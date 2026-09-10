#!/usr/bin/env node

/**
 * check-datetime-discipline.mjs — 日期时间的三条纪律（owner 2026-09-08）。
 *
 * ══ 一、界面到秒 ══
 * 日期分长短、时间也分长短，四种组合规范上都支持；**平台当前统一采用
 * 「长日期 + 长时间」**。长时间本就含秒——「显示时间就必须带秒」是从这里来的：
 * 排查订单、审计、通知时，同一分钟内的先后顺序恰恰最要紧，两个「15:04」摆在
 * 一起看不出谁先谁后。形态定义见 `@vxture-platform/shared` 的 format.utils.ts。
 *
 * 执法方式：门户与 BFF 不得手搓日期格式，一律走共用件（下面 §1）。手搓有三种写法，
 * 三种都要认——只认前两种时，console 的 `hubModel.ts` 拿第三种（分量 getter + padStart）
 * 写了三个格式化函数，67 处调用，从守卫底下整整走过去。
 *
 * ══ 二、存储到微秒 ══
 * **界面到秒是产品口径，不是精度上限。** 库里一律 `timestamptz`（默认精度 6，
 * 即微秒）；写成 `timestamptz(0)` 会把记录本身截到秒，那是不可逆的信息丢失——
 * 界面上少显示几位随时能加回来，库里截掉的补不回来。
 *
 * 执法方式：DDL 与迁移里不得出现降精度的 `timestamp[tz](N<6)`（下面 §2）。
 *
 * ══ 三、格式化函数禁止流入写路径 ══
 * `formatDay` / `formatDateTime` 是**纯显示**函数：吃时间、吐给人看的字符串
 * （`2026/09/08 15:04:05`，locale 形状，本来就解析不回时间戳）。它的输出一旦
 * 进了请求体或写库，等于把一个到微秒的时间戳换成一个到秒、还带 locale 口音的
 * 字符串——**不报错、不影响构建**，只在几个月后表现为「这条记录的时间对不上」。
 *
 * 执法方式：写调用（api.post/put/patch、fetch 的 body、JSON.stringify）的实参
 * 里不得出现这两个函数（下面 §3）。要往服务端送时间，送 ISO 串或原值。
 *
 * 判据自己先用内置样本自检；样本不过就退出，不给结论。
 *
 * 用法：node scripts/guardrails/check-datetime-discipline.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SRC_ROOTS = ["portals", "bff", "services"];
const DDL_ROOTS = ["deploy/database/ddl", "deploy/database/migrations"];

/** 共用件自己要用 Intl 实现形态；另两处见注释。 */
const ALLOW_SRC = [
  "packages/shared",
  "portals/website/src/components/marketing/ProductCatalogCard.tsx",
  // 通知模板的日期**参数**：用 formatToParts 拼严格 YYYY-MM-DD，是进模板的数据串，
  // 不是界面渲染。走共用件会变成 locale 形状的 2026/09/08，那不是同一个东西。
  "services/commerce/subscription/src/service/customer-notifier.ts",
];

/**
 * 只对这条 §1c 生效的豁免——**不是**整个 §1 的豁免。
 * 这两处补零拼串是对的，理由各自写在文件里：
 */
const ALLOW_PADDED = [
  // 本地时区 yyyy-MM-dd，是算周期起止用的**数据键**，形状必须固定、与语言无关。
  "portals/console/src/modules/commerce/components/CyclePicker.tsx",
  // 用量图表的**轴标**（小时档只要 `14:00` 这个刻度），规范里短形态点名的场合。
  "portals/console/src/modules/commerce/UsagePage.tsx",
];

