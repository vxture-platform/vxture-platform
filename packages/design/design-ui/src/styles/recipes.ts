/**
 * recipes.ts - 组件视觉配方：跨组件恒定、但无法表达成 token 的类名片段。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Styles
 *
 * 为什么需要这一层：
 *
 * T2 能装下"值"（间距、圆角、颜色、时长），装不下"规则"——焦点环由哪三个类构成、
 * 按下去要不要位移、菜单展开时触发器变成什么样。shadcn 把这些烤进 62 个组件源码，
 * 代价是规则不可见、不可校验，改基调要改几十处。
 *
 * 我们抽出来：**规则只写一次，所有 cva 引用**。改基调改一处。
 *
 * ⚠ 这里只放**跨组件恒定**的片段。只有一个组件用到的写在它自己的 cva 里——
 *   放进来会让"配方"退化成公共类名垃圾桶，那就白抽了。
 *
 * 取值依据见 packages/design/design-system/docs/02-visual-spec.md，规格来源为 shadcn vega。
 */

/**
 * 所有可交互控件的公共底座：焦点环、禁用态、过渡。
 *
 * `ring-3` 而非 `ring-[3px]`：上游内置档位，任意值语法是 v3 思维残留。
 * `opacity-disabled` 而非 `opacity-50`：我们有语义档（0.45），对齐的是上游的
 * **做法**不是它的字面量——vega 写 50 是因为它没有这一族。
 */
export const interactive = [
  "outline-none",
  "transition-all duration-fast ease-standard",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  "disabled:pointer-events-none disabled:opacity-disabled",
].join(" ");

/**
 * 按下时下沉 1px。
 *
 * `not-aria-[haspopup]` 把菜单触发器排除在外——它按下去要弹面板，位移会让面板
 * 跟着抖。这条细节是照抄 vega 的，不是我们想出来的。
 */
export const pressable = "active:not-aria-[haspopup]:translate-y-px";

/** 菜单 / 下拉的触发器在面板展开期间保持高亮，否则展开后触发器看起来是"没按中"。 */
export const expandable =
  "aria-expanded:bg-muted aria-expanded:text-foreground";

/**
 * 校验失败态。挂在 `aria-invalid` 上而不是自定义 prop：无障碍属性本来就要写，
 * 让它同时驱动样式，就不会出现"标了 aria 但没变红"或反过来的偏差。
 *
 * 描边和光环用 alpha（要透出下面的内容），填充才用实色 muted 阶——见 060 判据。
 */
export const invalid = [
  "aria-invalid:border-destructive aria-invalid:ring-3",
  "aria-invalid:ring-destructive/20",
  "dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
].join(" ");

/**
 * 内联图标的通用处理：不吃指针事件、不被压缩、未显式指定尺寸时随控件档走。
 */
export const inlineIcon =
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-icon-sm";

/**
 * 带图标时该侧内边距收紧。
 *
 * 图标的视觉重量比文字轻，两侧留一样的内边距会看起来偏内。调用方在图标上标
 * `data-icon="inline-start"`，这条选择器自动收紧对应一侧。
 */
export const iconInset = [
  "has-data-[icon=inline-start]:pl-sm",
  "has-data-[icon=inline-end]:pr-sm",
].join(" ");

/**
 * 圆角封顶：小尺寸控件不跟随基数一路变圆。
 *
 * `--radius` 调大时 24/32px 高的控件会先变成胶囊。封在 8px 上，
 * **这是"一个基数换基调"能安全成立的前提**。
 */
export const radiusClamp = "rounded-[min(var(--radius-md),8px)]";

/**
 * 叠层面板的公共外观。
 *
 * 边缘用 `ring-1` 不用 `border`：ring 不占布局（换边框宽度不会让内容位移 1px），
 * 且它叠在阴影**之上**而不是和阴影抢同一圈像素——border + shadow 并用时，
 * 描边会在投影最浓的地方被压住，面板边缘看起来是断续的。
 *
 * 用 `foreground/10` 而非 `border-border`：叠层浮在不确定的底色上，需要一条
 * 跟随明暗自动反相的边——实色描边在暗色下要么看不见要么过重。
 * 这属于"描边用 alpha"那一条判据。
 */
export const panel = {
  base: "bg-popover text-foreground ring-1 ring-foreground/10",
  /** 悬浮小面板：下拉、气泡、选择器。 */
  popover: "rounded-md shadow-overlay",
  /** 模态面板：对话框。 */
  dialog: "rounded-xl shadow-dialog",
} as const;

/**
 * 发丝线：品牌微染的分隔描边，线型语义分工为**实线开区块，虚线分行 / 分字段**
 * （workplan §1 V4）。
 *
 * 颜色不新增 token：`primary/10` 即 brand-600 @10%，对齐 admin 的
 * `--vx-color-auth-border`（brand 12% alpha）。暗色抬到 /20——同一浓度在
 * 暗底上远不如亮底可见。
 *
 * 只给"颜色 + 线型"，边落在哪一侧由调用方补（`border-b` / `border-t`）——
 * 同一条规则在表头是下边、在 footer 是上边。
 */
