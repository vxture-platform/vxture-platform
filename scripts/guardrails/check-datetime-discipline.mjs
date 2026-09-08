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
 * 执法方式：门户与 BFF 不得手搓日期格式，一律走共用件（下面 §1）。
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

const FORMATTER = /\b(formatDay|formatDateTime|sharedDay|sharedDateTime)\s*\(/;
/** Date 接收者的 toLocale*：认 `new Date(...)`、或名字像日期的变量。 */
const DATE_RECEIVER =
  /(new Date\([^)]*\)|\b(?:d|dt|date|at|when|ts|moment)\b)\s*\.\s*toLocale(?:Date|Time)?String\s*\(/;
/** 写调用的开头。命中后按括号配平圈出实参区间。 */
const WRITE_OPENER =
  /\b(?:api|http|client)\s*\.\s*(?:post|put|patch|delete)\s*\(|\bJSON\.stringify\s*\(|\bbody\s*:\s*\{|\.query\s*\(/;

// ── §1 手搓日期格式 ────────────────────────────────────────────────────────
function scanHandRolled(src) {
  const lines = src.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
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
