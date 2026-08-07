#!/usr/bin/env node

/**
 * generate-semantic-scales.mjs — 生成 T2 语义层的非色彩部分。
 *
 * 输入来自 semantic-policy.mjs 与 typography-policy.mjs。生成器承担的是断言与
 * 派生：T1 存在性、z 逐档互异、elevation 与间距的单调性，以及排版角色在字号
 * 三档之间的平移——1500 行重复的模式块 CSS 手工维护必然漂移。
 *
 * ── T2 为什么要覆盖全部刻度族 ──
 * T1 是 Tailwind theme 的镜像，回答"有哪些数可选"；T2 回答"哪个数用在什么场合"。
 * 即使某族的语义名与 T1 一一对应、当下零增益（radius 就是），仍然经 T2 出口：
 * 分层边界要么处处成立、要么不成立，消费方不该需要记住"这族有语义名、那族没有"。
 *
 * 命名一律落在 v4 的真实命名空间上（`--transition-duration-*` 而非 `--duration-*`、
 * `--z-index-*` 而非 `--z-*`、`--spacing-*` 而非 `--space-*`），否则变量声明成功、
 * 工具类却不产出，且不报错——`duration-fast` 曾这样哑火一整轮。
 *
 * ── 两种落法 ──
 * 有模式轴的（字号三档 / 密度三档）：在模式选择器下声明 DS 侧名字，由
 *   generate-theme.mjs 注册进命名空间，`@theme inline` 使模式切换自动跟随。
 * 无模式轴的：直接在本文件的 `@theme` 块里用最终命名空间名声明，一处声明即完成
 *   注册——少一跳，也少一类"声明了忘记注册"的静默失效。
 *
 * 用法：
 *   node scripts/design-tokens/generate-semantic-scales.mjs
 *   node scripts/design-tokens/generate-semantic-scales.mjs --check
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  Z_LADDER,
  ELEVATION,
  EASE_ROLES,
  DURATION_ROLES,
  RADIUS_BASE,
  RADIUS_STEPS,
  BORDER_WIDTHS,
  OPACITIES,
  VEIL_ALPHAS,
  ICON_SIZES,
  MEDIA_SIZES,
  SIDEBAR_WIDTHS,
  HEADER_HEIGHTS,
  CONTENT_WIDTHS,
  PANEL_WIDTHS,
  OVERLAY_WIDTHS,
  SPACING_SCALE,
  SPACING_KINDS,
  FLUID_SPACING,
  assertElevationOrdered,
} from "./semantic-policy.mjs";
import {
  TEXT_LADDER,
  SIZE_MODE_SHIFT,
  TYPE_ROLES,
  TYPE_GROUP_ORDER,
  TIGHT_LEADING_ROLES,
  CAPS_ROLES,
  CAPS_TRACKING,
  CJK_SELECTOR,
  CJK_LEADING_ADD,
} from "./typography-policy.mjs";

const ROOT = process.cwd();
const CHECK = process.argv.includes("--check");

const PKG = path.join(ROOT, "packages/design/design-tokens");
const OUT_DIR = path.join(PKG, "src/styles/semantic");
const PRIMITIVE = path.join(PKG, "src/styles/primitive");

const errors = [];
const notes = [];

/* ── 读 T1 ──────────────────────────────────────────────────── */

function loadT1() {
  const literals = new Map();
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) walk(full);
      else if (f.name.endsWith(".css")) {
        for (const m of readFileSync(full, "utf8").matchAll(/^\s*(--vx-[\w-]+):\s*([^;]+);/gm)) {
          literals.set(m[1], m[2].trim());
        }
      }
    }
  };
  walk(PRIMITIVE);
  return literals;
}

/** 引用 T1，并断言目标存在——指向不存在的原子在 CSS 里是静默失效。 */
function t1(name, where) {
  if (!t1Literals.has(name)) errors.push(`${where}：T1 中不存在 ${name}`);
  return `var(${name})`;
}

/** 顺 var() 链解到字面量，用于必须落字面量的场合（容器查询）。 */
function resolve(name, where) {
  let cur = name;
  for (let i = 0; i < 8; i++) {
    const value = t1Literals.get(cur) ?? layoutLiterals.get(cur);
    if (value === undefined) {
      errors.push(`${where}：无法解析 ${cur}`);
      return "0";
    }
    const m = /^var\((--[\w-]+)\)$/.exec(value);
    if (!m) return value;
    cur = m[1];
  }
  errors.push(`${where}：var() 引用过深或成环`);
  return "0";
}

