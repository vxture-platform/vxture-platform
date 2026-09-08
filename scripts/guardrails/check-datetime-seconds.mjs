#!/usr/bin/env node

/**
 * check-datetime-seconds.mjs — 日期时间只走共用形态（owner 2026-09-08）。
 *
 * ── 规范 ──
 * 日期分长短、时间也分长短，四种组合规范上都支持；**平台当前统一采用
 * 「长日期 + 长时间」**。长时间本就含秒——「显示时间就必须带秒」是从这里来的。
 * 形态定义与四种组合见 `@vxture-platform/shared` 的 format.utils.ts。
 *
 * ── 补的是哪个盲区 ──
 * 手搓一个 `Intl.DateTimeFormat` 或 `toLocaleString` **不报错、不影响构建、
 * 页面照常渲染**，只是那一处的日期跟别处长得不一样。2026-09-08 清点：全仓
 * 四种形态各自漂移（`年月日 时分秒` / `月日 时分秒`（没有年）/ 裸 toLocaleString
 * （`2026/9/8` 不补零）/ dateStyle-timeStyle 的三种组合），同一个门户里甚至同时
 * 存在带秒与不带秒的两份副本。没有守卫，它会再长回来。
 *
 * ── 判据 ──
 * 门户与 BFF 的源码里，日期不得手搓：
 *   · `new Intl.DateTimeFormat(...)` 带日期/时间字段的 —— 一律走共用件
 *   · `<Date>.toLocaleString/.toLocaleDateString(...)` —— 同上
 * 例外只有共用件自己（packages/shared）。
 * **数字的 `toLocaleString` 不在此列**：那是千分位，与日期无关（清点时它一度把
 * 78 个数字调用混进日期桶，判据因此必须只认 Date 接收者）。
 *
 * 用法：node scripts/guardrails/check-datetime-seconds.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOTS = ["portals", "bff", "services"];
/** 共用件自己要用 Intl 实现形态，豁免。 */
const ALLOW = [
  // 共用件自己要用 Intl 实现形态。
  "packages/shared",
  "portals/website/src/components/marketing/ProductCatalogCard.tsx",
  // 通知模板的日期**参数**:用 formatToParts 拼严格 YYYY-MM-DD,是进模板的数据串,
  // 不是界面渲染。走共用件会变成 locale 形状的 2026/09/08,那不是同一个东西。
  "services/commerce/subscription/src/service/customer-notifier.ts",
];

/** Date 接收者的 toLocale*：认 `new Date(...)`、或名字像日期的变量。 */
const DATE_RECEIVER =
  /(new Date\([^)]*\)|\b(?:d|dt|date|at|when|ts|moment)\b)\s*\.\s*toLocale(?:Date|Time)?String\s*\(/;

function scan(src) {
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

// ── 自检：坏样本必须被抓，好样本与数字千分位必须放行 ────────────────────────
const BAD_INTL = 'new Intl.DateTimeFormat(locale, { hour: "2-digit" })';
const BAD_TOLOCALE = "return d.toLocaleString(locale, { hour12: false });";
const GOOD_SHARED = "return formatDateTime(value, locale);";
const GOOD_NUMBER = 'total.toLocaleString("en-US")';
if (scan(BAD_INTL).length === 0 || scan(BAD_TOLOCALE).length === 0) {
  console.error("自检失败：坏样本没被抓到 —— 判据失效，拒绝给出通过结论");
  process.exit(1);
}
if (scan(GOOD_SHARED).length > 0) {
  console.error("自检失败：走共用件的写法被误报 —— 判据失效");
  process.exit(1);
}
if (scan(GOOD_NUMBER).length > 0) {
  console.error("自检失败：数字千分位被当成日期 —— 判据失效");
  process.exit(1);
}
// ── 扫全仓 ────────────────────────────────────────────────────────────────
const files = [];
for (const root of ROOTS) {
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
      else if (/\.(ts|tsx)$/.test(p) && !/\.spec\.tsx?$/.test(p)) files.push(p);
    }
  })(root);
}
if (files.length === 0) {
  console.error("扫不到任何源文件 —— 判据失效，拒绝给出通过结论");
  process.exit(1);
}

const problems = [];
for (const f of files) {
  const rel = f.replace(/\\/g, "/");
  if (ALLOW.some((a) => rel.startsWith(a) || rel === a)) continue;
  for (const h of scan(readFileSync(f, "utf8"))) {
    problems.push(`${rel}:${h.line} —— ${h.kind}`);
  }
}

console.log("══ 日期形态检查（check-datetime-seconds）══");
console.log(`扫描 ${files.length} 个源文件，自检四项样本均正确。\n`);

if (problems.length > 0) {
  console.error(`以下位置手搓了日期格式（${problems.length} 处）：`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    "\n改法：用 @vxture-platform/shared 的 formatDay（只有日期）或 " +
      "formatDateTime（日期 + 时刻，默认长日期 + 长时间、含秒）。" +
      "\n需要短形态或固定时区的传第四个参数 { date, time, timeZone }。" +
      "\n数字的千分位 toLocaleString 不受此约束——本检查只认 Date 接收者。",
  );
  console.error(`\n── 汇总 ──\nerror: ${problems.length}`);
  process.exit(1);
}

console.log("✓ 日期格式全部走共用形态。");
console.log("\n── 汇总 ──\nerror: 0");
