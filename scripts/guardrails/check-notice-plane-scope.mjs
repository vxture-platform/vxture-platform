#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-notice-plane-scope.mjs — 运营通告的**平面谓词**守卫（A2 第四轮，2026-10-03）
//
// ## 为什么只守这一张表
//
// 「运营三平面严格隔离」这条，在**数据层**只落在一个地方：全仓 DDL 里带平面维度的列
// 只有一个 —— `admin.operator_notices.target_planes`（数过：整个 `deploy/database/ddl/`
// 里 `plane` 相关的列就这一个）。其余运营表（审计日志、会话、角色…）按设计是全平台视角，
// 平面隔离靠的是**权限码的域**（`check-operator-planes.mjs` 守那一轴）与 BFF 的平面门。
//
// 所以这一轴的数据层缺陷面很小 —— 而它**已经出过一次**：
// `markRead` 少了一道平面谓词，而同一文件里 `list` 与 `markAllRead` 都有
// （2026-10-02 修于 #568）。那一处的注释自己写着「动作作用域必须**字面等于**视图作用域」，
// 而它当时正是唯一一条没拄那段文本的分支。**同一个判据长在一条分支上，另一条就是门没关。**
//
// 本守卫把「第四条访问路径不许跳过这道谓词」变成 lint 期的红。
//
// ## 判据：三档，不是两档
//
// 只写「每条读都必须带平面谓词」会把**合法的发布者视图**判红 —— 那就从门变成了墙。
// opera 是发布平面：它的管理列表要看见自己发给 admin / arche 的那些，所以它
// **不过滤**平面，而是把平面算成一列 `on_this_plane` 投影出去。这是对的。
//
//   ① filtered   —— 带 `target_planes = '{}' or $n = any(target_planes)` 且**不是**
//                   `… as 别名` 的形态。读路径的正解。
//   ② projected  —— 同一个表达式跟着 `) as on_this_plane`。
//                   发布者视图的正解：看得见全部，但标出哪些落在本平面。
//   ③ neither    —— 必须在下面 `ALLOW` 里登记，并写清为什么。没登记就红。
//
// ①②**用的是同一段文本**（共享仓储的注释说的正是这件事：动作作用域必须字面等于视图
// 作用域），所以区分它们靠的是后面跟不跟 `as 别名`，不是靠「在 WHERE 里还是在 SELECT 里」
// —— 后者要解析 SQL 才知道，而本守卫不解析。两处真实用法这个区分点都分得开；
// 将来有人把同一个表达式既投影又过滤地写在一条语句里，本守卫会判成 filtered（偏严的方向）。
//
// 「空数组 = 全部平面」是唯一表示（写侧把「三个都选」收敛成 `'{}'`），所以
// `target_planes = '{}'` 这一半是判据的必需部分 —— 少了它，面向全平面的通告会一条都看不见。
//
// ## 看不见什么
//
//   · 库内函数 / 视图里的 SQL：本守卫只扫仓库里的模板串；
//   · 运行期拼出来的表名（本仓没有这种写法）；
//   · 「这道谓词绑的值对不对」：`$1` 必须是本 BFF 自己的 `PLANE_NAME`（从 `PLANE_ROOT`
//     派生，不是请求参数）。那是人读的事，守卫只看谓词在不在。
//
// 运行：node scripts/guardrails/check-notice-plane-scope.mjs
//      node scripts/guardrails/check-notice-plane-scope.mjs --self-test
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SKIP = new Set(["node_modules", "dist", ".next", "coverage", "build"]);
const TABLE = "admin.operator_notices";

/**
 * 不带平面谓词、也不投影它的语句 —— 每条写清为什么。
 * 新增一条必须来这里登记；登记了却已经带上谓词也红（登记表不许过期）。
 */
const OPERA_NOTICES = "bff/opera-bff/src/routers/operator-notices.router.ts";
const NOTICE_REPO =
  "services/notification/notice/src/repository/pg-notice.repository.ts";