export const hairline = {
  /** 区块起始：表格顶边、工具栏与内容的分界。 */
  block: "border-primary/10 dark:border-primary/20",
  /** 行 / 字段 / footer 分隔。 */
  field: "border-dashed border-primary/10 dark:border-primary/20",
  /**
   * 同上，但配 `divide-y` 用。必须另给一份：`divide-*` 生成的是**子项**的边框，
   * 容器上的 `border-*` 颜色够不着它，而 v4 里边框默认色是 `currentColor`——
   * 漏了这一档，分隔线就取正文前景色，一条条发黑（2026-08-06 owner 实测）。
   */
  divide: "divide-dashed divide-primary/10 dark:divide-primary/20",
} as const;

/**
 * 叠层容器（透明模式）：页面只有一层实色底，容器以半透明表面叠在其上。
 *
 * 三档共用同一副骨架（发丝线描边 + 8px 圆角），只差表面透明度——层级差异
 * 用透明度而非亮度表达（workplan §1 V1）。
 *
 * **表面本身在 `cardVeil` 里，不在这里。** 这里只出骨架。原先这三档各带一个
 * `bg-card/58|68|72`，与 `cardVeil` 叠起来是两层半透明白做同一件事，后者的品牌调
 * 会被前者冲掉——opera 的卡片因此看不出底纹（2026-08-05 实测）。
 *
 * 语义色永不填充叠层的底；要表达状态用 `toneEdgeClasses`（顶缘色条，见 tone.ts）。
 */
export type VeilSurface = "soft" | "base" | "strong";

export const veil: Record<VeilSurface, string> = {
  /** 最透：大面积实体卡、列表卡。 */
  soft: `rounded-md border ${hairline.block}`,
  /** 默认：面板、统计卡。 */
  base: `rounded-md border ${hairline.block}`,
  /** 最实：入口卡、重点卡。 */
  strong: `rounded-md border ${hairline.block}`,
};

/**
 * 次要操作随父容器 hover / focus 渐显（workplan §1 V9）。
 *
 * 挂 `group` 在父容器上。`pointer-events` 跟着 opacity 走：看不见时也点不中，
 * 否则隐形按钮会截胡本该落在下层的点击。focus-within 同样显形——键盘用户
 * 没有 hover，tab 进来必须看得见自己落在了哪。
 */
export const revealOnHover = [
  "opacity-0 pointer-events-none",
  "transition-opacity duration-fast ease-standard",
  "group-hover:opacity-100 group-hover:pointer-events-auto",
  "group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
].join(" ");

/**
 * 进出场动效。**必须用 `data-[state=*]`**：上游 radix 模板写的是 `data-open:` /
 * `data-closed:`，但 Radix 发的属性是 `data-state="open"`——那些类编译得出来、
 * 永远匹配不上，结果是整个叠层族没有任何动效，且不报错。
 */
export const overlayMotion = [
  "duration-fast ease-standard",
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
  "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
  "data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
].join(" ");

/**
 * 卡面：上白下蓝，180deg 直上直下。**这就是叠层的表面本身**，`veil` 只出骨架。
 *
 * **它是背景不是前景，要的是似有似无。** 两端浓淡由 alpha 决定，不是靠把色阶
 * 调深——色阶一深就成了色块，会跟卡里的读数抢注意力。端点色与六个透明度都在
 * T2：亮色 white → brand-50，暗色由 token 自己重定向（neutral-800 → brand-950），
 * 组件不必知道主题。
 *
 * 三档对应 `veil` 的三档，整体加实而不是加深：
 *   soft   56 / 36   大面积实体卡、列表卡
 *   base   66 / 46   面板、统计卡
 *   strong 72 / 52   入口卡、重点卡
 *
 * 是 style 对象而不是类名片段（本文件里唯一的例外）：渐变函数带逗号与空格，
 * 写成 Tailwind arbitrary value 要把空格全换成下划线，读起来不像 CSS 也不像
 * 别的什么。它仍然属于这里——"跨组件恒定的规则"正是本文件的收录判据。
 */
export function cardVeil(
  surface: VeilSurface = "base",
): import("react").CSSProperties {
  return {
    backgroundImage: [
      "linear-gradient(180deg,",
      `color-mix(in srgb, var(--gradient-card-from) calc(var(--opacity-veil-${surface}-top) * 100%), transparent),`,
      `color-mix(in srgb, var(--gradient-card-to) calc(var(--opacity-veil-${surface}-bottom) * 100%), transparent))`,
    ].join(" "),
  };
}
