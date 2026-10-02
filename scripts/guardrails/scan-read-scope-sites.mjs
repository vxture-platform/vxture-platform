#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scan-read-scope-sites.mjs — 读路径盘点：按**被执行的那条语句**数，不按模板串
//
// ## 为什么要换数法
//
// 2026-10-01 的 A2 第一轮按「反引号模板串 + 带 $n + SQL 文本里没有归属列」数出
// `services/**/repository/` 下 103 条，七个单元逐条判完报 0 缺口。完备性复核把这个数法
// 推翻了——它量的是**一种写法**而不是**一类读路径**，四个条件每一个都在切掉真实读路径：
//
//   · 整个 `bff/**` 不在分母里，**而归属门恰恰都写在那里** —— 各单元拿 console-bff 的
//     `loadOrderRow` 当凭据，却没人审过 console-bff 自己那几十条。这是循环论证；
//   · 判据两个方向都错：条件拼接的 `if (p.tenantId) conditions.push("tenant_id = …")`
//     在文本里有 `tenant_id`，于是被当成「已归属」排除 —— **而那正是 A1 立 ReadScope
//     要防的那一格**；反过来谓词住在另一个模板串里（`where ${where}`）又被当成「无归属」；
//   · 全仓带 `owner_col = $n` 的被当成「已归属」整体排除，而 A2 要问的那句话对它们一字
//     不改地成立：**那个 `$n` 是谁给的**；
//   · 双引号字符串拼出来的 SQL（ops/todos 把 SQL 拆成 head/columns/from/where 片段）整条看不见。
//
// ## 本扫描器的判据
//
// 单元 = `.query(` 调用点（`pool.query` / `client.query` / `tx.query` …），不是模板串。
// 对每个调用点：
//   ① 取第一个实参并**解析**：反引号 / 双引号 / 单引号字面量，或一个标识符 →
//      在同文件的 `const NAME = <字面量>` 里查；`${…}` 插值同样按标识符查一层。
//      查不到的插值记为 `unresolved`，**不当成「无谓词」也不当成「有谓词」**（它是第三档）。
//   ② 归属谓词三态，不是两态：
//        inline      —— 解析后的 SQL 文本里有 `owner_col` 与 `$n` 的比较；
//        conditional —— 所在函数体里有 `if (…) … push(… owner_col …)` 的形状。
//                       **这一档算「无谓词」**：调用方不传就没有这道过滤，而类型不强制它传。
//        none        —— 都没有。
//   ③ 对 inline / conditional，再问**那个 `$n` 从哪来**：看第二个实参（参数数组）里对应的
//      表达式。`req.user.*` / `req.tenant.*` / `req.session.*` / `s2sCaller.*` → `session`；
//      `params.* / body.* / input.* / query.*` → `caller`（请求给的）；其余 `unknown`。
//      一条带归属谓词、而值来自 `caller` 的查询，和一条没有谓词的查询**风险同级**。
//
// ## 自检：它必须先证自己看得见
//
// `--self-test` 拿复核点名的五条样本当反例喂进去，**五条全部命中才算这个数法能用**：
//   1 条件谓词            pg-subscription.repository.ts   conditions.push(`tenant_id = …`)
//   2 谓词在另一个串里    console-bff/audit.router.ts     const where = `al.tenant_id = $1 …`
//   3 双引号 + 拼装       pg-ops-todo.repository.ts       selectAll: "  select * from order_todos"
//   4 有谓词但值自报      pg-consume.repository.ts        where qp.workspace_id = $1（值经旧凭据可自报）
//   5 库内函数            95_triggers.sql                 metering.resolve_seat_max(...)
// 第 5 条**任何 TS 扫法都看不见**，所以自检只断言它被单独列进「看不见什么」那一节并计数，
// 不假装能扫到——「静态守卫要写下自己看不见什么」。
//
// ## 本扫描器看不见什么
//
//   · 库内的读（`95_triggers.sql` 里的 17 个 SELECT 在函数体内，调用方只写函数名）；
//   · 跨文件的片段（`const X` 在另一个模块里 import 进来）——记为 `unresolved`；
//   · 运行时才成立的事（某个分支到不到得了）；
//   · ORM / 查询构建器（本仓没有：`@prisma/client` 挂着但全仓零 import）。
//
// 运行：node scripts/guardrails/scan-read-scope-sites.mjs            （盘点，打表）
//      node scripts/guardrails/scan-read-scope-sites.mjs --self-test （先证它看得见）
//      node scripts/guardrails/scan-read-scope-sites.mjs --json      （喂给别的工具）
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SCAN_ROOTS = ["services", "bff", "packages"];
const SKIP = new Set(["node_modules", "dist", ".next", "coverage", "build"]);
const OWNER_COL =
  "(?:tenant_id|workspace_id|org_id|organization_id|owner_user_id)";
