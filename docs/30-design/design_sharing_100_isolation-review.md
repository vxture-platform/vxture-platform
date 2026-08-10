# 共享与隔离模型（v0.2）吸纳评审：深度分析 · 采纳裁定 · 设计结果

> ✅ **后记（2026-07-06 当日）：owner 已全部拍板，评审结论已落实。** 拍板结果：§8 待拍板 9 项全决（产品名称终版采纳；ruyin.ai 对接方=umbra 保持现状订阅、Ruyin 重定义为 client 端产品；SoT=控制面 sharing 域；P 级=行业公开数据+三方公开服务、来源审计强化；上游文档不再提供、由仓内重构取代；业务面模板更新；superseded 走"标记删除"）。落实产物（同日体系化为**产品架构族 `product_{NNN}`**，族路由见 product_100 头部）：[`product_110_sharing-isolation.md`](./product_110_sharing-isolation.md) **v1.0**、[`product_100_matrix.md`](./product_100_matrix.md) v1.0、[`product_200_integration.md`](./product_200_integration.md) v1.0、[`product_300_naming-migration.md`](./product_300_naming-migration.md)（定名迁移规划，ruyin→umbra 本次不实施）、`docs/ADR-12-sharing-grant-design.md`，及 data_platform_100/300、glossary、tenant.md、product-oidc-subscription、005、model-platform、ruyin-contract、control-plane 的对齐更新。本文为**过程留档**（不进编号体系），不再更新。
>
> 版本：v1 · 日期：2026-07-06 · 状态：~~评审稿（待 owner 拍板后落实）~~ → **已拍板落实，过程留档**
> 评审对象：`docs/sharing-isolation-model.md` v0.2（owner 输入稿，untracked）
> 对账基准：`data_platform_100_architecture.md`（数据架构顶层权威）+ `ADR-11`（订阅/权益决策）+ `control-plane.md`（双平面概念）+ 现行 seed/schema
> 结论性质：分析与建议；所有"拍板"级事项汇总于 §8，不代替 owner 决策

---

## 0. 总评（一段话）

v0.2 是一份**质量很高的顶层产品架构稿**：它给平台补上了此前完全缺位的一层——L0–L3 产品分层、L2 域平台统一原型（P-T-A + 托管水位线）、SharingGrant 共享策略。其核心公理（能力同构 / 数据异构 / 共享是策略非结构 / 供给直连）与本仓已实施的底座**高度同源**：entitlement 粒度（workspace × product，state × tier 双轴）就是 ADR-11 的原文；"Atlas 唯一模型宿主 + 计量口径唯一"就是本仓"consume 唯一写入方 + Model Platform 只读 gate"铁律的产品化表述；org 硬隔离 + agent-db 一产品一套按 WS 隔离与双平面架构一致。**建议整体采纳为平台产品架构权威**，但有 4 处与仓内现状的实质冲突需裁定（产品目录命名重排、Ruyin 订阅处置、业务面模板 workspace 化、旧租户文档作废）、5 处模型自身缺口需在 v0.3 修补（策略 SoT 落位、P 级供给两形态、Runos eval 运行时口子、grant 语义精确化、级联撤销一等化）。

---

## 1. 文档地位与上游缺失（吸纳硬规）

### 1.1 该稿在文档体系中的位置

现有体系自上而下是：`control-plane.md`（双平面技术架构）→ `data_platform_100`（数据架构权威）→ `data_*_200`（字段级）。**缺一层"平台是什么产品组合、产品之间什么关系"的产品架构层**——v0.2 正好补这一层，位于 control-plane 之上、作为各产品定义（`docs/20-specs/`）与各域数据设计的共同上游。

```
[产品架构层]  sharing-isolation-model（本稿转正后）＋ product-matrix（上游，待入仓）
      ↓ 约束
[技术架构层]  control-plane.md（双平面）· identity-access-topology · 应用接入标准
      ↓ 约束
[数据架构层]  data_platform_100 → data_{domain}_200 → 300 迁移
```

### 1.2 ⚠️ 上游文档不在仓（阻塞项）

稿件引用 `product-matrix.md v1.1`、`ADR-entitlement-and-workspace.md v2` 为上游，且 §13 多处"沿用上游既定"——**两份文档在本仓均不存在**。L1 层的成员构成（Atlas/Ontos/Runos 谁在 L1）全稿未定义，只能靠上游文档解释。按吸纳留档对账硬规（inputs 先入仓、对账清单、对账完前不删原稿）：

