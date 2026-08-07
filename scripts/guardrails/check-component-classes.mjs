#!/usr/bin/env node

/**
 * check-component-classes.mjs — 把组件里写的每个类名喂给 Tailwind，报出哑火的。
 *
 * ── 补的是哪个盲区 ──
 * DS 包用 tsup 打包，**自身从不跑 Tailwind 编译**。组件里写错或写了已退役的类名，
 * 包内 build 全绿、eslint 全绿、类型全绿，只在消费方渲染时无声失效——元素照样
 * 挂着那个 class，只是没有任何规则匹配。
 *
 * 遗留 token 层退役后这类失效有 130 处（`bg-vx-surface` 之类整族哑火），全是
 * 靠人眼发现的。本脚本把它变成机器可查。
 *
 * check-utilities.mjs 查的是"token 注册有没有产出工具类"（自下而上取样），
 * 本脚本查的是"组件用的类是不是都存在"（自上而下全量）。两者不重叠。
 *
 * 用法：node scripts/guardrails/check-component-classes.mjs
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { PENDING_COMPONENTS } from "./pending-components.mjs";
import { RECIPE_PATTERNS } from "./pending-recipes.mjs";

/**
 * 曾有一份"尚未改用配方层"的豁免清单，批 B–E 逐个清空后删除。
 * 现在没有豁免：任何组件手写这些片段都是错。
 */
const PENDING_RECIPES_SET = new Set();

const ROOT = process.cwd();
const PNPM = path.join(ROOT, "node_modules/.pnpm");
const twDir = (await readdir(PNPM)).find((d) => /^tailwindcss@\d/.test(d));
if (!twDir) {
  console.error("未找到 tailwindcss 安装目录，跳过组件类名实测。");
  process.exit(0);
}
const TW = path.join(PNPM, twDir, "node_modules/tailwindcss");
const { compile } = await import(
  new URL(`file://${path.join(TW, "dist/lib.mjs").split(path.sep).join("/")}`).href
);

const PKG = path.join(ROOT, "packages/design/design-system");
const STYLES = path.join(PKG, "src/styles");
/** 组件分居两包：无状态的在 design-ui，需要运行时接线的两个留在伞包。 */
const COMPONENT_ROOTS = [
  path.join(ROOT, "packages/design/design-ui/src/components"),
  path.join(PKG, "src/components"),
];
const TOKENS_STYLES = path.join(ROOT, "packages/design/design-tokens/src/styles");

/**
 * 从 DS 的 `globals.css` 起编，而不是只编 `tokens.css`。
 *
 * 消费方引的就是 globals.css，链上还有 `@plugin "tailwindcss-animate"`——
 * 只编 tokens.css 会把 `animate-in` / `fade-in-0` 这类 shadcn 标配全判成哑火。
 */
async function loadStylesheet(id, base) {
  if (id === "tailwindcss") {
    const p = path.join(TW, "index.css");
    return { path: p, base: TW, content: await readFile(p, "utf8") };
  }
  // 样式链跨包：globals.css 引 @vxture/design-tokens/styles/*
  for (const [prefix, dir] of [
    ["@vxture/design-tokens/styles/", TOKENS_STYLES],
    ["@vxture/design-system/styles/", STYLES],
  ]) {
    if (id.startsWith(prefix)) {
      const p = path.join(dir, id.slice(prefix.length));
      return { path: p, base: path.dirname(p), content: await readFile(p, "utf8") };
    }
  }
  const p = path.isAbsolute(id)
    ? id
    : id.startsWith(".")
      ? path.resolve(base, id)
      : path.join(TW, id);
  return { path: p, base: path.dirname(p), content: await readFile(p, "utf8") };
}

const compiled = await compile(
  `@import "${path.join(STYLES, "globals.css").split(path.sep).join("/")}";`,
  {
    base: ROOT,
    loadStylesheet,
    // `@plugin "tailwindcss-animate"` 走这里。仓根不直接依赖它，故从 pnpm store 解析。
    loadModule: async (id) => {
      const dir = (await readdir(PNPM)).find((d) => d.startsWith(`${id}@`));
      if (!dir) throw new Error(`未找到插件 ${id}`);
      const entry = path.join(PNPM, dir, "node_modules", id);
      // CJS 包无 exports 字段时目录导入不被 ESM 支持，须显式指到入口文件。
      const pkg = JSON.parse(await readFile(path.join(entry, "package.json"), "utf8"));
      const main = path.join(entry, pkg.main ?? "index.js");
      const mod = await import(new URL(`file://${main.split(path.sep).join("/")}`).href);
      return { base: entry, module: mod.default ?? mod };
    },
  },
);

