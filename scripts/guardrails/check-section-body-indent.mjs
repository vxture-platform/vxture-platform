#!/usr/bin/env node

/**
 * check-section-body-indent.mjs — 说明类板块的正文必须缩进到与标题文字对齐。
 *
 * ── 补的是哪个盲区 ──
 * `PageSection`（DS `Section`）的标题行是「icon(icon-lg) + gap-lg + 标题文字」。正文
 * 若直接顶头排，左缘落在 **icon** 那条竖线上，读起来像与标题并列的另一块内容，而不是
 * 标题底下的东西（owner 2026-09-06 定，2026-09-08 要求全局统一）。`SectionBody`
 * 就是那一格缩进骨架，`CardRows` 是它的再导出。
 *
 * 漏套**不报错、不影响构建**，只是那一块的左缘比别处少 24px——一页里有的缩了有的没缩，
 * 肉眼要来回比才看得出。人工核对了两轮都还有漏网（第一轮只认 `SignalList` 当锚点，
 * 漏了裸 `<p>` 的；也曾把 `CardRows` 误报成没缩进），所以收成守卫。
 *
 * ── 判据 ──
 * 「说明类板块」= `<PageSection>` 的 `title` 取自 `notes.*` / `signals.*` 这类说明键。
 * 它的正文必须整体裹在 `SectionBody` / `CardRows` 里。
 *
 * **表格、卡片这类自带边框的独立面不在此列**——它们顶头排才对齐得上页面其它表
 * （见 `SectionBody` 的文件头）。所以只认说明键，不是所有 PageSection 都管。
 *
 * 用法：node scripts/guardrails/check-section-body-indent.mjs
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import process from "node:process";

const ROOT = process.cwd();

/** 说明类板块的标题键。命中其一即认为这一段是「跟着标题读」的正文。 */
const NOTE_TITLE = /title=\{t\("(?:notes|signals|hints|guide)\.[A-Za-z0-9_.]*"\)\}/;

const files = execSync(
  `grep -rl "<PageSection" portals/*/src --include=*.tsx`,
  { cwd: ROOT, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);

if (files.length === 0) {
  console.error("扫不到任何含 <PageSection> 的文件 —— 判据失效，拒绝给出通过结论");
  process.exit(1);
}

/** 从 `<PageSection` 起找到配对的 `</PageSection>`（按同名标签计数）。 */
function sectionRange(src, from) {
  let depth = 0;
  let i = from;
  while (i < src.length) {
    const open = src.indexOf("<PageSection", i);
    const close = src.indexOf("</PageSection>", i);
    if (close === -1) return -1;
    if (open !== -1 && open < close) {
      depth += 1;
      i = open + 12;
    } else {
      depth -= 1;
      i = close + 14;
      if (depth === 0) return close;
    }
  }
  return -1;
}

const problems = [];
let checked = 0;

for (const rel of files) {
  const src = readFileSync(`${ROOT}/${rel}`, "utf8");
  let i = 0;
  while ((i = src.indexOf("<PageSection", i)) !== -1) {
    const end = sectionRange(src, i);
    if (end === -1) break;
    const block = src.slice(i, end);
    // 只看开标签里的 title，避免命中嵌套子板块的 title
    const tagEnd = block.indexOf(">");
    const openTag = block.slice(0, tagEnd);
    if (!NOTE_TITLE.test(openTag)) {
      i += 12;
      continue;
    }
    checked += 1;
    const body = block.slice(tagEnd + 1);
    if (!/<SectionBody[\s>]/.test(body) && !/<CardRows[\s>]/.test(body)) {
      const line = src.slice(0, i).split("\n").length;
      problems.push(`${rel}:${line}`);
    }
    i = end;
  }
}

console.log("══ 说明板块缩进检查（check-section-body-indent）══");
console.log(
  `扫描 ${files.length} 个含 <PageSection> 的文件，命中说明类板块 ${checked} 处。\n`,
);

if (problems.length > 0) {
  console.error("以下说明板块的正文没有裹 SectionBody / CardRows：");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    "\n改法：把板块正文整体裹进 <SectionBody>…</SectionBody>（`@/layout/shell`）。" +
      "\n表格、卡片这类自带边框的独立面不该裹——它们顶头排才对齐得上页面其它表。",
  );
  console.error(`\n── 汇总 ──\nerror: ${problems.length}`);
  process.exit(1);
}

console.log("✓ 说明类板块的正文全部与标题文字对齐。");
console.log("\n── 汇总 ──\nerror: 0");