1. **请 owner 提供两份上游文档**，与 v0.2 原稿一并 commit 进 `docs/30-design/inputs/`；
2. 本评审即对账清单的分析部分；实体级对账（上游 vs 仓内 catalog/entitlement 逐项）在上游入仓后补做；
3. 上游未入仓前，本稿内"沿用上游既定"各条按仓内 ADR-11/data_platform_100 校验（本评审已做，见 §3）。

---

## 2. 与现状的一致面（直接确认，无需改动）

| v0.2 主张                                                 | 仓内对应                                                                                        | 判定                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| entitlement 粒度 workspace × product（state × tier 双轴） | ADR-11 §11.0：state 在 Subscription 层、tier 在 plan_component 层；commerce 已 workspace 化实施 | ✅ 完全一致                                     |
| org(tenant) → 多 workspace，两级 Membership               | identity 四层稳定模型（User→Tenant→Workspace→两级 Membership），已建库                          | ✅ 一致                                         |
| org 是绝对隔离边界、数据键携带 org_id                     | 双平面铁律 + workspace_id 权威隔离键（data_platform_100 §16）                                   | ✅ 一致                                         |
| Atlas 唯一模型宿主、计量口径唯一、推理量必过 Atlas        | "用量唯一写入方 = commerce consume 服务"铁律 + Model Platform 只读配额 gate + 唯一 LLM 出口     | ✅ 同构，Atlas 即现 Model Platform 的终态产品名 |
| agent-db 一产品一套                                       | 业务面 `vxturebiz_{product}_{env}` 一产品一对库                                                 | ✅ 一致（隔离键见 §4.3）                        |
| 权益实时派生、不入 token；应用间不塞 token                | identity-platform-decisions §"只装填本 client 的 entitlement" + entitlement_current 短 TTL 缓存 | ✅ 一致                                         |
| L0 vxture 不作 product code                               | 现行 catalog 平台位无 product code                                                              | ✅ 一致                                         |
| L0 共享沙箱 / 向量基础设施                                | `deployment/06-subdomain-dns.md` 已预留 `sandbox`/`vector` 子域                                 | ✅ 有预留位，无实现（绿地）                     |

**双平面铁律与 Karda 全量托管不冲突（重要澄清）**：初看"RAG/向量在外部业务面、平台不碰"（data*platform_100 §1.7/§16）与"Karda 全量托管向量/图谱索引"矛盾——实际不然。Karda 是 L2 **产品**，其索引态资产落在 **Karda 自己的业务面基础设施**（vxturebiz_karda*\* + 向量引擎），不进平台控制面库。控制面继续只持 org/WS/entitlement/grant 策略。真正的新增物是**业务面内部的跨产品关系**（见 §4.1）。

---

## 3. 逐项深度分析与采纳裁定

裁定用语：**采纳**（照收）/ **采纳+修补**（方向收、v0.3 补缺口）/ **待拍板**（owner 决）。

### 3.1 两平面模型：硬隔离 + 软共享（§3）——采纳

org 硬边界"无此路径"而非"权限不允许"、唯一跨 org 形态为 P 级资产、共享不产生副本、撤销即时无残留——对齐 Snowflake Secure Data Sharing / Unity Catalog，且与本仓"权益派生不落副本"的哲学同构。**采纳为平台铁律**，建议吸入 data_platform_100 §2.2.3 铁律表（新增一条："org 为绝对隔离边界；跨 tenant 数据形态唯 P 级平台资产；org 内共享靠策略不靠复制"）。

### 3.2 L2 统一原型 P-T-A + 托管水位线（§4）——采纳+修补

三个 L2 收敛为同一模式的参数化实例、唯一变量为托管水位线（由数据结构收敛度客观决定）——这是全稿最有价值的抽象，避免了三个 L2 各自发明一套资产/授权模型。**采纳为产品设计公理**。

两处修补：

