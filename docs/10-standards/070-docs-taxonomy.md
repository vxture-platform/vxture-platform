# Docs 编号与标识体系（taxonomy）

> **权威**：`docs/` 目录结构、文件命名、标识符的唯一规范。所有产品仓（vxture-platform/arda/karda/varda…）共用。
> **配套**：仓库骨架见 [`repo-governance-standard.md`](./140-repo-governance-standard.md) §10；强制见 `pnpm lint:docs-numbering`。
> **参照**：`vxture-arda` 的 `docs/` 编号分类是范式来源（本文在其基础上把 standards 提前、加元规则）。

---

## 0. 元规则（铁律）

1. **编号 = 正式文件（永久）；无编号 = 临时文件（定位即待删）。概莫能外。**
   连 `index` 也不破例（写作 `00-index.md`）。CI 护栏 `lint:docs-numbering` 把此规则变成硬门。
   **本规则仅约束 `.md` 文件**；非 `.md` 产物（`.sql`/`.html`/`.json` 等）不受编号约束，
   由各自惯例管理（如 `30-design/db/schemas/*.sql` 按表名、`50-deployment/rebuild/*.json` 按平台惯例）。
2. **编号预留空位，不连续。** 一律留插入余量，避免后续插档要全体重排：
   - 顶层目录 = **十进制分段**（`00/10/20…90`），过渡目录可暂占非十进制号（如 `95-readme`），
     但须在本条注明回收条件（见 §1 表后说明），不得长期悬空。
   - 目录内文件 = **十位跳**（`00/10/20…`，插档用 `15`）
   - 域文档 = **百位分段 + 段内十位跳**（`100/110…`、`200/210…`）
3. **例外**：类型寄存器（`ADR-`/`TD-`）是 append-only 历史日志，**保留既有稳定 ID、永不重排**（新增只追加、可跳号），其"编号"由 ID 本身承载。

---

## 1. 顶层目录（decades）

| 编号                | 目录                                                                  | 收纳                                           |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| `00-meta`           | 关于文档本身                                                          | `00-index` / glossary / contributing / status  |
| `10-standards`      | **全栈工程规范（org 级权威，基础层）**                                | git-workflow / security / testing / DS / 本文… |
| `20-specs`          | 产品/业务规格                                                         | product specs、console/tenant spec             |
| `30-design`         | 架构 · ADR · 域设计 · DB schema                                       | architecture / decisions / 域设计 / schema     |
| `40-implementation` | 分层/包指南 · 编码规范 · dev setup                                    | packages / coding-rules / setup                |
| `50-deployment`     | 基建 · CI-CD · 环境 · 迁移                                            | deployment / rebuild                           |
| `60-operations`     | runbook · 审计 · 技术债 · 事故                                        | audit / tech-debt / runbooks / incidents       |
| `70-workplan`       | 计划 · 路线                                                           | roadmap / 批次跟踪                             |
| `80-liaison`        | 跨组织对接联络（回函/约定/同步）——**2026-07-27 起停止新增，见下方注** | arda 回函、对接契约（历史归档）                |
| `90-memory`         | 仓内 AI handoff                                                       | agent.md、handoff 约定                         |

> 未用满时空号保留（如无 workplan 也占住 `70`，勿挪用）。standards 居 `10`（基础层，governs 一切），非末尾。
> **`80-liaison`（2026-07-27 起）**：跨仓联络改用 GitHub Issues（`liaison` 标签），不再新建
> `NN-YYMMDDHHmm-slug.md`——原因与约定见 [`140-repo-governance-standard.md`](./140-repo-governance-standard.md)
> §10。既有文件保留作历史归档，不追溯迁移、不删除，按各仓节奏陆续退役；本目录不回收（`90-memory`
> 之前仍占位，避免号段错位），只是不再新增内容。
> **`95-readme`**（2026-07-17）：内部包 README 归集区（package 只留 `AGENTS.md` 入口，内容收 docs）；
> 属**过渡 staging**，与十进制分段并存的显式例外（见元规则 2）。**回收条件**：与
> `40-implementation/packages/` 合并去重后即删除本目录、条目从本表移除。已发布包（shared/design-system）
> README 保留在 package（作 npm registry 页面）。

