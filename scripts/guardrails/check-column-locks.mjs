#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 锚点列列级锁 linter（TD-018；data_platform_100_architecture.md §3.2.4 检测器 #4）
//
// 独立于 check-data-architecture.mjs（该脚本只扫 docs/**/*.md）——本检测器扫的是
// deploy/database/ddl/*.sql 本身，验证 98_column_locks.sql 与 10_*.sql..80_*.sql
// 的实际列定义保持一致，防止"加了新表/新列却忘了同步列锁"的静默漂移。
//
// 判定规则（与 98_column_locks.sql 头注一致，唯一权威）：
//   ① 主键列（含复合、1:1 子表 PK=FK）；② 任意 `_no` 后缀列；③ `created_at`；
//   ④ `created_by`；⑤ 显式安全语义列白名单（目前仅 admin.operator_role.rank）。
// 对每张表核对：
//   · 98_column_locks.sql 必须有 `REVOKE UPDATE ON schema.table FROM platform_svc;`
//   · 若该表有 ≥1 可写列，必须有对应 `GRANT UPDATE (...) ON schema.table TO platform_svc;`，
//     且列清单与规则推导结果**完全一致**（不多不少——多了=漏锁一个锚点，少了=误锁一个业务列）。
//   · 若该表全部列均为锚点（无可写列），只应有 REVOKE、不应有 GRANT UPDATE。
//
// 运行：  node scripts/guardrails/check-column-locks.mjs
// 别名：  pnpm lint:column-locks
// 退出码：存在不一致 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRA_ANCHOR, LATE_BOUND_WRITABLE } from './column-locks.shared.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const DDL_DIR = join(REPO_ROOT, 'deploy', 'database', 'ddl');
const LOCKS_FILE = join(DDL_DIR, '98_column_locks.sql');
const rel = (f) => f.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');

// 规则⑤显式锚点 + 规则②的晚绑定例外，两个守卫共用一份（column-locks.shared.mjs）。

// 表定义所在文件（排除跨 schema FK / 触发器 / 分区 / 本检测器目标文件本身）。
const TABLE_FILES = readdirSync(DDL_DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .filter((f) => !['90_cross_schema_fk.sql', '95_triggers.sql', '96_partitions.sql', '97_service_roles.sql', '98_column_locks.sql'].includes(f))
  .sort();

const CONSTRAINT_KEYWORDS = /^(CONSTRAINT|PRIMARY KEY|FOREIGN KEY|REFERENCES|UNIQUE|CHECK|EXCLUDE)\b/i;

function parseTables() {
  const tables = new Map(); // "schema.table" -> { columns: Set, pk: Set }
  for (const file of TABLE_FILES) {
    const src = readFileSync(join(DDL_DIR, file), 'utf8');
    const re = /CREATE TABLE\s+(\w+)\.(\w+)\s*\(([\s\S]*?)\n\)(?:\s*PARTITION BY[^;]*)?;/g;
    let m;
    while ((m = re.exec(src))) {
      const [, schema, table, body] = m;
      const columns = [];
      const pk = new Set();
      for (const raw of body.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('--')) continue;
        const noComment = line.replace(/--.*$/, '').trim();
        if (!noComment) continue;
        const compositePk = noComment.match(/PRIMARY KEY\s*\(([^)]+)\)/i);
        if (compositePk) compositePk[1].split(',').forEach((c) => pk.add(c.trim()));
        if (CONSTRAINT_KEYWORDS.test(noComment)) continue;
        const colMatch = noComment.match(/^(\w+)\s+/);
        if (!colMatch) continue;
        columns.push(colMatch[1]);
        if (/PRIMARY KEY/i.test(noComment)) pk.add(colMatch[1]);
      }
      if (columns.length) tables.set(`${schema}.${table}`, { columns, pk });
    }
  }
  return tables;
}

function expectedAnchors(key, def) {
  const anchors = new Set();
  for (const c of def.columns) {
    if (def.pk.has(c)) anchors.add(c);
    // 规则②：`_no` 锚点，减去晚绑定例外（INSERT 之后才有值的单号，见 shared）。
    if (/_no$/.test(c) && !LATE_BOUND_WRITABLE.has(`${key}.${c}`)) anchors.add(c);
    if (c === 'created_at') anchors.add(c);
    if (c === 'created_by') anchors.add(c);
    if (EXTRA_ANCHOR.has(`${key}.${c}`)) anchors.add(c);
  }
  return anchors;
}

