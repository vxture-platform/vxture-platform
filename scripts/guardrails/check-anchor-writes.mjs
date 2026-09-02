#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-anchor-writes.mjs — 应用代码里的 SQL UPDATE 不许碰锚点列（TD-018 铁律八的消费方守卫）
//
// ── 补的是哪个盲区 ──
// 98_column_locks.sql 用列级 REVOKE/GRANT 把锚点列（主键 / `_no` / created_at /
// created_by …）锁死，但**列锁只对非-owner 角色生效**：开发与 CI 以 owner `vxture`
// 连库，锁在那里是摆设；代码里一条 `update billing.invoices set … transaction_no = $5`
// 在开发库畅通无阻，到生产（platform_svc）就是 42501 permission denied——而且是**整条
// 事务回滚**，界面只看到 Internal server error。2026-09-02 owner 走真实支付链路点
// 「确认收款」实测到这一条；同款还有发票寄送/开具（express_no / invoice_electronic_no）。
//
// check-column-locks.mjs 只校验"锁的形状"（98 与 DDL 一致）。本守卫校验"锁的消费方"：
// 静态扫 bff/ 与 services/ 里每一条 `UPDATE schema.table … SET …`，把 SET 列表里的
// 列名对照 98 里该表的 GRANT UPDATE(...) 白名单——白名单之外的列一律报错。判据与 98
// 完全同源，不另起一套规则。
//
// ── 判定范围与已知盲点 ──
// · 只认 `update <schema>.<table> [alias] set … (where|from|returning)` 这一形状，
//   SET 列表按顶层逗号切分、取每段 `col =` 左侧的列名（括号内的逗号不切）。
// · 动态拼接的列名（`set ${col} = …`）扫不出来，那种写法本身就该避免。
// · 表不在 98 里（无锁）→ 跳过；`update` 出现在注释/字符串里但不是 SQL → 只要表名对
//   得上也会被扫，误报按 ALLOWLIST 处理并写明理由。
//
// 运行：pnpm lint:anchor-writes（node scripts/guardrails/check-anchor-writes.mjs）
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const LOCKS_FILE = join(
  REPO_ROOT,
  "deploy",
  "database",
  "ddl",
  "98_column_locks.sql",
);
const SCAN_ROOTS = ["bff", "services"].map((d) => join(REPO_ROOT, d));
const rel = (f) => relative(REPO_ROOT, f).replace(/\\/g, "/");

/** 显式豁免（"file:schema.table.column" → 理由）。空表 = 没有豁免，就该如此。 */
const ALLOWLIST = new Map([]);

// ── 98：每张表的可写列白名单 ─────────────────────────────────────────────────
function parseGrants() {
  const src = readFileSync(LOCKS_FILE, "utf8");
  const revoked = new Set();
  const granted = new Map();
  let m;
  const revokeRe = /REVOKE UPDATE ON (\w+)\.(\w+) FROM platform_svc;/g;
  while ((m = revokeRe.exec(src))) revoked.add(`${m[1]}.${m[2]}`);
  const grantRe = /GRANT UPDATE \(([^)]*)\) ON (\w+)\.(\w+) TO platform_svc;/g;
  while ((m = grantRe.exec(src))) {
    granted.set(
      `${m[2]}.${m[3]}`,
      new Set(
        m[1]
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      ),
    );
  }
  return { revoked, granted };
}

// ── 代码：找 UPDATE 语句，抽 SET 列 ─────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".next", "coverage"].includes(entry.name))
      continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (
      /\.(ts|js|mjs)$/.test(entry.name) &&
      !/\.(spec|test)\.[tj]s$/.test(entry.name)
    )
      out.push(full);
  }
  return out;
}

/** 顶层逗号切分（忽略括号内）。 */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

const UPDATE_RE =
  /\bupdate\s+(\w+)\.(\w+)(?:\s+(?:as\s+)?(?!set\b)\w+)?\s+set\b([\s\S]*?)(?=\bwhere\b|\bfrom\b|\breturning\b|;|`)/gi;

function extractSetColumns(setClause) {
  const cols = [];
  for (const seg of splitTopLevel(setClause)) {
    const m = seg.match(/^\s*(?:\w+\.)?(\w+)\s*=/);
    if (m) cols.push(m[1]);
  }
  return cols;
}

const { revoked, granted } = parseGrants();
const findings = [];
let scannedFiles = 0;
let scannedUpdates = 0;

for (const root of SCAN_ROOTS) {
  let files;
  try {
    if (!statSync(root).isDirectory()) continue;
    files = walk(root);
  } catch {
    continue;
  }
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!/\bupdate\s+\w+\.\w+/i.test(src)) continue;
    scannedFiles++;
    let m;
    UPDATE_RE.lastIndex = 0;
    while ((m = UPDATE_RE.exec(src))) {
      const key = `${m[1]}.${m[2]}`;
      if (!revoked.has(key)) continue; // 表无列锁，不在本守卫范围
      scannedUpdates++;
      const writable = granted.get(key) ?? new Set();
      const line = src.slice(0, m.index).split("\n").length;
      for (const col of extractSetColumns(m[3])) {
        if (writable.has(col)) continue;
        const allowKey = `${rel(file)}:${key}.${col}`;
        if (ALLOWLIST.has(allowKey)) continue;
        findings.push({ file: rel(file), line, key, col });
      }
    }
  }
}

console.log("══ 锚点列写入检查（check-anchor-writes）══");
console.log(
  `扫描 ${scannedFiles} 个含 UPDATE 的文件、${scannedUpdates} 条命中列锁表的 UPDATE，对照 ${rel(LOCKS_FILE)}。\n`,
);
if (findings.length) {
  for (const f of findings) {
    console.log(
      `  ERROR ${f.file}:${f.line}  UPDATE ${f.key} 写了锚点列 \`${f.col}\`（98 未授权 platform_svc）—— 生产会 42501 整条回滚。` +
        ` 一次写入的单号请在 INSERT 时给；真属"晚绑定"的列加入 column-locks.shared.mjs LATE_BOUND_WRITABLE 并同步 98 + 迁移 GRANT。`,
    );
  }
  console.log("\n── 汇总 ──");
  console.log(`error: ${findings.length}`);
  process.exit(1);
}
console.log("✓ 所有 UPDATE 语句只写各表白名单内的列。");
console.log("\n── 汇总 ──");
console.log("error: 0");