/** CSS 选择器转义：数字开头须写成十六进制码点加空格（`2xl:p-4` → `\32 xl\:p-4`）。 */
function cssIdent(name) {
  const escaped = name.replace(/[:.[\]()&>/%'=,#!+*~$^|?]/g, (c) => `\\${c}`);
  return /^\d/.test(escaped) ? `\\3${escaped[0]} ${escaped.slice(1)}` : escaped;
}

/**
 * 标记类：Tailwind 用它们做选择器锚点（`peer-checked:` / `group-hover:`），
 * 本身**不产出任何规则**，故按存在处理，否则会被误报成哑火。
 */
const MARKERS = /^(peer|group)(\/[\w-]+)?$/;

const cache = new Map();
function generated(cls) {
  if (cache.has(cls)) return cache.get(cls);
  let ok = MARKERS.test(cls);
  try {
    if (ok) throw new Error("marker");
    const out = compiled.build([cls]);
    const i = out.indexOf("@layer utilities {");
    ok = i >= 0 && out.slice(i).includes(`.${cssIdent(cls)} {`);
  } catch {
    /* 标记类走上面的短路；编译异常按未生成处理 */
  }
  cache.set(cls, ok);
  return ok;
}

/**
 * 判定一个字符串字面量是不是类名列表。
 *
 * 源码里字符串还有 import 路径、prop 取值、displayName、SVG path 等等。判据用
 * "多数 token 能被编译器认出"：`"flex items-center gap-md"` 全中；`"react"`、
 * `"horizontal"` 一个都不中，直接跳过。半数以上命中才逐个报缺失的那几个。
 */
/**
 * strict：配方层专用。多数票启发式在组件文件里是必要的（要把 import 路径、普通
 * 文案排除掉），但它放走过 `"aria-expanded:bg-muted aria-expanded:text-foreground"`
 * ——两 token 恰好一半失效，整串被判为"不是类名列表"（2026-08-03 实测：
 * expandable 配方的展开高亮因 bg-muted 缺 token 静默失效，所有菜单触发器中招）。
 * recipes.ts 按定义只装类名片段：命中一个生成类就整串实测，不再多数票。
 */
function classListOf(text, strict = false) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.some((t) => /[<>{}"`;]|^\.{1,2}\//.test(t))) return null;
  const hits = tokens.filter((t) => generated(t));
  if (hits.length === 0) return null;
  if (!strict && hits.length * 2 <= tokens.length) return null;
  return tokens.filter((t) => !generated(t));
}

async function walk(dir, out = []) {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) await walk(p, out);
    else if (/\.tsx$/.test(f.name)) out.push(p);
  }
  return out;
}

/**
 * 只查已按 shadcn 惯例 + cva 重写完的组件。
 *
 * 其余组件仍依赖遗留样式层的 BEM 类名（`.vx-card` / `.vx-page-header__title-row`），
 * 那些类随 155 个遗留 CSS 文件一并删除，现在**全部无定义**——纳入检查会一次报出
 * 几百条，把真实回归淹掉。它们的去向是 C2（以工具类重写为 cva 组件）；
 * 每重写完一个就从 PENDING 移走，清空即可删掉这份名单。
 */
const PENDING = new Set(PENDING_COMPONENTS);

const discovered = [];
for (const root of COMPONENT_ROOTS) discovered.push(...(await walk(root)));
/**
 * 配方层也要扫。
 *
 * 它不在 components/ 下，第一版因此漏检——`panel.base` 里写了个不存在的
 * `text-popover-foreground`，被它引用的四个叠层组件全部逃过检查，
 * 而组件自己写同样的类会立刻报错。**共享的东西比各写各的更需要检查**，
 * 因为一处错会静默扩散到所有引用方。
 */
discovered.push(
  path.join(ROOT, "packages/design/design-ui/src/styles/recipes.ts"),
);
const files = discovered.filter((f) => !PENDING.has(path.basename(f)));

/**
 * 一个都没扫到就是错，不是"通过"。
 *
 * 拆包时组件从 design-system 迁到 design-ui，本检查还指着旧路径，于是安静地
 * 报出"0 个组件 / 全部生成"——空集永远全绿。零结果必须当失败。
 */
if (files.length === 0) {
  console.error(
    "没有扫到任何组件——组件目录可能移动过而本清单没跟上。\n" +
      `已查：${COMPONENT_ROOTS.map((r) => path.relative(ROOT, r)).join(", ")}`,
  );
  process.exit(1);
}

/**
 * 生成了 ≠ 用对了：`max-w-lg` 在上游是 512px 容器宽，在本仓却命中同名的
 * `--spacing-lg`——类名照常生成，Dialog 塌成 24px 宽（2026-08-02 实测事故）。
 * 容器意图必须走 content / page 宽度族；这里把裸容器档的 max-w / min-w 一律拦下。
 */
const MISRESOLVED = /^(?:max|min)-w-(?:3xs|2xs|xs|sm|md|lg|xl|[2-7]xl)$/;

const dead = [];
const misresolved = [];
let scanned = 0;
for (const file of files) {
  const src = await readFile(file, "utf8");
  const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const strict = path.basename(file) === "recipes.ts";
  const lines = body.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/"([^"\n]{2,})"/g)) {
      const missing = classListOf(m[1], strict);
      if (missing === null) continue;
      scanned++;
      for (const cls of missing) {
        dead.push({ file: path.relative(ROOT, file), line: i + 1, cls });
      }
      for (const cls of m[1].split(/\s+/)) {
        if (MISRESOLVED.test(cls.replace(/^.*:/, ""))) {
          misresolved.push({ file: path.relative(ROOT, file), line: i + 1, cls });
        }
      }
    }
  });
}

