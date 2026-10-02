#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-read-scope.mjs — 共用列表仓储的读取作用域：可选的那些不许被客户面接上
//
// ## 补的是哪个盲区
//
// 共用列表仓储（账单 / 工单 / 评价 / 支付 …）被**客户面与运营面共用**，于是租户过滤
// 写成了可选参数：`if (params.tenantId) { conditions.push("tenant_id = $n") }`。
// 运营三平面不传是对的（按设计跨租户）；**客户面忘了传，返回的就是所有租户的行**——
// SQL 合法、类型通过、测试通过、界面照常渲染，只是多了别人的数据。
//
// 2026-10-01 逐条核过：今天所有调用方都传对了，所以这是潜在隐患不是现行缺陷。
// 真正会发生的将来失败不是「现有调用方忘了传」，是**「今天只有运营面调用的共用方法，
// 将来被客户面接上了」**——那一刻没有任何东西会响。本守卫就守这一格。
//
// 彻底的修法是把作用域变成必填的判别联合（`ReadScope`，见
// `packages/shared/shared/src/types/read-scope.types.ts`），漏了编译不过。已迁的不再
// 出现在本守卫的清单里；没迁的留在快照里，并且**不许被客户面引用**。
//
// ## 判据
//
// ① 扫 `services/**` 与 `packages/**` 的 `export interface`：名字像查询参数
//    （List*/Query*/Find*/Search* + Params/Input/Query），且含可选归属字段
//    （tenantId? / workspaceId? / orgId? / organizationId?）而**没有**必填归属字段。
//    ——「有必填归属字段 + 可选的另一个」是**收窄**不是缺口（如 GovernanceContext
//    的 orgId 必填、workspaceId 可选），不报。
// ② 这些类型必须在快照里登记，每条带 reason；新出现的 → 红。
// ③ 对每条登记项，推导出「哪个 class 的哪个方法」收它，然后检查客户面三个 BFF
//    （console-bff / platform-api / website-bff）有没有**同时**提到那个 class 和
//    `.method(` —— 命中即红（可选作用域被客户面接上了）。
//
// ## 本守卫看不见什么
//
//   · 调用方**有没有真的传**那个可选字段——静态看不出，这正是要改类型的原因；
//   · 不经 service class 的调用（直连 repository、动态派发）；
//   · 方法名在客户面文件里碰巧出现（如 `.list(`）会误报——所以要求 class 名同现，
//     但同一文件里既用该 service 又调别的 `.list(` 仍可能误报：那种情况把调用改成
//     显式作用域（即彻底修法），不要加豁免；
//   · 写入路径（Create*/Update*Input）不在范围内：写入的归属来自被写的行本身。
//
// 运行：node scripts/guardrails/check-read-scope.mjs
//      node scripts/guardrails/check-read-scope.mjs --update   （重算快照）
// 退出码：新增可选作用域类型 / 登记项被客户面引用 / 快照不符 → 1
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SNAPSHOT = join(REPO_ROOT, "scripts", "guardrails", "read-scope.snapshot.json");
const UPDATE = process.argv.includes("--update");

const SCAN_ROOTS = ["services", "packages"];
const CUSTOMER_FACES = ["bff/console-bff", "bff/platform-api", "bff/website-bff"];
const SKIP = new Set(["node_modules", "dist", ".next", "coverage", "build"]);