1. **"唯一变量"轻微过度收敛**：Terra 的"孪生实例运行态由 Terra 托管"（§5.2）实际是第二个变量——**计算/运行时托管**，与数据托管水位线正交。Karda（索引即运行时）与 Terra（孪生运行态）都有运行时托管，Arda 没有。建议 v0.3 在 §4.3 表中补一行"运行时托管"维度，不影响公理主体。
2. **P 级资产供给形态需二分**（详见 §3.4 Terra 合规）：自有资产（asset：平台拥有、版本化、entitlement 售卖）vs **代理持牌服务**（brokered service：地图瓦片/影像等由持牌服务商供给，平台卖的是接入而非数据再分发）。§4.2 现文只覆盖前者；Terra 的地图/遥感在中国监管下大概率走后者。

### 3.3 Karda：知识能力域 + 全量知识资产托管（§5.1）——采纳+修补

全量托管是三个水位线中最激进的一档，但论证成立：知识加工后的表示统一（分块/向量/图谱/索引），检索能力无法脱离索引运行，"所有权与托管分离"+"知识流动由属主发起"+"跨库统一检索=可见范围并集"三条把 Glean 式体验和租户主权同时保住了。删除独立"回流"机制（沉淀直接写自有库再 grant）是正确的简化。

修补/强调：

1. **级联撤销必须 day-one 建模，不是事后补**（稿件风险#2 提到但低估了）。Karda 库绑定 Arda DataSource 加工而来 → 数据侧 grant 撤销必须使派生索引同步不可召回。这要求 **ingestion 时点就记录派生边**（kb ← datasource ← 授权依据），撤销事件到达后按派生边重算可见性（re-scope，非 re-index）。若 lineage 是后补的，已建索引无派生记录，级联撤销无从执行。应写入 Karda 产品定义的硬约束。
2. **org 级物理命名空间的成本曲线**：风险#4 的应对（org 级独立 collection/namespace）方向对，但海量小 org × 少量数据会产生 collection 蔓延（内存/句柄开销随 org 数线性涨）。建议表述改为"org 级**逻辑上强制、物理上分档**"：大 org 独立 collection，小 org 可共享物理 collection + 强制 org_id 过滤（引擎级 RLS/payload 过滤），阈值运营可调；例外条款（silo-on-demand）继续保留给合规客户。
3. 跨库统一检索的扇出成本：可见范围并集（自有 ∪ 被授权 ∪ org ∪ 订阅 P 库）联合检索+统一重排是昂贵操作，物化可见集（风险#1 应对）同时服务于此，实现时两者合并设计。

### 3.4 Terra（§5.2）——定位采纳，合规风险升级提示

定位（横向能力底座 + 标准化底座托管 + 业务数据留 agent-db）采纳。但 **P 级资产合规在中国语境远超"元数据字段"**：地图/遥感影像涉《测绘法》/审图号/甲级测绘资质/地理信息保密处理，平台自持并跨 tenant 再分发底图基本不可行，现实路径是接入持牌服务商（高德/天地图等）做**服务代理**。这直接支撑 §3.2 的"P 级供给形态二分"：Terra 的地图 P 级资产按 brokered service 建模（entitlement 售卖接入额度，许可元数据指向服务商条款），自产白膜/客户授权数据才按 asset 建模。**建议 v0.3 修订 §4.2/§5.2**，并列入 Terra 产品定义前置约束。

### 3.5 Arda（§5.3–5.4）——采纳；命名冲突待拍板

"agent-db 是 SoR、Arda 是 SoA"、目录四元组 (org, ws, product, datasource)、"连接=Arda、理解=Karda"、管线属主拉动——采纳，边界干净。Karda 对 Arda 的实现层依赖不上升为矩阵结构概念，正确。

**冲突**：现行 `product-oidc-subscription.md` 把 `arda` 定义为"平台门户/内部 shell、无订阅"；live seed 中数据平台占位 product_code 是 `data`。新稿把 Arda 重定义为可售 L2 产品。处置建议见 §5 目录映射（"arda=门户"语义作废，门户就是 website/console/admin 平台位，不占 product code；`data` 占位改名 `arda`）。**此即产品命名定型待决项（runbook §18.2#5）的答案**——v0.2 事实上完成了定名，owner 确认映射表即可销号。

### 3.6 Runos：技能与专用模型资产平台（§6）——采纳+修补一处口子

纯控制面、不在任何调用链路、非 API 网关/模型平台/工作流引擎、Rule of Two 准入、构件分布式就位（声明部分进 agent 运行时 / 工具引用直连 / 小模型推理在 Atlas / 重计算在 L0 沙箱）——**全部采纳**。这套设计精确规避了 ESB 反模式，与 MCP + Skills 生态对齐，且"Runos 无推理与执行负载 → SaaS 成本极轻"的推论成立。