/* ── 排版角色（字号三档）───────────────────────────────────── */

/* 默认块排最前，理由同 DENSITY_MODES。本族当前靠 `html.vx-font-*` 的
 * (0,1,1) 压过 `:root` 的 (0,1,0) 侥幸没出事，但那是特异性在兜底而非顺序正确；
 * 谁把选择器改成裸类名就会立刻复现 compact 那个故障。两族保持同一形态。 */
const FONT_SIZE_MODES = [
  [1, ":root, html.vx-font-default"],
  [0, "html.vx-font-small"],
  [2, "html.vx-font-large"],
];

/**
 * 角色在某个字号模式下的档位。
 *
 * 平移沿 T1 字号阶梯进行；`noShrink` / `noGrow` 是角色自己声明的例外，理由见
 * typography-policy。越界一律夹到端点而不是报错——阶梯两端本来就是硬边界。
 */
function shiftFor(role, modeIndex) {
  const flag = role[6];
  let shift = SIZE_MODE_SHIFT[modeIndex];
  if (flag === "noShrink" && shift < 0) shift = 0;
  if (flag === "noGrow" && shift > 0) shift = 0;
  return shift;
}

function stepFor(role, shift) {
  const base = role[3];
  const i = TEXT_LADDER.indexOf(base);
  if (i < 0) {
    errors.push(`${role[0]}：默认档 ${base} 不在字号阶梯上`);
    return base;
  }
  return TEXT_LADDER[Math.min(TEXT_LADDER.length - 1, Math.max(0, i + shift))];
}

/**
 * 一个角色在某个字号档下的五项属性。
 *
 * 行高引字号档自带的子键，故角色在三档字号模式之间自动跟随；字距统一为零。
 * 规则与两处例外（大字号标题收紧行高、全大写放开字距）见 typography-policy。
 */
function buildRoles(modeIndex) {
  const rows = [];
  for (const role of TYPE_ROLES) {
    const [name, family, weight] = role;
    const where = `字号模式 ${modeIndex} ${name}`;
    const step = stepFor(role, shiftFor(role, modeIndex));
    const tightLeading = TIGHT_LEADING_ROLES.test(name);
    const group =
      TYPE_GROUP_ORDER.find((g) => name === g || name.startsWith(`${g}-`)) ?? name;

    rows.push([`--${name}-font-family`, t1(`--vx-font-${family}`, where), group]);
    rows.push([`--${name}-font-size`, t1(`--vx-text-${step}`, where), group]);
    rows.push([`--${name}-font-weight`, t1(`--vx-font-weight-${weight}`, where), group]);
    rows.push([
      `--${name}-line-height`,
      `calc(${
        tightLeading
          ? t1("--vx-leading-tight", where)
          : t1(`--vx-text-${step}--line-height`, where)
      } + var(--vx-cjk-leading-add))`,
      group,
    ]);
    // 字距统一为零，全大写除外。角色仍显式声明，避免继承自父级的字距漏进来。
    rows.push([
      `--${name}-letter-spacing`,
      t1(CAPS_ROLES.has(name) ? CAPS_TRACKING : "--vx-tracking-normal", where),
      group,
    ]);
  }
  return rows;
}

/* ── 间距（密度三档）───────────────────────────────────────── */

/**
 * **顺序即正确性**：`:root` 与 `.density-compact` 特异性同为 (0,1,0)，而 `:root`
 * 也匹配 `<html>`——默认块排在后面就会把 compact 整档覆盖掉，且不报错。
 * 实测症状是 compact 完全等于 default，comfortable（排在默认块之后）正常。
 *
 * 故默认块必须**排在最前**。不用 `html.density-*` 抬特异性来绕，是为了保留把
 * 密度类挂在子树上的可能——密度是"这一片紧凑些"的合法诉求，不必须全局。
 */
/**
 * 每档取 `SPACING_SCALE` 的哪一列，**按族分开**。
 *
 * 默认档的留白与行高取最宽那一列（原 comfortable 的取值），但 `control` 族**不跟**：
 * 密度是"一屏放多少信息"，由留白和行高决定；控件高度是人机工程（点击目标、
 * 文字可读性），不该因为页面变宽松就把按钮撑胖。
 *
 * 这不是我们的发明——实测 shadcn 的 maia（generous）与 vega 的控件高度完全相同，
 * 都是 24/32/36/40。上游改密度从不改控件高度。
 *
 * 于是 `control` 的第三列在默认档下闲置，只有显式 `.density-comfortable` 才用到。
 */