const OWNER_PRED = new RegExp(
  `\\b[\\w.]*${OWNER_COL}\\s*(?:=|in)\\s*(?:\\$\\d+|any\\s*\\()`,
  "i",
);
const PUSH_OWNER = new RegExp(`push\\s*\\([^)]*${OWNER_COL}`, "i");
const SELECTISH = /\b(select|with)\b/i;

/** 运营三平面按设计跨租户（现状文档 ③ 的口径），单独分组而不是算进缺口。 */
const OPERATOR_FACES = ["bff/admin-bff", "bff/opera-bff", "bff/arche-bff"];
const CUSTOMER_FACES = [
  "bff/console-bff",
  "bff/platform-api",
  "bff/website-bff",
  "bff/auth-bff",
];

const rel = (f) => relative(REPO_ROOT, f).replace(/\\/g, "/");

function walk(dir, out = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (
      n.endsWith(".ts") &&
      !/\.(spec|test)\.ts$/.test(n) &&
      !n.endsWith(".d.ts")
    )
      out.push(p);
  }
  return out;
}

/** 从 openIdx 处的开括号起按深度取到配对的闭括号，返回里面的内容。 */
function balanced(src, openIdx, open = "(", close = ")") {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const c = src[i];
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return "";
}

/** 同文件里的 `const NAME = <字面量>`（反引号 / 双引号 / 单引号），供插值与标识符解析。 */
function constMap(src) {
  const map = new Map();
  const re =
    /(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  let m;
  while ((m = re.exec(src))) map.set(m[1], m[2].slice(1, -1));
  // 对象字面量里的片段（ops/todos 的 `selectAll: "…"`）也收：按属性名登记。
  const prop = /(\w+)\s*:\s*("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  while ((m = prop.exec(src))) {
    if (!map.has(m[1])) map.set(m[1], m[2].slice(1, -1));
  }
  return map;
}

/** 解析一个实参表达式为 SQL 文本；返回 { sql, unresolved }。 */
function resolveSql(expr, consts, depth = 0) {
  const e = expr.trim();
  let unresolved = 0;
  if (depth > 3) return { sql: "", unresolved: 1 };
  const lit = /^(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/.exec(
    e,
  );
  if (lit) {
    let body = lit[1].slice(1, -1);
    // 反引号里的 ${…}：标识符能查到就替换，查不到记一笔 unresolved。
    body = body.replace(/\$\{([^}]*)\}/g, (_all, inner) => {
      const name = inner.trim().replace(/^\.\.\./, "");
      if (/^\$\{?\w*$/.test(name)) return "";
      if (consts.has(name)) {
        const r = resolveSql(`\`${consts.get(name)}\``, consts, depth + 1);
        unresolved += r.unresolved;
        return r.sql;
      }
      // `${idx++}` 这类是参数序号，不是片段 —— 不算 unresolved。
      if (/idx|i\s*\+\+|\+\+/.test(name)) return "1";
      unresolved += 1;
      return " /*UNRESOLVED*/ ";
    });
    return { sql: body, unresolved };
  }
  // 字符串拼接 a + b + c
  if (e.includes("+")) {
    let sql = "";
    for (const part of e.split("+")) {
      const r = resolveSql(part, consts, depth + 1);
      sql += r.sql;
      unresolved += r.unresolved;
    }
    return { sql, unresolved };
  }
  // 裸标识符
  const id = /^[\w.]+$/.exec(e);
  if (id && consts.has(e)) {
    const r = resolveSql(`\`${consts.get(e)}\``, consts, depth + 1);
    return { sql: r.sql, unresolved: r.unresolved };
  }
  return { sql: "", unresolved: 1 };
}

/** 包住某个偏移的最近一个函数体（用来找 conditions.push 那种形状）。 */
function enclosingBody(src, idx) {
  const head = src.lastIndexOf("async ", idx);
  const start = head === -1 ? Math.max(0, idx - 4000) : head;
  return src.slice(start, Math.min(src.length, idx + 4000));
}

/** 判断参数数组里的表达式是会话来的还是请求来的。 */
function paramOrigin(argsText) {
  if (
    /req\.(user|tenant|session)\b|s2sCaller\b|session\.|ctx\.(user|tenant)\b/.test(
      argsText,
    )
  )
    return "session";
  if (/\b(params|body|input|query|dto|filters)\./.test(argsText))
    return "caller-object";
  // **这一档不是「量不出来」，是「答案在调用链上」。** 仓储层最常见的形状是
  // `pool.query(sql, [tenantId, …])`，那个 `tenantId` 是本方法的入参 —— 它是谁给的，
  // 要顺着调用方往上看。这正是 A2 要问的那句话，文本启发式答不了它。
  return "needs-callgraph";
}

function faceOf(r) {
  if (OPERATOR_FACES.some((f) => r.startsWith(f))) return "operator";
  if (CUSTOMER_FACES.some((f) => r.startsWith(f))) return "customer";
  if (r.startsWith("services/")) return "service";
  if (r.startsWith("packages/")) return "package";
  return "other";
}

const files = SCAN_ROOTS.flatMap((r) => walk(join(REPO_ROOT, r)));
const sites = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!src.includes(".query")) continue;
  const consts = constMap(src);
  const r = rel(file);
  const re = /\.query\s*(?:<[^>]*>)?\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const openIdx = src.indexOf("(", m.index + m[0].length - 1);
    const argsRaw = balanced(src, openIdx);
    if (!argsRaw) continue;
    // 顶层逗号切分实参
    const parts = [];
    let d = 0;
    let cur = "";
    let inTpl = false;
    for (let i = 0; i < argsRaw.length; i += 1) {
      const ch = argsRaw[i];
      if (ch === "`") inTpl = !inTpl;
      if (!inTpl) {
        if ("([{".includes(ch)) d += 1;
        else if (")]}".includes(ch)) d -= 1;
        if (ch === "," && d === 0) {
          parts.push(cur);
          cur = "";
          continue;
        }
      }
      cur += ch;
    }
    parts.push(cur);
    const { sql, unresolved } = resolveSql(parts[0] ?? "", consts);
    if (!SELECTISH.test(sql) && unresolved === 0) continue; // 不是读
    const line = src.slice(0, m.index).split("\n").length;
    const body = enclosingBody(src, m.index);
    const pred = OWNER_PRED.test(sql)
      ? "inline"
      : PUSH_OWNER.test(body)
        ? "conditional"
        : "none";
    sites.push({
      at: `${r}:${line}`,
      face: faceOf(r),
      pred,
      unresolved,
      origin: pred === "none" ? "n/a" : paramOrigin(parts.slice(1).join(",")),
      head: sql.replace(/\s+/g, " ").trim().slice(0, 70),
    });
  }
}

