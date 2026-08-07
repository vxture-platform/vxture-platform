# Design Token 构建规范

版本：1.1.0
日期：2026-07-31
范围：`@vxture/design-system` 的 T1–T3 token、Figma DTCG 导出、`scripts/design-tokens/*` 生成器

本文定义 token 从设计到代码的**唯一构建路径**与权威边界。层级定义见包内 `packages/design/design-system/docs/01-usage.md` §2（T1 镜像机制见 `060-design-system.md` §1.1），发布影响见 `050-design-system-release.md`。

## 1. 权威边界

**`@vxture/design-system` 的 token 产出即唯一真值源。** 其余一切都是应用方——**Figma 也是应用方**，它最终要应用本包的 token 来做产品设计。

| 角色                                           | 定位                                     | 是否权威            |
| ---------------------------------------------- | ---------------------------------------- | ------------------- |
| `src/styles/primitive\|semantic\|components/*` | **DS token 真值源**                      | **是**              |
| `src/tokens/*.ts`                              | 真值源的 TS 投影                         | 否（由 CSS 层决定） |
| Figma 文件                                     | **应用方**：用 DS token 做视觉推演与设计 | 否                  |
| `Figma-Token/`（DTCG 导出）                    | **过程文件**：首次播种用，迁移完成后删除 | 否（临时）          |
| 手写非生成态 token                             | 迁移完成后即为常态                       | **是**              |

方向：**DS → Figma / 产品**。不是 Figma → DS。

### 1.1 迁移期的临时倒置

当前值源自 Figma 的一次性导出，因此存在一个**临时的反向依赖**：`Figma-Token/` 暂时充当播种源，生成器从它产出 CSS。这是过渡态，不是目标态。

迁移完成的判据是**全部集合都已落入 `src/styles/`**。届时：

1. 删除 `Figma-Token/`。
2. 退役 `scripts/design-tokens/generate-primitives.mjs` 与 `lint:design-tokens` 门。
3. 生成物头部的"勿手工编辑"改为常规文件头，此后由人维护。
4. 反向补一条 DS → Figma 的导出，供设计侧导入。

迁移进度见第 8 节。

## 2. 管线

**目标态**：

```
packages/design/design-system/src/styles/primitive|semantic|components/*.css   ← 真值源
  ↓ tokens.css 聚合            ↓ 导出 DTCG
消费方（产品仓库 / T4）        Figma（导入后用于设计）
```

**迁移期**（临时）：

```
Figma-Token/<collection>/*.tokens.json   ← 过程文件
  ↓ scripts/design-tokens/*.mjs
src/styles/primitive/*.css
```

### 2.1 过程文件约定（迁移期有效）

- 导出**全部集合**，不做裁剪——裁剪会让"缺失"与"未导出"无法区分。
- 目录结构保持 Figma 集合原样：`<collection>/<mode>.tokens.json`。
- **逐字入仓，禁止格式化**（已加入 `.prettierignore`），否则无法与重新导出比对。
- 不参与 DS 守卫扫描（`check-design-system.mjs` 的 `IGNORED_PARTS`），裸值正是它的本体。
- 不随包发布：`package.json` 的 `files` 白名单未含该目录。

### 2.2.0 T1 / T2 的边界

**T1 是无意义的值刻度，T2 是组件消费的名字。** 判据只有一条：这个 token 的名字本身是否携带含义。`--vx-radius-md: 6px` 只是阶梯上的一格 → T1；`--z-modal: 500`、`--opacity-disabled` 名字即含义 → T2。

早先 T1 只有色彩、间距、排版三类，radius / shadow / border-width / opacity / breakpoint / duration / ease / size 这八条刻度全挂在 T2，导致 T2 里刻度与语义混杂，边界不清。现已全部下沉，T1 共 **15 个文件**：

| T1 文件                      | 内容                       |
| ---------------------------- | -------------------------- |
| `color-primitive.css`        | 13 色相、alpha 变体（189） |
| `spacing-primitive.css`      | 长度刻度（24）             |
| `font-family-primitive.css`  | 字族 + 完整字体栈（8）     |
| `font-size-primitive.css`    | 字号（12）                 |
| `font-weight-primitive.css`  | 字重（5）                  |
| `leading-primitive.css`      | 行高倍数（6）              |
| `tracking-primitive.css`     | 字距，em（6）              |
| `radius-primitive.css`       | 圆角（8）                  |
| `border-width-primitive.css` | 描边宽度（4）              |
| `shadow-primitive.css`       | 阴影几何（12）             |
| `opacity-primitive.css`      | 透明度，数值阶（5）        |
| `breakpoint-primitive.css`   | 断点（9）                  |
| `duration-primitive.css`     | 时长（5）                  |
| `ease-primitive.css`         | 缓动曲线（5）              |
| `size-primitive.css`         | 图标与媒体尺寸（17）       |