const DENSITY_MODES = [
  [{ inset: 2, row: 2, control: 1 }, ":root, .density-default"],
  [{ inset: 0, row: 0, control: 0 }, ".density-compact"],
  [{ inset: 2, row: 2, control: 2 }, ".density-comfortable"],
];

/**
 * T2 变量名用 `--space-*` 而非 `--spacing-*`：后者是命名空间名，同名会写出指向
 * 自己的注册（`--spacing-md: var(--spacing-md)`），CSS 判定为循环、整族失效且不报错。
 * 注册由 generate-theme.mjs 改名完成。
 */
function buildSpacing(columnOf) {
  return SPACING_SCALE.map(([step, ...mults]) => {
    const kind = SPACING_KINDS.find((k) => step.startsWith(`${k}-`)) ?? "inset";
    const n = mults[columnOf(kind)];
    const value =
      n === 0 ? "0px" : `calc(${t1("--vx-spacing", `spacing/${step}`)} * ${n})`;
    return [`--space-${step}`, value, kind];
  }).concat(buildFluidSpacing());
}

/**
 * 流体档：取值不随密度块变化（上下界引用的 `--space-*` 已经按密度分块声明，
 * 自定义属性在使用处求值，自然跟着走），但**仍要逐块声明一遍**——三个密度块
 * 的键集必须完全一致，这是 check-design-tokens 的模式轴不变量，也是"切换密度
 * 不会让某个变量突然没人定义"的保证。三块里的文本完全相同，不是重复定义了
 * 三个不同的值。
 */
function buildFluidSpacing() {
  return FLUID_SPACING.map(([step, minStep, vw, maxStep, why]) => [
    `--space-${step}`,
    `clamp(var(--space-${minStep}), ${vw}, var(--space-${maxStep}))`,
    "fluid",
    why,
  ]);
}

/** 下界必须真的低于上界，否则 clamp 退化成一个常数且不报错。 */
function assertFluidOrdered() {
  const order = SPACING_SCALE.map(([step]) => step);
  for (const [step, minStep, , maxStep] of FLUID_SPACING) {
    const lo = order.indexOf(minStep);
    const hi = order.indexOf(maxStep);
    if (lo < 0 || hi < 0) {
      errors.push(`流体间距 ${step}：边界档 ${minStep}/${maxStep} 不在 SPACING_SCALE 内`);
    } else if (lo >= hi) {
      errors.push(`流体间距 ${step}：下界 ${minStep} 不低于上界 ${maxStep}，clamp 会退化成常数`);
    }
  }
}

/** 同一行三档非递减、同一档沿族内递增——挡的是改表时把某一档写反。 */
function assertSpacingMonotonic() {
  const last = {};
  for (const [step, ...mults] of SPACING_SCALE) {
    const kind = SPACING_KINDS.find((k) => step.startsWith(`${k}-`)) ?? "inset";
    for (let i = 1; i < mults.length; i++) {
      if (mults[i] < mults[i - 1]) {
        errors.push(`间距 ${step}：密度三档非递减被打破（${mults.join(" / ")}）`);
      }
    }
    const prev = last[kind];
    if (prev && mults.some((m, i) => m < prev[i])) {
      errors.push(`间距 ${step}：某一档低于族内上一档（${mults.join(" / ")} < ${prev.join(" / ")}）`);
    }
    last[kind] = mults;
  }
}

/* ── 无模式轴的各族 ─────────────────────────────────────────── */

function buildRadius() {
  // 基数先落，各档 calc 引它——产品覆写 `--radius` 一处，整条梯子等比跟随。
  return [
    ["--radius", RADIUS_BASE, "radius", "圆角基数：改基调只改这一个数"],
    ...RADIUS_STEPS.map(([step, ratio]) => [
      `--radius-${step}`,
      ratio === 1 ? "var(--radius)" : `calc(var(--radius) * ${ratio})`,
      "radius",
    ]),
  ];
}

function buildBorder() {
  return BORDER_WIDTHS.map(([name, value, why]) => [
    `--border-width-${name}`,
    value,
    "border-width",
    why,
  ]);
}