// ── 待判集合（**必须在自检之前算出来**，见下） ────────────────────────────────
//
// **2026-10-02 修**：第一版的过滤是 `pred === "none" || "conditional"`，把整个 `inline`
// 档扔了 —— 而本文件头 :16-17 自己写着旧数法错在「把带 `owner_col = $n` 的整体排除，
// 而 A2 要问的那句话对它们一字不改地成立：**那个 `$n` 是谁给的**」。
// **数法改了、产物没改**：范围内 126 条 inline 一条都没进清单，其中 14 条扫描器自己标了
// `origin === "caller-object"`（值取自 `params./body./input.`），例如
// `pg-consume.repository.ts:141`（按自报 workspace 把配额池 for update 锁出来）。
//
// 更坏的是**自检当时还是绿的**：它断言样本④在内部 `sites` 数组里，而清单用的是这里过滤出来的
// `todo` —— 门绿着、产物瞎着。所以三处一起改：① 判据改成下面这条；② 计算提到自检之前；
// ③ 自检改成断言样本出现在 `todo` 里。
//
// 判据：范围内（客户面 / 服务层 / 包）且**不是「谓词在且值来自会话」**。
// 也就是 `inline + session` 才出局；`inline + caller-object` 与 `inline + needs-callgraph`
// 都要判 —— 后者正是「这个 `$n` 是谁给的」还没有答案的那一批。
const IN_SCOPE = new Set(["customer", "service", "package"]);
const todo = sites.filter(
  (s) =>
    IN_SCOPE.has(s.face) && !(s.pred === "inline" && s.origin === "session"),
);

