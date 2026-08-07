#!/usr/bin/env node
/**
 * check-mode-blocks.mjs - 模式轴块的结构断言。
 * @package vxture
 *
 * 起因：`.density-compact` 曾整档失效。它与 `:root` 特异性同为 (0,1,0)，而
 * `:root` 也匹配 `<html>`；默认块被生成在它之后，于是后写的赢，compact 完全
 * 等于 default。CSS 对此不报错——变量声明成功、值被覆盖、页面照常渲染。
 *
 * 同一族里 `html.vx-font-small` 是 (0,1,1)，靠 `html` 那一位压过 `:root`，
 * 侥幸没炸。也就是说当时的正确性挂在选择器形状这个巧合上：谁把看似赘余的
 * `html.` 前缀去掉，故障立刻复现，而且同样不报错。
 *
 * 靠"记得把默认块写在前面"防不住这种事，所以固化成三条断言：
 *
 *   1. **默认块必须最先**。带 `:root` 的那个块排在本族所有覆盖块之前。
 *   2. **覆盖块的特异性不得低于默认块**。低了就只能靠顺序兜底，而顺序是
 *      生成器的实现细节，随时会被重排。
 *   3. **同族各块的变量键集必须完全一致**。少一个键 = 那一档在该维度上悄悄
 *      退回默认值，是最难发现的一类漂移。
 *
 * 用法：node scripts/guardrails/check-mode-blocks.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEMANTIC = path.join(
  ROOT,
  "packages/design/design-tokens/src/styles/semantic",
);

/** 每族一条：文件 + 判定"这个顶层块属于本族"的规则。 */
const FAMILIES = [
  {
    name: "主题（明 / 暗）",
    file: "color-semantic.css",
    // 暗色块是 `.dark, :root.dark` 两支并列——`.dark` 那支让暗色能作用于子树，
    // 不只是整页。族匹配必须认得两种写法。
    match: /:root|\.dark/,
  },
  {
    name: "密度三档",
    file: "spacing-semantic.css",
    match: /^:root|density-/,
  },
  {
    name: "字号三档",
    file: "typography-semantic.css",
    match: /vx-font-/,
  },
];

/**
 * 算一个选择器列表的特异性，取其中最高的一个分支——`:root, .density-default`
 * 这种并列，最强的那支决定它能压过谁。
 */
function specificity(selectorList) {
  let best = [0, 0, 0];
  for (const raw of selectorList.split(",")) {
    const sel = raw.trim();
    if (!sel) continue;
    const a = (sel.match(/#[\w-]+/g) ?? []).length;
    // 类、属性、伪类；伪元素（::）不计入这一位，故先排除
    const b = (sel.match(/\.[\w-]+|\[[^\]]+\]|(?<!:):[\w-]+(?:\([^)]*\))?/g) ?? [])
      .length;
    const c = (sel.match(/(?<![\w.#[:-])[a-z][\w-]*/gi) ?? []).length;
    const cur = [a, b, c];
    if (cur[0] > best[0] || (cur[0] === best[0] && cur[1] > best[1]) ||
        (cur[0] === best[0] && cur[1] === best[1] && cur[2] > best[2])) {
      best = cur;
    }
  }
  return best;
}

const fmt = (s) => `(${s.join(",")})`;
const lt = (x, y) =>
  x[0] < y[0] ||
  (x[0] === y[0] && x[1] < y[1]) ||
  (x[0] === y[0] && x[1] === y[1] && x[2] < y[2]);

/** 抓顶层块：选择器起于行首、`}` 独占一行。生成物格式固定，够用。 */
function topLevelBlocks(src) {
  const out = [];
  const re = /^([^\s/@}][^{]*)\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(src))) {
    out.push({
      selector: m[1].trim(),
      keys: new Set(
        [...m[2].matchAll(/^\s*--([a-z0-9-]+)\s*:/gm)].map((x) => x[1]),
      ),
    });
  }
  return out;
}

let failed = 0;
const fail = (msg) => {
  failed += 1;
  console.error(`  ✗ ${msg}`);
};

for (const family of FAMILIES) {
  const file = path.join(SEMANTIC, family.file);
  if (!fs.existsSync(file)) {
    fail(`${family.name}：找不到 ${family.file}`);
    continue;
  }

  const blocks = topLevelBlocks(fs.readFileSync(file, "utf8")).filter((b) =>
    family.match.test(b.selector),
  );

  if (blocks.length < 2) {
    fail(`${family.name}：只解析出 ${blocks.length} 个块，模式轴至少要两个`);
    continue;
  }

  const defaultIndex = blocks.findIndex((b) => /(^|,)\s*:root(?![\w.-])/.test(b.selector));
  if (defaultIndex === -1) {
    fail(`${family.name}：没有默认块（不含 :root 的分支）`);
    continue;
  }

  // 1. 默认块最先
  if (defaultIndex !== 0) {
    fail(
      `${family.name}：默认块 \`${blocks[defaultIndex].selector}\` 排在第 ${
        defaultIndex + 1
      } 位，必须最先——` +
        `它与同特异性的覆盖块平手时后写的赢，会把前面的档整个吃掉`,
    );
  }

  const base = blocks[defaultIndex];
  const baseSpec = specificity(base.selector);

  for (const b of blocks) {
    if (b === base) continue;

    // 2. 覆盖块特异性不低于默认块
    const spec = specificity(b.selector);
    if (lt(spec, baseSpec)) {
      fail(
        `${family.name}：\`${b.selector}\` ${fmt(spec)} 低于默认块 ` +
          `\`${base.selector}\` ${fmt(baseSpec)}，只能靠顺序兜底`,
      );
    }

    // 3. 键集一致
    const missing = [...base.keys].filter((k) => !b.keys.has(k));
    const extra = [...b.keys].filter((k) => !base.keys.has(k));
    if (missing.length || extra.length) {
      fail(
        `${family.name}：\`${b.selector}\` 键集与默认块不一致——` +
          `缺 ${missing.length}（${missing.slice(0, 5).join(" ")}）` +
          `多 ${extra.length}（${extra.slice(0, 5).join(" ")}）`,
      );
    }
  }

  if (!failed) {
    console.log(
      `${family.name}：${blocks.length} 块 × ${base.keys.size} 键 ✓  ` +
        blocks
          .map(
            (b) =>
              `${b.selector.replace(/\s+/g, " ")} ${fmt(specificity(b.selector))}`,
          )
          .join("  |  "),
    );
  }
}

if (failed) {
  console.error(`\n模式轴块检查失败：${failed} 项。`);
  process.exit(1);
}
console.log("\n模式轴块检查通过：默认块最先、覆盖块特异性不低、各档键集一致。");
