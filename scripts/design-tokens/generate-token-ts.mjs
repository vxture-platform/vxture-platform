#!/usr/bin/env node

/**
 * generate-token-ts.mjs — 生成 @vxture/design-tokens 的 TypeScript 面。
 *
 * ── 为什么必须生成 ──
 * TS 面与 CSS 面描述的是同一件事，手写两份必然漂移，且漂移是静默的。实测过一次：
 * `layers/zIndex.ts` 自持一套 1000–1500 的阶梯，与 T2 的 `--z-index-*`（0–9999）
 * 和 deviations 里的推导表**三者互不相同**，谁也没报错。
 *
 * 故 TS 面一律由 semantic-policy.mjs 这唯一权威派生。
 *
 * 出：packages/design/design-tokens/src/generated/*.ts
 *
 * 用法：
 *   node scripts/design-tokens/generate-token-ts.mjs
 *   node scripts/design-tokens/generate-token-ts.mjs --check
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { Z_LADDER } from "./semantic-policy.mjs";

const ROOT = process.cwd();
const CHECK = process.argv.includes("--check");
const OUT_DIR = path.join(ROOT, "packages/design/design-tokens/src/generated");

/**
 * 模式轴：CSS 侧的选择器与 TS 侧的取值必须一致。类名写错在运行时表现为
 * "切换没反应"，不报错。
 */
const DENSITY = ["compact", "default", "comfortable"];
const FONT_SIZE = ["small", "default", "large"];

function header(title, utility) {
  return `/**
 * ${title}
 * @package @vxture/design-tokens
 * @layer Presentation
 * @category Tokens
 *
 * ⚠ 本文件由脚本生成，请勿手工编辑。
 *   生成：node scripts/design-tokens/generate-token-ts.mjs
 *   权威：scripts/design-tokens/semantic-policy.mjs
 *
 * ${utility}
 */
`;
}

const zLines = Z_LADDER.map(([name, value, why]) => `  ${name}: ${value}, // ${why}`);
const zIndex = `${header(
  "zIndex.ts - 叠放次序（与 --z-index-* 同源）。",
  "首选用 `z-<role>` 工具类；本表供内联 style、portal 容器等拿不到类名的场合使用。",
)}
export const Z_INDEX = {
${zLines.join("\n")}
} as const;

export type ZIndexRole = keyof typeof Z_INDEX;
export type ZIndexValue = (typeof Z_INDEX)[ZIndexRole];
`;

const modes = `${header(
  "modes.ts - 模式轴的取值与类名（与 T2 的模式块同源）。",
  "密度与字号是用户偏好轴，由祖先类重定向 T2 变量实现，组件无需感知。",
)}
/** 密度三档。CSS 侧对应 spacing-semantic.css 的 \`.density-*\` 块。 */
export type Density = ${DENSITY.map((d) => `"${d}"`).join(" | ")};

export const DENSITIES: readonly Density[] = [
${DENSITY.map((d) => `  "${d}",`).join("\n")}
] as const;

/** 密度类名。default 档写在 \`:root\` 上，仍给出类名以便显式覆盖父级。 */
export const densityClass = (density: Density): string => \`density-\${density}\`;

/** 字号三档。CSS 侧对应 typography-semantic.css 的 \`html.vx-font-*\` 块。 */
export type FontSize = ${FONT_SIZE.map((f) => `"${f}"`).join(" | ")};

export const FONT_SIZES: readonly FontSize[] = [
${FONT_SIZE.map((f) => `  "${f}",`).join("\n")}
] as const;

export const fontSizeClass = (size: FontSize): string => \`vx-font-\${size}\`;
`;

const index = `${header(
  "index.ts - @vxture/design-tokens 生成物入口。",
  "手写内容不进本目录。",
)}
export * from "./zIndex";
export * from "./modes";
`;

const outputs = [
  ["zIndex.ts", zIndex],
  ["modes.ts", modes],
  ["index.ts", index],
];

/** 断言 CSS 侧确实声明了这些模式块，否则 TS 给出的类名切了也没反应。 */
const SEMANTIC = path.join(ROOT, "packages/design/design-tokens/src/styles/semantic");
const errors = [];
for (const [file, selectors] of [
  ["spacing-semantic.css", DENSITY.map((d) => `.density-${d}`)],
  ["typography-semantic.css", FONT_SIZE.map((f) => `html.vx-font-${f}`)],
]) {
  let css = "";
  try {
    css = readFileSync(path.join(SEMANTIC, file), "utf8");
  } catch {
    errors.push(`${file}：读不到，无法核对模式块`);
    continue;
  }
  for (const sel of selectors) {
    if (!css.includes(sel)) errors.push(`${file}：缺模式块 ${sel}`);
  }
}
if (errors.length > 0) {
  console.error("TS 面与 CSS 模式块不一致：\n");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

if (CHECK) {
  const stale = outputs.filter(([name, code]) => {
    try {
      return readFileSync(path.join(OUT_DIR, name), "utf8") !== code;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) {
    console.error(
      `design-tokens 的 TS 面不同步：${stale.map(([n]) => n).join(", ")}\n` +
        "运行：node scripts/design-tokens/generate-token-ts.mjs",
    );
    process.exit(1);
  }
  console.log(`TS 面一致（z 阶梯 ${Z_LADDER.length} 档 · 密度 3 档 · 字号 3 档）`);
} else {
  for (const [name, code] of outputs) writeFileSync(path.join(OUT_DIR, name), code, "utf8");
  console.log(`已生成 TS 面：z 阶梯 ${Z_LADDER.length} 档 · 密度 3 档 · 字号 3 档`);
}
