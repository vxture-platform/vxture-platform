# Design System 阶段收尾（2026-08-21）

> 范围：`@vxture/design-tokens` · `@vxture/design-ui` · `@vxture/design-system`（+ 私有的 `design-preview`）
> 状态：**本阶段收口。三包自足、已发布、设计线 issue 清零；拆仓的技术前提已备齐，剩下的是配置与产品裁定。**

本文只做一件事：把 DS 这条线**现在**处在哪儿写清楚，好让下一次接手的人不用重新考古。
不重复各包 CHANGELOG（那里有逐版细节），也不重复
[`10-standards/040-design-system-package-convergence.md`](../10-standards/040-design-system-package-convergence.md)
的三包职责裁定（那份仍然有效）。

---

## 1. 本阶段落了什么

| 项                                                                 | PR   | 结果                                        |
| ------------------------------------------------------------------ | ---- | ------------------------------------------- |
| 设计三包脱离 `@vxture/shared`（主题/偏好契约键归位 design-tokens） | #346 | 三包自此**自足**，可独立发布                |
| `#347` `/server` 入口在 react-server 下不可求值                    | #348 | 图标改引 Phosphor SSR 构建                  |
| `#268` 发布包按 registry 形态不可消费（六条缺陷，分三轮报回）      | #349 | `@source` 指向 dist、`/server` 类型面收窄   |
| 发布 `shared 2.0.0` / `tokens 2.2.0` / `ui 3.1.1` / `system 6.4.0` | —    | 已到 GitHub Packages（`workflow_dispatch`） |
| 三个 server layout 的常量改从 `/server` 取（#346 的回归）          | #357 | 见 §5「这轮暴露的第四条同形缺陷」           |

### 现在的依赖图（已核）

```
@vxture/design-tokens   零 @vxture 依赖      peer: tailwindcss
        ↓
@vxture/design-ui       → design-tokens      peer: @phosphor-icons/react, react, react-dom
        ↓
@vxture/design-system   → tokens + ui        peer: 上述 + next-themes, tailwindcss-animate
```

伞包对另两包用**精确版本**（发布时由 pnpm 把 `workspace:*` 替换为确切版本号）——
理由见发布规范 §1，不是习惯。

---

## 2. 守卫矩阵（DS 的机器化关卡）

| 守卫                                 | 守什么                                                                                                 | 何时加     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------- |
| `check-design-system.mjs`            | DS 规范（存量债由 baseline 钉住）                                                                      | 早期       |
| `check-design-system-exports.mjs`    | 公开入口快照，改导出面必须显式重生成                                                                   | 早期       |
| `check-component-classes.mjs`        | 组件类名**真能产出**（95 个组件 / 973 处类名列表）                                                     | 早期       |
| `check-preview-coverage.mjs`         | 每个组件都有预览条目（93/93，1 个按理由排除）                                                          | 早期       |
| `check-mode-blocks.mjs`              | 明暗模式块                                                                                             | 早期       |
| **`check-server-entry-safety.mjs`**  | `/server` 在 `--conditions react-server` 下**真的可 import**                                           | **本阶段** |
| **`check-packed-consumability.mjs`** | 按 **registry 安装形态**验：`@source` 目标在包里、目标里真扫得到工具类、`/server` 类型面不宽于运行时面 | **本阶段** |

后两条都**经过反向验证**（把缺陷退回去，守卫确实报错），并且都跑在**发布流水线上——发布前**，不是发布后。

另有随包发布的
[`packages/design-system/docs/07-consumption-pitfalls.md`](https://github.com/vxture/vxture-design/blob/main/packages/design-system/docs/07-consumption-pitfalls.md)：
只收「接上去不报错、构建全绿、但结果是错的」这一类，消费方装完就能读到。

---

## 3. 拆仓就绪度（旧仓 → design-system 独立开发仓）

**已就绪**：三包无 `@vxture/shared` 依赖、依赖图单向、发布流水线可用、导出面有快照、
消费契约有随包文档。

**要一起搬走的东西**（容易漏，逐条列）：

| 类别        | 内容                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| 私有包      | `packages/design/design-preview`——DS 自己的预览面，`check-preview-coverage` 靠它                                 |
| 守卫脚本    | `scripts/guardrails/` 下 7 个 DS 专属脚本 + 2 个基线/快照 JSON                                                   |
| token 管线  | `scripts/design-tokens/` 全部 11 个文件（生成器 + 策略源 + 基线）                                                |
| pnpm script | 根 `package.json` 的 9 条（`build:design` / `lint:design*` / `lint:server-entry` / `lint:packed-consumability`） |
| 流水线      | `publish-design-system.yml`，以及 `ci.yml` 里的设计段                                                            |
| 规范文档    | `10-standards/` 的 030 / 040 / 050 / 060 / 065 五份                                                              |

**拆仓后要付的成本**（现在是零成本，因为都在一个仓里）：

- **5 个门户 + design-preview** 从 `workspace:*` 改成 registry 版本号；每个消费仓与
  **每次 Docker 构建**都要 `.npmrc` 鉴权——GitHub Packages 即便包是公开的也要求鉴权。
- `packages/platform/browser` **直接依赖 `@vxture/design-tokens`**（`preferences.utils.ts`
  用其中的存储键）。这是唯一一处非门户的跨线依赖，拆仓后平台侧构建也进入上述鉴权范围。
  #346 把这些键放进 design-tokens 是对的（"取值存在哪、叫什么键"属于 token 契约），
  但它的连带后果要在拆仓预算里算上。
- 版本联动从"改完就生效"变成"发版才生效"：DS 改一处、门户要等一次发布。

---

## 4. 未决（需 owner）

| 项                                                    | 卡在哪                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@vxture/shared` 是否改名为 `@vxture-platform/shared` | 需确认 karda / yucer 等外部仓是否直接引用它——只有你知道                                         |
| 拆仓的执行时点                                        | 技术前提已备齐；何时动是产品/节奏问题                                                           |
| 新仓（主力仓）的 secrets 与 environments              | 影响平台发版，**不影响 DS 发布**——`@vxture` scope 必须由 `vxture` 组织发，DS 发布本就该留在旧仓 |

---

## 5. 这一阶段的判据（值得留下的那部分）

本轮 DS 侧一共暴露四条缺陷，**形状完全相同**：

| #   | 缺陷                                         | 为什么本仓测不出来                                             |
| --- | -------------------------------------------- | -------------------------------------------------------------- |
| 1   | `@source` 指向不发布的目录（#268）           | 工作区包软链到完整签出，`src/` 真的在                          |
| 2   | `/server` 的 `.d.ts` 比运行时宽（#268）      | 类型检查跑在普通 node 条件下，且**类型系统主动为错误写法背书** |
| 3   | `/server` 在 react-server 下不可求值（#347） | build / type-check / 单测都跑在普通 node 条件下                |
| 4   | server layout 从 client 入口点取常量（#357） | **CI 只建六个 BFF bundle，一个门户的 `next build` 都不跑**     |

四条都**不报错**，都在"看起来一切正常"的状态下活了很久：第 4 条是 #346 留下的回归，
在 main 上躺过五个 PR，直到打 `v0.20.44` 才炸。

所以本阶段的收尾结论不是"缺陷修完了"，而是：

> **凡是"消费方形态与开发形态不同"的地方，都要有一条按消费方形态跑的检查，
> 且必须跑在发布之前。**

这四条各自对应的机器化关卡都已落地（前三条见 §2，第 4 条是 `ci.yml` 里新加的
「Build affected portals」）。下一次再出现同形缺陷，应当先问"哪个形态没有被跑到"，
而不是先修那一处代码。