**一处口子**：§6.3#1 把"评测基线（eval）"列为 Runos 职责，但 eval **执行**需要运行时（跑评测要调模型、跑工具）。若不澄清，"无运行时"会被 eval 撕开。建议 v0.3 补一句：**eval 的执行按构件就位模型走（推理在 Atlas、执行在 L0 沙箱），Runos 只持有 eval 定义与结果记录**——与 §6.6 自洽。

### 3.7 供给唯一直连 + L0 工具协议（§7）——采纳；指出最大工程缺口

"L2 供给通道唯一为直连、Runos 位于消费侧、协议统一≠物理网关"的必要性分析（双接口面/双重求值/产品完整性受损）成立，采纳。

**最大工程缺口 = 身份透传**。"技能运行时对 L2 的每次调用以调用方 agent 身份走直连"，要求 L2 入口能拿到可信的 (org, ws, product, user?) 调用方身份并做 grant ∧ entitlement 求值。现有身份体系只覆盖**用户级 OIDC RP 登录**（identity-app-integration-standard），服务间只有"经服务间 API、不塞 token"的原则声明，**无 S2S 凭证/token 交换（RFC 8693 on-behalf-of）设计**。L0 工具协议规范（§7.1 已固化归 L0）必须包含：工具 schema 约定、**S2S 鉴权与调用方身份透传**、grant∧entitlement 求值时点、审计与计量归属。这是采纳后第一个要开的新设计线（见 §7 计划）。

### 3.8 SharingGrant（§8）——采纳+四处精确化

最小策略模型（resource/grantee/scope/status）、默认拒绝、grantee 双维度对齐 entitlement 双轴、召回层强制权限不做生成后裁剪、P 级不走 grant、WS 发起 + org 审计回收——采纳。四处精确化（v0.3 编辑项，无需拍板）：

1. **grantee=product 的谓词要写死**：资源归属 (org, ws, product)，授给 product 应精确定义为"本 org 内、经由该 product 访问的任意 WS 实例"，即可见性谓词 = `(caller.ws = grantee_ws) ∨ (caller.product = grantee_product) ∨ grantee = org_all`，再 ∧ entitlement。不写死会在实现时分叉。
2. **scope 集按资源类型参数化**：read/retrieve/apply 混合了数据域动作（read）与知识域动作（retrieve/apply），技能域实际是 use/装载。建议 scope 值域由 resource_type 决定（数据集：read；知识库：retrieve < apply；技能：use），语义分级保留。
3. **加 `expires_at`（可选）**：行业常规（Databricks sharing 有到期），审计与临时协作都需要；撤销已有 status，到期是另一轴。
4. **管理权模型（§8.3"建议"）直接固化**：WS 发起 + org 全局审计与一键回收，对齐待拍板#2 的倾向，无更优解，建议 v0.3 转"已固化"。

**策略 SoT 落位是稿件隐含未列的待拍板项**（风险#2"单一策略存储或强一致同步"点到即止）。本评审给出设计结果，见 §4.2。

### 3.9 行业对标与边界（§9/§11）——采纳

对标结论中肯；"grant 语义统一横贯数据/知识/技能超出行业常规"这一差异点确实存在，也正是策略 SoT 必须单一的原因（三类资产共用一套 grant，分散存储必然漂移）。§11 负面清单全部采纳（其中"Ruyin 不共享 entitlement 模型"与现状冲突，见 §4.4）。

### 3.10 待拍板 4 项（§12）——本评审意见

| #   | 决策项                  | 稿件倾向                           | 本评审意见                                                                                                                                                     |
| --- | ----------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 图谱实例归属            | Schema 归 Ontos、实例归 Karda      | **同意**。实例量大、随知识域生命周期、需 WS 隔离，三条理由都成立；且与"Ontos 定义 Schema、实例归各 L2"的总图一致                                               |
| 2   | 共享管理权              | WS 发起 + org 审计回收             | **同意**，建议直接固化（见 §3.8#4）                                                                                                                            |
| 3   | Arda/Karda 边界裁定规则 | 归 Karda 产品定义                  | **同意**，可给一条起步判据：按**消费方式**裁定——被检索/引用消费的进 Karda（FAQ 表→知识库），被查询/计算消费的留数据域；同一载体可双注册（DataSource + 绑定库） |
| 4   | Arda P 级通用数据清单   | Arda 产品定义列 v1 清单 + 准入流程 | **同意**，准入判据建议复用 Rule of Two 精神：≥2 个 agent 需要且无租户属性的参考/主数据才进 P 级                                                                |