if (misresolved.length > 0) {
  console.error(
    "裸容器档的宽度类会命中同名 spacing 档（生成但值错，如 max-w-lg → 24px）：\n",
  );
  for (const d of misresolved) console.error(`  ✗ ${d.file}:${d.line}  ${d.cls}`);
  console.error("\n容器意图改用 max-w-content-* / max-w-page-* 宽度族。");
  process.exit(1);
}

if (dead.length > 0) {
  console.error("组件用到未生成的类名——这些元素会静默无样式：\n");
  for (const d of dead) console.error(`  ✗ ${d.file}:${d.line}  ${d.cls}`);
  console.error(
    "\n改用 T2 语义名产出的工具类；族清单见 packages/design/design-system/docs/04-tokens-contract.md。",
  );
  process.exit(1);
}

/* ── 配方层采用情况 ───────────────────────────────────────────
 *
 * 上面查的是"类名存不存在"，这里查的是"该不该由组件自己写"。
 * 焦点环 / 禁用态 / 校验态在每个组件里都该长一个样，手写就会漂移——而漂移不报错，
 * 只是那个组件从此和别人不一样。
 *
 * 双向校验：清单外的组件手写会报错（挡新增漂移），清单内的组件已经不写了也报错
 * （挡清单腐烂）。后者是关键——没有它，清单会变成一份永远只增不减的豁免名单。
 */
const stillHandWritten = new Set();
const recipeViolations = [];
for (const file of files) {
  const base = path.basename(file);
  const body = (await readFile(file, "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  // 配方层自己当然要写这些片段——它就是定义处。
  if (base === "recipes.ts") continue;

  // 判据是"有没有 import 配方"，不是"文本里有没有这个串"。
  // 逐变体覆盖（destructive 换环色）是合法定制，按串匹配会把它误判成手写。
  const adopted = /from\s+"[^"]*styles\/recipes"/.test(body);
  if (adopted) continue;

  // `(?<![\w-])` 挡住 `peer-disabled:opacity` / `group-data-[disabled=…]` 这类
  // **反应别人状态**的写法——它们不是配方能替的：配方管的是元素自己的状态。
  const hits = RECIPE_PATTERNS.filter(([pattern]) =>
    new RegExp(`(?<![\\w-])${pattern.replace(/[[\]]/g, "\\$&")}`).test(body),
  );
  if (hits.length === 0) continue;
  stillHandWritten.add(base);
  if (PENDING_RECIPES_SET.has(base)) continue;
  for (const [pattern, recipe] of hits) {
    recipeViolations.push({ file: path.relative(ROOT, file), pattern, recipe });
  }
}

const staleLedger = [...PENDING_RECIPES_SET].filter((b) => !stillHandWritten.has(b));

if (recipeViolations.length > 0 || staleLedger.length > 0) {
  if (recipeViolations.length > 0) {
    console.error("组件手写了本该由配方层提供的片段——改基调时一定会漏掉：\n");
    for (const v of recipeViolations) {
      console.error(`  ✗ ${v.file}  写了 ${v.pattern}，应引用配方 \`${v.recipe}\``);
    }
    console.error("\n配方在 packages/design/design-ui/src/styles/recipes.ts。");
  }
  if (staleLedger.length > 0) {
    console.error("\n以下组件已不再手写这些片段，请从 pending-recipes.mjs 删掉：\n");
    for (const b of staleLedger) console.error(`  ✗ ${b}`);
  }
  process.exit(1);
}

console.log(
  `组件类名实测通过（${files.length} 个已重写组件 / ${scanned} 处类名列表，全部生成；` +
    `${PENDING.size} 个待 C2 重写的组件暂不纳入）\n` +
    `配方层检查通过（${files.length} 个组件全部无手写视觉片段，无豁免）`,
);