---

## 2. 目录内文件与子目录编号（每一级都编号）

- **文件** `NN-kebab-slug.md`，`NN` **十位跳**（`10/20/30…`，插档 `15`）；≤9 文件用 2 位、>9 用 3 位（`010/020…`，sort-safe）。
- **子目录分两类**，`lint:docs-numbering` 对子目录名机检（2026-07-22 起，补 F2）：
  - **序列子目录**（承载该层内容的顺序分组，如 `30-design/` 下按主题切的子目录）用 `NN-name/`；
    **产品子目录用层级编码号**（见 §6）。
  - **键控子目录**（目录名本身就是稳定外部键——包名、产品面名、决策/审计登记表——顺序对其无意义，
    编号只会制造虚假顺序感）**不编号**，但须登记进护栏的具名例外表（`check-docs-numbering.mjs` 内
    `DIR_EXEMPTIONS`），新增前先入表。现行例外：`40-implementation/packages/**`（键=包名）、
    `20-specs/**/{admin,console,website}` 等产品面子目录（键=产品面名）、`30-design/decisions/`
    （键=ADR 号，070 §4 钉死）、`30-design/db/schemas/`（键=表名）、`50-deployment/rebuild/`
    （治理规范 §1 钉死）、`60-operations/audit/rules/`（键=规则名）、`30-design/inputs/`
    （键=owner 原稿留档，永久性 staging，不进编号体系——见吸纳留档对账纪律）。
  - **历史遗留豁免**（不追溯重排，避免大范围改链接；本身应属序列子目录、理应编号，但既有
    引用面过宽故维持现状）：`30-design/{architecture,commerce,db,identity,platform}/`、
    `40-implementation/{ai,development}/` 目录名不补 `NN-` 前缀；其中 `30-design/architecture/`
    内部文件另有个位跳且 `00-index.md`/`00-overview.md` 双 `00`（对应 F8）。**新建同层级目录
    起一律编号，不得再复制此形态**；本表随时间收缩，不新增条目。
- 每目录索引 = **`00-index.md`**（0 位固定给索引/概览）。
- 无编号 `.md`/目录 = 临时，`lint:docs-numbering` 报错（白名单：`README.md`——仅限 docs 根一级，见 §7；
  根级 `CLAUDE.md` 等非 docs 正文不在扫描范围）。

---

## 3. 域文档编号 `{kind}_{domain}_{NNN}_{slug}`

**作用域（owner 2026-07-22 定调）：本编码仅用于 vxture-platform 仓内部。** platform 仓的
`docs/` 是扁平目录，多个域（identity/commerce/metering/… 以及 arda/karda/varda 这些产品域）
的设计文档挤在同一层，域码前缀是唯一的防撞手段。独立仓库之间（platform 与各产品仓）本该
平级——产品一旦有了自己的独立仓库，**仓库内部**文档改用该仓库自己的编号惯例（目录分层 +
`NN-slug.md` 之类），不套用 `{domain}` 前缀；单一域仓库里域前缀是纯噪音。platform 仓里仍会
保留一部分该产品的文档（对接契约、entitlement/commerce 集成设计等平台视角、需跨域引用的部
分），这部分继续用域码前缀，不因产品有了自己的仓库就整体撤下平台仓。

**产品仓行使本条自定权限后的义务（2026-07-22 采纳 karda 回函 D4）**：不能止步于「不套用域码前缀」，
**须**在仓内固化一份文档约定（写清目录分层、文件编号带、护栏形态），把该约定接入本仓机检，并将
约定文档回报平台线（`80-liaison/` 通知即可）。不固化 = 下放退化为各仓各写各的、无约定无机检，
恰是本文件 §0 想消灭的状态。karda 仓 `docs/00-meta/10-docs-convention.md` + 其
`check-docs-numbering.mjs` 可作参照实现。

数据/域设计类文档用此扁平命名（不靠目录层级区分域），已在 `data_` 系列证明、`lint:data-design` 已校：