---

## 4. 与仓内现状的实质冲突（4 项，均需处置）

### 4.1 业务面契约需要扩展（不是推翻）

现行双平面契约只定义了**平台↔业务**流（引用 ID、用量上行、不读平台库）。新模型引入两类**业务面内部的跨产品关系**，现契约无载体：

1. **跨产品数据托管**：L3 agent 的 A 级资产托管进 Karda（Karda 基础设施持有 raven 的知识库）——"一产品的数据只在自己库里"的隐含假设被打破，但归属键 (org, ws, product) 清晰，隔离靠授权逻辑 + 命名空间（稿件 §10#4 两条硬约束）。
2. **跨产品直连调用**：agent（L3 业务面）直连 Karda/Terra/Arda（L2 业务面）服务，带身份透传。

**处置**：data_platform_100 §2.3（业务面边界契约）增补"L2 域平台条款"——L2 产品可按 P-T-A 模型托管其他产品的资产，托管资产的归属键与授权求值义务；产品间调用一律走 L0 工具协议（禁直连对方库）。原有铁律（不读平台库、不持 Key、用量经 consume 上行）对 L2 全部继续适用。

### 4.2 SharingGrant 策略 SoT 落位（设计结果）

**建议：SoT 放平台控制面，新增 `sharing` 域（schema）**，理由：

- 稿件风险#2 要求单一策略存储；grant 横贯数据/知识/技能三类资产、跨 L2 产品，任何单个 L2 都不是自然属主，**org/WS/entitlement 所在的控制面才是**；
- 联合求值 = grant ∧ entitlement，两个操作数同源（控制面）才能一处求值/一处物化/一处失效；
- org 管理员全局审计与一键回收（待拍板#2）天然是平台 Console/Admin 的界面，策略在控制面则审计走现成 `support.audit_log`；
- 完全复用已验证的模式：**entitlement_current 短 TTL 缓存 + invalidate 推送**——grant 可见集照此办理（按 grantee 预展开物化，正是风险#1 的应对）。

表级草图（字段级设计后续入 `data_sharing_200`）：

```
sharing.grants
  id uuid PK / tenant_id FK→tenancy（org 内机制，硬约束）
  resource_type varchar(32)  CHECK (dataset|knowledge_base|skill)
  resource_product_id FK→product.products / resource_workspace_id FK→workspaces
  resource_ref varchar(128)          -- 业务面资产 id，跨面 loose 引用（铁律一边界#1）
  grantee_type varchar(16) CHECK (workspace|product|org_all)
  grantee_workspace_id? / grantee_product_id?（按 type 二选一，CHECK 收敛）
  scope varchar(16)                  -- 值域随 resource_type（§3.8#2）
  status active|revoked / expires_at? / created_by / revoked_at / revoked_by

sharing.visible_set_current            -- 物化可见集（对齐 entitlement_current 模式，非 SoT）
  (grantee 键, resource 键, scope) UPSERT + 短 TTL；grant 变更 → invalidate 推送 L2
```

执行点不变：**求值在各 L2 入口**（召回层强制），控制面提供解析 API + 物化 + invalidate；级联撤销的派生边（lineage）留在 Karda/Arda 业务面，撤销事件由控制面广播、L2 按派生边重算（§3.3#1）。跨面 resource_ref 为 loose 引用，符合铁律一边界#1（真物理库边界），不破 FK 政策。

### 4.3 业务面模板隔离键：tenant_id → workspace_id（存量陈旧，非新冲突）

data_platform_100 §2.3.1 业务库模板（context.app_instance 等）仍以 tenant_id/user_id 为键，而 §16 已确立"平台提供权威 workspace_id 隔离键"、commerce/provisioning 全面 workspace 化。新模型"agent-db 按 WS 隔离"与 §16 一致，**模板是没跟上 workspace 化的陈旧段**。处置：§2.3.1 模板补 workspace_id 键（context.app_instance 增列、业务表隔离键改述），与 §16 对齐；"业务侧不得镜像四层模型"原则不变（只持 workspace_id 引用，不建 workspace 表）。

### 4.4 Ruyin 订阅处置（待拍板）

