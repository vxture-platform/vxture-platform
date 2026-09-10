#!/usr/bin/env node

/**
 * check-seed-check-constraints.mjs — seed 写进列的字面值是否满足该列的 CHECK。
 *
 * ── 这条判据为什么存在 ──
 * 2026-09-17 的迁移把 `account.user_profiles.gender` 的 CHECK 收窄成
 * `IN ('male','female')`（「未设定」= NULL）。**三个 seed 一个都没跟着改**：
 *   · seed-sample.mjs      写 'unknown'
 *   · seed-demo.mjs        写 'unknown'
 *   · seed-bulk-core.mjs   从 ["male","female","unspecified"] 里挑
 *
 * 三周后才被发现——发现方式是生产上一次 `db-init provision-secrets` **整体失败**，
 * 而它真正要做的事（铸密钥）已经做完了，失败报的却是 seed 的错。
 *
 * 为什么这么久没人发现：seed 不在 CI 里跑（要真库），type-check 与 lint 看不出
 * 一个字符串字面量与某张表的约束冲突。**这一类缺陷没有任何现成信号。**
 *
 * ── 判据 ──
 * 从 DDL 里取每个 `col ... CHECK (col IN ('a','b'))` 的允许集，再扫 seed 的
 * `insert into <schema>.<table> (cols...) values (...)`，把**位置对应**的字面量
 * 取出来比对。只看字面量：`$1` 这类占位符、函数调用、表达式一律跳过——它们的值
 * 不在这里，硬猜只会造假阳性。
 *
 * NULL 一律放行：CHECK 对 NULL 求值为 unknown，不算违反（这正是「未设定」的表达）。
 *
 * 用法：node scripts/guardrails/check-seed-check-constraints.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DDL_DIR = "deploy/database/ddl";
const SEED_DIR = "deploy/database/seed";

/*
 * DDL 里 `col IN (...)` 有三种写法，三种都要认——只认一种的话覆盖率会低到让这条
 * 判据变成「已经检查过了」的假象：我第一版只认第 ① 种、而且字符类还挡掉了带
 * `DEFAULT 'x'` 的列行，171 个列只解析到 2 个，却照样报了「通过」。
 */
/**
 * ① 列行内联：`col varchar(16) NOT NULL DEFAULT 'x' CHECK (col IN ('a','b'))`。
 * 列名与 CHECK 之间用 `[^\n]*?`，不要用字符类——DEFAULT 值里的引号和逗号会把它挡住。
 */
const COL_CHECK_INLINE =
  /^[ \t]*([a-z_][a-z0-9_]*)\s+[^\n]*?CHECK\s*\(\s*\1\s+IN\s*\(([^)]*)\)/gim;
/** ② 表级具名：`CONSTRAINT chk_x CHECK (col IN ('a','b'))`。 */
const COL_CHECK_NAMED =
  /CONSTRAINT\s+[a-z_][a-z0-9_]*\s+CHECK\s*\(\s*([a-z_][a-z0-9_]*)\s+IN\s*\(([^)]*)\)/gi;
/** ③ 可空形式：`CHECK (col IS NULL OR col IN ('a','b'))`。NULL 本就放行，取同一个允许集。 */
const COL_CHECK_NULLABLE =
  /CHECK\s*\(\s*([a-z_][a-z0-9_]*)\s+IS\s+NULL\s+OR\s+\1\s+IN\s*\(([^)]*)\)/gi;
const ALL_CHECK_PATTERNS = [
  COL_CHECK_INLINE,
  COL_CHECK_NAMED,
  COL_CHECK_NULLABLE,
];

/** 从 DDL 收集 `schema.table.column -> Set(允许值)`。 */
function collectChecks() {
  const out = new Map();
  for (const f of readdirSync(DDL_DIR).filter((n) => n.endsWith(".sql"))) {
    const src = readFileSync(path.join(DDL_DIR, f), "utf8");
    // 逐个 CREATE TABLE 分段，才能知道列属于哪张表。
    const tableRe = /CREATE TABLE\s+([a-z_]+)\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi;
    for (const t of src.matchAll(tableRe)) {
      const [, schema, table, body] = t;
      for (const re of ALL_CHECK_PATTERNS) {
        re.lastIndex = 0;
        for (const m of body.matchAll(re)) {
          const [, col, list] = m;
          const allowed = new Set(
            [...list.matchAll(/'([^']*)'/g)].map((x) => x[1]),
          );
          if (allowed.size === 0) continue;
          const key = `${schema}.${table}.${col}`;
          /* 一列可能被两种写法同时命中；取并集会放宽判定，先到的为准即可
             （DDL 里一列不会同时挂两条互相矛盾的 IN 约束）。 */
          if (!out.has(key)) out.set(key, allowed);
        }
      }
    }
  }
  return out;
}