T1 内部允许互相引用（`--vx-radius-md: var(--vx-spacing-1-5)`——圆角与间距同为长度量纲，共用一条阶），这不破坏分层。

**T2 中允许保留裸值的只有三类**，共 104 项，各有据：

| 类别             | 数量 | 理由                                                                                              |
| ---------------- | ---- | ------------------------------------------------------------------------------------------------- |
| 排版角色行高比值 | 72   | 各角色比值不同（1.167 / 1.200 / 1.429）——大字号收紧行距是排版惯例，**不可能**引用一条固定倍数刻度 |
| 布局常量         | 20   | 侧栏/面板/字段/顶栏尺寸是一次性产品决策，收进原子层只会让长度阶膨胀                               |
| z-index          | 12   | 语义梯度，名字即含义                                                                              |

### 2.2.1 T2 按命名空间分文件

**一个命名空间对应一族工具类，一一对应。** 不按 Figma 集合分文件——集合是设计侧的组织方式，会随设计稿调整而变动，且一个集合常横跨多个工具类族（`vx-Shape` 同时含 radius 与 border-width，`vx-Depth` 同时含 shadow 几何、z-index 与 opacity）。按命名空间分则稳定，且"改这个文件会影响哪族工具类"在文件名上即可见。

| 文件                      | 工具类族                                               | 数量 |
| ------------------------- | ------------------------------------------------------ | ---- |
| `color-semantic.css`      | `bg-*` `text-*` `border-*` `ring-*`                    | 117  |
| `radius-semantic.css`     | `rounded-*`                                            | 8    |
| `border-semantic.css`     | `border-*`（宽度）                                     | 4    |
| `shadow-semantic.css`     | `shadow-*`                                             | 12   |
| `z-index-semantic.css`    | `z-*`                                                  | 12   |
| `opacity-semantic.css`    | `opacity-*`                                            | 5    |
| `size-semantic.css`       | `size-*`                                               | 17   |
| `duration-semantic.css`   | `duration-*`                                           | 5    |
| `ease-semantic.css`       | `ease-*`                                               | 5    |
| `breakpoint-semantic.css` | `sm:` `md:` …                                          | 9    |
| `spacing-semantic.css`    | `gap-*` `p-*` `h-*`（密度三档）                        | 61   |
| `typography-semantic.css` | `text-*` `font-*` `leading-*` `tracking-*`（字号三档） | 120  |
| `layout-semantic.css`     | —（DS 特有：页宽/内容宽/侧栏/面板/字段）               | 34   |

### 2.2.2 与 Tailwind 的刻度对齐

设计系统严格对齐 Tailwind，设计稿按 DS 修正。逐项核对结果：

| 命名空间                  | 状态                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 字号 / 字重 / 行高 / 断点 | **完全一致**，零差异                                                                                                                      |
| spacing                   | 等价（`--vx-spacing-4` = 16px = `p-4`）                                                                                                   |
| radius                    | 已按取值对齐（见 §3.1.3）                                                                                                                 |
| 字距                      | 已由 px 改 **em**——本系统有三档字号模式，px 不随字号缩放；换算后与 `--tracking-*` 逐档等值                                                |
| duration / ease           | 已由 `--motion-duration-*` / `--motion-easing-*` 改为 `--duration-*` / `--ease-*`；Tailwind 内置仅 `ease-in/out/in-out`，与我方曲线名不撞 |
| container                 | 已改名 `--layout-page-*`。Tailwind 的 `--container-*` 是**通用宽度刻度**（md=448px），我方是**页面最大宽度**（md=768px），同词不同义      |
| elevation                 | 不可比且合理：我方拆 offset-y/blur/color 三件以便 Figma 阴影面板分字段绑定，Tailwind 是完整 shadow 字符串                                 |

**页宽与内容宽分离**：`layout/container/{3xl,4xl,5xl}` 原本同为 1920px（"兼容 2K/4K"的权宜写法），三档同值等于没有档位，且破坏了 container 与 breakpoint 的一一对应。根因是把**视口容器**（应跟随断点）与**可读内容宽度**（应有上限）混在一个刻度里。现拆开：`--layout-page-*` 与断点严格对齐（…1920 / 2560 / 3840），可读上限归 `--layout-content-*`，并补 `ultra-3xl = 1920px` 承接 2K/4K 的数据密集型页面——再宽则行长失控，应改用分栏。

