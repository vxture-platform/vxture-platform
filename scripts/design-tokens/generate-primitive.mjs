#!/usr/bin/env node

/**
 * generate-primitive.mjs — 生成 T1 原子层：Tailwind theme 的完整镜像 + DS 偏离。
 *
 * T1 直接读上游的 theme.css 生成，一致性由构造保证。靠人工核对维持"取值等于
 * Tailwind"是不行的——实测漂成过两套（色板停在 v3 的 hex，而 v4 早已改用 oklch；
 * shadow 与 ease 各自另起一套）。
 *
 * 偏离全部集中在 primitive-policy.mjs，逐条带理由，生成时打印。
 *
 * 出：src/styles/primitive/**.css
 *
 * 用法：
 *   node scripts/design-tokens/generate-primitive.mjs
 *   node scripts/design-tokens/generate-primitive.mjs --check
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { NAMESPACES, readBaseline, readKeyframes } from "./tailwind-baseline.mjs";
import {
  KEEP_HUES,
  KEEP_COLOR_SINGLES,
  EXTENSIONS,
  OVERRIDES,
  BRAND_COLOR_PATTERNS,
  EXTRA_BRAND_ROWS,
} from "./primitive-policy.mjs";

const ROOT = process.cwd();
const CHECK = process.argv.includes("--check");
const OUT_DIR = path.join(ROOT, "packages/design/design-tokens/src/styles/primitive");

const notes = [];

function header(title, utility) {
  return `/**
 * ${title}
 * @package @vxture/design-tokens
 * @layer Presentation
 * @category styles
 * @author AI-Generated
 * @date 2026-07-31
 *
 * ⚠ 本文件由脚本生成，请勿手工编辑。
 *   生成：node scripts/design-tokens/generate-primitive.mjs
 *
 * T1 是 Tailwind v4 theme 的镜像，取值与之逐项一致；偏离登记在
 * scripts/design-tokens/primitive-policy.mjs。工具类族：${utility}
 */
