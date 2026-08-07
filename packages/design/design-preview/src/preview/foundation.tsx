"use client";

/**
 * foundation.tsx - 基础资源展示：色彩、图标、文字。
 * @package @vxture/design-preview
 *
 * 两块都**不写清单**，一律从源头读：
 *   色彩 —— 运行时枚举 `:root` 上注册的自定义属性，取值像颜色的即入列。token 层
 *           注册了什么，这里就显示什么；漏注册的不会凭空出现，多出来的也藏不住。
 *   图标 —— 直接读 `iconDictionary`，那份数组同时是 `IconName` 的类型来源。
 *
 * 色值随主题变，所以监听 `<html>` 的 class 变化重读一遍——色块靠 `var()` 会自己跟，
 * 但打印出来的那串字不会，留着就是条假信息。
 */

import * as React from "react";
import {
  Icon,
  ICON_GROUPS,
  iconDictionary,
  Input,
  type IconName,
} from "@vxture/design-system";

/* ── 色彩 ─────────────────────────────────────────────────── */

interface ColorToken {
  readonly name: string;
  readonly value: string;
}

/**
 * 是不是颜色交给浏览器判，不自己写正则。
 *
 * 一开始用的是 `/^(oklch|rgba?|hsla?|color|#)/`，结果只认出 37 个——计算值里还有
 * `lab()`，语义色里的 info / success / warning / destructive 整族都被漏掉了，而页面
 * 照常渲染，没有任何报错。列举颜色函数这件事就不该由手写清单来做。
 */
function isColor(value: string): boolean {
  return value !== "" && CSS.supports("color", value);
}

/**
 * 计算值是 `oklch()` / `lab()`，设计师要的是 `#rrggbb`——取色、比对、发给别人都用它。
 *
 * 转换交给画布：任何浏览器认得的颜色画进 1×1 画布，读回来就是 sRGB 字节，不用自己
 * 实现色彩空间换算。超出 sRGB 色域的会在这一步被钳进来——那正是它落到屏幕上的样子，
 * 不是精度损失。
 */
const hexCache = new Map<string, string>();
let probe: CanvasRenderingContext2D | null | undefined;

function toHex(value: string): string {
  const hit = hexCache.get(value);
  if (hit !== undefined) return hit;
  if (probe === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true });
  }
  let out = value;
  if (probe) {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    const byte = (n = 0) => n.toString(16).padStart(2, "0");
    // 带透明度的角色（遮罩、阴影底色）多写一段 alpha，省掉会让两个不同的值同形。
    out = `#${byte(r)}${byte(g)}${byte(b)}${a === 255 ? "" : byte(a)}`;
  }
  hexCache.set(value, out);
  return out;
}

function readColorTokens(): ColorToken[] {
  const cs = getComputedStyle(document.documentElement);
  const out: ColorToken[] = [];
  for (let i = 0; i < cs.length; i += 1) {
    const name = cs[i];
    if (name === undefined || !name.startsWith("--")) continue;
    // --tw-* 是 Tailwind 运行时自己的中间变量（ring-offset 之类），不是 DS token。
    if (name.startsWith("--tw-")) continue;
    const value = cs.getPropertyValue(name).trim();
    if (isColor(value)) out.push({ name, value });
  }
  return out;
}

