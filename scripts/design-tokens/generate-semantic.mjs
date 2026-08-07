#!/usr/bin/env node

/**
 * generate-semantic.mjs — 生成 T2 色彩语义层。
 *
 * 输入是 color-policy.mjs。六个意图族由"色相 × 阶型"派生，故族间不一致在结构上
 * 不可能发生；阶型本身携带对比度依据。
 *
 * 出：packages/design/design-tokens/src/styles/semantic/color-semantic.css
 *
 * 用法：
 *   node scripts/design-tokens/generate-semantic.mjs
 *   node scripts/design-tokens/generate-semantic.mjs --check
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  INTENT_FAMILIES,
  INTENT_RAMPS,
  INTENT_SLOTS,
  INTENT_SLOT_ORDER,
  LEVEL_HUE,
  LEVEL_RAMP,
  LEVEL_SLOT_ORDER,
  LEVELS,
  STANDALONE_COLORS,
} from "./color-policy.mjs";

const ROOT = process.cwd();
const CHECK = process.argv.includes("--check");

const PKG = path.join(ROOT, "packages/design/design-tokens");
const OUT_DIR = path.join(PKG, "src/styles/semantic");
const T1_COLOR_FILES = [
  path.join(PKG, "src/styles/primitive/color-primitive.css"),
  path.join(PKG, "src/styles/primitive/color-brand-primitive.css"),
];

const errors = [];

/**
 * T1 已生成的色板变量——用于断言 T2 不会引用不存在的原子。
 *
 * 两个文件：镜像 Tailwind 的色阶，与 DS 自有的品牌 / 合成色。分开存放是为了
 * 一眼能看出哪些是我们的；读的时候必须都读，否则品牌色会被误判为不存在。
 */
function loadT1Vars() {
  const names = new Set();
  for (const file of T1_COLOR_FILES) {
    for (const m of readFileSync(file, "utf8").matchAll(/^\s*(--vx-color-[\w-]+):/gm)) {
      names.add(m[1]);
    }
  }
  return names;
}
const t1Vars = loadT1Vars();

/** 档位是数字（同色相内的一档）或完整色名（`white` / `neutral-900`）。 */
function t1Ref(hue, step, where) {
  const target = typeof step === "number" ? `${hue}-${step}` : step;
  const name = `--vx-color-${target}`;
  if (!t1Vars.has(name)) errors.push(`${where}：T1 中不存在 ${name}`);
  return name;
}

/* ── 意图族：色相 × 阶型 × 槽位 ─────────────────────────────── */

function intentRows(mode) {
  const rows = [];
  for (const [family, hue, rampKey] of INTENT_FAMILIES) {
    const ramp = INTENT_RAMPS[rampKey];
    if (!ramp) {
      errors.push(`${family}：未知阶型 ${rampKey}`);
      continue;
    }
    const slots = INTENT_SLOTS[mode];
    for (const slot of INTENT_SLOT_ORDER) {
      const name = slot ? `${family}-${slot}` : family;
      const where = `${mode} ${name}`;
      const step =
        slot === ""
          ? ramp.fill
          : slot === "hover"
            ? ramp.hover
            : slot === "active"
              ? ramp.active
              : slot === "foreground"
                ? ramp.foreground
                : slots[slot];
      if (step === undefined) {
        errors.push(`${where}：槽位无取值`);
        continue;
      }
      rows.push([name, `var(${t1Ref(hue, step, where)})`, "intent"]);
    }
  }
  return rows;
}

/* ── 等级族：单色相 × 五档 ──────────────────────────────────── */

function levelRows(mode) {
  const rows = [];
  for (const level of LEVELS) {
    const ramp = LEVEL_RAMP[level];
    for (const slot of LEVEL_SLOT_ORDER) {
      const name = slot ? `level-${level}-${slot}` : `level-${level}`;
      const where = `${mode} ${name}`;
      const step =
        slot === ""
          ? ramp.fill
          : slot === "deep"
            ? ramp.deep
            : ramp.foreground;
      rows.push([name, `var(${t1Ref(LEVEL_HUE, step, where)})`, "level"]);
    }
  }
  return rows;
}

/* ── 渲染 ───────────────────────────────────────────────────── */

/** 分组顺序保持稳定，便于逐行比对产物。 */
const GROUP_ORDER = ["surface", "content", "stroke", "intent", "level", "chart", "gradient"];
const groupOf = (name) => {
  if (/^(background|surface|card|popover|scrim|accent)/.test(name)) return "surface";
  if (/^(foreground|muted-foreground|content-|link)/.test(name)) return "content";
  if (/^(border|input|stroke-|ring)/.test(name)) return "stroke";
  if (/^chart-/.test(name)) return "chart";
  return "gradient";
};

function buildMode(mode) {
  const idx = mode === "light" ? 1 : 2;
  const rows = STANDALONE_COLORS.map((row) => [
    row[0],
    `var(${t1Ref(null, row[idx], `${mode} ${row[0]}`)})`,
    groupOf(row[0]),
  ]);
  return [...rows, ...intentRows(mode), ...levelRows(mode)];
}

function render(rows, indent = "  ") {
  const groups = new Map();
  for (const [name, value, group] of rows) {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(`${indent}--${name}: ${value};`);
  }
  const ordered = [
    ...GROUP_ORDER.filter((g) => groups.has(g)),
    ...[...groups.keys()].filter((g) => !GROUP_ORDER.includes(g)),
  ];
  return ordered.map((g) => `${indent}/* ${g} */\n${groups.get(g).join("\n")}`).join("\n\n");
}

const light = buildMode("light");
const dark = buildMode("dark");

if (errors.length > 0) {
  console.error("T2 色彩层生成失败：\n");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const css = `/**
 * semantic/color-semantic.css - T2 语义层 · 色彩。
 * @package @vxture/design-tokens
 * @layer Presentation
 * @category styles
 * @author AI-Generated
 * @date 2026-08-01
 *
 * ⚠ 本文件由脚本生成，请勿手工编辑。
 *   生成：node scripts/design-tokens/generate-semantic.mjs
 *   输入：scripts/design-tokens/color-policy.mjs
 *
 * T2 契约见 packages/design/design-system/docs/04-tokens-contract.md。
 * 构建规范见 docs/10-standards/065-design-token-pipeline.md。
 *
 * 命名沿用 shadcn 约定（--background / --foreground / --primary / --border …），
 * shadcn 无对应概念的用 DS 自有名（--surface-* / --content-* / --link …）。
 *
 * 六个意图族由"色相 × 阶型"派生，故族间必然一致；阶型的对比度依据见 color-policy。
 * 本层只引用 T1。
 */

:root {
${render(light)}
}

.dark,
:root.dark {
${render(dark)}
}
`;

mkdirSync(OUT_DIR, { recursive: true });
const target = path.join(OUT_DIR, "color-semantic.css");

if (CHECK) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    /* 缺文件即视为不同步 */
  }
  if (current !== css) {
    console.error(
      "T2 色彩层与 color-policy 不同步。运行：node scripts/design-tokens/generate-semantic.mjs",
    );
    process.exit(1);
  }
  console.log(`T2 色彩层一致（light ${light.length} · dark ${dark.length}）`);
} else {
  writeFileSync(target, css, "utf8");
  console.log(`已生成 T2 色彩：light ${light.length} · dark ${dark.length} 项`);
}