// ── 自检 ───────────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  const SAMPLES = [
    {
      name: "① 条件谓词（文本里有 tenant_id，但调用方不传就没有这道过滤）",
      file: "services/commerce/subscription/src/repository/pg-subscription.repository.ts",
      want: (s) => s.pred === "conditional",
    },
    {
      name: "② 谓词住在另一个模板串里（单看 SELECT 文本一个归属列都没有）",
      file: "bff/console-bff/src/routers/audit.router.ts",
      want: (s) => s.pred === "inline",
    },
    {
      name: "③ 双引号 + 拼装（反引号与完整 SELECT 两个条件同时落空）",
      file: "services/ops/todos/src/repository/pg-ops-todo.repository.ts",
      want: () => true,
    },
    {
      name: "④ 有归属谓词、但那个 $n 的值经旧凭据可以自报",
      file: "services/commerce/subscription/src/repository/pg-consume.repository.ts",
      want: (s) => s.pred === "inline",
    },
  ];
  let bad = 0;
  console.log("══ 自检：先证这个数法看得见复核点名的那五条 ══\n");
  for (const smp of SAMPLES) {
    // **断言的是写出去的那份清单（todo），不是内部的 sites。**
    // 第一版断言 sites，于是「样本④在 sites 里」为真、而紧接着写出的 todo.json 里没有它
    // —— 自检绿着、产物瞎着。这一行就是那个教训。
    const hit = todo.filter(
      (s) => s.at.startsWith(`${smp.file}:`) && smp.want(s),
    );
    const ok = hit.length > 0;
    if (!ok) bad += 1;
    console.log(`${ok ? "✓" : "✗"} ${smp.name}`);
    console.log(
      `    ${smp.file} → 命中 ${hit.length} 条` +
        (ok
          ? `（如 ${hit[0].at} pred=${hit[0].pred}）`
          : "  ← 这个数法看不见它，不能用"),
    );
  }
  console.log(
    "\n✓ ⑤ 库内函数（95_triggers.sql 的 17 个 SELECT 在函数体内，调用方只写函数名）",
  );
  console.log(
    "    **任何 TS 扫法都看不见它**，所以不假装能扫到：它单列在本文件头的「看不见什么」一节，",
  );
  console.log("    要查只能读 DDL。这一条是写下来的盲区，不是通过的判据。");
  console.log(
    `\n── 汇总 ──\n看得见 ${SAMPLES.length - bad}/${SAMPLES.length} 条可扫样本`,
  );
  if (bad) {
    console.log("这个数法还不能用 —— 先让它看得见上面标 ✗ 的那几条。");
    process.exit(1);
  }
  console.log("四条可扫样本全部命中，第五条已登记为盲区。这个数法可以用了。");
  process.exit(0);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ total: sites.length, sites }, null, 2));
  process.exit(0);
}

// ── 盘点 ───────────────────────────────────────────────────────────────────
const by = (fn) => {
  const m = new Map();
  for (const s of sites) {
    const k = fn(s);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
};

console.log("══ 读路径盘点（按被执行的那条语句，不按模板串）══\n");
console.log(
  `扫 ${files.length} 份 .ts，命中 ${sites.length} 个 .query( 读调用点。\n`,
);

console.log("── 按面分组（运营三平面按设计跨租户，不是缺口）");
for (const [k, n] of by((s) => s.face))
  console.log(`   ${String(n).padStart(4)}  ${k}`);

console.log("\n── 按归属谓词三态");
for (const [k, n] of by((s) => s.pred))
  console.log(`   ${String(n).padStart(4)}  ${k}`);

console.log("\n── 带谓词的那些：那个 $n 是谁给的");
for (const [k, n] of by((s) => (s.pred === "none" ? null : s.origin)).filter(
  ([k]) => k,
))
  console.log(`   ${String(n).padStart(4)}  ${k}`);
console.log(
  "   （needs-callgraph 不是「量不出来」：那个值是本方法的入参，谁给的要顺调用方往上看 ——",
);
console.log("     这正是 A2 要逐条判的那句话，文本启发式答不了它。）");

console.log(
  "\n── 要逐条判的集合（客户面 + 服务层；只排除「谓词在且值来自会话」那一档）",
);
console.log(`   ${todo.length} 条`);
for (const [k, n] of by((s) => s.face).filter(([k]) =>
  ["customer", "service", "package"].includes(k),
)) {
  const t = todo.filter((s) => s.face === k).length;
  console.log(`     ${k}: ${t} / ${n}`);
}

const OUT = join(
  REPO_ROOT,
  "scripts",
  "guardrails",
  "read-scope-sites.todo.json",
);
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      note:
        "本文件由 scan-read-scope-sites.mjs 生成，是 A2 要逐条判调用链的集合（客户面 + 服务层，归属谓词 none 或 conditional）。" +
        "不是快照、不参与门禁 —— 只是把分母写下来供审查消费。旧数法那 103 条是按模板串数的，而且整个 bff/ 不在里面。",
      total: todo.length,
      sites: todo,
    },
    null,
    2,
  )}\n`,
);
console.log(`   → 清单已写出：${rel(OUT)}`);

const unres = sites.filter((s) => s.unresolved > 0);
console.log(
  `\n── 解析不出完整 SQL 的：${unres.length} 条（第三档，既不算有谓词也不算没有）`,
);
for (const s of unres.slice(0, 12)) console.log(`   ${s.at}  ${s.head}`);
if (unres.length > 12) console.log(`   …另 ${unres.length - 12} 条`);

console.log(
  "\n注：库内函数里的读（95_triggers.sql 17 个 SELECT）本扫描器看不见，见文件头「看不见什么」。",
);