function buildVeilAlphas() {
  return VEIL_ALPHAS.map(([name, value, why]) => [
    `--opacity-${name}`,
    String(value),
    "veil",
    why,
  ]);
}

function buildOpacity() {
  return OPACITIES.map(([name, value, why]) => [
    `--opacity-${name}`,
    String(value),
    "opacity",
    why,
  ]);
}

function buildZIndex() {
  const byValue = new Map();
  const rows = [];
  for (const [name, value, why] of Z_LADDER) {
    if (byValue.has(value)) {
      errors.push(
        `z-index 同值：${byValue.get(value)} 与 ${name} 都是 ${value}——叠放次序未定义`,
      );
    }
    byValue.set(value, name);
    rows.push([`--z-index-${name}`, String(value), "z-index", why]);
  }
  return rows;
}

function buildShadow() {
  assertElevationOrdered(errors);
  return ELEVATION.map(([role, step, , why]) => [
    `--shadow-${role}`,
    step === "none" ? "none" : t1(`--vx-shadow-${step}`, `elevation/${role}`),
    "shadow",
    why,
  ]);
}

function buildMotion() {
  const rows = DURATION_ROLES.map(([role, step, why]) => [
    `--transition-duration-${role}`,
    t1(`--vx-transition-duration-${step}`, `duration/${role}`),
    "duration",
    why,
  ]);
  for (const [role, step, why] of EASE_ROLES) {
    rows.push([`--ease-${role}`, t1(`--vx-ease-${step}`, `ease/${role}`), "ease", why]);
  }
  return rows;
}

function buildSize() {
  const rows = [];
  for (const [kind, list] of [
    ["icon", ICON_SIZES],
    ["media", MEDIA_SIZES],
  ]) {
    for (const [step, mult] of list) {
      rows.push([
        `--spacing-${kind}-${step}`,
        `calc(${t1("--vx-spacing", `${kind}/${step}`)} * ${mult})`,
        kind,
      ]);
    }
  }
  return rows;
}

/**
 * 页面与内容宽度。
 *
 * ⚠ 必须落字面量：容器宽度进 `@container (width >= …)`，而**容器查询里 var() 不
 *   参与求值**。写成引用不报错，只是该档的所有容器变体静默失效。这是本层唯一
 *   一处不写 var() 的地方，原因是 CSS 的限制而非分层的例外。
 *
 * 页面宽度逐档等于同名断点；内容宽度是可读行长上限，分档依据见 semantic-policy。
 */
const layoutLiterals = new Map();
function buildLayout() {
  const rows = [];
  const bp = [...t1Literals.entries()]
    .map(([n, v]) => [/^--vx-breakpoint-(.+)$/.exec(n)?.[1], v])
    .filter(([s_]) => s_)
    .sort((a, b) => parseFloat(a[1]) - parseFloat(b[1]));

  for (const [step] of bp) {
    const value = resolve(`--vx-breakpoint-${step}`, `layout/page/${step}`);
    layoutLiterals.set(`--container-page-${step}`, value);
    rows.push([`--container-page-${step}`, value, "page"]);
  }
  for (const [name, step, why] of CONTENT_WIDTHS) {
    rows.push([
      `--container-content-${name}`,
      resolve(`--container-page-${step}`, `layout/content/${name}`),
      "content",
      why,
    ]);
  }
  /* 浮层面板宽：上游 container 刻度的三档字面量，理由见 semantic-policy。 */
  for (const [name, value, why] of PANEL_WIDTHS) {
    rows.push([`--container-panel-${name}`, value, "panel", why]);
  }
  /* 控件与浮层宽：取 T1 基本单位的整数倍——container 刻度从 16rem 起步，这一段在它底下。
     可以引 var()（不同于 page / content）：控件宽不进容器查询。 */
  for (const [name, mult, why] of OVERLAY_WIDTHS) {
    rows.push([
      `--container-overlay-${name}`,
      `calc(${t1("--vx-spacing", `layout/overlay/${name}`)} * ${mult})`,
      "control",
      why,
    ]);
  }
  /* 侧栏宽 / header 高：版面结构归本族，但命名空间留 spacing——
     w-* / h-* 只从 --spacing-* 派生。 */
  for (const [kind, list] of [
    ["sidebar", SIDEBAR_WIDTHS],
    ["header", HEADER_HEIGHTS],
  ]) {
    for (const [name, mult] of list) {
      rows.push([
        `--spacing-${kind}-${name}`,
        `calc(${t1("--vx-spacing", `${kind}/${name}`)} * ${mult})`,
        kind,
      ]);
    }
  }
  return rows;
}