- **`kind`** ∈ `data`（数据架构）· `design`（域设计）· `ops`（域运维，若长期无实例可从集合移除）·
  `product`（产品级说明/矩阵，**允许省略 `domain` 段**——写作 `product_{NNN}_{slug}`，因其域即产品自身；
  2026-07-22 采纳 karda 回函 D1，`product_100_matrix.md`/`product_240_repo-template.md` 等既有 11 篇
  零改名即合法）
- **`domain`** = 域码表（§5）的 canonical 词（`product` kind 除外，见上）
- **`NNN`** 百位分段：**`1xx` 架构 / `2xx` 细化(schema) / `3xx` 实施**；**段内十位跳**（`200/210/220…`）
- 例：`data_platform_100_architecture.md` · `data_commerce_210_billing.md` · `data_platform_310_cutover-runbook.md` · `product_240_repo-template.md`

---

## 4. 类型寄存器（append-only，稳定 ID，永不重排）

| 前缀      | 含义     | 位置                                            | 规则                                                                                                                                                  |
| --------- | -------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADR-NNN` | 架构决策 | `30-design/decisions/`                          | 合并散落两处后**保留既有号**（`001-005`+`011`/`012`，`006-010` 天然空位保留）；新增追加、可跳号                                                       |
| `TD-NNN`  | 技术债   | `60-operations/10-tech-debt.md`（技术债登记表） | 从 `001` 递增、永不复用                                                                                                                               |
| `RUN-*`   | runbook  | `60-operations/`                                | 文件名 `NN-run-{slug}.md`（校准到实际落地形态，2026-07-22 采纳 karda 回函 F1；§7 护栏按此形态放行，`run-{domain}-{slug}.md` 无 `NN-` 前缀过不了硬门） |

---

## 5. 域码表（canonical domain slugs）

用域**全词**（非生僻缩写），与 `@vxture/*` 包域、DDL schema 对齐：

`platform` · `identity` · `commerce` · `metering` · `billing` · `provisioning` · `promotion` ·
`sharing` · `model` · `notification` · `support` · `safety` · `product` · `admin` · `varda` · `arda` ·
`karda`

新增域先入本表再用。本表只登记「platform 仓内部仍需引用/托管该域文档」的域——产品仓已独立
后若该域文档整体搬空，本表词条可保留（不追溯撤销既有引用），但**不代表该产品仓内部也要用此
编码**（见 §3 作用域）。

> 表中 `product` 是**元词**（kind，见 §3），与 identity/commerce 等真域并列略有混编，但语义已
> 由 §3 的 `product` kind 说明段界定（产品级文档省略 domain 段的触发词），不再单独处理。

---

## 6. 产品编号（层级编码）

产品目录（`20-specs/` 下、及任何按产品组织处）用**层级编码号**——**首位数字 = 层**，一眼看出层级、排序即层序，十位跳留空。权威产品矩阵 = `30-design/product/*_matrix`（product_100）。

| 号    | 产品     | 层      | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `000` | platform | L0      | Vxture 平台本身（租户/商业/协议底座）                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `001` | varda    | L0 内嵌 | 平台内嵌副驾；**只服务 platform，与其它产品无关**                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `110` | atlas    | L1      | 模型平台                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `120` | ontos    | L1      | 语义平台                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `130` | runos    | L1      | 技能平台                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `210` | arda     | L2      | 结构化数据平台                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `220` | karda    | L2      | 知识平台                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `230` | terra    | L2      | 时空平台                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `310` | raven    | L3      | 行业 agent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `320` | anlan    | L3      | 行业 agent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `330` | forge    | L3      | 行业 agent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `340` | xuanzhen | L3      | 行业 agent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `910` | ruyin    | 层外    | client 端（desktop）                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `920` | umbra    | 层外    | 外部边界 VPN（ruyin.ai）                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `930` | hermes   | 层外    | internal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `940` | vxtpl    | 层外    | 仓库模板演示实例（原 `vxture-template`，名称已归一化为 `vxtpl`）。~~非产品矩阵成员~~ **2026-08-13 起口径变更**：owner 裁定 vxtpl 与 `agent-template` 是同一个业务（开发样本 / 测试智能体），**归 L3、已进产品分配登记表，并已完全产品化进 `product.products`**；但**文档号段仍留在 `940` 层外**，不占产品层号段——「进产品矩阵」与「文档号段归属」是两件事，此处只管后者。2026-07-22 采纳 karda 回函 D3：`220` 此前被 `20-specs/220-vxtpl/` 误占（`220` 已属 karda），现迁至本号并归还 `220` |

- **内嵌专用 agent 不单独编号**（除平台级 `varda=001`）：L1/L2 的"内嵌 agent" = 产品的 agentic 表面，产品号已涵盖；L3 本就是独立 agent 产品。
- **每产品保留 `NN1–NN9` 空位**：将来某产品真长出独立子件（如 varda 之于 platform），届时取 `产品号+1`；不预分空号。
- 产品定义待建者**不预建空目录**——有实际 specs 才建 `20-specs/<号>-<产品>/`。

---

## 7. 强制（`lint:docs-numbering`）

**作用域**：本节校验形态是 platform 仓内部实现，`{kind}_{domain}_{NNN}_` 一支仅适用于本仓
（见 §3 作用域条款）；产品仓依 §3 授权在仓内自定编号惯例并自建机检，不套用本节正则。

`scripts/guardrails/check-docs-numbering.mjs` 扫 `docs/` 下每个 `.md` 与每一级子目录：

- **文件**：非 `00-index.md`、非白名单（`README.md`，仅限 docs 根一级，见 §2）、且既不匹配
  `NN(N)-slug.md` / `{prefix}(_{domain})?_{NNN}_slug.md`（覆盖 `{kind}_{domain}_{NNN}_` 及
  `product_{NNN}_` 等省略 domain 段的 `product` kind，见 §3 D1）/ `ADR-NNN*`·`TD-NNN*` 者 → 报错。
- **子目录**（2026-07-22 起，采纳 karda 回函 D2）：非顶层十进制分段目录、非产品层级编码目录
  （§6）、非 `NN(N)-name/` 序列子目录、且不在具名例外表 `DIR_EXEMPTIONS` 内者 → 报错（= 未分类
  的子目录，须编号或登记进例外表，见 §2）。
- 均 = 未编号/未分类 = 临时或待处理，须编号、登记例外或删除。

- **硬门（现行）**：`lint:docs-numbering --strict` 已接入 CI `quality-gate`（始终跑，含 docs-only），
  任何未编号 `.md`/未分类子目录即 fail 拦合并——把元规则"无编号=待删"变成铁律。新增 `.md`/子目录
  必须编号、登记例外或删除。

---

## 8. 迁移（分批，每批一 PR，含内链/linter/memory 路径修复）

1. **批 1**：固化本权威 + 护栏脚本（report 模式）+ 更新 `repo-governance-standard.md` §10。✅
2. **批 2**：建 `00–90` 顶层目录骨架，迁移到位，`00-index.md` 就位。✅
3. **批 3a**：简单目录文件加 `NN-` 编号；护栏认 `{prefix}_{NNN}` 已编号。✅
4. **批 3b**：`30-design` 域子目录（identity/commerce/…）+ 文件编号；`20-specs` 产品层级编号（§6）；子目录编号；`platform-alerts-cron-runbook`→`60-operations`；temp 输入稿清理。
5. **批 4**：ADR 统一 `ADR-NNN`（001-005 加前缀保号、11/12→011/012，`30-design/decisions/`）；`lint:docs-numbering --strict` 接 CI 硬门。✅ **迁移完成，214 docs 全编号。**
6. **批 5**（2026-07-22，采纳 karda 回函 `80-liaison/10-2607221756-karda-taxonomy-findings.md` D1–D4）：
   kind 集合扩 `product`（§3，零文件改名）；护栏补子目录检查 + 具名例外表（§2/§7）；
   `20-specs/220-vxtpl/` → `940-vxtpl/`，归还 `220` 给 karda（§6）；§3 补产品仓固化约定+机检+回报义务（D4）；
   顺带校准 §4 寄存器命名/路径、§0.1 仅约束 `.md`、§1 `95-readme` 回收条件、§2 `30-design/architecture/`
   历史遗留豁免（F1/F4/F5/F7/F8，均文本校准，无文件改动）。✅
