/**
 * color-policy.mjs — T2 色彩语义的定义。
 *
 * 六个意图族按**色相 × 阶型**表达，而不是逐条列出 60 行映射：六族的槽位结构完全
 * 相同，差别只在色相与填充档。这样加一个意图族是一行，而族间不一致在结构上
 * 不可能发生——"warning 的前景是深色而其余是白色"作为阶型差异一眼可见，
 * 摊平成行时则看不出是决策还是笔误。
 *
 * 非意图族（表面 / 内容 / 描边 / 图表 / 渐变）不具备这种规律，逐条列出即最简形式。
 */

/**
 * 意图族的色相与阶型。
 *
 * 阶型由**对比度**决定，不是审美偏好：
 * - A 档（600 填充配白字）适用于中高彩度冷色与红色
 * - B 档（700 填充配白字）给 emerald / sky——它们在 600 档配白字对比度不足
 * - C 档（400 填充配深字）给 amber——黄色系在任何档位配白字都不合格，
 *   业界通行解法是压低填充档并改用近黑文字
 */
export const INTENT_FAMILIES = [
  ["primary", "brand", "A"],
  ["destructive", "red", "A"],
  ["ai", "purple", "A"],
  ["success", "emerald", "B"],
  ["info", "sky", "B"],
  ["warning", "amber", "C"],
];

/**
 * 阶型：填充三态 + 前景。`text` 档不在这里——它由 `INTENT_SLOTS` 统一给（见下），
 * 阶型只管"实心块用哪一档"。
 */
export const INTENT_RAMPS = {
  A: { fill: 600, hover: 700, active: 800, foreground: "white" },
  B: { fill: 700, hover: 800, active: 900, foreground: "white" },
  C: { fill: 400, hover: 500, active: 600, foreground: "neutral-900" },
};

/**
 * 六族共用的槽位。填充三态与前景**不随主题变化**——一个"危险"按钮在暗色下仍应
 * 是同一个红，否则同一个操作在两种主题下看起来是两件事。随主题变的是 muted 系列
 * （底色要贴合各自主题的表面明度）与 text / border（要在各自背景上保持对比度）。
 *
 * `text` **六族同档，不随阶型**（owner 2026-08-05）：它是"在浅底上说话的那档字"，
 * 决定它的是背景明度，不是这一族实心块用得多深。此前它挂在阶型里，于是 A 族
 * （primary / destructive / ai）拿的是 600——与自己的实心填充同档，而 B/C 族拿
 * 700。结果 brand 语气的标、tag、链接比同场的 success / warning 高出整整一档
 * 彩度，满页的品牌蓝发亮（owner 实测："大范围的 brand 色 tags/badge 太亮眼"）。
 * 统一到 700 后六族在浅底上视重齐平。实心块不受影响——那走 fill，仍是各自阶型。
 */
export const INTENT_SLOTS = {
  light: {
    muted: 50,
    "muted-hover": 100,
    "muted-active": 200,
    "muted-foreground": 800,
    border: 600,
    text: 700,
  },
  dark: {
    muted: 950,
    "muted-hover": 900,
    "muted-active": 800,
    "muted-foreground": 300,
    border: 500,
    text: 400,
  },
};

/**
 * 等级族 L1–L5：序数用明度表达，类别才用色相（owner 2026-08-06）。
 *
 * 等级是同一维度上的高低，不是六个意图那样的并列类别，所以它取单色相的五档，
 * 而不是各占一个色相——后者正是现状的毛病：套餐层级借 success 表示免费、借
 * warning 表示专业版，读起来像状态而不是层级。同样的判断在 `chart-seq-*` 上
 * 已经成立（序数数据走 brand 明度阶）。
 *
 * 数字越大等级越高，与色阶 50→950 同向。名次→等级的翻译归产品侧。
 *
 * **档距均匀、整体偏浅**（owner 2026-08-06 实测后调）：初版取 200/400/600/700/900，
 * L5→L4 跨 200 档而 L4→L3 只跨 100 档，于是第一名远远甩开、第二三名几乎分不出；
 * 而且末档太深太重。现在每级 +100，立体感交给渐变与透明度，不靠把颜色调深。
 *
 * `fill`/`deep` 是渐变两端（相差两档）；`foreground` 按各档对比度定，前三档配白字
 * 不足 4.5:1，改深字。三者均不随主题变化，同意图族填充的理由：一个"五级"记号在
 * 暗色下仍应是同一个五级。
 */