/* ── 渲染 ───────────────────────────────────────────────────── */

function render(rows, indent = "  ") {
  const groups = new Map();
  for (const [name, value, group, why] of rows) {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(`${indent}${name}: ${value};${why ? `  /* ${why} */` : ""}`);
  }
  return [...groups]
    .map(([g, lines]) => `${indent}/* ${g} */\n${lines.join("\n")}`)
    .join("\n\n");
}

function header(file, label, source, extra = "") {
  return `/**
 * semantic/${file} - T2 语义层 · ${label}。
 * @package @vxture/design-tokens
 * @layer Presentation
 * @category styles
 * @author AI-Generated
 * @date 2026-08-01
 *
 * ⚠ 本文件由脚本生成，请勿手工编辑。
 *   生成：node scripts/design-tokens/generate-semantic-scales.mjs
 *   输入：${source}
 *
 * T2 契约见 packages/design/design-system/docs/04-tokens-contract.md。
 * 构建规范见 docs/10-standards/065-design-token-pipeline.md。${extra}
 */
`;
}

/** 无模式轴的族：名字即命名空间名，在 `@theme` 里一处声明即完成注册。 */
function staticFile(file, label, source, rows, extra = "", rootRows = null) {
  const theme = `\n@theme {\n${render(rows)}\n}\n`;
  /* 只给 var() 用、不产工具类的值走 `:root`——`@theme` 里没被任何工具类引用的
   * 变量会被 Tailwind v4 摇掉（见 semantic-policy 的 VEIL_ALPHAS 注释）。 */
  const root = rootRows ? `\n:root {\n${render(rootRows)}\n}\n` : "";
  return [file, header(file, label, source, extra) + theme + root];
}

/* ── 生成 ───────────────────────────────────────────────────── */

const t1Literals = loadT1();

assertSpacingMonotonic();
assertFluidOrdered();
const typoBlocks = FONT_SIZE_MODES.map(([i, sel]) => [sel, buildRoles(i)]);
const spaceBlocks = DENSITY_MODES.map(([cols, sel]) => [
  sel,
  buildSpacing((kind) => cols[kind]),
]);
const roleCount = TYPE_ROLES.length;