新稿 §11/§13："Ruyin 不共享 entitlement 模型、不进 entitlement"。但现状：live seed 有 `ruyin` product 行 + `ruyin-free` plan + `ruyin:subscription` OIDC scope，生产在用。两种解读需 owner 裁定：

- **(a) 完全退出**：ruyin 从 product/plan/claim 体系摘除，其商业化完全在 ruyin 侧自理 → 需要清 seed + claim + RP contract 改造（worker-03 侧 OUT，只动本仓侧）；
- **(b) 只是不进新引擎**：保留现有租户级订阅/claim 原样，不参与 workspace × product 权益引擎与 SharingGrant → 文档注明豁免即可，代码不动。

倾向 **(b)**（起步最小化：不为边界产品做拆除工程；且 ruyin 跨域 RP 契约已上生产）。同时 Karda 知识库能力默认不对 Ruyin 开放、仅 Atlas/Runos 层互通（§11）照录进 ruyin contract。

### 4.5 旧租户文档撕裂（顺带清理，非本稿引入）

`tenant.md`（单层租户模型）、`decisions/005-plg-tenant-model.md`、`glossary.md` 的 CallerContext（只有 tenantId 无 workspaceId）先于 workspace 化，会误导实现。处置：tenant.md 标 superseded 指向 data_identity_200、005 加后记指向 ADR-11、glossary 补 workspace/层级词条 + **Atlas 消歧**（产品 Atlas ≠ 迁移工具 ariga/atlas，data_platform_320 用到后者）。

---

## 5. 产品目录映射（设计结果，销 runbook §18.2#5 的答案）

v0.2 事实上完成了产品定名。建议映射表（owner 确认后回填 §18.2#5 + product-oidc-subscription 校订 + seed 改名）：

| 层                             | 产品                             | product_code            | 现状 → 动作                                                                                         |
| ------------------------------ | -------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| L0                             | vxture 平台                      | 无（不作 product code） | 门户 = website/console/admin，**"arda=平台 shell"旧表述作废**                                       |
| 平台能力（L1，待上游确认层名） | Atlas 模型平台                   | `atlas`                 | 现 Model Platform 的终态产品名（model-platform.md 已声明现名非终态）；seed 已有 atlas OIDC client ✔ |
| 〃                             | Ontos 语义平台                   | `ontos`                 | seed 已有 client ✔；产品定义空白，待建                                                              |
| 〃                             | Runos 技能平台                   | `runos`                 | seed 已有 product+client；**定位改写**（原"多模态助手 agent"文案作废 → 技能与专用模型资产平台）     |
| L2                             | Arda 数据平台                    | `arda`                  | seed 占位 `data` → 改名 `arda`（type=data_platform 已对）                                           |
| L2                             | Karda 知识平台                   | `karda`                 | 全新；候选名 `nocus`（seed 有 client）/`vault`/`cortex`（design 稿）→ 处置：改名或退役              |
| L2                             | Terra 时空平台                   | `terra`                 | 全新                                                                                                |
| L3                             | raven / anlan / forge / xuanzhen | 同名                    | seed 已有 client 预留 ✔；架构设计空白（后续按 agent-db 模板 + 接入标准建）                          |
| 独立                           | Ruyin                            | `ruyin`                 | 处置见 §4.4                                                                                         |
| internal                       | Hermes                           | `hermes`                | 不变                                                                                                |

配套 schema 小项：`products` 表建议加 **`layer` 显式列**（varchar(8) CHECK l0|l1|l2|l3，或并入 product_type 值域约定）——分层是产品矩阵既定能力（铁律四：schema 完整优先），有 layer 轴后 Console/Admin 的产品目录、entitlement UI、文档才有统一锚点。待拍板（§8#5）。

---

## 6. v0.3 修订清单（回给 owner 的稿件修改建议）

编辑级（无需拍板）：

1. §4.3 托管水位线表补"运行时托管"维度（§3.2#1）；
2. §4.2 P 级供给形态二分：自有资产 vs 代理持牌服务（§3.2#2/§3.4）；
3. §5.1 级联撤销升级为 day-one 硬约束：ingestion 记派生边、撤销按边重算（§3.3#1）；
4. §10#4 命名空间隔离改"逻辑强制、物理分档"（§3.3#2）；
5. §6.3 补 eval 执行位置（推理在 Atlas、执行在 L0 沙箱，Runos 只存定义与结果）（§3.6）；
6. §8.1 grant 加可选 `expires_at`；grantee=product 谓词写死；scope 按 resource_type 参数化（§3.8）；
7. §8.3 管理权由"建议"转"已固化"（合并待拍板#2）；
8. 上游引用改指入仓后的 inputs 路径；L1 成员构成补一句明示。

