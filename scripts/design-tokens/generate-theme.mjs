#!/usr/bin/env node

/**
 * generate-theme.mjs — 生成 Tailwind v4 的 `@theme` 注册。
 *
 * ── 注册什么 ──
 * T1 是 Tailwind theme 的**完整镜像**，凡与上游同值的挡位，Tailwind 自己的
 * `@theme` 已经产出了工具类（`rounded-lg`、`shadow-md`、`ease-out`、
 * `duration-150`、`p-4`、`z-50`…），DS 再注册一遍只会得到一份逐字重复的真值。
 *
 * 因此需要注册的恰好是两类，且都是"上游没有"的：
 *   1. T1 相对基线的**偏离**——扩展档与覆盖值，清单在 primitive-policy.mjs
 *   2. T2 的**语义**——色彩角色、24 档排版角色、页面与内容宽度
 *
 * 出：src/styles/theme.css
 *
 * ⚠ 必须生成而非手写：手写必漏。首版手写颜色桥接时就漏了 link / link-hover /
 *   primary-muted-hover / primary-muted-foreground 四个，而 DS 包不跑 Tailwind 编译，
 *   build 全绿却会在消费方静默失效。
 *
 * 用法：
 *   node scripts/design-tokens/generate-theme.mjs
 *   node scripts/design-tokens/generate-theme.mjs --check
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { EXTENSIONS, OVERRIDES } from "./primitive-policy.mjs";

const ROOT = process.cwd();
const CHECK = process.argv.includes("--check");

const PKG = path.join(ROOT, "packages/design/design-tokens");
const SEMANTIC = path.join(PKG, "src/styles/semantic");
const FOUNDATION = path.join(PKG, "src/styles/primitive");
const TARGET = path.join(PKG, "src/styles/theme.css");

/**
 * 排版角色的修饰子键。v4 的 `--text-*` 支持 `--text-<name>--line-height` 这类子键，
 * 一个 `text-body-md` 工具类即同时落 font-size / line-height / letter-spacing /
 * font-weight。font-family 不在子键之列（只有这三个），故角色的字体族仍由独立的
 * `font-*` 工具类承担。
 */
const TEXT_MODIFIERS = [
  ["line-height", "line-height"],
  ["letter-spacing", "letter-spacing"],
  ["font-weight", "font-weight"],
];

/**
 * 必须落字面量、不能用 var() 的命名空间。
 *
 * 断点进 `@media (width >= …)`、容器宽度进 `@container (width >= …)`，而
 * **媒体查询与容器查询里不允许出现 var()**——CSS 变量在此处不参与求值。
 * 写成 var() 不会报错，只会让该断点的所有响应式变体静默失效。
 */
const LITERAL_NAMESPACES = new Set(["breakpoint", "container"]);

/** 取某文件在首个规则块内声明的变量名（模式块重复声明，取一份即可）。 */
function declaredVars(file) {
  const css = readFileSync(path.join(SEMANTIC, file), "utf8");
  const names = [];
  const seen = new Set();
  for (const m of css.matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    names.push(m[1]);
  }
  return names;
}

/** 全量 CSS 变量表（T1 + T2），用于把 var() 链解到字面量。 */
function loadVars() {
  const map = new Map();
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) walk(full);
      else if (f.name.endsWith(".css")) {
        for (const m of readFileSync(full, "utf8").matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
          if (!map.has(m[1])) map.set(m[1], m[2].trim());
        }
      }
    }
  };
  walk(FOUNDATION);
  walk(SEMANTIC);
  return map;
}

const vars = loadVars();

/** 顺 var() 链解到字面量。链断了就是错误，不静默留 var()。 */
function literal(name) {
  const seen = new Set();
  let cur = name;
  while (true) {
    if (seen.has(cur)) throw new Error(`${name}：var() 引用成环`);
    seen.add(cur);
    const value = vars.get(cur);
    if (value === undefined) throw new Error(`${name} → ${cur}：变量未定义`);
    const m = /^var\((--[\w-]+)\)$/.exec(value);
    if (!m) return value;
    cur = m[1];
  }
}

const inlineBlocks = [];
const staticBlocks = [];
const stats = [];

/* ── 1. T1 偏离：扩展档与覆盖值 ─────────────────────────────── */

/**
 * 不注册的扩展命名空间。
 *
 * `transition-duration` 整族是 DS 补的 T1 原子（上游 theme 里没有这一族），供 T2 的
 * fast / base / slow 指向；档位本身不需要工具类——`duration-150` 作为裸数值工具类
 * 上游已经产出，再注册一遍只会给同一个类名造出第二个来源。
 */
const UNREGISTERED_EXTENSIONS = new Set(["transition-duration"]);

