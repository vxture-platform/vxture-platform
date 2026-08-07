#!/usr/bin/env node

/**
 * check-utilities.mjs — 实测 T2 注册确实产出可用的 Tailwind 工具类。
 *
 * 补的是一个结构性盲区：DS 包用 tsup 打包、**自身从不跑 Tailwind 编译**，
 * 所以「工具类没生成」这类问题在包内 build 全绿，只会在消费方构建时静默失效
 * ——失效方式是类名不产出，页面无样式，且不报错。
 *
 * 本脚本用 Tailwind 编译 API 真编一遍完整样式链，断言样例工具类确实存在。
 *
 * 用法：node scripts/design-tokens/check-utilities.mjs
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

// tailwindcss 不是本仓根 package.json 的直接依赖（由各 portal 持有），
// 故从 pnpm store 目录解析，而非 import 裸名。
const PNPM = path.join(ROOT, "node_modules/.pnpm");
const twDir = (await readdir(PNPM)).find((d) => /^tailwindcss@\d/.test(d));
if (!twDir) {
  console.error("未找到 tailwindcss 安装目录，跳过工具类实测。");
  process.exit(0);
}
const TW = path.join(PNPM, twDir, "node_modules/tailwindcss");
const { compile } = await import(
  new URL(`file://${path.join(TW, "dist/lib.mjs").split(path.sep).join("/")}`).href
);
const STYLES = path.join(ROOT, "packages/design/design-tokens/src/styles");

/**
 * 样例覆盖三类：DS 注册的语义、DS 登记的偏离、以及**上游内置**。
 *
 * 第三类看似不该由 DS 测，但正是它守住了这轮重构的前提：T1 与上游同值的挡位
 * 一律不再注册，全靠 Tailwind 自己产出。若哪天样式链 import 顺序出错、或
 * `@theme` 写成了覆盖形式把上游整族清空，`p-4` / `rounded-lg` 这些会一起哑火，
 * 而 DS 自己的注册仍然正常——只测自家注册就看不见这种塌方。
 */
const EXPECTED = [
  // T2 语义 —— 每族至少一个样例。九族里有六族的命名空间名与直觉不同
  // （`--transition-duration-*` 而非 `--duration-*`、`--z-index-*` 而非 `--z-*`、
  // `--spacing-*` 而非 `--space-*`），写错则变量声明成功、工具类不产出且不报错。
  ["bg-primary", "T2 色彩"],
  ["text-foreground", "T2 色彩"],
  ["border-border", "T2 色彩"],
  ["dark:bg-card", "T2 色彩 · 暗色变体"],
  ["text-body-md", "T2 排版角色"],
  ["text-heading-1", "T2 排版角色"],
  ["text-title-md", "T2 排版角色"],
  ["p-md", "T2 间距（密度轴）"],
  ["gap-lg", "T2 间距"],
  ["h-control-md", "T2 控件高度"],
  ["h-row-lg", "T2 行高度"],
  ["md:p-xl", "T2 间距 · 断点变体"],
  ["size-icon-md", "T2 图标尺寸"],
  ["size-media-lg", "T2 媒体尺寸"],
  ["size-control-lg", "T2 控件尺寸（Button icon 变体）"],
  ["rounded-md", "T2 圆角"],
  ["shadow-raised", "T2 视觉高度"],
  ["shadow-dialog", "T2 视觉高度"],
  ["z-modal", "T2 叠放次序"],
  ["z-tooltip", "T2 叠放次序"],
  ["duration-fast", "T2 时长"],
  ["duration-base", "T2 时长"],
  ["ease-enter", "T2 缓动"],
  ["ease-exit", "T2 缓动"],
  ["opacity-disabled", "T2 透明度"],
  ["border-thin", "T2 描边宽度"],
  ["max-w-page-lg", "T2 页面宽度"],
  ["max-w-content-base-xl", "T2 内容宽度"],
  // T1 偏离：扩展档与覆盖值
  ["font-brand", "T1 扩展 · 品牌字体族"],
  ["font-cjk", "T1 扩展 · 中文字体栈"],
  
  ["3xl:p-4", "T1 扩展 · 断点变体"],
  ["font-sans", "T1 覆盖 · 正文字体栈"],
  ["font-mono", "T1 覆盖 · 等宽字体栈"],
  // 上游内置：DS 注册不得挤掉它们。若哪天 import 链出错把上游 theme 清空，
  // DS 自家注册仍然正常，只测自家就看不见这种塌方。
  ["p-4", "内置 · 间距"],
  ["size-4", "内置 · 尺寸"],
  ["duration-150", "内置 · 时长"],
  ["z-50", "内置 · 层级"],
  ["opacity-45", "内置 · 透明度"],
];

