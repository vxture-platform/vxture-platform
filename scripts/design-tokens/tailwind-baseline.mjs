/**
 * tailwind-baseline.mjs — 读取 Tailwind v4 自带的 theme.css，作为 T1 的基线输入。
 *
 * ── 为什么以 Tailwind 为输入源 ──
 * DS 的 T1 是 Tailwind theme 的**完整镜像**：命名空间、分组、挡位、名称、取值
 * 逐项一致，DS 因此是一套自洽完整的 token 层，而不是 Tailwind 上的差分补丁。
 *
 * 镜像若靠人工抄写，"逐项一致"只能靠纪律维持，且 Tailwind 升级后会静默漂移。
 * 直接读它的 theme.css，则一致性由构造保证：对不上是不可能的，除非我们**有意**
 * 在 EXTENSIONS / OVERRIDES 里写明。
 *
 * 偏离一律显式：扩展进 EXTENSIONS（Tailwind 没有的挡位），覆盖进 OVERRIDES
 * （Tailwind 有但 DS 判定要改）。两者都要求写理由，生成时逐条打印。
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** 定位 pnpm store 里的 tailwindcss——本仓根 package.json 不直接依赖它。 */
export function tailwindDir(root) {
  const store = path.join(root, "node_modules/.pnpm");
  const dir = readdirSync(store).find((d) => /^tailwindcss@\d/.test(d));
  if (!dir) throw new Error("未找到 tailwindcss 安装目录，无法取得 T1 基线");
  return path.join(store, dir, "node_modules/tailwindcss");
}

/**
 * Tailwind theme 的命名空间。**按最长前缀匹配**，顺序即优先级：
 * `--font-weight-bold` 必须归入 font-weight 而非 font，`--text-shadow-*` 同理。
 */
export const NAMESPACES = [
  { ns: "font-weight", file: "typography/weight-primitive.css", title: "字重", utility: "font-*" },
  { ns: "text-shadow", file: "text-shadow-primitive.css", title: "文字阴影", utility: "text-shadow-*" },
  { ns: "inset-shadow", file: "inset-shadow-primitive.css", title: "内阴影", utility: "inset-shadow-*" },
  { ns: "drop-shadow", file: "drop-shadow-primitive.css", title: "投影滤镜", utility: "drop-shadow-*" },
  { ns: "color", file: "color-primitive.css", title: "色板", utility: "bg-* / text-* / border-*" },
  { ns: "font", file: "typography/font-primitive.css", title: "字体栈", utility: "font-*" },
  { ns: "text", file: "typography/text-primitive.css", title: "字号", utility: "text-*" },
  { ns: "tracking", file: "typography/tracking-primitive.css", title: "字距", utility: "tracking-*" },
  { ns: "leading", file: "typography/leading-primitive.css", title: "行高", utility: "leading-*" },
  { ns: "breakpoint", file: "breakpoint-primitive.css", title: "断点", utility: "sm: / md: / …" },
  { ns: "container", file: "container-primitive.css", title: "容器宽度", utility: "max-w-*" },
  { ns: "spacing", file: "spacing-primitive.css", title: "间距基数", utility: "p-* / gap-* / size-*" },
  { ns: "radius", file: "radius-primitive.css", title: "圆角", utility: "rounded-*" },
  { ns: "shadow", file: "shadow-primitive.css", title: "阴影", utility: "shadow-*" },
  { ns: "blur", file: "blur-primitive.css", title: "模糊", utility: "blur-*" },
  { ns: "perspective", file: "perspective-primitive.css", title: "透视", utility: "perspective-*" },
  { ns: "aspect", file: "aspect-primitive.css", title: "宽高比", utility: "aspect-*" },
  { ns: "ease", file: "ease-primitive.css", title: "缓动曲线", utility: "ease-*" },
  { ns: "animate", file: "animate-primitive.css", title: "动画", utility: "animate-*" },
  // 上游 theme.css 里没有这一族——v4 的 duration-* 是裸数值工具类。但它在文档与
  // 实现里是一条**封闭的档位表**，T2 的 fast / base / slow 需要有 T1 可指，
  // 否则语义名只能落裸值、破坏"T2 只引 T1"。故整族由 EXTENSIONS 提供。
  {
    ns: "transition-duration",
    file: "transition-duration-primitive.css",
    title: "过渡时长",
    utility: "duration-*",
  },
];

/**
 * `--default-*` **不镜像**。
 *
 * 它们不是设计 token，而是 Tailwind 自己的内部旋钮：驱动 preflight 的默认字体、
 * 以及 `transition` 工具类在未指定时长时的兜底值。加上 `--vx-` 前缀后 Tailwind
 * 不会去读，变量就此失效；更糟的是其取值形如
 * `--theme(--font-sans, initial)`——`--theme()` 只在 Tailwind 的 theme 处理阶段
 * 有意义，落到普通 `:root` 里根本不解析。
 *
 * 要改这些默认值，正确做法是在消费方的 `@theme` 里直接写 `--default-*`，
 * 而不是在 DS 里存一份镜像。故解析时识别、但不产出。
 */
export const DEFAULTS_MIRRORED = false;

/**
 * 解析 theme.css → [{ ns, step, name, value }]。
 *
 * `--text-xs--line-height` 这类修饰子键的 step 含 `--`，原样保留：它是 Tailwind
 * 定义排版角色附属属性的机制，镜像必须带上，否则 `text-xs` 会少落行高。
 */
export function readBaseline(root) {
  const css = readFileSync(path.join(tailwindDir(root), "theme.css"), "utf8");
  const seen = new Set();
  const rows = [];
  const defaults = [];

  for (const m of css.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
    const [, name, raw] = m;
    if (seen.has(name)) continue;
    seen.add(name);
    const value = raw.trim().replace(/\s+/g, " ");

    if (name.startsWith("--default-")) {
      defaults.push({ name, value });
      continue;
    }
    const hit = NAMESPACES.find(
      (n) => name.startsWith(`--${n.ns}-`) || name === `--${n.ns}`,
    );
    if (!hit) continue; // theme.css 里的其余变量（如 --max-width-prose）不属命名空间
    const step = name === `--${hit.ns}` ? "" : name.slice(hit.ns.length + 3);
    rows.push({ ns: hit.ns, step, name, value });
  }
  return { rows, defaults };
}

/** theme.css 里的 @keyframes——`--animate-*` 引用它们，镜像时必须一并带走。 */
export function readKeyframes(root) {
  const css = readFileSync(path.join(tailwindDir(root), "theme.css"), "utf8");
  const out = [];
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    // 手工配平花括号：keyframes 内部有嵌套块，正则一把梭会提前收尾。
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = m.index;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) break;
    }
    out.push({ name: m[1], css: css.slice(start, i + 1) });
  }
  return out;
}