`;
}

/** 色板做减法：只留登记的色相与单值，其余整族丢弃。 */
function keepColor(step) {
  if (KEEP_COLOR_SINGLES.includes(step)) return true;
  const hue = step.replace(/-\d+$/, "");
  return KEEP_HUES.includes(hue);
}

const { rows } = readBaseline(ROOT);
const byNs = new Map();
for (const r of rows) {
  if (r.ns === "color" && !keepColor(r.step)) continue;
  if (!byNs.has(r.ns)) byNs.set(r.ns, []);
  byNs.get(r.ns).push(r);
}

const droppedHues = [...new Set(rows.filter((r) => r.ns === "color").map((r) => r.step.replace(/-\d+$/, "")))]
  .filter((h) => !KEEP_HUES.includes(h) && !KEEP_COLOR_SINGLES.includes(h));
notes.push(`色板保留 ${KEEP_HUES.length} 色相，弃用 ${droppedHues.length} 个：${droppedHues.join(" ")}`);

/* ── 品牌与合成色：Tailwind 不可能有，取自既有产物 ── */
/* 这一族没有上游对应物，只能自持。生成时从上一版产物读回，故它既是输入也是输出——
   要改品牌色请直接改 color-brand-primitive.css，它是本族唯一的真值源。 */
/**
 * 合成色跟着色相走：色相被 KEEP_HUES 砍掉，它的 alpha 衍生值就没有本体可衍生了。
 *
 * 这一族是从上一版产物读回来的，等于自我复制——所以过滤必须在读回这一步做，否则
 * 被弃色相的合成值会一代代传下去。cyan / fuchsia / lime / orange / teal 的 20 个
 * `-600-alpha-*` 就是这么留到今天的：色相早在减色时删了，衍生值没跟着删，语义层
 * 一个都没取用。
 */
/* 单值色（white / black）没有数字档，本体提取要先剥 alpha 再剥档位，
   否则 `white-alpha-58` 会被解析成色相 `white-alpha` 而误剔。 */
const hueOf = (step) => step.replace(/-alpha-\d+$/, "").replace(/-\d+$/, "");

const keepBrandRow = (step) => {
  if (step.startsWith("brand-")) return true;
  const hue = hueOf(step);
  return KEEP_HUES.includes(hue) || KEEP_COLOR_SINGLES.includes(hue);
};

const brandRows = [];
try {
  const prev = readFileSync(path.join(OUT_DIR, "color-brand-primitive.css"), "utf8");
  for (const m of prev.matchAll(/^\s*--vx-color-([\w-]+):\s*([^;]+);/gm)) {
    brandRows.push({ step: m[1], value: m[2].trim() });
  }
} catch {
  // 首次生成：从旧色板里挑出品牌与 alpha 合成色
  try {
    const legacy = readFileSync(path.join(OUT_DIR, "color-primitive.css"), "utf8");
    for (const m of legacy.matchAll(/^\s*--vx-color-([\w-]+):\s*([^;]+);/gm)) {
      if (BRAND_COLOR_PATTERNS.some((p) => p.test(m[1]))) {
        brandRows.push({ step: m[1], value: m[2].trim() });
      }
    }
  } catch {
    /* 无既有色板，品牌色留空 */
  }
}
// 登记的新增行并入读回结果；已经在产出里的不重复添加。
for (const [step, value] of EXTRA_BRAND_ROWS) {
  if (!brandRows.some((r) => r.step === step)) brandRows.push({ step, value });
}

const orphanRows = brandRows.filter((r) => !keepBrandRow(r.step));
if (orphanRows.length > 0) {
  const hues = [...new Set(orphanRows.map((r) => hueOf(r.step)))];
  notes.push(`剔除无本体合成色 ${orphanRows.length} 项：${hues.join(" ")}（色相已在减色时删除）`);
}
const keptBrandRows = brandRows.filter((r) => keepBrandRow(r.step));

if (keptBrandRows.length === 0) throw new Error("未取得品牌 / 合成色，中止（避免生成残缺色板）");
notes.push(`品牌与合成色 ${keptBrandRows.length} 项（DS 自有，上游无对应）`);

/* ── 组装各命名空间文件 ── */
const outputs = new Map();
const addBlock = (file, block) => {
  if (!outputs.has(file)) outputs.set(file, []);
  outputs.get(file).push(block);
};

let extCount = 0;
let overCount = 0;

for (const ns of NAMESPACES) {
  const list = byNs.get(ns.ns) ?? [];
  const lines = list.map((r) => {
    const key = `${ns.ns}/${r.step}`;
    if (OVERRIDES[key]) {
      overCount++;
      notes.push(`覆盖 ${key}：${OVERRIDES[key].value}（${OVERRIDES[key].why}）`);
      return `  --vx-${r.name.slice(2)}: ${OVERRIDES[key].value};`;
    }
    return `  --vx-${r.name.slice(2)}: ${r.value};`;
  });

  if (ns.ns === "color" && keptBrandRows.length > 0) {
    // 品牌色单独成文件，避免与镜像混在一起看不出哪些是我们的
    addBlock(
      "color-brand-primitive.css",
      `  /* 品牌与合成色。DS 自有，非 Tailwind 镜像。 */\n` +
        keptBrandRows.map((r) => `  --vx-color-${r.step}: ${r.value};`).join("\n"),
    );
  }

  const ext = EXTENSIONS[ns.ns] ?? [];
  if (ext.length > 0) {
    extCount += ext.length;
    lines.push("");
    lines.push(`  /* DS 扩展（Tailwind 无此挡位）。 */`);
    for (const [step, value, why] of ext) {
      lines.push(`  --vx-${ns.ns}-${step}: ${value}; /* ${why} */`);
    }
  }

  if (lines.length === 0) continue;
  addBlock(ns.file, `  /* ${ns.title}。 */\n${lines.join("\n")}`);
}

/* ── 写出 ── */
const files = new Map();
for (const [file, blocks] of outputs) {
  const meta = NAMESPACES.find((n) => n.file === file);
  const title =
    file === "color-brand-primitive.css"
      ? "primitive/color-brand-primitive.css - T1 原子层 · 品牌与合成色。"
      : `primitive/${file} - T1 原子层 · ${meta?.title ?? file}。`;
  files.set(
    file,
    header(title, meta?.utility ?? "—") + `\n:root {\n${blocks.join("\n\n")}\n}\n`,
  );
}

// animate 引用 @keyframes，镜像必须把定义一并带走，否则动画名指向不存在的关键帧
const keyframes = readKeyframes(ROOT);
if (byNs.has("animate") && keyframes.length > 0) {
  const kfFile = NAMESPACES.find((n) => n.ns === "animate").file;
  files.set(kfFile, files.get(kfFile) + "\n" + keyframes.map((k) => k.css).join("\n\n") + "\n");
  notes.push(`@keyframes ${keyframes.length} 组随 animate 一并镜像`);
}

const total = [...byNs.values()].reduce((s, l) => s + l.length, 0) + keptBrandRows.length + extCount;

if (CHECK) {
  const stale = [];
  for (const [file, css] of files) {
    let current = "";
    try {
      current = readFileSync(path.join(OUT_DIR, file), "utf8");
    } catch {
      /* 缺文件即视为不同步 */
    }
    if (current !== css) stale.push(file);
  }
  if (stale.length > 0) {
    console.error(`T1 与 Tailwind 基线不同步：${stale.join(", ")}`);
    console.error("运行：node scripts/design-tokens/generate-primitive.mjs");
    process.exit(1);
  }
  console.log(`T1 镜像一致（${files.size} 文件 / ${total} 项 · 扩展 ${extCount} · 覆盖 ${overCount}）`);
} else {
  for (const [file, css] of files) {
    mkdirSync(path.dirname(path.join(OUT_DIR, file)), { recursive: true });
    writeFileSync(path.join(OUT_DIR, file), css, "utf8");
  }
  console.log(`已生成 T1 镜像：${files.size} 文件 / ${total} 项 · 扩展 ${extCount} · 覆盖 ${overCount}`);
  for (const n of notes) console.log(`    · ${n}`);
}
