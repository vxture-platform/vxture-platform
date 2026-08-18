/**
 * primitive-policy.mjs — T1 相对 Tailwind 基线的**全部偏离**，逐条写明理由。
 *
 * T1 是 Tailwind theme 的完整镜像。凡与基线不同之处只有三种，且必须登记在此：
 *
 *   KEEP_HUES   色板做减法（平台用不到那么多色相）
 *   EXTENSIONS  Tailwind 没有的挡位（扩展）
 *   OVERRIDES   Tailwind 有、但 DS 判定要改的取值（修改）
 *
 * 没登记就是没有偏离——生成器直接照搬基线。**不允许手工改 primitive/ 下的文件**，
 * 那是生成物，改动会被下一次生成静默覆盖。
 */

/**
 * 保留的色相。Tailwind 给 22 个色相 × 11 档 = 242 个色板 token，平台实际只用得上
 * 少数几个；全量镜像会让调色板"太杂"，选色时反而无所适从。
 *
 * 判据是 T2 语义层的实际消费量：下列七相各被引用 18–59 次，各自承担一类语义；
 * 被删的 fuchsia / teal / orange / lime / cyan 各只被引用 2–4 次，且全部来自
 * chart-2…6 各取一档——为图表配色养 5 个完整色阶不划算。图表改用保留色相。
 *
 * ⚠ 图表色的可辨识度因此下降：brand（靛）、purple、sky 三者偏冷且相邻。
 *   若数据可视化确有需要，再把 teal / orange 作为**明确扩展**加回，
 *   而不是默认全量保留。
 */
export const KEEP_HUES = ["neutral", "red", "amber", "emerald", "sky", "purple"];

/** 色板里不属于任何色相的单值（Tailwind 的 black / white）。 */
export const KEEP_COLOR_SINGLES = ["black", "white"];

/**
 * 扩展：Tailwind 没有的挡位。**扩展不是修改**——只增不改。
 *
 * 每条都要能回答"为什么 Tailwind 的挡位不够用"，答不上来的不算扩展，算私货。
 */
export const EXTENSIONS = {
  radius: [
    [
      "full",
      "9999px",
      "胶囊/圆点档。Tailwind 的 rounded-full 是硬编码 calc(infinity*1px)、不进 theme，" +
        "CSS 文件层（取值桥/遗留层）没有可引用的 var 面；2026-08-18 批 C 按原则 3 自 " +
        "shell-template 收编（同名同值零漂移，admin/console 5 个既有消费位）",
    ],
  ],
  font: [
    [
      "brand",
      "'Funnel Display', Inter, 'Noto Sans SC', sans-serif",
      "品牌标题字体；Tailwind 的 font 命名空间只有 sans / serif / mono 三族，无标题族",
    ],
    [
      "cjk",
      "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
      "中文优先栈，用于需强制中文字形的场合（正文栈里中文是回退位）",
    ],
  ],
  /* 字号档不再有扩展：最小档回到上游的 xs=12px。曾有 3xs=8 / 2xs=10 两档，随
     body-xs / label-xs 一并删除——10px 以下的汉字读不了，而字号偏好是无障碍设置，
     不该把文字推到读不了。扩展答不上"为什么上游挡位不够用"就不是扩展。 */
  // v4 的 duration-* 是裸数值工具类，theme.css 里没有这一族，T2 的 fast / base /
  // slow 因此无 T1 可指。档位表本身是 Tailwind 文档给定的封闭集合，照录即可。
  "transition-duration": [
    ["75", "75ms", "Tailwind 时长档"],
    ["100", "100ms", "Tailwind 时长档"],
    ["150", "150ms", "Tailwind 时长档"],
    ["200", "200ms", "Tailwind 时长档"],
    ["300", "300ms", "Tailwind 时长档"],
    ["500", "500ms", "Tailwind 时长档"],
    ["700", "700ms", "Tailwind 时长档"],
    ["1000", "1000ms", "Tailwind 时长档"],
  ],
  /* 不设 sm 以下的档：mobile-first 里基线样式就是手机样式，断点只向上加——
     曾有 xs=375px 一档，全仓零使用且答不上"上游为何不够"，2026-08-02 删。 */
  breakpoint: [
    ["3xl", "120rem", "1920px，1080p 横屏"],
    ["4xl", "160rem", "2560px，2K"],
    ["5xl", "240rem", "3840px，4K"],
  ],
};

/**
 * 覆盖：Tailwind 有该挡位、但 DS 认定取值不同。
 *
 * ease 曾用 Material 曲线覆盖 in/out/in-out，已按"扩展不是修改"的原则退回
 * Tailwind 取值；shadow 曾用自造的几何倍增阶梯，亦已退回。仅剩的两条是字体栈：
 * Tailwind 的 `--font-sans` / `--font-mono` 是**通用系统栈**，不含任何具体字体。
 * 品牌指定了 Inter / Noto Sans SC / Geist Mono，不覆盖则这些字体永远不生效——
 * 这不是"换个数"，而是该挡位按设计本就应由使用方填的内容。
 */
export const OVERRIDES = {
  "font/sans": {
    value:
      "Inter, 'Noto Sans SC', ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
    why: "平台正文字体为 Inter + Noto Sans SC，其后接 Tailwind 原栈作回退",
  },
  "font/mono": {
    value:
      "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Noto Sans Mono CJK SC', 'Liberation Mono', 'Courier New', monospace",
    why: "代码与数字等宽用 Geist Mono，其后接 Tailwind 原栈作回退",
  },
};

/**
 * 品牌与合成色：上游没有对应物，属 DS 私有。前缀在此登记，生成器据此把这部分
 * 从色板里分出来单独成文件。
 *
 * alpha 衍生值按用途配基色：≤22% 是叠加着色，用 `-600`；45% 是遮罩，用 `-950`。
 * 不要两个基色各铺一遍刻度。
 */
export const BRAND_COLOR_PATTERNS = [/^brand-/, /-alpha-\d+$/];

/**
 * 新增的合成色在此登记。
 *
 * 本族的既有取值由生成器从**自己上一次的产出**读回（上游没有对应物，无处可镜像），
 * 所以新增一档没有入口——手改生成物又与"请勿手工编辑"冲突。在此登记的行会并入
 * 读回结果，此后随生成物自我保留，可以从这里删掉。
 */
export const EXTRA_BRAND_ROWS = [
  [
    "neutral-950-alpha-10",
    "rgb(10 10 10 / 0.1)",
    "轻遮罩：配合背景虚化使用。虚化已经说明了'下面那层不可操作'，遮罩不必再压暗一次",
  ],
  [
    "brand-20",
    "#f4f7fd",
    // = oklch(97.6% 0.009 265)。为什么上游/现有色阶不够用：50 档是最浅的**填充**
    // 色，页面**底**必须比任何填充都浅，否则卡片叠不起来——brand-50 亮度 96.2%、
    // 彩度 .0179，直接当底会盖过其上的一切。本档取 brand-600 的核心色相 265
    // （brand-50 已漂到 272 偏紫，作品牌底色不够正），亮度贴齐 neutral-100 一线，
    // 彩度吃到该亮度下的安全上限：H265 的彩度天花板随亮度单调收窄（97.6%→.0095、
    // 98.0%→.0075），再亮就得让出蓝、再蓝就会撞 sRGB 边界被截断，声明值与实际
    // 渲染将对不上。偏离纯灰 6/255——brand-50 是 13/255（过量），纯中性是 0（呆板）。
    "页面底色档：比任何填充都浅的品牌微调底。彩度已取该亮度下的色域安全上限",
  ],
];