---

## 7. 设计文档体系更新计划（分阶段）

**P0 吸纳与转正**（本轮）

1. 上游 `product-matrix.md` + `ADR-entitlement-and-workspace.md` 由 owner 提供，与 v0.2 原稿一并 commit 进 `docs/30-design/inputs/`（吸纳硬规，阻塞项）；
2. §8 拍板批处理 → owner 出 v0.3（含 §6 修订）→ 转正为 `docs/30-design/platform-sharing-isolation.md`（产品架构层权威，与 control-plane.md 同级互引）。

**P1 顶层对齐** 3. `data_platform_100`：§1#1 产品矩阵表述按 §5 映射回填；§2.2.3 铁律表增 org 硬隔离/共享不复制条；§2.3 业务面契约增 L2 域平台条款 + 模板 workspace 化（§4.1/§4.3）；§3.1 全景登记 `sharing` 新域；4. 销 `data_platform_300` §18.2#5 + §7.10#1（命名定型回填）；`product-oidc-subscription.md` 全面校订（tenant×app → workspace×product、catalog 重排、ruyin 裁定落文）或标 superseded 重写；5. 清旧撕裂：tenant.md / decisions-005 / glossary（§4.5）。

**P2 新设计线（依赖 P0 拍板）** 6. `data_sharing_100/200`：SharingGrant 域数据设计（按 §4.2 草图展开字段级；命名遵循 data*{domain}*{NNN} 前缀规则）；7. **L0 工具协议规范**（`docs/10-standards/` 或 design/）：工具 schema、S2S 鉴权与身份透传（token exchange）、grant∧entitlement 求值时点、审计计量归属——扩展而非替代 identity-app-integration-standard（§3.7）；8. **Karda 产品定义**（稿件明示本模型是其前置输入）：含待拍板#3 裁定规则、#4 之 Karda 侧、级联撤销硬约束、命名空间分档。

**P3 逐产品展开**（按业务节奏）9. Terra / Arda / Ontos / Runos 产品定义；L3 应用架构模板（agent-db + 接入标准 + 工具协议消费方指南）。

**明确不做**（对齐负面清单与起步最小化）：不建中心网关/ESB；不在平台控制面建向量/索引表；L0 共享沙箱本轮只留文档占位不实施；umbra 不进模型。

---

## 8. 汇总待拍板清单（owner）

| #   | 决策项                                                                                                          | 本评审建议                                     | 来源             |
| --- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------- |
| 1   | 图谱实例归属                                                                                                    | Schema 归 Ontos、实例归 Karda（同意稿件倾向）  | 稿件 §12#1       |
| 2   | 共享管理权                                                                                                      | WS 发起 + org 审计回收，直接固化               | 稿件 §12#2       |
| 3   | Arda/Karda 边界裁定规则                                                                                         | 归 Karda 产品定义；起步判据=按消费方式裁定     | 稿件 §12#3       |
| 4   | Arda P 级数据清单                                                                                               | Arda 产品定义列 v1 清单；准入=Rule of Two 精神 | 稿件 §12#4       |
| 5   | **产品目录映射定名**（§5 表，含 data→arda 改名、nocus/vault/cortex 处置、"arda=门户"作废、products.layer 加列） | 按 §5 表确认；销 runbook §18.2#5               | 本评审           |
| 6   | **Ruyin 订阅处置**：完全退出 vs 仅豁免新引擎                                                                    | 倾向 (b) 仅豁免、代码不动                      | 本评审 §4.4      |
| 7   | **SharingGrant 策略 SoT 落位**                                                                                  | 平台控制面新增 `sharing` 域（§4.2）            | 稿件风险#2 隐含  |
| 8   | **P 级供给形态二分**（asset vs brokered service）                                                               | 采二分；Terra 地图类走 brokered                | 本评审 §3.2/§3.4 |
| 9   | 上游两文档入仓                                                                                                  | owner 提供 → inputs/ 归档（P0 阻塞项）         | 吸纳硬规         |