### 2.2 文件组织

`src/styles/primitive/` 下按**主语在前、层级在后**命名，与 Figma 集合命名一致：

| 文件                       | 内容                                      | 数量 |
| -------------------------- | ----------------------------------------- | ---- |
| `color-primitive.css`      | 13 色相、alpha 变体                       | 189  |
| `spacing-primitive.css`    | 长度刻度（含 0.5 / 1.5 等半档与 `px`）    | 24   |
| `typography-primitive.css` | 字族 / 字体栈 / 字号 / 字重 / 行高 / 字距 | 37   |

### 2.3 生成物约定（迁移期有效）

- 头部标注"由脚本生成，勿手工编辑"，写明源与生成命令。
- 生成器必须提供 `--check`：只校验不写入，用于 CI。
- 每个生成器对应一个 `lint:design-*` 脚本并接入 `ci.yml`。

## 3. 取值规则

### 3.1 `$description` 不可信，`aliasData` 才是真值

导出中每个 token 携带 `$extensions`：

| 字段                                     | 含义                        | 可信度                 |
| ---------------------------------------- | --------------------------- | ---------------------- |
| `com.figma.aliasData.targetVariableName` | 该 token 实际指向的目标变量 | **权威**               |
| `com.figma.codeSyntax.WEB`               | 该 token 的 CSS 变量名      | **权威**               |
| `$value`                                 | 解析后的最终值              | 权威                   |
| `$description`                           | 人工填写的说明              | **仅供参考，已知有错** |

已确认的描述错误（截至 2026-07-31）：

| token              | 描述所写           | 实际（aliasData / 解析值）       |
| ------------------ | ------------------ | -------------------------------- |
| `surface/B-1`      | `color/neutral/50` | `color/brand/main/50`（#eef2ff） |
| `intent/*/muted`   | `<hue>/100`        | `<hue>/50`                       |
| `content/disabled` | `neutral/400`      | `neutral-300`                    |
| `stroke/control`   | `neutral/500`      | `neutral-400`                    |
| `content/primary`  | `neutral/900`      | `neutral/600`（#525252）         |

**生成器一律读 `aliasData` 与 `$value`，禁止解析 `$description`。** 描述错误应回报设计侧修正，但不阻塞生成。

### 3.1.1 codeSyntax 漏写 `--` 前缀

13 个 token 的 `codeSyntax.WEB` 写作 `var(elevation-1-color)` 而非 `var(--elevation-1-color)`（全部 `elevation/*/color` 与 `gradient/*/{from,to}`）。生成器规范化后继续，并在输出中逐条列出以便回报设计侧修正——**不得静默修正**。

### 3.1.2 偏离机制

DS 是真值源，设计稿只是输入且已证实会出错，因此**必须允许有依据地覆盖导出值**。覆盖只能写在生成器的 `DEVIATIONS` 表中，逐条给出理由；生成物在对应行留下 `/* 偏离设计稿：… */` 注释，生成时逐条打印。

**禁止直接编辑生成物**——会被 `--check` 拦下，且理由无处可查。每新增一条偏离，都应回报设计侧修正设计稿。

当前偏离（`vx-Color-Light`，4 条）：明色表面阶梯去品牌调。设计稿用 `surface/B-*` 的品牌浅蓝与 `surface/N-*` 的中性拉开层次，但该区分在暗色下完全塌缩（四级全为中性明度阶），且实践中 console 早已用 `--vx-color-shell-bg: #f5f7fb` 绕过较重的品牌底色。明色可用档位只有 `white / 50 / 100 / 200` 四个、恰好四级，故整体重排而非单点替换，否则页面底与卡内凹陷面会撞成同值。

| token          | 设计稿      | DS 取值     |
| -------------- | ----------- | ----------- |
| `--background` | brand-50    | neutral-100 |
| `--surface-1`  | brand-100   | neutral-200 |
| `--card`       | neutral-50  | white       |
| `--surface-3`  | neutral-100 | neutral-50  |

### 3.2 命名映射

Figma 路径 → CSS 变量名，规则确定且不可自由发挥：

| 层       | 变量名来源              | 示例                                                             |
| -------- | ----------------------- | ---------------------------------------------------------------- |
| T1 原子  | 由 Figma 路径机械推导   | `color/brand/main/600` → `--vx-color-brand-600`                  |
| T1 alpha | 同上加后缀              | `color/neutral/600/alpha-08` → `--vx-color-neutral-600-alpha-08` |
| T2 语义  | **取 `codeSyntax.WEB`** | `surface/B-1` → `--background`                                   |
| T3 组件  | **取 `codeSyntax.WEB`** | `toast/shadow-color` → `--toast-shadow-color`                    |