const deviations = [];
for (const [ns, list] of Object.entries(EXTENSIONS)) {
  if (UNREGISTERED_EXTENSIONS.has(ns)) continue;
  for (const [step] of list) deviations.push([ns, step]);
}
for (const key of Object.keys(OVERRIDES)) {
  const [ns, step] = key.split("/");
  deviations.push([ns, step]);
}
deviations.sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y));

const devLines = deviations.map(([ns, step]) => {
  const src = `--vx-${ns}-${step}`;
  const value = LITERAL_NAMESPACES.has(ns) ? literal(src) : `var(${src})`;
  return `  --${ns}-${step}: ${value};`;
});
staticBlocks.push(
  `  /* T1 相对 Tailwind 基线的偏离——同值的挡位由 Tailwind 自己注册，此处不重复 */\n` +
    devLines.join("\n"),
);
stats.push(`偏离 ${devLines.length}`);

/* ── 2. T2 语义：色彩 ───────────────────────────────────────── */

const colorLines = declaredVars("color-semantic.css").map(
  (name) => `  --color-${name.slice(2)}: var(${name});`,
);
inlineBlocks.push(`  /* bg-* / text-* / border-* / ring-* */\n${colorLines.join("\n")}`);
stats.push(`color ${colorLines.length}`);

/* ── 3. T2 语义：排版角色 ───────────────────────────────────── */

// 由 T2 声明的 `--<role>-font-size` 反推角色名，避免另立一份角色清单。
const typoVars = declaredVars("typography-semantic.css");
const roles = typoVars
  .filter((n) => n.endsWith("-font-size"))
  .map((n) => n.slice(2, -"-font-size".length));
if (roles.length === 0) throw new Error("未从 T2 解析出任何排版角色，中止");

const textLines = [];
for (const role of roles) {
  textLines.push(`  --text-${role}: var(--${role}-font-size);`);
  for (const [suffix, prop] of TEXT_MODIFIERS) {
    if (typoVars.includes(`--${role}-${prop}`)) {
      textLines.push(`  --text-${role}--${suffix}: var(--${role}-${prop});`);
    }
  }
}
inlineBlocks.push(
  `  /* text-*（${roles.length} 档角色，含行高 / 字距 / 字重修饰） */\n${textLines.join("\n")}`,
);
stats.push(`text ${roles.length} 档`);

/* ── 4. T2 语义：间距（密度三档）─────────────────────────────── */

const spaceLines = declaredVars("spacing-semantic.css").map(
  (name) => `  --spacing-${name.replace(/^--space-/, "")}: var(${name});`,
);
inlineBlocks.push(
  `  /* p-* / gap-* / h-control-* / h-row-*（跟随密度三档） */\n${spaceLines.join("\n")}`,
);
stats.push(`spacing ${spaceLines.length}`);

/*
 * 其余各族（radius / shadow / z-index / motion / opacity / border-width / size /
 * layout）不在此注册：它们无模式轴，T2 名即命名空间名，在各自的 semantic 文件里
 * 用 `@theme` 一处声明即完成注册。少一跳，也少一类"声明了忘记注册"的静默失效。
 */

/* ── 输出 ───────────────────────────────────────────────────── */

const css = `/**
 * theme.css - Tailwind v4 @theme 注册。
 * @package @vxture/design-tokens
 * @layer Presentation
 * @category styles
 * @author AI-Generated
 * @date 2026-07-31
 *
 * ⚠ 本文件由脚本生成，请勿手工编辑。
 *   生成：node scripts/design-tokens/generate-theme.mjs
 *
 * 只注册"上游没有"的两类：T1 相对 Tailwind 基线的偏离，与 T2 的语义。
 * 与上游同值的挡位由 Tailwind 自己的 \`@theme\` 产出工具类，此处不重复。
 *
 * 注册后每个 token 产出真工具类，组件**禁止使用任意值语法**
 * （\`h-(--control-height-lg)\`）。约定见 docs/10-standards/040-*.md §4.1。
 */

/* 有模式轴（明暗 / 字号三档）。\`inline\` 保留 var() 引用而非取快照，故模式切换自动跟随。 */
@theme inline {
${inlineBlocks.join("\n\n")}
}

/* 无模式轴。断点与容器宽度落字面量——媒体查询与容器查询里 var() 不参与求值。 */
@theme {
${staticBlocks.join("\n\n")}
}
`;

if (CHECK) {
  let current = "";
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    /* 缺文件即视为不同步 */
  }
  if (current !== css) {
    console.error("@theme 注册与 token 层不同步。运行：node scripts/design-tokens/generate-theme.mjs");
    process.exit(1);
  }
  console.log(`@theme 注册一致（${stats.join(" · ")}）`);
} else {
  writeFileSync(TARGET, css, "utf8");
  console.log(`已生成 @theme 注册：${stats.join(" · ")}`);
}
