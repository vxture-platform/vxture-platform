# @vxture/design-tokens — 更新日志

发布走 `publish-design-system.yml`（GitHub Packages `npm.pkg.github.com`）。版本规则见
`docs/10-standards/050-design-system-release.md` §2。

⚠ 本包的破坏性判据与代码包不同：**删掉一个 CSS 变量不会报错，只会静默失效**。
故 token 的删改一律按 major，不做"应该没人用"的推定。

---

## 2.1.0 — 2026-08-18

纯增量，无删改——minor。

### ✨ 新增

- **T2 `--container-panel-xl: 58rem`**——panel 梯补超宽档（双栏表单、并排预览），
  owner 批准新增；@theme 字面量消费方为 design-ui Dialog 的 `width="xl"` 档
  （v4 只发射被工具类字面量消费的变量，无消费方会静默失效）。
- **T1 `--vx-radius-full: 9999px`**（EXTENSIONS 扩展）——胶囊/圆点档。Tailwind 的
  `rounded-full` 是硬编码 `calc(infinity*1px)`、不进 theme，CSS 文件层（取值桥/
  遗留层）此前没有可引用的 var 面；自 shell-template 同名同值收编，零漂移。

### 🔧 取值调整（不增删名字，patch 级随批）

- **`font/sans` 覆盖栈**补中文系统回退：`'PingFang SC', 'Microsoft YaHei'` 插在
  `'Noto Sans SC'` 与 `ui-sans-serif` 之间——webfont 未载入时中文落系统 CJK 字形，
  而非无中文字形的 ui-sans-serif。自 shell-template 的刻意设计经生成器管路收编。

---

## 2.0.0 — 2026-08-17

首个版本。从 `@vxture/design-system` 拆出，零运行时依赖。

版本号从 2.0.0 起：按 050 §2.1「major 号在批次开启时已定，批次内不重复决策」，
随三包同批的号走，而不是自己另起一个 1.0.0。

### 内容

- **T1 原子层** —— Tailwind v4 theme 的完整镜像，由 `scripts/design-tokens/generate-foundation.mjs`
  直接读上游 `theme.css` 生成，一致性由构造保证。全部偏离登记在 `foundation-policy.mjs`：
  扩展（`text-3xs/2xs`、`breakpoint-xs/3xl/4xl/5xl`、`font-brand/cjk`、时长档）、
  覆盖（`font-sans` / `font-mono` 的字体栈）、减法（色板只留六个色相加品牌色）。
- **T2 语义层** —— 色彩（112 角色 × 明暗）、24 档排版角色（× 字号三档）、
  间距（× 密度三档）、圆角、视觉高度、叠放次序、时长与缓动、透明度、描边宽度、
  图标与媒体尺寸、页面与内容宽度。输入全部在 `scripts/design-tokens/*-policy.mjs`。
- **TS 面** —— `Z_INDEX` 叠放阶梯、`Density` / `FontSize` 及其类名。由同一份策略生成，
  与 CSS 不会漂移。

### 样式入口

- `@vxture/design-tokens/styles/tokens.css` —— T1 + T2 + `@theme` 注册
- `@vxture/design-tokens/styles/tailwind.css` —— Tailwind 基线与暗色变体

一般不直接引用：`@vxture/design-system/styles/globals.css` 已经把它们串在链首。
