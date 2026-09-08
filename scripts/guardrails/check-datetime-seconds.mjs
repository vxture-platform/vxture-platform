#!/usr/bin/env node

/**
 * check-datetime-seconds.mjs — 显示了时分的地方必须显示到秒（owner 2026-09-08）。
 *
 * ── 补的是哪个盲区 ──
 * 缺一个秒**不报错、不影响构建、页面照常渲染**，只是表里那一列少两个字符。
 * 排查订单、审计、通知这类东西时，同一分钟内的先后顺序恰恰是最要紧的信息，
 * 而「15:04」和「15:04」摆在一起看不出谁先谁后。2026-09-08 清点：全仓 8 处漏秒，
 * 分布在 5 个门户 + 1 个 BFF，而同一个门户里另有已经带秒的权威 formatter
 * ——是本地副本各自漂移，不是没人想过。
 *
 * ── 只认两种缺陷写法 ──
 *   A. 选项块里有 `minute:` 却没有 `second:`
 *   B. `timeStyle: "short"`（实测 short 只到分，medium 起才有秒）
 * **只显示日期的一律不管**：没有 minute / timeStyle 的块跳过——给注册日期、
 * 加入日期加秒是另一种难看。
 *
 * ── 判据自己先自检 ──
 * 用内置的一好一坏两个样本验探测逻辑，而不是拿仓里某个真实文件当阳性对照：
 * 那种对照会在缺陷被修好的当天失效，守卫从此静默放行（2026-09-08 当场撞到）。
 *
 * 用法：node scripts/guardrails/check-datetime-seconds.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOTS = ["portals", "packages", "bff", "services"];

/** 在一段源码里找缺秒的位置；返回 [{line, kind}]。 */
function findMissingSeconds(src) {
  const lines = src.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/\bminute\s*:/.test(lines[i])) {
      // 窗口而不是配平花括号：这些选项对象都很小，窗口足够；配平解析容易被
      // 模板串与 JSX 里的花括号带偏。
      const win = lines
        .slice(Math.max(0, i - 12), Math.min(lines.length, i + 13))
        .join("\n");
      if (!/\bsecond\s*:/.test(win)) hits.push({ line: i + 1, kind: "缺 second" });
    }
    if (/timeStyle\s*:\s*["']short["']/.test(lines[i])) {
      hits.push({ line: i + 1, kind: 'timeStyle:"short" 只到分' });
    }
  }
  return hits;
}

// ── 自检：坏样本必须被抓，好样本必须放行 ──────────────────────────────────
const BAD = `new Intl.DateTimeFormat(l, {\n  hour: "2-digit",\n  minute: "2-digit",\n  hour12: false,\n});`;
const GOOD = `new Intl.DateTimeFormat(l, {\n  hour: "2-digit",\n  minute: "2-digit",\n  second: "2-digit",\n});`;
const DATE_ONLY = `new Intl.DateTimeFormat(l, {\n  year: "numeric",\n  month: "2-digit",\n  day: "2-digit",\n});`;
if (findMissingSeconds(BAD).length === 0) {
  console.error("自检失败：坏样本没被抓到 —— 探测逻辑失效，拒绝给出通过结论");
  process.exit(1);
}
if (findMissingSeconds(GOOD).length > 0) {
  console.error("自检失败：好样本被误报 —— 探测逻辑失效，拒绝给出通过结论");
  process.exit(1);
}
if (findMissingSeconds(DATE_ONLY).length > 0) {
  console.error("自检失败：纯日期样本被误报 —— 只显示日期的地方不该要求秒");
  process.exit(1);
}

// ── 扫全仓 ────────────────────────────────────────────────────────────────
const files = [];
for (const root of ROOTS) {
  (function walk(d) {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === "node_modules" || e === ".next" || e === "dist" || e === "coverage")
        continue;
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
  for (const h of findMissingSeconds(readFileSync(f, "utf8"))) {
    problems.push(`${f.replace(/\\/g, "/")}:${h.line} —— ${h.kind}`);
  }
}

console.log("══ 日期到秒检查（check-datetime-seconds）══");
console.log(`扫描 ${files.length} 个源文件，自检三项样本均正确。\n`);

if (problems.length > 0) {
  console.error(`以下位置显示了时间却没有秒（${problems.length} 处）：`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    "\n改法：选项块补 `second: \"2-digit\"`；用 dateStyle/timeStyle 的把 " +
      'timeStyle 从 "short" 改成 "medium"。' +
      "\n只显示日期的地方不受此约束——本检查不会命中它们。",
  );
  console.error(`\n── 汇总 ──\nerror: ${problems.length}`);
  process.exit(1);
}

console.log("✓ 凡是显示了时分的地方都显示到秒。");
console.log("\n── 汇总 ──\nerror: 0");