/** 模式轴：三档必须都在，缺一档意味着该模式下整族回落到默认值且不报错。 */
const MODE_BLOCKS = [
  ["typography-semantic.css", ["html.vx-font-small", "html.vx-font-large"], "字号三档"],
  ["spacing-semantic.css", [".density-compact", ".density-comfortable"], "密度三档"],
  ["color-semantic.css", [".dark"], "暗色"],
  ["typography-semantic.css", [":lang(zh)", "--vx-cjk-leading-add"], "中文修正轴"],
];

/** 排版角色须一次落齐四个属性，只出 font-size 等于注册没生效。 */
const TEXT_ROLE_PROPS = ["font-size", "line-height", "letter-spacing", "font-weight"];

async function loadStylesheet(id, base) {
  if (id === "tailwindcss") {
    const p = path.join(TW, "index.css");
    return { path: p, base: TW, content: await readFile(p, "utf8") };
  }
  // 绝对路径直接用；相对路径按引用方目录解析；其余当作 tailwind 内部资源。
  const p = path.isAbsolute(id)
    ? id
    : id.startsWith(".")
      ? path.resolve(base, id)
      : path.join(TW, id);
  return { path: p, base: path.dirname(p), content: await readFile(p, "utf8") };
}

const entry = [
  '@import "tailwindcss";',
  `@import "${path.join(STYLES, "tokens.css").split(path.sep).join("/")}";`,
].join("\n");

const compiled = await compile(entry, { base: ROOT, loadStylesheet });

/**
 * 判定工具类是否真的产出。
 *
 * ⚠ 不能用 `out.includes("duration-fast")`：`:root` 里的 `--duration-fast:` 声明
 *   含同样的子串，未生成工具类也会判过。`duration-fast` 就是这么假绿了一轮的
 *   ——`--duration-*` 根本不是 v4 命名空间，工具类从未产出。
 *   故必须在 `@layer utilities` 内匹配**类选择器**。
 */
function generated(util) {
  const out = compiled.build([util]);
  const i = out.indexOf("@layer utilities {");
  if (i < 0) return false;
  return out.slice(i).includes(`.${cssIdent(util)} {`);
}

/**
 * 类名 → CSS 选择器里的转义写法。
 *
 * 首字符是数字时不能只转义冒号：CSS 标识符不允许数字开头，须写成十六进制码点
 * 加一个空格（`3xl:p-4` → `\33 xl\:p-4`）。漏了这条会把 `3xl:` / `2xl:` 这些
 * 断点变体一律误判为未生成。
 */
function cssIdent(name) {
  const escaped = name.replace(/[:./]/g, (c) => `\\${c}`);
  return /^\d/.test(escaped)
    ? `\\3${escaped[0]} ${escaped.slice(1)}`
    : escaped;
}

const missing = EXPECTED.filter(([u]) => !generated(u));

if (missing.length > 0) {
  console.error("工具类未生成——T2 注册有缺口：\n");
  for (const [u, note] of missing) console.error(`  ✗ ${u}  （${note}）`);
  console.error("\n检查 src/styles/theme.css 的 @theme 注册，以及被引用变量是否在链路中声明。");
  process.exit(1);
}

// `--text-*` 的修饰子键写错时工具类仍会生成，只是少落几个属性——
// 只断言类名存在会漏掉这种半哑火，故单独校验属性齐备。
const roleOut = compiled.build(["text-body-md"]);
const roleCss = roleOut.slice(roleOut.indexOf("@layer utilities {"));
const lacking = TEXT_ROLE_PROPS.filter((p) => !roleCss.includes(`${p}:`));
if (lacking.length > 0) {
  console.error(`text-body-md 只落了部分属性，缺：${lacking.join(" / ")}`);
  console.error("检查 generate-theme.mjs 的 `--text-<role>--<modifier>` 子键拼写。");
  process.exit(1);
}

const missingModes = [];
for (const [file, selectors, note] of MODE_BLOCKS) {
  const css = await readFile(path.join(STYLES, "semantic", file), "utf8");
  for (const sel of selectors) {
    if (!css.includes(sel)) missingModes.push(`${file} 缺 ${sel}（${note}）`);
  }
}
if (missingModes.length > 0) {
  console.error("模式轴缺档——该模式下整族回落到默认值且不报错：\n");
  for (const m of missingModes) console.error(`  ✗ ${m}`);
  process.exit(1);
}

console.log(
  `工具类实测通过（${EXPECTED.length} 个样例全部生成，排版角色四属性齐备，模式轴三族齐备）`,
);