T2/T3 采用 shadcn 约定名（`--background`/`--primary`/`--border`…），shadcn 无对应概念的沿用 Figma 自有名（`--gap-*`/`--inset-*`/`--content-*`）。既有 `--vx-*` 名一律保留为别名，不删除。

### 3.1.3 变量名不得遮蔽 Tailwind 主题变量

Tailwind v4 的工具类编译为对同名主题变量的引用——`rounded-md` 即 `border-radius: var(--radius-md)`。因此在 `:root` 定义同名变量会**直接改掉仓库中该工具类的全部用法**，无需任何"桥接"动作。

设计稿的 radius 刻度比 Tailwind 整体错位一档（设计稿 md=8px、Tailwind md=6px），实测影响 83 处 `rounded-*`。两条刻度的取值集合本就相同（2/4/6/8/12/16），仅标签错位，故按**取值**对齐即可——对齐后同名同值，遮蔽无害化，且与既有 `--vx-radius-*` 一致（它一直是 Tailwind 语义）。收敛表在 `scripts/design-tokens/radius-map.mjs`，由 T2 与 T3 生成器共用。

设计稿的 `radius/2xl`（20px）在 Tailwind 刻度上无对应（16 之后为 24）且无人引用，故不发——需回报设计侧确认并入 24px 还是删除。

**排查方法**：把 T2/T3 全部变量名与 `tailwindcss/theme.css` 的变量名取交集。当前 601 个 T2/T3 变量中，仅 radius 一族 6 个同名，且已同值。新增 token 时应重跑该比对。

### 3.2.1 非色彩集合的命名由 DS 定义

`vx-Shape / vx-Depth / vx-Element / vx-Motion / vx-Layout / vx-Space / vx-Typography` 共 292 个 token，其 `codeSyntax` **38% 不可用**：50 个缺失，62 个分属 22 组撞名（如 `inset/2xl`–`inset/6xl` 五档全部声明为 `--inset-2xl`，`vx-Typography` 有 12 组）。该字段已不足以充当这些集合的命名权威。

因此这些集合的变量名**一律由 DS 按 token 路径机械推导**（`control/height/md` → `--control-height-md`），唯一性由路径本身保证。`codeSyntax` 降为参考，生成时逐条列出与 DS 命名不符之处（当前 142 项）与缺失项（50 项），供回报设计侧修正。

`vx-Color` 不适用本条——其 `codeSyntax` 除 §3.1.1 的前缀问题外无撞名，仍作命名权威。

### 3.3 禁止使用 Tailwind 内置调色板作为 T1

Tailwind v4 调色板已迁 P3 广色域，饱和色与设计稿不等值：

|             | 设计稿    | Tailwind v4 |
| ----------- | --------- | ----------- |
| red-600     | `#dc2626` | `#e7000b`   |
| emerald-600 | `#059669` | `#009966`   |
| purple-600  | `#9333ea` | `#9810fa`   |
| amber-500   | `#f59e0b` | `#fe9a00`   |

中性色两者等值，但仍须显式声明以保持单一取值来源。shadcn 生成的 theme 用的是 v4 值，**不作为取值来源**。

## 4. 已知导出缺陷与必须的补偿

### 4.1 步阶降级丢值

某步阶一旦挂了 alpha 子项（如 `color/emerald/600/alpha-08`），DTCG 导出会把该步阶降级为「组」，**其不透明本体值不再作为独立 token 导出**。当前影响 13 个色相的 600 阶与 neutral / brand 的 950 阶，共 14 项。

补偿方式：从任一 alpha 子项的 `hex` 字段回收本体值。**回收必须带三条断言，缺一不可**：

1. 同一步阶下所有 alpha 子项 `hex` 必须一致——不一致则本体值无从判定，报错退出。
2. 回收出的本体必须被某个 L2/L3 token 的 `aliasData` 引用——无引用即说明该步阶在 Figma 中并无不透明本体，**拒绝凭空生成**。
3. 凡被 L2/L3 引用的原子，生成物必须覆盖——否则报错退出。

无断言的回收等同于静默猜测，一旦导出结构变化就会产出错误取值而无人察觉。

### 4.2 MCP 页面列表不全