const ALLOW = {
  [`${OPERA_NOTICES}|insert|sql:168a793a9e`]:
    "发布：opera 是发布平面，这条 INSERT 自己写 target_planes",
  [`${OPERA_NOTICES}|update|sql:50af179c1d`]:
    "撤回（软删）：opera 发得到任何平面，就撤得回任何平面——加平面谓词反而会让它撤不回自己发出去的那条",
  [`${OPERA_NOTICES}|select|sql:65dd5e23f3`]:
    "撤回前的存在性探测（只回 id，用来把「已撤回」与「不存在」分开）",
  [`${NOTICE_REPO}|insert|CREATE_SYSTEM_NOTICE_SQL`]:
    "系统通告落库：巡检作业是发布者，自己定 target_planes",
};

const rel = (f) => relative(ROOT, f).replace(/\\/g, "/");

/** 语句的内容身份：空白归一后取 sha256 前 10 位。 */
const digestOf = (text) =>
  createHash("sha256")
    .update(text.replace(/\s+/g, " ").trim())
    .digest("hex")
    .slice(0, 10);

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
    else if (/\.(ts|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

/**
 * 把同一文件里的 `${CONST}` 展开 —— 谓词常常**住在另一个模板串里**
 * （`where ${VISIBLE_WHERE}`）。不展开就会把带谓词的那些误判成不带，
 * 这是上一个扫描器踩过的坑。
 */
function expandTemplates(src) {
  const consts = new Map();
  const re = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_]\w*)\s*=\s*`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(src))) consts.set(m[1], m[2]);
  const expand = (text, depth = 0) => {
    if (depth > 6) return text;
    let changed = false;
    const out = text.replace(/\$\{([A-Za-z_]\w*)\}/g, (whole, name) => {
      if (!consts.has(name)) return whole;
      changed = true;
      return consts.get(name);
    });
    return changed ? expand(out, depth + 1) : out;
  };
  const resolved = new Map();
  for (const [k, v] of consts) resolved.set(k, expand(v));
  return { consts: resolved, expand };
}

/**
 * 平面谓词的两半。「空数组 = 全部平面」那一半是必需的 —— 少了它，面向全平面的通告
 * 一条都看不见。
 */
const PLANE_EXPR = /target_planes\s*=\s*'\{\}'\s*or\s*\$\d+\s*=\s*any\(\s*n?\.?target_planes\s*\)/gi;

/**
 * 「过滤」与「投影」**用的是同一段文本** —— 共享仓储那份注释说的正是这件事：
 * 动作作用域必须字面等于视图作用域。所以不能靠「文本里有没有这个表达式」分开两者。
 * 唯一可靠又便宜的区分点是它后面跟什么：跟 `) as <名字>` 的是投影（发布者视图），
 * 否则是过滤（读路径）。两处真实用法都能被它分开，而这比去解析 SQL 划算。
 */
const AS_ALIAS = /^\s*\)?\s*as\s+\w+/i;

function classify(text) {
  PLANE_EXPR.lastIndex = 0;
  let m;
  let sawFilter = false;
  let sawProjection = false;
  while ((m = PLANE_EXPR.exec(text))) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (AS_ALIAS.test(after)) sawProjection = true;
    else sawFilter = true;
  }
  if (sawFilter) return "filtered";
  if (sawProjection) return "projected";
  return "neither";
}

const VERBS = [
  ["insert", /\binsert\s+into\s+admin\.operator_notices/i],
  ["update", /\bupdate\s+admin\.operator_notices/i],
  ["delete", /\bdelete\s+from\s+admin\.operator_notices/i],
  ["select", /\b(from|join)\s+admin\.operator_notices/i],
];

/**
 * 一段文本里碰到这张表的语句。**按语句各算一条，不按（文件，动词）合并。**
 *
 * 第一版是按（文件，动词）合并、取最弱那一档的 —— 于是 opera 那份文件里
 * 「撤回前的存在性探测」（登记在册、确实不该有谓词）把**同一个动词**的管理列表
 * 整条盖掉了：报出来的是一条 `select / 都没有`，而它被一条为探测写的 ALLOW 放行。
 * 粒度错了不会报错，只会让一条真缺的谓词藏在为另一条语句写的豁免后面。
 * 现在每条语句自带身份（常量名，或行内串的内容摘要）。
 */
/**
 * 先去掉注释再扫。本仓的注释里**大量**用反引号引标识符
 * （`` `admin.operator_notices` ``、`` `uq_operator_notices_system` ``），
 * 而行内模板串是按反引号取的 —— 不去注释的话，一句说明文字就会被当成一条语句。
 * 今天凑巧没造成假阳（光一个表名命中不了任何动词），但那是运气不是设计：
 * 注释里写一句 `insert into admin.operator_notices …` 当例子就会误报。
 * 只去块注释与「整行是注释」的行，不碰行中的 `//`（那可能是模板串里的 URL）。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

