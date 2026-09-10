#!/usr/bin/env node
/**
 * check-brand-name.mjs — 官网品牌名只有一个权威值。
 *
 * owner 2026-09-10 走查:页面标题已改「Ruyin Studio」,但**浏览器 tab 与 `<title>`
 * 还是「vxture AI」**。根因不是改漏了一处,是品牌名散在四处各写一份——两份 header
 * 词条(zh/en)+ 根 layout 的静态 metadata + metadata.ts 的双语标题。改了看得见的
 * 那两处,看不见的两处没人会想起来。
 *
 * tab 标题恰恰是**最不容易被自己发现**的一处:改站的人盯着页面看,而 tab 上那行字
 * 要切出去才看得到。人工核对已经漏过一次,所以收成守卫。
 *
 * 判据两条:
 *   ① 两份 header 词条的 logo.text / logo.alt 必须等于 BRAND_NAME。
 *   ② 全站源码与词条里不得再出现旧名(vxture AI)。
 * 第二条是**反向**的:只查①的话,把常量改成旧名两边照样"一致"。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BRAND_SRC = "packages/shared/shared/src/constants/brand.constants.ts";
const HEADER_MESSAGES = [
  "portals/website/messages/zh-CN/layout/header.json",
  "portals/website/messages/en-US/layout/header.json",
];
/** 退役的旧品牌名。加新的退役名往这里加。 */
const RETIRED = [/vxture\s*ai/i];

const errors = [];

// ── 取权威值 ──────────────────────────────────────────────────────────────
const brandSrc = readFileSync(BRAND_SRC, "utf8");
const m = /export const BRAND_NAME = "([^"]+)";/.exec(brandSrc);
if (!m) {
  console.error(`✗ 读不到 BRAND_NAME(${BRAND_SRC})——判据取不到就抛,不兜底`);
  process.exit(1);
}
const brand = m[1];

// ── ① 词条与常量一致 ──────────────────────────────────────────────────────
for (const p of HEADER_MESSAGES) {
  const json = JSON.parse(readFileSync(p, "utf8"));
  for (const key of ["text", "alt"]) {
    const got = json?.logo?.[key];
    if (got !== brand) {
      errors.push(`${p} logo.${key} = ${JSON.stringify(got)},应为 "${brand}"`);
    }
  }
}

// ── ② 全站不得残留退役名 ──────────────────────────────────────────────────
const roots = ["portals/website/src", "portals/website/messages"];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist")
      continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.(ts|tsx|json)$/.test(name)) continue;
    const text = readFileSync(p, "utf8");
    text.split("\n").forEach((line, i) => {
      // 注释行豁免:说明「此前叫什么」是有用的历史,不是残留。
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const re of RETIRED) {
        if (re.test(line)) {
          errors.push(
            `${p}:${i + 1} 残留退役品牌名 → ${line.trim().slice(0, 80)}`,
          );
        }
      }
    });
  }
};
for (const r of roots) walk(r);

console.log("══ 官网品牌名一致性(check-brand-name)══");
console.log(`  · 权威值 BRAND_NAME = "${brand}"`);
if (errors.length === 0) {
  console.log("✓ 词条与常量一致,且无退役名残留。");
  process.exit(0);
}
for (const e of errors) console.error(`  ✗ ${e}`);
console.error(`\n── 汇总 ──\nerror: ${errors.length}`);
process.exit(1);