const FORMATTER = /\b(formatDay|formatDateTime|sharedDay|sharedDateTime)\s*\(/;
/** Date 接收者的 toLocale*：认 `new Date(...)`、或名字像日期的变量。 */
const DATE_RECEIVER =
  /(new Date\([^)]*\)|\b(?:d|dt|date|at|when|ts|moment)\b)\s*\.\s*toLocale(?:Date|Time)?String\s*\(/;
/**
 * 第三种手搓方式：拿 Date 的分量 getter 自己补零拼串。
 *
 * 前两条认的是 `toLocale*` 和 `new Intl.DateTimeFormat`——那是「用了 Intl 但绕开
 * 共用件」。这一条认的是**连 Intl 都没用**：`String(d.getMonth() + 1).padStart(2, "0")`。
 * console 的 `hubModel.ts` 里三个格式化函数（41 + 22 + 4 处调用）正是这么写的，
 * 从前两条眼皮底下整整走过去——不看语言、英文界面照样输出中文形状，`fmtTime`
 * 还漏了秒。**判据只认得两种手搓方式，第三种就等于没设防。**
 */
const PADDED_DATE_PART =
  /\.get(?:Month|Date|Hours|Minutes|Seconds)\s*\(\s*\)[^;\n]*\.padStart\s*\(/;
/** 写调用的开头。命中后按括号配平圈出实参区间。 */
const WRITE_OPENER =
  /\b(?:api|http|client)\s*\.\s*(?:post|put|patch|delete)\s*\(|\bJSON\.stringify\s*\(|\bbody\s*:\s*\{|\.query\s*\(/;

/**
 * 整行都是注释吗（`//`、`/*`、JSDoc 续行的 `*`）。
 *
 * 按行匹配时**注释和代码长得一模一样**。这条判据要拦的写法，恰恰最常被引在注释里
 * ——「原先是 xxx，已经改掉了」。把那种行报成缺陷，等于逼着人不许在注释里说明白
 * 自己改了什么，而说明白正是注释存在的理由。
 *
 * 只看整行注释：行尾跟在代码后面的注释不处理。那种位置写下这类样例极罕见，
 * 真遇上了，正确做法是把它挪到独立一行，而不是让判据去猜哪半边是代码。
 */
function isCommentLine(line) {
  const s = line.trimStart();
  return s.startsWith("//") || s.startsWith("*") || s.startsWith("/*");
}

// ── §1 手搓日期格式 ────────────────────────────────────────────────────────
function scanHandRolled(src) {
  const lines = src.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (isCommentLine(lines[i])) continue;
    if (DATE_RECEIVER.test(lines[i])) {
      hits.push({ line: i + 1, kind: "手搓 toLocale*（Date 接收者）" });
    }
  }
  for (const m of src.matchAll(/new Intl\.DateTimeFormat/g)) {
    const win = src.slice(m.index, m.index + 260);
    if (/(year|month|day|hour|minute|second|dateStyle|timeStyle)\s*:/.test(win)) {
      hits.push({
        line: src.slice(0, m.index).split("\n").length,
        kind: "手搓 Intl.DateTimeFormat",
      });
    }
  }
  return hits;
}

/** §1c 单独一支，因为它有自己的豁免名单（见 ALLOW_PADDED）。 */
function scanPaddedParts(src) {
  const lines = src.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (isCommentLine(lines[i])) continue;
    if (PADDED_DATE_PART.test(lines[i])) {
      hits.push({
        line: i + 1,
        kind: "手搓补零拼串（Date 分量 getter + padStart）",
      });
    }
  }
  return hits;
}

// ── §3 格式化结果流入写路径 ────────────────────────────────────────────────
/**
 * 从写调用的开括号起按**括号配平**圈出实参区间，看里面有没有格式化调用。
 * 配平只在这一小段上做（实参区间通常十几行），不跨 JSX——那正是我反复解析出错的地方。
 */
function scanIntoWrites(src) {
  const hits = [];
  for (const m of src.matchAll(new RegExp(WRITE_OPENER, "g"))) {
    const openIdx = src.indexOf(m[0].endsWith("{") ? "{" : "(", m.index);
    if (openIdx < 0) continue;
    const openCh = src[openIdx];
    const closeCh = openCh === "{" ? "}" : ")";
    let depth = 0;
    let end = openIdx;
    for (let i = openIdx; i < src.length && i < openIdx + 4000; i += 1) {
      if (src[i] === openCh) depth += 1;
      else if (src[i] === closeCh) {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const region = src.slice(openIdx, end + 1);
    if (FORMATTER.test(region)) {
      hits.push({
        line: src.slice(0, openIdx).split("\n").length,
        kind: "格式化结果进了写调用的实参",
      });
    }
  }
  return hits;
}

// ── §2 降精度的时间列 ──────────────────────────────────────────────────────
function scanPrecision(sql) {
  const hits = [];
  for (const m of sql.matchAll(/\btimestamptz?\s*\(\s*(\d)\s*\)/gi)) {
    if (Number(m[1]) < 6) {
      hits.push({
        line: sql.slice(0, m.index).split("\n").length,
        kind: `时间列被截到 10^-${m[1]} 秒（应留默认精度 6 = 微秒）`,
      });
    }
  }
  return hits;
}

// ── 自检 ──────────────────────────────────────────────────────────────────
const S = {
  badIntl: 'new Intl.DateTimeFormat(locale, { hour: "2-digit" })',
  badToLocale: "return d.toLocaleString(locale, { hour12: false });",
  goodShared: "return formatDateTime(value, locale);",
  goodNumber: 'total.toLocaleString("en-US")',
  badPadded: 'const m = String(d.getMonth() + 1).padStart(2, "0");',
  badPaddedHour: 'return `${String(d.getHours()).padStart(2, "0")}:00`;',
  /** 补零的不是日期分量就不该报——序号、编号、金额都会 padStart。 */
  goodPadded: 'const seq = String(index + 1).padStart(2, "0");',
  /** 取了分量但没补零拼串（做的是比较 / 计算），也不该报。 */
  goodDateMath: "if (a.getMonth() !== b.getMonth()) return false;",
  /** 注释里引用旧写法说明「已经改掉了」——不是缺陷。 */
  goodInComment:
    ' * 原先是 `${String(d.getMonth() + 1).padStart(2, "0")}`，已改走 Intl。',
  goodInLineComment:
    '// 别再写 String(d.getHours()).padStart(2, "0") 这种，走共用件。',
  goodToLocaleInComment: "// 旧代码是 d.toLocaleString(locale, {}) ，已退役。",
  badWrite:
    'await api.patch(url, {\n  checkedAt: formatDateTime(new Date(), locale),\n});',
  goodRender: "cell: (item) => formatDateTime(item.updatedAt, locale),",
  goodWrite: 'await api.patch(url, { isSatisfied: true, remark: r.detail });',
  badPrecision: "created_at timestamptz(0) NOT NULL",
  goodPrecision: "created_at timestamptz NOT NULL DEFAULT now()",
};
const fail = (why) => {
  console.error(`自检失败：${why} —— 判据失效，拒绝给出通过结论`);
  process.exit(1);
};
if (!scanHandRolled(S.badIntl).length) fail("手搓 Intl 没被抓到");
if (!scanHandRolled(S.badToLocale).length) fail("手搓 toLocaleString 没被抓到");
if (scanHandRolled(S.goodShared).length) fail("走共用件的写法被误报");
if (scanHandRolled(S.goodNumber).length) fail("数字千分位被当成日期");
if (!scanPaddedParts(S.badPadded).length) fail("手搓补零拼串没被抓到");
if (!scanPaddedParts(S.badPaddedHour).length) fail("手搓补零拼小时没被抓到");
if (scanPaddedParts(S.goodPadded).length) fail("序号补零被当成日期");
if (scanPaddedParts(S.goodDateMath).length) fail("日期比较被当成拼串");
if (scanPaddedParts(S.goodInComment).length) fail("JSDoc 里引用旧写法被误报");
if (scanPaddedParts(S.goodInLineComment).length) fail("行注释里的样例被误报");
if (scanHandRolled(S.goodToLocaleInComment).length)
  fail("行注释里的 toLocale* 被误报");
if (!scanIntoWrites(S.badWrite).length) fail("格式化进写调用没被抓到");
if (scanIntoWrites(S.goodRender).length) fail("表格渲染被误报成写调用");
if (scanIntoWrites(S.goodWrite).length) fail("不含格式化的写调用被误报");
if (!scanPrecision(S.badPrecision).length) fail("降精度的时间列没被抓到");
if (scanPrecision(S.goodPrecision).length) fail("默认精度的时间列被误报");

// ── 扫仓 ──────────────────────────────────────────────────────────────────
function collect(roots, exts) {
  const out = [];
  for (const root of roots) {
    (function walk(d) {
      let es;
      try {
        es = readdirSync(d);
      } catch {
        return;
      }
      for (const e of es) {
        if (["node_modules", ".next", "dist", "coverage"].includes(e)) continue;
        const p = path.join(d, e);
        let st;
        try {
          st = statSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(p);
        else if (exts.test(p) && !/\.spec\.tsx?$/.test(p)) out.push(p);
      }
    })(root);
  }
  return out;
}

const srcFiles = collect(SRC_ROOTS, /\.(ts|tsx)$/);
const ddlFiles = collect(DDL_ROOTS, /\.sql$/);
if (srcFiles.length === 0) fail("扫不到源文件");
if (ddlFiles.length === 0) fail("扫不到 DDL / 迁移");

const problems = [];
for (const f of srcFiles) {
  const rel = f.replace(/\\/g, "/");
  const src = readFileSync(f, "utf8");
  if (!ALLOW_SRC.some((a) => rel.startsWith(a))) {
    for (const h of scanHandRolled(src)) {
      problems.push(`§1 ${rel}:${h.line} —— ${h.kind}`);
    }
    /* §1c 的豁免是**这一条自己的**：上面两条对这两个文件仍然生效。 */
    if (!ALLOW_PADDED.includes(rel)) {
      for (const h of scanPaddedParts(src)) {
        problems.push(`§1c ${rel}:${h.line} —— ${h.kind}`);
      }
    }
  }
  // §3 对共用件自己也生效——它没有写路径，命中即真有问题。
  for (const h of scanIntoWrites(src)) {
    problems.push(`§3 ${rel}:${h.line} —— ${h.kind}`);
  }
}
for (const f of ddlFiles) {
  const rel = f.replace(/\\/g, "/");
  for (const h of scanPrecision(readFileSync(f, "utf8"))) {
    problems.push(`§2 ${rel}:${h.line} —— ${h.kind}`);
  }
}

console.log("══ 日期时间纪律检查（check-datetime-discipline）══");
console.log(
  `源码 ${srcFiles.length} 个、DDL/迁移 ${ddlFiles.length} 个；自检九项样本均正确。\n`,
);

if (problems.length > 0) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    "\n§1 改法：用 @vxture-platform/shared 的 formatDay / formatDateTime；" +
      "需要短形态或固定时区传第四参 { date, time, timeZone }。" +
      "\n§2 改法：时间列写 `timestamptz`，不要带精度——界面少显示几位随时能加回来，" +
      "库里截掉的补不回来。" +
      "\n§3 改法：往服务端送时间用 ISO 串或原值；格式化函数只用于给人看。",
  );
  console.error(`\n── 汇总 ──\nerror: ${problems.length}`);
  process.exit(1);
}

console.log("✓ 界面到秒、存储到微秒、格式化不入写路径——三条都成立。");
console.log("\n── 汇总 ──\nerror: 0");