export const LEVEL_HUE = "brand";
export const LEVELS = [1, 2, 3, 4, 5];
export const LEVEL_RAMP = {
  1: { fill: 200, deep: 400, foreground: "neutral-900" },
  2: { fill: 300, deep: 500, foreground: "neutral-900" },
  3: { fill: 400, deep: 600, foreground: "neutral-900" },
  4: { fill: 500, deep: 700, foreground: "white" },
  5: { fill: 600, deep: 800, foreground: "white" },
};

/* 只给底座要的三档。曾另给 muted / text 供 pill 用，但单色相下五级的浅底
   全落在 brand-50，表达不出等级差异——pill 要用等级色时按 fill 调透明度。 */
export const LEVEL_SLOT_ORDER = ["", "deep", "foreground"];

/** 槽位输出顺序，与既有产物一致。 */
export const INTENT_SLOT_ORDER = [
  "",
  "hover",
  "active",
  "foreground",
  "muted",
  "muted-hover",
  "muted-active",
  "muted-foreground",
  "border",
  "text",
];

/**
 * 非意图族：表面 / 内容 / 描边 / 图表 / 渐变。三列为 [语义名, 明色 T1 档, 暗色 T1 档]。
 *
 * 这些族没有可提取的规律，逐条列举。判据：
 * - 表面阶梯用中性档，不带品牌调
 * - `scrim` 与 `gradient-glow-*` 明暗同值（alpha 合成色）
 * - `chart-seq-*` / `chart-div-*` 明暗逐档反序（100↔900）
 * - 渐变端点按感知亮度差定：强调渐变（brand / ai）ΔL* 12–17，底纹（surface / glow）5–9
 */