function statementsInText(rawSrc, label) {
  const src = stripComments(rawSrc);
  if (!src.includes(TABLE)) return [];
  const { consts, expand } = expandTemplates(src);

  /** `[身份, 展开后的文本]`：每个 const 一条，外加文件里行内出现的模板串。 */
  const chunks = [...consts].map(([name, text]) => [name, text]);
  // 行内串（没有常量名的那些）**按内容取身份，不按出现位置**。
  // 位置式身份（`inline#5`）会随它上面任何一次无关改动整体漂移，于是登记表在
  // 下一次提交里就指错了语句 —— 今天在另一个扫描器上刚踩过这件事（样本写死行号，
  // 而行号早漂了一行）。内容摘要还有一个正确的副作用：**语句改了身份就变**，
  // 于是它必须被重新判一次，而不是继承上一版的豁免。
  const inline = /`([\s\S]*?)`/g;
  let m;
  while ((m = inline.exec(src))) {
    const text = expand(m[1]);
    if (!text.includes(TABLE)) continue;
    chunks.push([`sql:${digestOf(text)}`, text]);
  }

  const out = [];
  const seen = new Set();
  for (const [name, text] of chunks) {
    if (!text.includes(TABLE)) continue;
    for (const [verb, re] of VERBS) {
      if (!re.test(text)) continue;
      const cls = classify(text);
      // 同一条语句既在 const 里又被行内串扫到时只留一条：按「动词 + 分档 + 长度」去重。
      const dedupe = `${verb}|${cls}|${text.replace(/\s+/g, " ").trim().slice(0, 120)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({ file: label, verb, stmt: name, cls });
    }
  }
  return out;
}

function statementsIn(file) {
  return statementsInText(readFileSync(file, "utf8"), rel(file));
}

function scan(files) {
  const out = [];
  for (const f of files) out.push(...statementsIn(f));
  return out.sort((a, b) =>
    `${a.file}|${a.verb}|${a.stmt}`.localeCompare(`${b.file}|${b.verb}|${b.stmt}`),
  );
}

const FILES = walk(ROOT).filter((f) => !/\.(spec|test)\.ts$/.test(f));
const stmts = scan(FILES);

// ── 自检 ───────────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  let bad = 0;
  const say = (ok, msg) => {
    if (!ok) bad += 1;
    console.log(`${ok ? "✓" : "✗"} ${msg}`);
  };
  console.log("══ 自检：先证这个判据看得见已知的三档，并且会对反例说话 ══\n");

  const repo = stmts.filter((s) =>
    s.file.endsWith("services/notification/notice/src/repository/pg-notice.repository.ts"),
  );
  const sel = repo.find((s) => s.verb === "select");
  say(
    sel?.cls === "filtered",
    `共享仓储的读带平面谓词（${sel ? sel.cls : "没扫到"}）` +
      "  —— 这里面有 #568 修的那条 markRead",
  );

  const opera = stmts.filter((s) =>
    s.file.endsWith("bff/opera-bff/src/routers/operator-notices.router.ts"),
  );
  const opSel = opera.find((s) => s.verb === "select");
  say(
    opSel !== undefined,
    `发布者视图被扫到了（${opSel ? opSel.cls : "没扫到"}）` +
      "  —— 它按设计不过滤平面，所以必须有 projected 或登记这一档，不能只有「必须过滤」一条规则",
  );

  // 反例一：把平面谓词从共享仓储里摘掉 → 必须报。
  const victim = join(
    ROOT,
    "services/notification/notice/src/repository/pg-notice.repository.ts",
  );
  const orig = readFileSync(victim, "utf8");
  const holed = orig.replace(
    /and \(n\.target_planes = '\{\}' or \$1 = any\(n\.target_planes\)\)/,
    "",
  );
  say(orig !== holed, "反例能构造出来（找到那一行平面谓词）");
  const probe = (() => {
    const saved = readFileSync(victim, "utf8");
    try {
      // 不落盘：直接对改过的文本重跑分类逻辑。
      const tmp = statementsInText(holed, rel(victim));
      return tmp.find((s) => s.verb === "select")?.cls;
    } finally {
      void saved;
    }
  })();
  say(
    probe === "neither",
    `摘掉那道谓词之后，判据把它归成 ${probe}（要 neither）` +
      "  —— 判据必须会动，不然它只是看起来在拦",
  );

  // 反例二：登记表不许过期 —— 登记了却已经合规的要报。
  const stale = Object.keys(ALLOW).filter((k) => {
    const [file, verb, stmt] = k.split("|");
    const hit = stmts.find(
      (s) => s.file === file && s.verb === verb && s.stmt === stmt,
    );
    return hit && hit.cls !== "neither";
  });
  const orphan = Object.keys(ALLOW).filter(
    (k) => !stmts.some((s) => `${s.file}|${s.verb}|${s.stmt}` === k),
  );
  say(
    stale.length === 0 && orphan.length === 0,
    `登记表既没过期也没指向不存在的语句（已合规却仍登记 ${stale.length} 条、` +
      `指向扫不到的语句 ${orphan.length} 条）`,
  );

  console.log(`\n── 汇总 ──\n看得见 ${5 - bad}/5 项判据`);
  if (bad) {
    console.log("判据还不能用 —— 先让它看得见上面标 ✗ 的那几条。");
    process.exit(1);
  }
  console.log("三档都看得见、反例会报、登记表不过期。这个判据可以用了。");
  process.exit(0);
}

// ── 门禁 ───────────────────────────────────────────────────────────────────
const failures = [];

// 登记了、而扫描器一条都没扫到的那些 —— **豁免活得比它的理由久**的另一种形态。
// 第一版的 ALLOW 里有三条就是这样：我按「哪些文件提到这张表」写豁免，而那三份
// 只在注释里提过，真正的写入走共享仓储。为不存在的语句发许可，读起来像「已经判过了」。
const seenKeys = new Set(stmts.map((s) => `${s.file}|${s.verb}|${s.stmt}`));
for (const key of Object.keys(ALLOW)) {
  if (!seenKeys.has(key)) {
    failures.push(
      `登记表指向不存在的语句：${key}\n` +
        "    扫描器没扫到它。要么那条语句已经删了（把这一行也删掉），" +
        "要么它换了内容（身份是内容摘要，改了就要重新判一次）。",
    );
  }
}

for (const s of stmts) {
  const key = `${s.file}|${s.verb}|${s.stmt}`;
  if (s.cls !== "neither") {
    if (ALLOW[key]) {
      failures.push(
        `登记表过期：${key} 已经是 ${s.cls} 了，却还登记在 ALLOW 里。删掉那一行。`,
      );
    }
    continue;
  }
  if (!ALLOW[key]) {
    failures.push(
      `${key} 碰了 ${TABLE} 却既不带平面谓词、也不把它投影出来。\n` +
        "    读路径要带 `target_planes = '{}' or $n = any(target_planes)`（两半都要，" +
        "空数组那一半是「全平面」的唯一表示）；\n" +
        "    发布者视图把它投影成 `… as on_this_plane`；\n" +
        "    确实两者都不该有的，去 ALLOW 里登记并写清为什么。",
    );
  }
}

console.log(`══ 运营通告平面谓词：扫到 ${stmts.length} 条语句`);
for (const s of stmts) {
  const mark = s.cls === "filtered" ? "过滤" : s.cls === "projected" ? "投影" : "都没有";
  console.log(`   ${mark.padEnd(4)} ${s.verb.padEnd(6)} ${s.stmt.padEnd(22)} ${s.file}`);
}
if (stmts.length === 0) {
  console.log("\n✗ 一条都没扫到 —— 那不是「通过」，是判据瞎了（表名改了？）。");
  process.exit(1);
}
if (failures.length) {
  console.log(`\n✗ ${failures.length} 条`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log("\n✓ 每条都带平面谓词、或投影出来、或已登记。");