/** 从 `open`（指向左括号）向后配平，返回对应右括号的下标；找不到返回 -1。 */
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === "'") {
      // 跳过字符串字面量：里面的括号与逗号都不是结构。
      i += 1;
      while (i < src.length && src[i] !== "'") i += 1;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 按**顶层**逗号切分：`now(), 'a,b'` 是两项，不是四项。 */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'") {
      cur += c;
      i += 1;
      while (i < text.length && text[i] !== "'") {
        cur += text[i];
        i += 1;
      }
      cur += "'";
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

/**
 * 从一段 `insert into s.t (a, b, c) values (x, y, z)` 里取出「列 → 字面量」。
 *
 * 列表与值表都**按括号配平**取，不能用 `[^)]*`：值里几乎一定有 `now()`，
 * 那个 `)` 会把捕获截断，于是列数与值数对不上、整条 insert 被**静默跳过**。
 * 我第一版正是这么写的——判据全绿，却一个 insert 都没真正检查到
 * （把已知的坏值塞回去也不报，这是反向验证抓出来的）。
 *
 * 遇到看不懂的形状**跳过而不是猜**：猜出来的假阳性会让人干脆关掉这条判据。
 */
function* insertsOf(src) {
  const head = /insert\s+into\s+([a-z_]+)\.([a-z_]+)\s*\(/gi;
  for (const m of src.matchAll(head)) {
    const [, schema, table] = m;
    const colsOpen = m.index + m[0].length - 1;
    const colsEnd = balanced(src, colsOpen);
    if (colsEnd < 0) continue;
    const colsRaw = src.slice(colsOpen + 1, colsEnd);

    // 列表与 values 之间可能夹注释行。
    const after = src.slice(colsEnd + 1);
    const vm = /^\s*(?:--[^\n]*\n\s*)*values\s*\(/i.exec(after);
    if (!vm) continue;
    const valsOpen = colsEnd + vm[0].length;
    const valsEnd = balanced(src, valsOpen);
    if (valsEnd < 0) continue;
    const valsRaw = src.slice(valsOpen + 1, valsEnd);

    const cols = colsRaw.split(",").map((c) => c.trim());
    const vals = splitTopLevel(valsRaw);
    if (cols.length !== vals.length) continue; // 形状不符，跳过
    const line = src.slice(0, m.index).split("\n").length;
    yield { schema, table, cols, vals, line };
  }
}

/** 只认得出「确定的字符串字面量」；其余（占位符/表达式/NULL）返回 null = 不判。 */
function literalOf(raw) {
  const v = raw.trim();
  if (/^null$/i.test(v)) return null; // NULL：CHECK 求值为 unknown，不违反
  const m = /^'([^']*)'$/.exec(v);
  return m ? m[1] : null;
}

// ── 自检：判据自己先过样本，样本不过就退出，不给结论 ──────────────────────
const fail = (why) => {
  console.error(`自检失败：${why} —— 判据失效，拒绝给出通过结论`);
  process.exit(1);
};
{
  const sample = `insert into account.user_profiles
      (user_id, display_name, gender, bio)
    values ($1, $2, 'unknown', 'x')`;
  const got = [...insertsOf(sample)];
  if (got.length !== 1) fail("解析不出简单 insert");
  const idx = got[0].cols.indexOf("gender");
  if (idx < 0) fail("列名没解析出来");
  if (literalOf(got[0].vals[idx]) !== "unknown") fail("字面量没取出来");
  if (literalOf("$1") !== null) fail("占位符被当成了字面量");
  if (literalOf("NULL") !== null) fail("NULL 被当成了字面量");
  if (literalOf("now()") !== null) fail("函数调用被当成了字面量");
}

const checks = collectChecks();
/*
 * 覆盖率下限。判据「读不到」时必须抛，不能安静地给一个「通过」——第一版就是只解析到
 * 2 个列却报了通过，那和真的检查过长得一模一样，而它其实什么都没管住。
 * 这个数字按当前 DDL 的量级定；DDL 大改后它会先红，那正是要人看一眼的时刻。
 */
const MIN_COLUMNS = 120;
if (checks.size < MIN_COLUMNS) {
  fail(
    `只从 DDL 解析到 ${checks.size} 个带 CHECK…IN 的列（下限 ${MIN_COLUMNS}）——` +
      `解析器多半跟不上 DDL 的写法了。先修解析器；确认 DDL 真的变少了再调下限。`,
  );
}

const problems = [];
for (const f of readdirSync(SEED_DIR).filter((n) => n.endsWith(".mjs"))) {
  const rel = `${SEED_DIR}/${f}`;
  const src = readFileSync(rel, "utf8");
  for (const ins of insertsOf(src)) {
    for (let i = 0; i < ins.cols.length; i += 1) {
      const key = `${ins.schema}.${ins.table}.${ins.cols[i]}`;
      const allowed = checks.get(key);
      if (!allowed) continue;
      const lit = literalOf(ins.vals[i]);
      if (lit === null) continue; // 不是确定字面量，不判
      if (!allowed.has(lit)) {
        problems.push(
          `${rel}:${ins.line} —— ${key} 写入 '${lit}'，` +
            `但该列的 CHECK 只允许 {${[...allowed].join(", ")}}（NULL 另算，表示未设定）`,
        );
      }
    }
  }
}

console.log(`扫描：${checks.size} 个带 CHECK…IN 的列 × ${readdirSync(SEED_DIR).filter((n) => n.endsWith(".mjs")).length} 份 seed`);
if (problems.length > 0) {
  console.error(`\n✗ seed 写入了列 CHECK 不允许的值：\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    `\n改法：写该列允许的值；「未设定 / 未知」一律用 NULL，不要自造 'unknown' / 'unspecified'。\n` +
      `收窄某列 CHECK 的迁移，必须同批检查 seed——两者不成对时,seed 要到真库上跑才会炸。\n`,
  );
  console.error(`── 汇总 ──\nerror: ${problems.length}`);
  process.exit(1);
}
console.log("✓ seed 写入的字面量都满足对应列的 CHECK。");
console.log("── 汇总 ──\nerror: 0");