export const STANDALONE_COLORS = [
  /* surface */
  ["background", "neutral-100", "neutral-950"],
  ["surface-1", "neutral-200", "neutral-900"],
  ["card", "white", "neutral-800"],
  ["surface-3", "neutral-50", "neutral-700"],
  ["popover", "white", "neutral-800"],
  // 遮罩与背景虚化配套使用。虚化本身已经说明"下面那层不可操作"，
  // 遮罩不必再压暗一次——45% 那种浓度是没有虚化时才需要的。
  ["scrim", "neutral-950-alpha-10", "neutral-950-alpha-10"],
  // hover / pressed 用品牌微染而非中性灰（owner 拍板 2026-08-02，透明模式 V8）：
  // 交互反馈是"染上品牌色"，与 surface-selected 同色相、不同浓度，构成连续刻度
  // hover(08) < selected(10) = pressed(15) < selected-hover(15)。
  ["accent", "brand-600-alpha-08", "brand-600-alpha-15"],
  ["surface-active", "brand-600-alpha-15", "brand-600-alpha-22"],
  ["surface-selected", "brand-600-alpha-10", "brand-600-alpha-15"],
  ["surface-selected-hover", "brand-600-alpha-15", "brand-600-alpha-22"],
  /*
   * 常态的品牌淡底与弱描边（a22e8db8 为档位徽章加的，2026-08-07 补录进 policy）。
   *
   * 名字带 `primary-` 却不走 `INTENT_SLOTS`：那张表是**六个意图族共用**的槽位，
   * 加一个槽就要给 success / warning / danger / info / neutral 各生一份，
   * 而这两档只有 primary 有需求，凭空多出十个没人用的 token。
   *
   * muted-strong：此前只有 hover/active 两个**交互**档比 muted 深，需要"同为常态、
   * 但比 muted 重一档"时只能去借 hover——借了之后调 hover 会把静态样式一起改掉。
   * border-soft：`--primary-border` 是 brand-600，给的是"要被看见"的边（聚焦环、
   * 强调块）；一枚安静的标用它会显得比它承载的文字还重。
   */
  ["primary-muted-strong", "brand-100", "brand-900"],
  ["primary-border-soft", "brand-200", "brand-800"],
  // 中性弱化填充（owner 拍板 2026-08-03）：占位、键位标示、组内非交互成员。
  // 与 accent 的分工：accent 是品牌微染的交互反馈（hover/展开），muted 是静态
  // 中性底——上游 muted/muted-foreground 本是一对，此前只建了后者，
  // expandable 配方引用 bg-muted 静默失效即此缺口。
  ["muted", "neutral-200", "neutral-800"],
  ["surface-inverse", "neutral-900", "neutral-100"],
  /* content */
  ["foreground", "neutral-900", "neutral-50"],
  ["muted-foreground", "neutral-500", "neutral-300"],
  ["content-tertiary", "neutral-400", "neutral-400"],
  ["content-disabled", "neutral-300", "neutral-600"],
  ["content-on-fill", "white", "white"],
  ["link", "brand-600", "brand-400"],
  ["link-hover", "brand-700", "brand-300"],
  ["content-on-inverse", "neutral-50", "neutral-900"],
  /* stroke */
  ["border", "neutral-200", "neutral-600"],
  ["input", "neutral-400", "neutral-500"],
  ["stroke-emphasis", "neutral-600", "neutral-400"],
  ["ring", "brand-600", "brand-400"],
  ["stroke-disabled", "neutral-200", "neutral-800"],
  /* chart */
  ["chart-other", "neutral-400", "neutral-500"],
  ["chart-grid", "neutral-200", "neutral-800"],
  ["chart-axis", "neutral-400", "neutral-600"],
  ["chart-tooltip-bg", "neutral-900", "neutral-800"],
  ["chart-1", "brand-600", "brand-400"],
  ["chart-2", "amber-600", "amber-400"],
  ["chart-3", "emerald-600", "emerald-400"],
  ["chart-4", "purple-600", "purple-400"],
  ["chart-5", "sky-600", "sky-400"],
  ["chart-6", "red-600", "red-400"],
  ["chart-seq-1", "brand-100", "brand-900"],
  ["chart-seq-2", "brand-300", "brand-700"],
  ["chart-seq-3", "brand-500", "brand-500"],
  ["chart-seq-4", "brand-700", "brand-300"],
  ["chart-seq-5", "brand-900", "brand-100"],
  ["chart-div-1", "sky-700", "sky-300"],
  ["chart-div-2", "sky-300", "sky-600"],
  ["chart-div-3", "neutral-200", "neutral-700"],
  ["chart-div-4", "red-300", "red-600"],
  ["chart-div-5", "red-700", "red-300"],
  /* gradient */
  ["gradient-brand-from", "brand-600", "brand-500"],
  ["gradient-brand-to", "brand-800", "brand-800"],
  ["gradient-ai-from", "purple-600", "purple-500"],
  ["gradient-ai-to", "purple-800", "purple-700"],
  ["gradient-surface-from", "neutral-200", "neutral-800"],
  ["gradient-surface-to", "white", "neutral-900"],
  // 卡面底纹：上白下蓝，似有似无。与 `gradient-surface-*` 刻意相对——那一档
  // "表面阶梯用中性档、不带品牌调"，这一档要的正是那一点品牌调。
  //
  // **不适用上面那条 ΔL* 判据**。那条是给两个实色端点的渐变定的；本档的两端是
  // 两个不同透明度的 color-mix（56% / 36%，见 StatCard），浓淡由 alpha 决定而不是
  // 由色阶决定，拿色阶亮度差去卡会把颜色越挑越深。所以端点取最浅的一档：
  // 亮色 white → brand-50，暗色是它在深色下的对位。
  ["gradient-card-from", "white", "neutral-800"],
  ["gradient-card-to", "brand-50", "brand-950"],
  ["gradient-glow-from", "brand-600-alpha-22", "brand-600-alpha-22"],
  ["gradient-glow-to", "brand-600-alpha-08", "brand-600-alpha-08"],
];