/** 主题轴改的是 `<html>` 的 class，盯住它即可。 */
export function useColorTokens(): ColorToken[] {
  const [tokens, setTokens] = React.useState<ColorToken[]>([]);
  React.useEffect(() => {
    const read = () => setTokens(readColorTokens());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return tokens;
}

/**
 * 语义族的排列顺序。列在这里的按此顺序出现，没列到的按名字排在其后——新增族不会
 * 因为漏改这份数组而消失，只是排在末尾。
 */
const FAMILY_ORDER = [
  "primary",
  "ai",
  "info",
  "success",
  "warning",
  "destructive",
  "surface",
  "content",
  "stroke",
  "chart",
  "gradient",
  "link",
];

/** 单值角色（background / border / ring…）没有族，归到这一组。 */
const SINGLETON = "基础";

/**
 * 族的中文名。**只是叫法，不是新的一层含义**——族名本身（`primary`）仍然并排显示，
 * 因为写进代码的是它。没列到的族直接用族名，不会因为漏改这份表而没有标题。
 */
const FAMILY_LABEL: Record<string, string> = {
  primary: "品牌主题色",
  ai: "智能功能色",
  info: "信息提示色",
  success: "成功状态色",
  warning: "警示状态色",
  destructive: "危险操作色",
  surface: "表面层次色",
  content: "内容前景色",
  stroke: "描边分隔色",
  chart: "图表数据色",
  gradient: "渐变色",
  link: "链接色",
  [SINGLETON]: "单值角色",
};

/**
 * 结构角色的归属。`background` / `foreground` / `border` 这些名字里不带族前缀，
 * 按"取第一段当族名"的规则会一起掉进"单值角色"这个筐里——那不是一个分类，是没分类：
 * 底色、文字色、描边色混在一格，恰恰是界面里用得最多的三类东西。
 *
 * 它们承担的角色是明确的，按角色归到 surface / content / stroke 三族，跟带前缀的
 * 同类角色并列。没登记的名字仍落到"单值角色"，会显示在未归组里——看得见，才补得上。
 */
const STRUCTURAL_ROLE: Record<string, "surface" | "content" | "stroke"> = {
  background: "surface",
  card: "surface",
  popover: "surface",
  accent: "surface",
  scrim: "surface",
  foreground: "content",
  "muted-foreground": "content",
  border: "stroke",
  input: "stroke",
  ring: "stroke",
};

function familyOf(name: string): string {
  const bare = name.replace(/^--/, "");
  const structural = STRUCTURAL_ROLE[bare];
  if (structural) return structural;
  const seg = bare.split("-")[0] ?? "";
  return FAMILY_ORDER.includes(seg) ? seg : SINGLETON;
}

/**
 * 去掉族前缀后剩下的那段。单值角色没有前缀可去，整个名字就是它的变体；被归族的结构
 * 角色同理——`background` 归进 surface 族，但它不叫 `surface-background`，整名就是变体。
 */
function variantOf(name: string, family: string): string {
  const bare = name.replace(/^--/, "");
  if (family === SINGLETON || STRUCTURAL_ROLE[bare]) return bare;
  return bare.slice(family.length).replace(/^-/, "");
}

/**
 * 族内再分三行。一族十来个角色平铺成一片，看不出哪个跟哪个是一对；这三行是它们
 * 实际的用法分工：**主色**上填充与描边，**辅色**是同一色相的弱化底，**文本**是压在
 * 这两种底上的前景色。
 *
 * 判据按变体名，不按清单——新增 `primary-subtle-hover` 之类会自动落进辅色行。
 */
const ROWS = ["main", "muted", "text"] as const;
type Row = (typeof ROWS)[number];

const ROW_LABEL: Record<Row, string> = {
  main: "主色",
  muted: "辅色",
  text: "文本",
};

function rowOf(variant: string): Row {
  if (variant.includes("text") || variant.includes("foreground")) return "text";
  if (variant.startsWith("muted") || variant.startsWith("subtle"))
    return "muted";
  return "main";
}

interface RowSpec {
  readonly label: string;
  readonly match: (variant: string) => boolean;
}

/**
 * 主色 / 辅色 / 文本这套分行对**一族一色相**的族成立，对 `chart` 不成立——它的
 * 20 个角色里没有"主色"这回事，而是三套各自成套的色序加一组图表结构色。混在一行
 * 里平铺是这页此前最不可读的一块：顺序色与发散色都是**有方向的序列**，打乱顺序
 * 或与分类色混排，序列本身携带的信息就没了。
 *
 * 所以分行方案按族给，不是一套硬套所有族。
 */
const CHART_ROWS: readonly RowSpec[] = [
  { label: "分类色", match: (v) => /^\d+$/.test(v) },
  { label: "顺序色", match: (v) => v.startsWith("seq-") },
  { label: "发散色", match: (v) => v.startsWith("div-") },
  { label: "图表结构", match: () => true },
];

const DEFAULT_ROWS: readonly RowSpec[] = [
  { label: ROW_LABEL.main, match: (v) => rowOf(v) === "main" },
  { label: ROW_LABEL.muted, match: (v) => rowOf(v) === "muted" },
  { label: ROW_LABEL.text, match: (v) => rowOf(v) === "text" },
];

/**
 * 结构三族的分行。列举式判据，末尾一律留一条**看得见的**"其他"——兜底行不写死语义
 * 标签，否则新角色掉进去会被读成"它属于这一类"，而实际只是没人给它归过类。
 */
const has =
  (...names: string[]) =>
  (v: string) =>
    names.includes(v);

/* 判据比的是**变体**：带族前缀的角色前缀已被剥掉（`--surface-1` → `1`），归族进来的
   结构角色则整名就是变体（`background`）。两种写法在一张表里，看着不齐，但那正是它们
   在 token 里的样子。 */
const SURFACE_ROWS: readonly RowSpec[] = [
  { label: "基底", match: has("background", "1", "3", "card", "popover") },
  {
    label: "交互态",
    match: has("accent", "active", "selected", "selected-hover"),
  },
  { label: "反色与遮罩", match: has("inverse", "scrim") },
  { label: "其他", match: () => true },
];

const CONTENT_ROWS: readonly RowSpec[] = [
  { label: "层级", match: has("foreground", "muted-foreground", "tertiary") },
  { label: "特定底色上", match: (v) => v.startsWith("on-") },
  { label: "失效", match: has("disabled") },
  { label: "其他", match: () => true },
];

const STROKE_ROWS: readonly RowSpec[] = [
  { label: "常规", match: has("border", "input", "emphasis") },
  { label: "状态", match: has("ring", "disabled") },
  { label: "其他", match: () => true },
];

function rowsFor(family: string): readonly RowSpec[] {
  if (family === "chart") return CHART_ROWS;
  if (family === "surface") return SURFACE_ROWS;
  if (family === "content") return CONTENT_ROWS;
  if (family === "stroke") return STROKE_ROWS;
  return DEFAULT_ROWS;
}

/**
 * 按分行方案切开一族。**先匹配的先取走**，所以每个角色只会出现在一行里，最后那条
 * 兜底规则收走剩下的——不会有角色因为没命中任何一条而消失。
 */
function splitRows(items: readonly ColorToken[], family: string) {
  let rest = [...items];
  const out: { label: string; items: ColorToken[] }[] = [];
  for (const spec of rowsFor(family)) {
    const hit = rest.filter((t) => spec.match(variantOf(t.name, family)));
    if (hit.length > 0) out.push({ label: spec.label, items: hit });
    rest = rest.filter((t) => !hit.includes(t));
  }
  return out;
}

/** 取值带 alpha 通道就当半透明处理——由色值本身判断，不看名字里有没有 `alpha`。 */
function isTranslucent(value: string): boolean {
  return toHex(value).length > 7;
}

/**
 * 族内变体的顺序。计算样式给出的是哈希序，照它排会把 `primary` 排在
 * `primary-muted-foreground` 后面——设计师要的是"基色 → 交互态 → 弱化 → 前景"这条线。
 */
const VARIANT_ORDER = [
  "",
  "hover",
  "active",
  "muted",
  "muted-hover",
  "muted-active",
  "border",
  "text",
  "foreground",
  "muted-foreground",
];

function variantRank(name: string, family: string): number {
  const i = VARIANT_ORDER.indexOf(variantOf(name, family));
  return i < 0 ? VARIANT_ORDER.length : i;
}

function groupByFamily(tokens: readonly ColorToken[]) {
  const map = new Map<string, ColorToken[]>();
  for (const token of tokens) {
    const family = familyOf(token.name);
    const bucket = map.get(family);
    if (bucket) bucket.push(token);
    else map.set(family, [token]);
  }
  for (const [family, items] of map) {
    items.sort((a, b) => {
      const d = variantRank(a.name, family) - variantRank(b.name, family);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
  }
  return [...map.entries()].sort(([a], [b]) => {
    const ia = FAMILY_ORDER.indexOf(a);
    const ib = FAMILY_ORDER.indexOf(b);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.localeCompare(b);
  });
}

/**
 * 色块高度**全页一个值**。T1 与 T2 各用各的高度时，两段之间没有可比性——色块大小
 * 会被读成重要程度，而它只是当初随手写的。
 */
const SWATCH_H = "h-media-sm";

/**
 * 一行装一组。列宽用 `flex-1 basis-0` 均分，组里几件就几列——11 阶的色阶和 4 个
 * 变体的一行都恰好占满一行，不换行、不留半截。写死列数做不到这点：11 阶配
 * `grid-cols-11`、4 件配 `grid-cols-4`，等于每处都要重新判断一次。
 */
function SwatchRow({
  children,
  columns,
}: {
  readonly children: React.ReactNode;
  /**
   * 给定列数时改用等宽栅格：一族里各行**列数一律取该族最宽那行**，短的行空着后面几格。
   * 不给就按件数均分一行（色阶那边每行件数本来就不同，对齐无从谈起）。
   *
   * 这是"横纵整齐"的实现方式——不给列数、让每行各自均分，主色 4 件、辅色 3 件就会
   * 排成两种宽度，同一族的东西看着像两套尺寸。
   */
  readonly columns?: number;
}) {
  if (columns === undefined) {
    return <div className="flex w-full items-stretch gap-2xs">{children}</div>;
  }
  return (
    <div
      className="grid w-full items-stretch gap-2xs"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

/**
 * 半透明色必须垫棋盘格，否则 `alpha-08` 压在白底上看着就是白色，和"没生效"分不清。
 */
const CHECKER: React.CSSProperties = {
  backgroundImage:
    "repeating-conic-gradient(var(--surface-3) 0% 25%, var(--surface-1) 0% 50%)",
  backgroundSize: "12px 12px",
};

function Swatch({
  name,
  value,
  label,
  alpha = false,
}: {
  readonly name: string;
  readonly value: string;
  readonly label: string;
  readonly alpha?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 basis-0 flex-col gap-2xs">
      <div
        className={`${SWATCH_H} w-full overflow-hidden rounded-md border border-border`}
        style={alpha ? CHECKER : undefined}
      >
        <div className="size-full" style={{ background: `var(${name})` }} />
      </div>
      <span className="truncate text-label-sm text-foreground" title={label}>
        {label}
      </span>
      <code className="truncate text-body-sm text-muted-foreground">
        {toHex(value)}
      </code>
    </div>
  );
}

/**
 * 语义族也按用途分三组一专项，跟色阶那边同一套骨架——上面按品牌 / 状态 / 中性分好，
 * 下面却是十三个族一路平铺，等于让人再自己归一次类。
 */
const SEMANTIC_GROUPS = [
  {
    label: "品牌色",
    note: "身份与主功能",
    families: ["primary", "ai", "link"],
  },
  {
    label: "状态色",
    note: "信息 / 成功 / 警示 / 危险，成组使用",
    families: ["info", "success", "warning", "destructive"],
  },
  {
    label: "界面结构色",
    note: "表面、前景、描边，界面的底子",
    families: [SINGLETON, "surface", "content", "stroke"],
  },
  {
    label: "数据可视化",
    note: "图表与渐变，整套取值不拆用",
    families: ["chart", "gradient"],
  },
] as const;

/** T2 语义色。跟随主题轴——右上角切 dark，整页色块与色值一起变。 */
export function SemanticColors() {
  const tokens = useColorTokens();
  const semantic = tokens.filter((t) => !t.name.startsWith("--vx-"));
  const byFamily = new Map(groupByFamily(semantic));

  const grouped = SEMANTIC_GROUPS.map((g) => ({
    label: g.label,
    note: g.note,
    families: g.families
      .map(
        (f) =>
          [f as string, byFamily.get(f)] as [string, ColorToken[] | undefined],
      )
      .filter((e): e is [string, ColorToken[]] => !!e[1]),
  })).filter((g) => g.families.length > 0);

  // 未列入任何组的族排在最后，不会因为漏改 SEMANTIC_GROUPS 就从页面上消失。
  const claimed = new Set(
    SEMANTIC_GROUPS.flatMap((g) => g.families as readonly string[]),
  );
  const leftover = [...byFamily.entries()].filter(([f]) => !claimed.has(f));
  const all =
    leftover.length > 0
      ? [
          ...grouped,
          { label: "未归组", note: "新增语义族，尚未归类", families: leftover },
        ]
      : grouped;

  return (
    <div className="flex w-full flex-col gap-3xl">
      <p className="text-body-sm text-muted-foreground">
        共 {semantic.length} 个语义角色，{all.length} 组，运行时从{" "}
        <code>:root</code>{" "}
        读出，非手写清单。切换右上角的主题，色块与色值同步变化。
      </p>
      {all.map((g) => (
        <div key={g.label} className="flex flex-col gap-xl">
          <div className="flex items-baseline gap-sm border-b border-border pb-xs">
            <span className="text-label-lg text-foreground">{g.label}</span>
            <span className="text-body-sm text-muted-foreground">{g.note}</span>
            <span className="text-body-sm text-muted-foreground">
              {g.families.length}
            </span>
          </div>
          {g.families.map(([family, items]) => (
            <FamilyPanel key={family} family={family} items={items} />
          ))}
        </div>
      ))}
    </div>
  );
}

function FamilyPanel({
  family,
  items,
}: {
  readonly family: string;
  readonly items: readonly ColorToken[];
}) {
  const rows = splitRows(items, family);
  // 列数取该族最宽那行，短行空着尾格——横纵才对得齐。
  const columns = Math.max(...rows.map((r) => r.items.length), 1);

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-baseline gap-sm">
        <span className="text-label-md text-foreground">
          {FAMILY_LABEL[family] ?? family}
        </span>
        <code className="text-body-sm text-muted-foreground">{family}</code>
        <span className="text-body-sm text-muted-foreground">
          {items.length}
        </span>
      </div>
      {family === "gradient" ? (
        <GradientPairs items={items} />
      ) : (
        rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-xs">
            {row.label ? (
              <span className="text-overline text-muted-foreground">
                {row.label}
              </span>
            ) : null}
            <SwatchRow columns={columns}>
              {row.items.map((t) => (
                <Swatch
                  key={t.name}
                  name={t.name}
                  value={t.value}
                  label={t.name.replace(/^--/, "")}
                  alpha={isTranslucent(t.value)}
                />
              ))}
            </SwatchRow>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * 渐变得看渐变本身。两个端点色摆在那里，中间怎么过渡是看不出来的——尤其 `glow`
 * 两端都是半透明品牌色，只看色块就是两块灰白格子，完全读不出它是干什么的。
 *
 * 每对一个 section：左右两个端点色 + 一块实际渲染的渐变（左上 → 右下，与 DS 里
 * 这几个渐变的实际用法一致）。四对排成两列两行。
 */
function GradientPairs({ items }: { readonly items: readonly ColorToken[] }) {
  const pairs = new Map<string, { from?: ColorToken; to?: ColorToken }>();
  for (const t of items) {
    const m = /^--gradient-(.+)-(from|to)$/.exec(t.name);
    if (!m) continue;
    const key = m[1] as string;
    const entry = pairs.get(key) ?? {};
    entry[m[2] as "from" | "to"] = t;
    pairs.set(key, entry);
  }

  return (
    <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
      {[...pairs.entries()].map(([name, { from, to }]) =>
        from && to ? (
          <div
            key={name}
            className="flex flex-col gap-sm rounded-lg border border-border p-md"
          >
            <code className="text-label-sm text-foreground">
              gradient-{name}
            </code>
            <SwatchRow columns={2}>
              <Swatch
                name={from.name}
                value={from.value}
                label="from"
                alpha={isTranslucent(from.value)}
              />
              <Swatch
                name={to.name}
                value={to.value}
                label="to"
                alpha={isTranslucent(to.value)}
              />
            </SwatchRow>
            {/* 渐变样张比色块高得多（media-3xl = 128px）：48 高的条子里，从左上到右下
                的对角过渡被压得几乎是横向的，看不出方向，也看不出中段的混色。 */}
            <div
              className="h-media-2xl w-full overflow-hidden rounded-md border border-border"
              style={CHECKER}
            >
              <div
                className="size-full"
                style={{
                  backgroundImage: `linear-gradient(to bottom right, var(${from.name}), var(${to.name}))`,
                }}
              />
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

/**
 * 色阶分三组，按它们在语义层承担的角色分——七条按字母排是"没排"，`amber` 排在
 * `brand` 前面不代表任何事。
 *
 *   品牌色 —— 身份色，`brand` 喂 primary / link，`purple` 喂 ai。
 *   状态色 —— 反馈四色：sky→info、emerald→success、amber→warning、red→destructive。
 *             行业里叫状态色或功能色，含义是"这四个是一套、成组使用"。
 *   中性色 —— 表面、文本、描边的灰阶底。
 *
 * 组内顺序也不是字母序，是语义顺序（信息 → 成功 → 警示 → 危险），跟语义色页那边
 * 的族顺序对齐，两页扫下来是同一条线。
 *
 * 没列到的色阶落进"未归组"——新增一条不会因为漏改这份表就从页面上消失。
 */
const RAMP_GROUPS = [
  { label: "品牌色", note: "身份与主功能", ramps: ["brand", "purple"] },
  {
    label: "状态色",
    note: "信息 / 成功 / 警示 / 危险，成组使用",
    ramps: ["sky", "emerald", "amber", "red"],
  },
  {
    label: "中性色",
    note: "表面、文本、描边的灰阶底",
    ramps: ["neutral"],
    /** 纯黑纯白不属于任何色阶，但它们是 T1 的一部分——前景色、蒙层都从这里取。 */
    singles: ["white", "black"],
  },
] as const;

const UNGROUPED = { label: "未归组", note: "新增色阶，尚未归入上面任何一组" };

/**
 * T1 原色阶。不跟随主题——它是取值来源，主题在语义层做映射。
 *
 * 阶必须按数字升序排：计算样式给出的是哈希序，照它渲染就是一排乱色，色阶最要紧的
 * 那点"由浅到深"的连续性直接没了。
 */
interface Ramp {
  readonly name: string;
  readonly steps: readonly {
    readonly step: number;
    readonly token: ColorToken;
  }[];
  /**
   * 同色相的透明度衍生值（`brand-600-alpha-15` 这种）。它们是合成色不是色阶的一档，
   * 但确实是 T1 的一部分——遮罩、选中底、辉光都从这里取值。挂在本条色阶下面，
   * 而不是另开一节：它衍生自谁，就该跟谁放在一起看。
   */
  readonly alphas: readonly {
    readonly label: string;
    readonly token: ColorToken;
  }[];
  readonly consumers: readonly string[];
}

/**
 * 这条色阶被哪些语义族取值——按**色值反查**，不是手写对照表。语义层改了指向，
 * 这里当场跟着变；对照表会留在原地变成一句假话。
 *
 * 收敛到**族**：`primary` / `primary-hover` / `primary-muted` 都取自同一条色阶，
 * 列三遍没有信息量。收敛到族之后 `chart` 这类不带基色、只有编号成员的族也能露出来
 * ——它没有自己的色阶，六条分类色是从六条现成色阶里各取一档。
 */
function consumersOf(
  steps: Ramp["steps"],
  semantic: readonly ColorToken[],
): string[] {
  const values = new Set(steps.map((s) => s.token.value));
  const out = new Set<string>();
  for (const t of semantic) {
    if (!values.has(t.value)) continue;
    const family = familyOf(t.name);
    if (family !== SINGLETON) out.add(family);
  }
  return [...out].sort(
    (a, b) => FAMILY_ORDER.indexOf(a) - FAMILY_ORDER.indexOf(b),
  );
}

export function PrimitiveRamps() {
  const tokens = useColorTokens();
  const semantic = tokens.filter((t) => !t.name.startsWith("--vx-"));

  const collected = new Map<string, { step: number; token: ColorToken }[]>();
  const alphas = new Map<string, { label: string; token: ColorToken }[]>();
  const singles = new Map<string, ColorToken>();
  for (const token of tokens) {
    const step = /^--vx-color-([a-z]+)-(\d+)$/.exec(token.name);
    if (step) {
      const key = step[1] as string;
      const entry = { step: Number(step[2]), token };
      const bucket = collected.get(key);
      if (bucket) bucket.push(entry);
      else collected.set(key, [entry]);
      continue;
    }
    const alpha = /^--vx-color-([a-z]+)-(\d+-alpha-\d+)$/.exec(token.name);
    if (alpha) {
      const key = alpha[1] as string;
      const entry = { label: alpha[2] as string, token };
      const bucket = alphas.get(key);
      if (bucket) bucket.push(entry);
      else alphas.set(key, [entry]);
      continue;
    }
    const single = /^--vx-color-([a-z]+)$/.exec(token.name);
    if (single) singles.set(single[1] as string, token);
  }

  const byName = new Map<string, Ramp>();
  for (const [name, steps] of collected) {
    steps.sort((a, b) => a.step - b.step);
    const mine = (alphas.get(name) ?? []).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
    byName.set(name, {
      name,
      steps,
      alphas: mine,
      consumers: consumersOf(steps, semantic),
    });
  }

  const grouped = RAMP_GROUPS.map((g) => ({
    label: g.label,
    note: g.note,
    items: g.ramps.map((n) => byName.get(n)).filter((r): r is Ramp => !!r),
    singles: ("singles" in g ? g.singles : [])
      .map((n) => singles.get(n))
      .filter((t): t is ColorToken => !!t),
  })).filter((g) => g.items.length > 0 || g.singles.length > 0);

  const claimed = new Set(
    RAMP_GROUPS.flatMap((g) => g.ramps as readonly string[]),
  );
  const leftover = [...byName.values()].filter((r) => !claimed.has(r.name));
  const all =
    leftover.length > 0
      ? [
          ...grouped,
          { ...UNGROUPED, items: leftover, singles: [] as ColorToken[] },
        ]
      : grouped;

  return (
    <div className="flex w-full flex-col gap-2xl">
      <p className="text-body-sm text-muted-foreground">
        {byName.size} 条色阶，按用途分 {all.length}{" "}
        组。语义角色从这里取值，本身不参与明暗切换。
      </p>
      {all.map((g) => (
        <div key={g.label} className="flex flex-col gap-lg">
          <div className="flex items-baseline gap-sm border-b border-border pb-xs">
            <span className="text-label-lg text-foreground">{g.label}</span>
            <span className="text-body-sm text-muted-foreground">{g.note}</span>
            <span className="text-body-sm text-muted-foreground">
              {g.items.length}
            </span>
          </div>
          {g.items.map((ramp) => (
            <div key={ramp.name} className="flex flex-col gap-sm">
              <div className="flex items-baseline gap-sm">
                <span className="text-label-md text-foreground">
                  {ramp.name}
                </span>
                <span className="text-body-sm text-muted-foreground">
                  {ramp.steps.length} 阶
                </span>
                {ramp.consumers.length > 0 ? (
                  <span className="text-body-sm text-muted-foreground">
                    → {ramp.consumers.join(" / ")}
                  </span>
                ) : null}
              </div>
              <SwatchRow>
                {ramp.steps.map(({ step, token }) => (
                  <Swatch
                    key={token.name}
                    name={token.name}
                    value={token.value}
                    label={String(step)}
                  />
                ))}
              </SwatchRow>

              {ramp.alphas.length > 0 ? (
                <div className="flex flex-col gap-xs">
                  <span className="text-overline text-muted-foreground">
                    透明度衍生
                  </span>
                  <SwatchRow>
                    {ramp.alphas.map(({ label, token }) => (
                      <Swatch
                        key={token.name}
                        name={token.name}
                        value={token.value}
                        label={label}
                        alpha
                      />
                    ))}
                  </SwatchRow>
                </div>
              ) : null}
            </div>
          ))}

          {g.singles.length > 0 ? (
            <div className="flex flex-col gap-sm">
              <div className="flex items-baseline gap-sm">
                <span className="text-label-md text-foreground">基础色</span>
                <span className="text-body-sm text-muted-foreground">
                  无色阶，纯黑纯白本身就是一档
                </span>
              </div>
              <SwatchRow>
                {g.singles.map((token) => (
                  <Swatch
                    key={token.name}
                    name={token.name}
                    value={token.value}
                    label={token.name.replace(/^--vx-color-/, "")}
                  />
                ))}
              </SwatchRow>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ── 图标 ─────────────────────────────────────────────────── */

/** 组件 `IconSize` 的全部档位，由小到大。 */
export const ICON_SIZES = ["xs", "sm", "md", "lg", "xl", "2xl"] as const;

/**
 * 全量图标，按 `ICON_GROUPS` 分组。
 *
 * 八十多个名字平铺成一片，找图标只能靠肉眼一个个扫——分组是这一页能不能用的分界。
 * 组来自 `@vxture/design-ui`，跟名字同一个来源；搜索时组照旧保留，空组不渲染。
 */
export function IconGallery() {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();

  const groups = ICON_GROUPS.map((g) => ({
    label: g.label,
    icons: (g.icons as readonly IconName[]).filter((n) => !q || n.includes(q)),
  })).filter((g) => g.icons.length > 0);
  const matched = groups.reduce((n, g) => n + g.icons.length, 0);

  return (
    <div className="flex w-full flex-col gap-xl">
      <div className="flex flex-col gap-sm">
        <span className="text-label-sm text-muted-foreground">
          {ICON_SIZES.length} 档尺寸
        </span>
        <div className="flex flex-wrap items-end gap-lg">
          {ICON_SIZES.map((size) => (
            <span key={size} className="flex flex-col items-center gap-2xs">
              <Icon name="sparkles" size={size} />
              <span className="text-body-sm text-muted-foreground">{size}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2xs">
        <span className="text-label-sm text-muted-foreground">
          共 {iconDictionary.length} 个，{ICON_GROUPS.length} 组
          {q ? `，命中 ${matched} 个` : "，按名字筛选"}
        </span>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例如 arrow / user / chart"
          className="max-w-content-narrow-lg"
        />
      </div>

      {groups.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">没有匹配的图标。</p>
      ) : (
        groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-md">
            <div className="flex items-baseline gap-sm border-b border-border pb-xs">
              <span className="text-label-lg text-foreground">{g.label}</span>
              <span className="text-body-sm text-muted-foreground">
                {g.icons.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-sm sm:grid-cols-4 lg:grid-cols-6">
              {g.icons.map((name) => (
                <div
                  key={name}
                  className="flex flex-col items-center gap-xs rounded-md border border-border p-md"
                >
                  <Icon name={name} size="2xl" />
                  <span className="w-full truncate text-center text-body-sm text-foreground">
                    {name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ── 文字 ─────────────────────────────────────────────────── */

interface TypeRole {
  readonly role: string;
  readonly size: string;
  readonly lineHeight: string;
  readonly letterSpacing: string;
  readonly weight: string;
}

/**
 * 角色名从 `--<role>-font-size` 反推，同样不写清单。
 *
 * 一个角色一次落齐五项，v4 把它们注册成 `--text-<role>` 的修饰子键——所以
 * `text-body-md` 一个类同时管字号、行高、字距、字重，这也是这张表要把五项并排列出的
 * 原因：它们是一体的，不该在调用处被拆开单点。
 */
function readTypeRoles(): TypeRole[] {
  const cs = getComputedStyle(document.documentElement);
  const roles: TypeRole[] = [];
  for (let i = 0; i < cs.length; i += 1) {
    const name = cs[i];
    if (name === undefined || !name.endsWith("-font-size")) continue;
    const role = name.slice(2, -"-font-size".length);
    roles.push({
      role,
      size: cs.getPropertyValue(`--${role}-font-size`).trim(),
      lineHeight: cs.getPropertyValue(`--${role}-line-height`).trim(),
      letterSpacing: cs.getPropertyValue(`--${role}-letter-spacing`).trim(),
      weight: cs.getPropertyValue(`--${role}-font-weight`).trim(),
    });
  }
  return roles;
}

/** 族的排列顺序。没列到的排在其后，不会因为漏改这份数组而消失。 */
const ROLE_FAMILIES = [
  "display",
  "heading",
  "title",
  "body",
  "label",
  "code",
  "overline",
];

/** 族内按大小降序。一份清单同时覆盖 heading-1..5 与 display-xl..xs 两种命名。 */
const ROLE_STEPS = ["1", "2", "3", "xl", "lg", "md", "sm"];

function roleRank(role: string): number {
  const i = ROLE_FAMILIES.findIndex((f) => role.startsWith(f));
  return i < 0 ? ROLE_FAMILIES.length : i;
}

function stepRank(role: string): number {
  const step = role.slice(role.lastIndexOf("-") + 1);
  const i = ROLE_STEPS.indexOf(step);
  return i < 0 ? ROLE_STEPS.length : i;
}

/** 排版角色。跟随字号三档——右上角切 small / large，整表的取值一起变。 */
export function useTypeRoles(): TypeRole[] {
  const [roles, setRoles] = React.useState<TypeRole[]>([]);
  React.useEffect(() => {
    const read = () => setRoles(readTypeRoles());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return roles;
}

/** 族的中文名与用途。没列到的族直接用族名，不会因为漏改这份表而没有标题。 */
const FAMILY_NOTE: Record<string, readonly [string, string]> = {
  display: ["展示", "营销页与大标题，非界面文本"],
  heading: ["主标题", "页面主标题，品牌展示体"],
  title: ["区块标题", "卡片头、区块名，正文体"],
  body: ["正文", "段落、描述、说明"],
  label: ["标签", "控件文字、字段名、元信息"],
  code: ["代码", "等宽，代码与标识符"],
  overline: ["眉标", "小字全大写，压在标题上方"],
};

/**
 * 一个角色的样张：中文与英文各占一栏，同一行左右并排。
 *
 * 两种文字要一起看：同一个字号下汉字比拉丁字母显得大、行高需求也不同，只给一种
 * 就看不出这一档在混排里到底合不合适。
 *
 * 样张用 `grid` 而不是 `flex`：flex 行里这一栏靠 `flex-1` 才有宽度，漏掉就被压成
 * 0 宽——文字在 DOM 里、一个字也看不见，且不报错。这个坑在这一页踩过两次，改成
 * 栅格后列宽由轨道给定，不存在压成 0 的路径。
 */
function TypeSample({ role }: { readonly role: string }) {
  const style: React.CSSProperties = {
    fontSize: `var(--${role}-font-size)`,
    lineHeight: `var(--${role}-line-height)`,
    letterSpacing: `var(--${role}-letter-spacing)`,
    fontWeight: `var(--${role}-font-weight)`,
    fontFamily: `var(--${role}-font-family)`,
  };
  return (
    <div className="grid grid-cols-1 gap-md md:grid-cols-2">
      <div className="min-w-0 overflow-hidden">
        <div className="truncate text-foreground" style={style}>
          永和九年岁在癸丑暮春之初
        </div>
      </div>
      <div className="min-w-0 overflow-hidden md:border-l md:border-border md:pl-md">
        <div className="truncate text-foreground" style={style}>
          The quick brown fox 0123
        </div>
      </div>
    </div>
  );
}

export function TypographyScale() {
  const roles = useTypeRoles();
  const sorted = [...roles].sort((a, b) => {
    const d = roleRank(a.role) - roleRank(b.role);
    if (d !== 0) return d;
    const t = stepRank(a.role) - stepRank(b.role);
    return t !== 0 ? t : a.role.localeCompare(b.role);
  });

  const families = [...new Set(sorted.map((r) => r.role.split("-")[0] ?? ""))];

  return (
    <div className="flex w-full flex-col gap-2xl">
      <p className="text-body-sm text-muted-foreground">
        共 {sorted.length} 个角色，{families.length} 族，运行时从{" "}
        <code>:root</code> 读出。切换右上角的字号，取值与样张一起变。
      </p>
      {families.map((family) => {
        // 按首段精确相等，不用 startsWith——那会让 `code` 顺手吃掉 `code-…` 之外的族。
        const mine = sorted.filter((r) => r.role.split("-")[0] === family);
        const [label, note] = FAMILY_NOTE[family] ?? [family, ""];
        return (
          <div key={family} className="flex flex-col gap-md">
            <div className="flex items-baseline gap-sm border-b border-border pb-xs">
              <span className="text-label-lg text-foreground">{label}</span>
              <code className="text-body-sm text-muted-foreground">
                {family}
              </code>
              {note ? (
                <span className="text-body-sm text-muted-foreground">
                  {note}
                </span>
              ) : null}
              <span className="text-body-sm text-muted-foreground">
                {mine.length}
              </span>
            </div>
            <div className="flex flex-col divide-y divide-border">
              {mine.map((r) => (
                <div key={r.role} className="flex flex-col gap-xs py-md">
                  <div className="flex flex-wrap items-baseline gap-sm">
                    <span className="text-label-sm text-foreground">
                      {r.role}
                    </span>
                    <code className="text-body-sm text-muted-foreground">
                      {r.size} / {r.lineHeight} / {r.letterSpacing} / {r.weight}
                    </code>
                  </div>
                  <TypeSample role={r.role} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