// 解析 98_column_locks.sql：每张表的 REVOKE 是否存在 + GRANT UPDATE(...) 的实际列清单。
function parseLocksFile() {
  const src = readFileSync(LOCKS_FILE, 'utf8');
  const revoked = new Set();
  const granted = new Map(); // "schema.table" -> [col,...]
  const revokeRe = /REVOKE UPDATE ON (\w+)\.(\w+) FROM platform_svc;/g;
  let m;
  while ((m = revokeRe.exec(src))) revoked.add(`${m[1]}.${m[2]}`);
  const grantRe = /GRANT UPDATE \(([^)]*)\) ON (\w+)\.(\w+) TO platform_svc;/g;
  while ((m = grantRe.exec(src))) {
    const cols = m[1].split(',').map((c) => c.trim()).filter(Boolean);
    granted.set(`${m[2]}.${m[3]}`, cols);
  }
  return { revoked, granted };
}

const tables = parseTables();
const { revoked, granted } = parseLocksFile();
const findings = [];

for (const [key, def] of tables) {
  const anchors = expectedAnchors(key, def);
  const writable = def.columns.filter((c) => !anchors.has(c));

  if (!revoked.has(key)) {
    findings.push({ key, msg: `缺少 REVOKE UPDATE（98_column_locks.sql 未覆盖此表——新表未同步列锁？）` });
    continue;
  }

  const grantedCols = granted.get(key);
  if (writable.length === 0) {
    if (grantedCols) {
      findings.push({ key, msg: `全部列均为锚点，不应有 GRANT UPDATE（当前误授: ${grantedCols.join(', ')}）` });
    }
    continue;
  }
  if (!grantedCols) {
    findings.push({ key, msg: `有 ${writable.length} 个可写列（${writable.join(', ')}）但缺少 GRANT UPDATE(...)` });
    continue;
  }
  const grantedSet = new Set(grantedCols);
  const writableSet = new Set(writable);
  const missingFromGrant = writable.filter((c) => !grantedSet.has(c));
  const anchorLeakedIntoGrant = grantedCols.filter((c) => anchors.has(c));
  const unknownInGrant = grantedCols.filter((c) => !writableSet.has(c) && !anchors.has(c));
  if (missingFromGrant.length) {
    findings.push({ key, msg: `GRANT UPDATE 漏列可写列: ${missingFromGrant.join(', ')}（新增列未同步授权）` });
  }
  if (anchorLeakedIntoGrant.length) {
    findings.push({ key, msg: `GRANT UPDATE 误含锚点列: ${anchorLeakedIntoGrant.join(', ')}（列锁失效）` });
  }
  if (unknownInGrant.length) {
    findings.push({ key, msg: `GRANT UPDATE 含已不存在的列: ${unknownInGrant.join(', ')}（表结构已变更，列锁未同步）` });
  }
}

// 反向：98_column_locks.sql 里锁了一张 DDL 里已经不存在的表（改名/删表后残留）。
for (const key of new Set([...revoked, ...granted.keys()])) {
  if (!tables.has(key)) {
    findings.push({ key, msg: `98_column_locks.sql 锁定了 DDL 中不存在的表（表已改名/删除，列锁残留未清理）` });
  }
}

console.log('══ 锚点列列级锁检查（check-column-locks）══');
console.log(`扫描 ${tables.size} 张表（${TABLE_FILES.length} 个 DDL 文件），对照 ${rel(LOCKS_FILE)}。\n`);

if (findings.length === 0) {
  console.log('✓ 未发现问题（全部表的列锁与实际结构一致）。');
} else {
  for (const f of findings.sort((a, b) => a.key.localeCompare(b.key))) {
    console.log(`  ERROR [${f.key}]  ${f.msg}`);
  }
  console.log('');
}

console.log('── 汇总 ──');
console.log(`error: ${findings.length}`);
process.exit(findings.length > 0 ? 1 : 0);