Figma MCP 的页面枚举会漏列页面，且 `search_design_system` 只返回已发布的库变量——**原子层通常未发布，因而完全不可见**。

因此：**取值一律走导出文件，不走 MCP**。MCP 仅用于设计评审、截图、结构探查。

## 5. 变更流程

### 5.1 目标态

1. 在 `src/styles/` 直接改 token。
2. 按 `050-design-system-release.md` 判定 SemVer——**token 值变化属行为变更**，即使公开入口未变。
3. PR 合入、发布。
4. 设计侧从 DS 导出的 DTCG 重新导入 Figma，使设计稿跟上实现。

### 5.2 迁移期

1. 若值需从 Figma 侧补充：重新导出全部集合，覆盖 `Figma-Token/`。
2. 运行生成器（不带 `--check`）。
3. **审阅两处 diff**：过程文件的 diff 说明设计侧改了什么，生成物的 diff 说明工程受什么影响。
4. 同 5.1 的第 2–3 步。

禁止只改生成物不改过程文件，也禁止只更新过程文件不重新生成——CI 会拦截。

## 6. 守卫

| 命令                       | 作用                                   |
| -------------------------- | -------------------------------------- |
| `pnpm lint:design-tokens`  | 生成物与导出一致性 + 第 4.1 节三条断言 |
| `pnpm lint:design-exports` | DS 公开入口快照                        |
| `pnpm lint:design`         | DS 分层与裸值守卫                      |

三者均已接入 `ci.yml`。

## 7. 关联文档

- `packages/design/design-system/docs/01-usage.md` §2 —— T1–T4 层级对外定义
- `docs/10-standards/060-design-system.md` §1.1 —— T1 镜像与偏离登记
- `docs/10-standards/050-design-system-release.md` —— 发布与 SemVer
- `docs/10-standards/040-design-system-package-convergence.md` —— 目录结构目标
- `workplans/design-system-t1-t4-refactor.md` —— 本次重构的推进记录

## 8. 迁移进度

`Figma-Token/` 是过程文件，**全部集合迁入 `src/styles/` 后即可删除**。当前状态：

| 集合                                      | 层  | 去向                               | 状态       |
| ----------------------------------------- | --- | ---------------------------------- | ---------- |
| `vx-Color-Primitive`                      | T1  | `color-primitive.css`              | **已迁入** |
| `vx-Spacing-Primitive`                    | T1  | `spacing-primitive.css`            | **已迁入** |
| `vx-Typography-Primitive`                 | T1  | `typography-primitive.css`         | **已迁入** |
| `vx-Color`（Light / Dark）                | T2  | `semantic/color-semantic.css`      | **已迁入** |
| `vx-Shape`                                | T2  | `semantic/shape-semantic.css`      | **已迁入** |
| `vx-Depth`                                | T2  | `semantic/depth-semantic.css`      | **已迁入** |
| `vx-Space`（Compact/Default/Comfortable） | T2  | `semantic/space-semantic.css`      | **已迁入** |
| `vx-Typography`（Small/Default/Large）    | T2  | `semantic/typography-semantic.css` | **已迁入** |
| `vx-Element`                              | T2  | `semantic/element-semantic.css`    | **已迁入** |
| `vx-Layout`                               | T2  | `semantic/layout-semantic.css`     | **已迁入** |
| `vx-Motion`                               | T2  | `semantic/motion-semantic.css`     | **已迁入** |
| `vx-Component`                            | T3  | `components/*-component.css`       | **已迁入** |

**12 / 12 已迁 —— 删除条件已满足。** `Figma-Token/` 可按 §1.1 的四步退役，该动作需 owner 明确授权后执行。

退役前需一并处理的遗留：

| 项                            | 数量          | 说明                                  |
| ----------------------------- | ------------- | ------------------------------------- |
| `$description` 与实际绑定不符 | 5             | §3.1                                  |
| `codeSyntax` 漏写 `--` 前缀   | 13            | §3.1.1                                |
| `codeSyntax` 撞名             | 22 组 / 62 项 | §3.2.1                                |
| `codeSyntax` 缺失             | 198           | T2 50 + T3 148                        |
| 表面阶梯偏离                  | 4             | §3.1.2，设计稿应跟随 DS 改为中性      |
| `modal` 违反自身 T3 门槛      | 12 项         | 治理称「无需 T3、直接绑 T2」却建了 T3 |
| `surface/danger` 无名无别名   | 1             | 无法生成，已跳过                      |

这些都应回报设计侧修正设计稿——**修的是设计稿，不是 DS**：DS 已是真值源，设计稿需向 DS 对齐。