const PARAMS_NAME = /^(List|Query|Find|Search|Get)\w*(Params|Query|Filter)$/;
const OWNER = "(?:tenantId|workspaceId|orgId|organizationId)";
const OPT_FIELD = new RegExp(`^\\s*(?:readonly\\s+)?${OWNER}\\?\\s*:`, "m");
const REQ_FIELD = new RegExp(`^\\s*(?:readonly\\s+)?${OWNER}\\s*:`, "m");
const IFACE = /export\s+interface\s+(\w+)[^{]*\{/g;

const rel = (f) => relative(REPO_ROOT, f).replace(/\\/g, "/");

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** 从 `{` 起按深度取到配对的 `}`。 */
function blockAt(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return "";
}

// ── ① 找出可选作用域的查询参数类型 ───────────────────────────────────────────
const serviceFiles = SCAN_ROOTS.flatMap((r) => walk(join(REPO_ROOT, r)));
const found = new Map(); // typeName -> { file, line }
for (const file of serviceFiles) {
  const src = readFileSync(file, "utf8");
  IFACE.lastIndex = 0;
  let m;
  while ((m = IFACE.exec(src))) {
    const name = m[1];
    if (!PARAMS_NAME.test(name)) continue;
    const body = blockAt(src, m.index + m[0].length - 1);
    if (!OPT_FIELD.test(body)) continue;
    if (REQ_FIELD.test(body)) continue; // 有必填归属字段 ⇒ 可选的是收窄
    found.set(name, { file: rel(file), line: src.slice(0, m.index).split("\n").length });
  }
}

// ── ①b 另一条枚举：**方法签名里的匿名内联参数** ──────────────────────────────
//
// ① 只认命名的 `export interface`，所以
// `async listAuditLogs(params: { actorId?: string; tenantId?: string; … })`
// 这种形状一个都看不见 —— 它没有类型名可匹配。2026-10-02 的完备性复核点名了这一处：
// `PgTicketRepository.listAuditLogs` 读 `support.audit_logs`、可选 `tenantId`、
// 条件拼接谓词，既不在本守卫的快照里、也不在 A2 的清单里，而今天只有 arche-bff 调它
// —— 客户面接上去那天没有任何东西会响。
//
// 判据：`async <method>(<arg>: { … })`，内联对象里有可选归属字段而**没有**必填归属字段。
// 没有类型名可登记，所以条目登记的是 `Class.method` 本身。
const INLINE_CLASS_RE = /export\s+class\s+(\w+)/g;
const INLINE_RE = /async\s+(\w+)\s*\(\s*\w+\s*:\s*\{/g;
const inlineFound = new Map(); // "Class.method" -> { file, line }
for (const file of serviceFiles) {
  const src = readFileSync(file, "utf8");
  INLINE_RE.lastIndex = 0;
  let im;
  while ((im = INLINE_RE.exec(src))) {
    const openIdx = src.indexOf("{", im.index + im[0].length - 1);
    const body = blockAt(src, openIdx);
    if (!OPT_FIELD.test(body)) continue;
    if (REQ_FIELD.test(body)) continue; // 有必填归属字段 ⇒ 可选的是收窄
    let cls = null;
    INLINE_CLASS_RE.lastIndex = 0;
    let cm;
    while ((cm = INLINE_CLASS_RE.exec(src)) && cm.index < im.index) cls = cm[1];
    inlineFound.set(`${cls ?? "?"}.${im[1]}`, {
      file: rel(file),
      line: src.slice(0, im.index).split("\n").length,
    });
  }
}

// ── ③ 推导 class.method：哪个方法收这个参数类型 ──────────────────────────────
const CLASS_RE = /export\s+class\s+(\w+)/g;
function ownersOf(typeName) {
  const out = [];
  for (const file of serviceFiles) {
    const src = readFileSync(file, "utf8");
    if (!src.includes(typeName)) continue;
    const callRe = new RegExp(`async\\s+(\\w+)\\s*\\([^)]*:\\s*${typeName}\\b`, "g");
    let mm;
    while ((mm = callRe.exec(src))) {
      // 往上找最近的 export class
      let cls = null;
      CLASS_RE.lastIndex = 0;
      let cm;
      while ((cm = CLASS_RE.exec(src)) && cm.index < mm.index) cls = cm[1];
      out.push({ cls, method: mm[1], file: rel(file) });
    }
  }
  return out;
}

const findings = [];
const entries = [];
for (const [name, where] of [...found.entries()].sort()) {
  const owners = ownersOf(name);
  entries.push({
    type: name,
    declaredAt: `${where.file}:${where.line}`,
    // 存成字符串而不是数组：prettier 会把短数组折成一行，而本守卫 --update 写的是
    // JSON.stringify 的多行形态，两者不一致会让每次重算都把 format 门顶红。
    takenBy: owners
      .map((o) => `${o.cls ?? "?"}.${o.method}`)
      .sort()
      .join(", "),
    kind: "named",
  });
}

// 内联参数那一批：没有类型名，`type` 记 `Class.method`，`takenBy` 就是它自己
// （它既是声明处也是收参数的那个方法）。
for (const [key, where] of [...inlineFound.entries()].sort()) {
  entries.push({
    type: key,
    declaredAt: `${where.file}:${where.line}`,
    takenBy: key,
    kind: "inline",
  });
}

// 客户面文件索引
const customerFiles = CUSTOMER_FACES.flatMap((f) => walk(join(REPO_ROOT, f))).map((f) => ({
  rel: rel(f),
  src: readFileSync(f, "utf8"),
}));

for (const e of entries) {
  for (const taken of e.takenBy.split(", ").filter(Boolean)) {
    const [cls, method] = taken.split(".");
    if (!cls || cls === "?") continue;
    for (const cf of customerFiles) {
      if (!cf.src.includes(cls)) continue;
      if (!new RegExp(`\\.${method}\\s*\\(`).test(cf.src)) continue;
      const where =
        e.kind === "inline"
          ? `签名里的内联参数，${e.declaredAt}`
          : `参数类型 ${e.type}，${e.declaredAt}`;
      findings.push(
        `${cf.rel}  客户面调用了可选作用域的 ${cls}.${method}（${where}）\n` +
          `      → 把那个归属字段改成必填 \`scope: ReadScope\`（见 packages/shared/shared/src/types/read-scope.types.ts），不要加豁免`,
      );
    }
  }
}

const actual = {
  note:
    "本文件由 check-read-scope.mjs --update 生成，不要手改。登记的是「归属作用域仍为可选」的共用读取入口，" +
    "两条枚举：kind=named 是命名的查询参数类型；kind=inline 是**方法签名里的匿名内联参数**" +
    "（2026-10-02 补的第二条判据——原来只按类型名枚举，所以 PgTicketRepository.listAuditLogs 这种形状一个都看不见）。" +
    "它们今天只被运营面调用，所以可选是安全的。条目只应减少（迁成必填 scope），增加必须是有意的。",
  optionalScopeTypes: entries.length,
  entries,
};

console.log("══ 读取作用域（check-read-scope）══");
console.log(
  `  · 扫 ${serviceFiles.length} 个 services/packages 源文件、${customerFiles.length} 个客户面源文件`,
);
console.log(`  · 归属作用域仍为可选的查询参数类型 ${entries.length} 个`);

if (UPDATE) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
  console.log("  · 快照已重算：scripts/guardrails/read-scope.snapshot.json");
}

let expected = null;
try {
  expected = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
} catch {
  if (!UPDATE) {
    findings.push(
      "快照缺失或不可解析 —— 先跑 `node scripts/guardrails/check-read-scope.mjs --update` 并入库",
    );
  }
}

if (expected && !UPDATE) {
  const a = new Set(actual.entries.map((e) => `${e.type} @ ${e.declaredAt} <- ${e.takenBy}`));
  const b = new Set(
    (expected.entries ?? []).map((e) => `${e.type} @ ${e.declaredAt} <- ${e.takenBy}`),
  );
  for (const x of [...a].filter((v) => !b.has(v))) {
    findings.push(
      `新增（或改变）了可选作用域的查询参数类型：${x}\n` +
        "      → 新写的列表查询应当一开始就用必填 `scope: ReadScope`；确实要留可选的，跑 --update 并在 PR 里写明为什么它只能被运营面调用",
    );
  }
  for (const x of [...b].filter((v) => !a.has(v))) {
    findings.push(`登记项消失了：${x}\n      → 迁成必填 scope 是好事，跑 --update 把它从清单里去掉`);
  }
}

if (findings.length) {
  console.log("");
  for (const f of findings) console.log(`  ERROR ${f}`);
  console.log("\n── 汇总 ──");
  console.log(`error: ${findings.length}`);
  process.exit(1);
}
console.log("✓ 可选作用域的清单与快照一致，且没有一个被客户面接上。");
console.log("\n── 汇总 ──");
console.log("error: 0");