const outputs = [
  [
    "typography-semantic.css",
    header(
      "typography-semantic.css",
      "排版角色（工具类族 text-*）",
      "scripts/design-tokens/typography-policy.mjs",
      `
 *
 * 每个角色一次落齐字号 / 行高 / 字距 / 字重，由 theme.css 注册为 v4 的
 * \`--text-<role>\` 及其修饰子键；字体族不在修饰子键之列，仍由独立的
 * \`font-*\` 工具类承担。`,
    ) +
      "\n" +
      typoBlocks.map(([sel, rows]) => `${sel} {\n${render(rows)}\n}`).join("\n\n") +
      "\n\n" +
      // 中文修正轴：默认零，由 :lang(zh) 打开。写成加法故与字号三档正交，
      // 三个模式块无需各自复制一遍。
      `:root {\n  --vx-cjk-leading-add: 0;\n}\n\n` +
      `${CJK_SELECTOR} {\n  --vx-cjk-leading-add: ${CJK_LEADING_ADD};\n}\n`,
  ],
  [
    "spacing-semantic.css",
    header(
      "spacing-semantic.css",
      "间距与控件高度（工具类族 p-* / gap-* / h-*）",
      "scripts/design-tokens/semantic-policy.mjs",
      `
 *
 * 密度三档是**用户偏好轴**，与组件自身的尺寸变体（cva size）正交：前者由祖先
 * 类重定向变量、任意深度生效，后者由类名逐处指定。组件不需要知道密度存在。
 *
 * 三档之间是档位平移而非等比缩放（比值 1.0–1.5 不等），故必须逐档列表，
 * 不能靠一个乘数推导。
 *
 * 末尾的流体档三块各写一遍且文本相同：它的上下界引用同块内的固定档，自定义
 * 属性在使用处求值，所以三档密度各自拿到自己的边界。`,
    ) +
      "\n" +
      spaceBlocks.map(([sel, rows]) => `${sel} {\n${render(rows)}\n}`).join("\n\n") +
      "\n",
  ],
  staticFile(
    "layout-semantic.css",
    "版面宽度：页面 / 内容 / 面板 / 控件（max-w-* / min-w-*）与侧栏（w-sidebar-*）",
    "scripts/design-tokens/semantic-policy.mjs",
    buildLayout(),
    `
 *
 * ⚠ page / content / panel 三族落字面量而非 var()：它们会进 @container (width >= …)，
 *   而容器查询里 var() 不参与求值，写成引用不报错、只是整档静默失效。
 *   control 族不受此限（控件宽不进容器查询），故按分层原则引 T1。
 *
 * ⚠ 本族在 @theme 里，而 v4 只吐**被工具类用到**的 theme 变量（实测 2026-08-07：
 *   --container-page-3xl / -5xl 因无人用而未产出）。纯 var() 消费的挡位会静默消失，
 *   所以每一档都要有组件以 min-w-* / max-w-* / w-* 消费它。`,
  ),
  staticFile("radius-semantic.css", "圆角（工具类族 rounded-*）", "scripts/design-tokens/semantic-policy.mjs", buildRadius()),
  staticFile(
    "shadow-semantic.css",
    "视觉高度（工具类族 shadow-*）",
    "scripts/design-tokens/semantic-policy.mjs",
    buildShadow(),
    `
 *
 * 按组件角色命名而非序数档位。允许多角色共用一档——可辨识的视觉高度本就比叠放
 * 层级少；与 z-index 的单调一致由生成器断言。暗色不另设一套，层次由 surface
 * 明度与描边承担。`,
  ),
  staticFile(
    "zindex-semantic.css",
    "叠放次序（工具类族 z-*）",
    "semantic-policy.mjs",
    buildZIndex(),
    `
 *
 * 无 T1 可指：叠放次序不是量纲，500 不是某个测量值的第 500 档，只是一个序。`,
  ),
  staticFile(
    "motion-semantic.css",
    "时长与缓动（工具类族 duration-* / ease-*）",
    "scripts/design-tokens/semantic-policy.mjs",
    buildMotion(),
  ),
  staticFile(
    "opacity-semantic.css",
    "透明度（工具类族 opacity-*）",
    "scripts/design-tokens/semantic-policy.mjs",
    buildOpacity(),
    `
 *
 * 无 T1 可指：上游对 opacity 既无 theme 变量也无封闭档位表，接受任意 0–100。
 *
 * 末尾的 \`:root\` 块是卡面底纹的浓淡（VEIL_ALPHAS）：只给 var() 用、不产工具类，
 * 留在 @theme 里会被 Tailwind 摇掉。`,
    buildVeilAlphas(),
  ),
  staticFile(
    "border-semantic.css",
    "描边宽度（工具类族 border-*）",
    "scripts/design-tokens/semantic-policy.mjs",
    buildBorder(),
    `
 *
 * 无 T1 可指：同 opacity，上游接受任意 border-<n>，没有原子刻度这回事。`,
  ),
  staticFile(
    "size-semantic.css",
    "图标与媒体尺寸（工具类族 size-*）",
    "scripts/design-tokens/semantic-policy.mjs",
    buildSize(),
    `
 *
 * 落在 spacing 命名空间下，产出 size-icon-md / size-media-lg。不随密度轴变化——
 * 图标缩小会先失去可辨识度，密度收紧应体现在留白而非图形本身。`,
  ),
];

if (errors.length > 0) {
  console.error("T2 非色彩层生成失败：\n");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const stat = `排版 ${roleCount} 角色 × 3 档 · 间距 ${spaceBlocks[0][1].length} × 3 档 · 其余 ${outputs.length - 2} 族`;

if (CHECK) {
  const stale = outputs.filter(([name, css]) => {
    try {
      return readFileSync(path.join(OUT_DIR, name), "utf8") !== css;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) {
    console.error(
      `T2 非色彩层与导出不同步：${stale.map(([n]) => n).join(", ")}\n` +
        "运行：node scripts/design-tokens/generate-semantic-scales.mjs",
    );
    process.exit(1);
  }
  console.log(`T2 非色彩层一致（${stat}）`);
} else {
  for (const [name, css] of outputs) writeFileSync(path.join(OUT_DIR, name), css, "utf8");
  console.log(`已生成 T2 非色彩层：${stat}`);
  for (const n of notes) console.log(`    · ${n}`);
}
