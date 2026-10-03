# 产品目录·权益与资源模型(Catalog, Entitlement & Resource Model)(product_220)

> 版本:**v1.0** · 状态:**已定稿并上产**(决策登记见 §10、明确不采纳见 §7;字段级落位摘要见 §8)
> 文档族:产品架构族 `product_{NNN}`,本文 = **220**(细化标准位);族路由见 [`product_100_matrix.md`](./product_100_matrix.md) §0 头部
> 定位:**平台商业目录与权益资源的结构标准**——回答"什么是产品/什么是可售项/什么是资源、五档阶梯与捆绑怎么建模、哪些资源归 L0 共享池、C2 信封长什么样"。所有产品(arda 为首)的计费模型设计与 C2 消费实现以本文为准。
> 上游:ADR-11(权益引擎)、[`product_100_matrix.md`](./product_100_matrix.md)(产品矩阵)、[`product_200_integration.md`](./product_200_integration.md)(三通道契约,本文细化其 C2 响应语义)。
> 下游:[`data_product_200_schema.md`](./data_product_200_schema.md) / [`data_commerce_200_metering.md`](./data_commerce_200_metering.md)(字段级,随实施车按 §8 更新)、各产品计费模型文档(arda = `arda-biz-260`)。
> 说明:"bundled 作为 tier 第六值"的旧消费规则已被 §3 的 `bundled` 布尔正交轴取代（防回退留痕见 [`arda_300`](../20-specs/210-arda/40-arda_300_integration-final.md) §2）。

---

## 0. 三概念分类学:Product / SKU / Resource

口语里都叫"产品",架构上是三样东西,**混淆它们是本域一切歧义的根源**:

| 概念                   | 判据                                                          | 登记处                                                                                                       | 例                                                        |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| **Product(架构产品)**  | 拥有**自己的服务面**:API/Console/入口、独立生命周期、直接用户 | `product_100` 矩阵 + `product.products` 行(随行背负 OIDC client、webhook、provisioning 空间等**产品面义务**) | arda、karda;业界:AWS S3、Google One                       |
| **SKU(可售项)**        | 能出现在**订单/账单**上的商业条目                             | `plans`/`plan_versions`/`plan_prices`;(登记)加油包 = 购买直接生成 pool grant,不经套餐机器                    | "arda-pro 月付"、"存储 +100G 包";业界:Salesforce 存储加购 |
| **Resource(计量维度)** | 被度量、被限额的**消耗/占用维度**                             | 产品级 = `product_metrics`;**L0 级 = `platform_metrics`(§4 新设)**                                           | `dataset.max`、`storage.bytes`、`ai.credit`               |

- **术语碰撞警告**:Stripe Billing 把可售项叫 "Product"——那是计费目录里的 SKU,不是架构产品,勿被带偏;
- **判定测试**:产品性是"**面**"的属性,不是"物"的属性。同样是磁盘字节:AWS 给它建了 API/控制台 → S3 是产品;Salesforce/Snowflake/GitHub 没建 → 存储只是套餐上的资源维度。Google 想把存储直接卖给消费者时,第一件事是包出 Google One 这个产品面——建面即产品,没面即维度;
- **晋升规则**:资源哪天长出自己的服务面 → 按新产品入 `product_100` 矩阵(领 client/webhook);L0 目录里的计量维度**原地不动**,二者并存(AWS:S3 是产品,storage-GB 同时是账单维度)。

## 1. 商业阶梯:五档,且只有五档

```
free < starter < pro < business < enterprise
```

- `tier` 表达**商业订阅级别**,值域即上五档——不承载任何其他语义(供给方式、来源、渠道一概不进 tier);
- tier **只属于 primary 组件**(§2);C2 信封的 `tier` 字段类型 = 五档之一 | `null`(null = 该产品无直购订阅);
- 就高合并:同产品多条直购订阅并存时,C2 返回最高档(ADR-11 §11.3)。

### 1.1 档位原则约定(所有产品统一,arda 为首)

**本节只约定档位阶梯的骨架**——每档卖给谁、走自助还是授权、席位轴怎么走。**各档具体装什么功能、配额给多少,由产品自己的能力矩阵决定**(D12 铁律:档位→功能是产品知识,平台/本文都不给产品定功能清单)。下表"功能/配额"列是**相对形状指引**,不是硬性清单。

**SaaS 自助可订阅面(四档,自助购买/升级,走 console)**:

| 档         | 相对形状(产品自填)  | 席位轴                           |
| ---------- | ------------------- | -------------------------------- |
| `free`     | 入门功能 + 少量配额 | 基础                             |
| `starter`  | 进阶功能 + 中等配额 | 基础                             |
| `pro`      | 完整功能 + 更大配额 | 基础                             |
| `business` | ≈ pro 的功能/配额   | **pro 席位 + 席位包,可叠加扩展** |

- 骨架约束:**`business` 相对 `pro` 的商业价值点主要在席位轴**(席位包叠加,`member.max` 增购,见 §5 席位不池化)——功能/配额是否再给增量由产品定,但 business 的定位是"pro + 更多席位",不是"pro 之上的又一层功能墙";
- free→starter→pro 的功能/配额梯度由产品能力矩阵自定,本文不规定含哪些具体功能。

**私有化 / 非 SaaS 面(一档,授权制,不自助购买)**:

| 档           | 骨架                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enterprise` | 私有化部署;**授权逻辑**(operator_grant 载体,同 beta 授权机制,非自助结账);**席位按合同约定的具体数**(无"无限席位"概念);UI 显示 `ent` / 企业版。功能/配额由产品定 |

- **骨架约束**:enterprise **不进 SaaS 自助售卖面**——升级引导永不指向 enterprise(console 深链止于 business);其权益经**授权**开通(运营授予受限订阅,与 beta 公测同机制、靠 plan 区分,见各产品定义 beta 授权模型);
- 私有化版本内部同样是授权逻辑:部署实例的可用性由授权订阅裁决,不做自助计费。

## 2. 组件 role 轴:primary / bundled(正交于阶梯)

`plan_components.component_role ∈ {primary, bundled}`(取代原 `billing_kind`,详见 §8):

| role      | 语义                                                     | tier                                                           | quota/features                |
| --------- | -------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------- |
| `primary` | 套餐**卖的主体**(plan 的价值主张)                        | 必填,五档之一                                                  | 该档位的权益                  |
| `bundled` | **绑定销售**的支撑件——价值折在主产品定价里,**不是 free** | **NULL**(捆绑件没有商业档位,它的"档位"就是 quota 里的具体数字) | 独立自由配置(存档组合盖章,§6) |

- **配额随主产品档位联动是结构性的**:bundled 组件长在每个 agent plan version 里面——raven-starter 的 arda 捆绑件配 5G、raven-pro 配 20G,各写各的;租户升级 agent 档位 = 换 plan version = 池整体重物化,支撑配额秒级跟随,**无映射表、无同步逻辑、无失同步问题**;
- **配置归属(arda 反馈 D,钉死)**:bundled arda 的配额活在**捆绑该产品的那个 agent plan version**里(如 raven-pro 目录中的 arda 组件),**不在被捆绑产品(arda)自己的 seed**。被捆绑产品**不 seed 自己的 bundled 组件、也不感知谁捆了它**——它只消费 C2 合并结果(`bundled` 布尔 + 池)。谁拥有 agent plan,谁配它的 bundled 支撑件;
- **合并规则**(C2 引擎,跨该产品全部 active/trialing 组件):

| 维度              | 规则                                                 |
| ----------------- | ---------------------------------------------------- |
| `tier`            | 仅 primary 组件就高;无 primary → `null`              |
| `bundled` 布尔    | 存在任一 bundled 组件覆盖 → `true`                   |
| max 型 caps       | **全组件**取数值最大(`-1` = 无限哨兵,胜过一切有限值) |
| union 型          | 全组件并集                                           |
| tiered 型(非数值) | primary 就高档优先;仅 bundled 时取 bundled 值        |
| quota_pools       | 不合并——全组件的池并存,瀑布按 priority 扣减          |

- 直购+捆绑并存示例:workspace 持 arda-free + raven-pro(捆 arda 500 数据集/20G)→ C2 返回 `tier:"free", bundled:true, limits:{"dataset.max":500,"member.max":1}`(max(1,0)=1),池 = free 池 + 捆绑池并存。**两个事实都不丢**——这是布尔方案优于"tier 第六值"方案的决定性一分。

## 3. C2 契约「契约收缩」(产品消费方以此为准;D12,全产品通用契约)

**原则:信封只承载商业事实(买了什么),不承载功能解释(意味着什么)**——档位→功能的映射是产品知识,由各产品在自己仓内以版本化能力矩阵自持;平台不再为任何产品配置功能键。v2 的 `capabilities` 块(`features` 数组、tiered/union 功能键)**整体退役**。本形状为**全产品通用契约**(L1/L2/L3 一律照此接入),非 arda 专属。

```jsonc
GET /platform/entitlements?workspace_id={W}&product={P}
→ {
    workspace_id, product,

    // ── 订阅事实块(单一代表订阅投影,见下) ────────────────────────
    status: "active"|"trialing"|"overdue"|"suspended"|"expired"|"cancelled" | null,  // null=从无订阅(v2 字段名 subscription_status,v3 随块整并改短)
    trial_ends_at: "…" | null,        // trialing 且有排定到期时非空
    current_period_end: "…" | null,   // active 且有界周期时非空(支付面落地后 overdue 同)
    cancel_at_period_end: false,      // 已预约到期不续(active ∧ 有界 ∧ auto_renew=off)
    data_retention_until: "…" | null, // expired 时非空 = 数据至少保留至此(过期+90 天,承诺下限)

    // ── 销售轴(跨全部活跃覆盖合并) ──────────────────────────────
    tier: "pro" | ... | null,         // 纯五档;null = 无活跃直购;primary 就高
    bundled: true | false,            // 是否有绑定销售组件覆盖(独立轴,与 tier 并存)
    limits: { "member.max": 20, "dataset.max": 500, "retention.days": 365, ... },  // 上限型销售数字,见下

    // ── 消耗型配额池(平台记账 SoT,机制零变更) ───────────────────
    quota_pools: [ { metric, limit, remaining, priority }, ... ]   // 含 L0 共享池(§4)
  }
```

**三层语义,合并规则刻意不同(消费方不得混读)**:

1. **订阅事实块 = 单一代表订阅的投影**——`status` 与四个时间戳/布尔**必须来自同一笔订阅**,否则会渲染出 `status:"active"` 配 `trial_ends_at` 的矛盾体。代表订阅 = 状态 precedence 最高者(`@shared` 数组顺序 `active>trialing>overdue>suspended>expired>cancelled`,`suspended` 高于 `expired` 系有意:运营拦停不得被更早的过期行掩盖),平手取周期结束最晚(开放式周期计为最晚)。`data_retention_until` 语义=**承诺下限**("至少保留至该日,之后平台有权清除"),= 代表订阅 expired 时刻 + **90 天**(owner 2026-07-13 裁定;wipe 自动化二期,不影响该字段承诺)。
2. **销售轴 = 跨全部活跃(active/trialing)覆盖合并**:`tier` primary 就高、`bundled` 任一捆绑组件即真、`limits` 就高(-1=无限哨兵)。**叠单不变量(owner 裁定 2026-07-14,arda 回函 07 §3 备案闭环)**:同一产品**不允许并存多笔档位不同的订阅**——升档 = 变更原订阅行,叠单 = 运营误配;`tier` 归合并侧正因该不变量使合并退化(每产品至多一个相异档位),同档并存与"直购+捆绑"共存(ADR-11 §8)仍合法;订阅创建/换版/复活写路径有 guardrail 强制(`SubscriptionService.assertNoTierConflict`)。**`limits` 键规范**:键 = 平台目录 `product_metrics` 中 `merge_strategy='max'` 的 metric_key(`{entity}.max` / `retention.days` 命名惯例);L0 `platform_metrics`(池指标)与 union/tiered 策略键**永不出现在 limits**(后者属功能语义,不出平台)。
3. **配额池 = 独立账本**,瀑布/幂等/失效语义零变更。

- **无覆盖回落**:`status: null` + `tier: null, bundled: false, limits: {}` + 空池(从无订阅);
- **消费方门控公式**(canonical 单式,一行判完,不得自定义放宽):产品 UI 门控 = `tier != null`;后端/agent 数据取用门控 = `tier != null || bundled`;**等价性(平台线确认,§6#6)**:代表订阅规则下 `tier != null` 定义等价于 `status ∈ {active,trialing,overdue}`(有可售档位 ⟺ 处于活跃/试用/宽限)——两式同真,消费方只实现 `tier != null` 一式,不各自展开 status 集合;
- **演进容错通则(双方义务)**:产品必须容忍信封**新增字段**与 `status` **新枚举值**(未知即降级隐藏/保守渲染)——决策位/资格位永不入信封(能不能试用、该买什么=console 深链的事),描述性事实按"产品无需理解平台策略即可逐字渲染"判据准入;
- **`status` = 订阅状态轴**(正交于 `tier` 能力轴与 `bundled` 来源轴):`tier != null` 只说"现在能干什么",不区分"从未订阅 vs 曾订已过期"——后者是"订阅 vs 续订"两种 CTA 的分岔。取值 = 该产品**直购(primary)订阅**的**真实状态**(代表选取见上),或 **`null` = 从无直购订阅**。**"无订阅"由 `null`(字段为空)表达,不是状态值**(订阅视角:没订阅就没有"这条订阅",何来状态);**捆绑覆盖不产生直购**,故"捆绑但无直购"= `status: null` + `bundled: true`(见 §2 示例);状态归 C2(权益不入 token 铁律使然),不从 access_token claim 读;
  - **值域权威 = `@vxture/shared` 的 `SUBSCRIPTION_STATUSES`**(= DB `metering.subscriptions.status` = 六个真实状态 `active/trialing/overdue/suspended/expired/cancelled`;owner 2026-07-13 裁定扩入 `overdue` = 欠费宽限——扣款失败、催缴中、**权益保留**,与 `expired`(权益已停)、`suspended`(运营拦停)语义正交;命名取单词格式统一,不用 `past_due`;**支付面落地前平台不产出该值**,预留系防契约再动;进入=扣款失败,退出=补款→`active` / 宽限到期→`expired`,宽限时长=支付面参数)。**不折叠、不改名、无 `none` 假状态**——"从没订过"用 `null` 表达;要不要对外简化展示是产品/引擎自己的事,不回写值域。**所有产品(含 arda)照此值域写;不符 = 产品改自己对齐 `@shared`,`@shared` 不派生别名去迁就**。字段名:v2 曾定 `subscription_status`(不叫 state),v3 随订阅事实块整并改短为 **`status`**(块内语境自明,时间戳字段同块同源);
  - **试用离开 = `null`,不 = `expired`(owner 裁定 2026-07-12,采纳 arda 回函 02 §1.3 主张)**:`expired` **专表"付费订阅被动失效"**(催缴/续回 UX);从没付过钱的试用结束(到期未转正,及试用中取消)呈现为 **`null`**——不污染付费流失口径,再获取文案由 `had_trial` 历史属性驱动。**实现 = C2 代表选取规则,不动值域**:DB 照写真实状态(trial 到期 → `status='expired'`,值域五值不变、无 `none`),C2 代表状态查询**排除 `subscription_kind='trial'` 且 `status ∈ {expired,cancelled}` 的行**,该产品无其余 primary 行时自然回落 `null`;同 WS 并存的已失效**付费**订阅照常呈现 `expired`(两口径互不吞)。**配套不变量**:试用转正必须**新建 `kind='paid'` 行**(或原行翻转 `subscription_kind`)——否则转正后再流失会被误判回 `null`;`suspended` 的试用行不在排除集(冻结照常拦停,不得借 null 洗白)。
- **L0 共享资源在每个产品视图中都出现,但余量口径按 `kind` 分**(§4.3/§4.4,取代早期"所有产品同值"的说法):**`storage.bytes`**(gauge,WS 级)→ 余量 = ws 存储总账,arda/karda 看到**同一个**(workspace 统一,§4.4);**`ai.credit`**(counter,reserved/shared)→ 余量**逐产品按租户策略、可不同**(自留 +(若参与)可及共享,§4.3),**非单一钱包**;数据同源,展示/准入按各自产品逻辑;
- 缓存/失效/409 语义不变(product_200 §3/§4);**通信一套**:共享资源与生命周期轴均**不引入任何新端点或新信封**。

## 4. L0 平台资源目录(`platform_metrics`)

**定义**:L0 拥有的计量维度注册表——**单一定义点**。跨产品共享的资源在此定义**一处且只有一处**;产品套餐组件只**贡献**额度(quota jsonb 写数字),不得在自己的 `product_metrics` 里重复定义共享键(键的归属目录决定池的作用域)。

### 4.1 目录清单(owner 2026-07-08 裁定)

| metric_key                       | kind    | consume_mode                  | 周期     | 状态                                                                                  |
| -------------------------------- | ------- | ----------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `storage.bytes`                  | gauge   | —(准入制,产品侧 admission,D5) | 无(水位) | ✅ v1 生效(自 arda 目录升格;**归属=WS 级,§4.4**;limit 过渡态 Σ 产品贡献→目标态 ws 池) |
| `ai.credit`                      | counter | atomic(预扣)                  | 月池     | ✅ v1 生效(**原 `varda.credit` 升格改名**——AI 成本载体在平台推理层,不属任何单一产品)  |
| `compute.gpu` / `compute.cpu`    | counter | 待定                          | 待定     | 🟡 **登记待落**——随 L0 共享沙箱 / Atlas 训练面落地;单一计量入口就位前**不开池**       |
| `egress.bytes` / `ingress.bytes` | —       | —                             | —        | ⬜ **扩展位,仅预留键名**(owner:产品体系暂未考虑;arda egress 计费 phase 3 时再裁)      |

### 4.2 共享池语义

- **判据**(资源该不该进 L0):成本载体在平台级基础设施(磁盘/GPU/带宽)→ L0;成本是某产品自己的服务容量(arda 的一次 API 调用)→ 留产品级;
- **不变量:机制类由成本类决定**(arda 反馈 B,钉死防口子)——**真金白银**的共享资源(`ai.credit`、`compute.gpu/cpu`)**必须 counter + atomic 预扣**(消耗前扣、扣不动即拒),**永不用 gauge + 准入**;**gauge + 产品侧准入仅用于"超冲=短时可自愈成本"**(`storage.bytes` = 磁盘占用,自愈路径 = 下次快照如实记水位 + 余量转负关闸 + 删除始终放行)。**跨产品并发准入下 storage 超冲被放大但同样接受**——承接方仍是磁盘、自愈机制不因产品数变化,单产品论证在此推广到多产品(arda + karda 各自对同一 remaining 并发准入,合计短时超出,下次快照收敛)。反之钱资源用 gauge+准入 = 跨产品并发套现,**结构上禁止**;
- **硬条件:单一计量入口**——共享池必须有唯一上报方防重复记账(storage = 各产品 gauge 报切片、平台读时求和;ai.credit 的**上报方是 Atlas**（全平台唯一推理计量入口），它上报**原始 token**（四维，计入调用方产品，不是 atlas），换算与 `ai.credit` 扣减在平台 —— ADR-013 / #547，owner 2026-09-30；此前此处写的「操作宿主产品 atomic 预扣，终态收敛到 Atlas 统一上报」已作废);
- **贡献与归因分离**:池行永远记录**贡献方**(哪条订阅/哪个产品的组件出的额度);usage_events 永远记录**花钱方**(consume 的 `product` 参数 = 记账归因)——共享池 + 逐产品消耗审计两头都有,成本分摊报表可直接导出;
- **"共享" = 单一 metric/货币 + 两类池 + 租户可控路由,不是单一钱包**(arda 反馈 C 升级为 §4.3 reserved/shared 模型)——ai.credit 仍是 L0 单一 metric/货币/换算基线(单一定义点不变),但**"哪些池可被谁消费"由租户策略决定**,默认全保留(不熄火);详见 §4.3;
- **不造伪产品**:共享性由 metric 归属目录表达,不为资源在 `products` 表造行(产品行背负产品面义务,资源一样都没有,见 §0);
- **burn 顺序约定**:订阅池 priority=100 先烧(月池会周期作废),加油包默认 200 后烧(有效期更长)——行业 credit ledger 标准默认;
- **加油包 = grant 不 = 套餐**:购买/运营授予直接生成一笔带有效期的池(pool_source:现行 `manual_override` 运营通道即可用;`addon_purchase` 值预留给自助购买流,登记不做);
- **scope 演进位**:现行池作用域 = workspace;`tenant` 级(企业大池分 WS)预留枚举值,不实现;
- **ai.credit 费率**:货币与池归 L0;**各产品自定义"操作 × credit"费率表**(arda 的 1/3/5/10/20 见 biz-260 §4);token 换算基线 1 credit ≈ 2K tokens(已确认)。

### 4.3 保留 / 共享池模型(reserved vs shared,arda 反馈 C→2 升级;取代 D7 "单一跨产品瀑布")

**D7 初版把共享 metric 建成"跨产品单一瀑布池"——一个产品烧光则全体熄火。arda 反馈指出这是设计缺陷不是"应有之义":产品配额应被保留、闲置额度应能流动、共享与否应由租户决定、超支应可归因。** 据此升级为两类池 + 租户路由策略:

**两类池(结构不变,靠消费路由区分):**

| 池类                            | 来源                                             | 可被谁消费                       | 效果                                                   |
| ------------------------------- | ------------------------------------------------ | -------------------------------- | ------------------------------------------------------ |
| **保留池 reserved**(默认)       | 每个产品订阅组件贡献的 quota 键 → 该产品自己的池 | **仅该产品**                     | 产品配额被保留,别的产品烧不到 → **无熄火、无交叉补贴** |
| **共享溢出池 shared**(租户开启) | 参与共享的产品,其池对参与集**互相开放**          | 参与集内任一产品(自留烧尽后兜底) | 闲置额度汇流 → **不浪费**                              |

**消费(product=X, metric=M):自留先烧、共享兜底**——候选池 =(1)X 自己的池(reserved,总在,先烧)∪(2)`若 M 是平台 metric 且 X 与该池贡献产品**同在**该 (workspace, M) 的共享策略中`→ 其他参与产品的池(shared,后烧)。默认策略为空 = 只有(1)= 全保留。瀑布顺序:自留 → 共享,各段内按 priority/role。

**关键点(逐条对齐反馈):**

- **设定权在租户管理员**:workspace 级 `credit 共享策略`(选定哪些产品参与共享某 metric),**默认全保留**(安全:不熄火、配额保留);管理员按需纳入产品换取"不浪费"。**waste↔starvation 的档由租户自己拨,不是平台替他定**;
- **不违反 plan 锁定(§6)**:管理员改的是**消费路由策略**(哪些池参与共享),**不是 plan 授予的额度数字**——授予值仍随版本锁死;策略是 quota_pools 之上的独立路由层,不回写组件;
- **归因永远在**:reserved 与 shared 都**逐 consume 记 `usage_events.product`**(谁烧的);共享是**逻辑消费视图不是物理合并**(每池仍带贡献产品)——正因不合并,"共享池里谁超多少"= 某产品 consumed − 其 contributed,随时可导,成本分摊算得清。**物理合并会丢归因,故不做**;
- **C2 视图按策略逐产品**:产品 X 的 `quota_pools` = X 的产品级池 + X 的平台 metric 自留池 +(若 X 参与)可及的共享池;`remaining` 反映"X 实际能烧多少"。**不同产品因策略不同,看到的共享余量可不同**(取代 D7 "所有产品同值");
- **L0 收益不丢**:ai.credit 仍单一 metric/货币/换算基线,共享只是"可消费池集合"的租户过滤,**不新增端点、不破单一计量入口**(通信仍一套);
- **行业对照**:reserved-by-default + org 级开启共享 = AWS Reserved Instance sharing(账户预留、组织策略开启跨账户共享)/ GCP CUD sharing scope / K8s ResourceQuota(namespace 预留)vs 集群突发——"保证预留 + 可选突发共享"是成熟范式;
- **实施**:策略表 `metering.resource_sharing_policies`(workspace_id, metric_key, product_id = 参与行;空=全保留)+ 引擎 consume/C2 按策略取候选(D8 已建结构,**默认空=全保留即安全默认**);**租户管理员配置面(API/UI)后置登记不做**——结构完备、安全默认、面待建。

### 4.4 资源归属分层(WS / Product / Plan)——"成本类决定机制类"的展开

§4.2 的不变量"**成本类决定机制类**"背后是一条**归属**判定。把它显式化:

**判定原则(单一测试)**:_"把该 workspace 的所有产品订阅退光,这个资源还在吗?"_ **在 → WS 级**(资源属 workspace 本身);**不在 → 产品级**(是某产品的服务容量/特性)。佐证:**成本载体**在平台基础设施(磁盘/token/GPU/带宽)→ WS;在某产品自己的服务面 → 产品。

**三层本质**:

| 层                | 装什么                                                                            |
| ----------------- | --------------------------------------------------------------------------------- |
| **WS(workspace)** | **共享基础设施资源**(存储/AI 额度/算力/流量)——workspace 有多少,与订了哪些产品无关 |
| **Product(产品)** | **该产品服务面的容量 + 特性**——只在这个产品里有意义                               |
| **Plan(套餐)**    | **商业 SKU**(tier + 定价):授产品能力;**目标态不授 WS 级资源**                     |

**逐资源归位**:

| 资源/指标                                                                | 归属                 | 机制(成本类决定,§4.2)                                  |
| ------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------ |
| `storage.bytes`                                                          | **WS**               | 存量 stock → gauge + 准入;**WS 叠加池,无预留**         |
| `ai.credit`                                                              | **WS**               | 流量 flow → counter + atomic;**reserved/shared(§4.3)** |
| `compute.gpu/cpu`                                                        | **WS**               | 流量 flow → counter + atomic;reserved/shared           |
| `egress.bytes` / `ingress.bytes`                                         | **WS**               | 流量 flow → counter                                    |
| `service.api.call` / `quality.check.run`                                 | **Product**          | 产品服务面容量                                         |
| `dataset.max` / `datasource.max` / `service_endpoint.max`                | **Product**          | 产品对象数上限                                         |
| `varda.enabled` / `varda.readonly` / `sync.frequency` / `retention.days` | **Product**          | 产品特性开关/档位                                      |
| `member.max`(席位)                                                       | **Product**(§5)      | 席位绑产品档,WS 级会跨产品套利                         |
| `tier`                                                                   | **Plan**(仅 primary) | 商业档位                                               |

**两类 WS 资源的分配模型(同一条"成本类决定机制类"的两个分支,不是两个模型)**:

- **stock(存量,如 `storage.bytes`)→ WS 叠加池**:存量无"预留"概念(空间就是空间);池 = **多来源 grant 叠加(Σ)** ——`ws_base`(默认底量)+ `addon_purchase`(加油包/扩展包)+ `entitlement_grant`(权益包)+ `voucher`(赠送券);`remaining = Σ grant − Σ 用量`;
- **flow(流量,如 `ai.credit`/compute/egress)→ reserved/shared(§4.3)**:流量可预留;每产品订阅贡献**保留池**(默认不熄火),租户可开**共享溢出池**;

**统一归因(§4.2/§4.3,覆盖所有 WS 资源)**:池行记**贡献方**、`usage_events` 记**花钱方**(consume 的 `product`);storage 按**逐产品切片**(gauge 求和)、ai.credit **逐 consume 记 product**;成本分摊 = 某产品 `consumed − contributed`,随时可导。**物理合并会丢归因,故所有 WS 资源都保留逐产品维度。**

**登记后续线:storage WS 池解耦**。当前 `storage.bytes` 的 limit **过渡态**仍从产品 `plan_component` quota 贡献(多订阅取合计 Σ);**目标态 = 移出产品权益、改 WS 级存储池**(base + 叠加包,`pool_source` 见上),彻底与产品订阅解耦,连带激活 §4.2 的 `addon_purchase` 登记项。详见 [`data_commerce_240_usage-gauge.md`](./data_commerce_240_usage-gauge.md) §4.1;另立工作线逐项授权。**`ai.credit` 等 flow 资源保持 §4.3 reserved/shared,不做此解耦**(流量可预留,产品订阅授予是其应有之义)。

## 5. 席位裁定:不池化,留各产品

`member.max` **不进 L0 共享池**,保持各产品 capability(owner 2026-07-08 裁定)。理由:席位价值与产品档位强绑定——同一 WS 内若席位池化,A 产品(低档 20 席)的成员将无门槛使用 B 产品(高档 2 席),**池化 = 跨产品席位套利通道**。

- 成员**本体**归平台 tenancy(`tenancy.workspace_memberships`),各产品按自己的 `member.max` 门控**自己的使用面**;
- 将来若要"全家桶席位"商业形态:以 bundled 组件在各产品**各自配** member.max 实现(套餐显式给到哪个产品几席),而非资源池化。

> **席位执行与成员花名册(owner 2026-07-20 裁定,收口 product_240 §6#26/#29)**:
>
> 1. **上限平台 owns、执行在产品侧**:`member.max` 上限由平台经 **C2 下发**(平台 owns 数字 + 成员本体 `tenancy.workspace_memberships`);**执行必然在产品入口**——每产品席位数不同,per-product 上限无法在"加入 workspace"这一 product-agnostic 时点由平台执行,只能由产品按其自己的成员使用面门控。
> 2. **v1 不建 roster 推送**:平台**不**为 member.max 提供成员列表推送 API;产品以登录累积的自有成员视图(`local_authz.member` 惰性子集)运作。**roster 拉取端点 + per-member 失效事件 = 预留前向能力**,待某产品需要完整"成员管理"面时再建(起步最小化)。
> 3. **ADR-011 措辞已收口(2026-07-20)**:ADR-011 §11.1a "member.max ~ active WorkspaceMembership 计数"描述的是 **workspace 成员轴**(平台级人数);它与 per-product 席位使用是**两个量**、不混,若另需 workspace 级总人数硬门是独立的平台 tenancy 门——已在 ADR-011 §11.1a 加注对齐(member.max=per-product 上限、执行产品侧,WorkspaceMembership 数量=度量的成员池)。

## 6. 配置组(profile):制单模板,盖章即拷贝值

运营为捆绑件/档位维护**常用配置组的存档组合**(如"数据支撑-小/中/大杯"),制单时选用并可微调——**值被拷贝进 plan_component 并随版本锁定**,组件行留 `source_profile_code` 溯源标记(松引用,展示用)。

- **禁运行时指针**:组件不得反查 profile 取值——否则改模板 = 已售套餐权益静默变动,违反 plan version 锁定铁律(行业对照:price book 是模板,合同上的数字是拷贝);
- 改模板只影响之后盖章的新版本;存量客户调整走开新版本+换版(升降级机制在产);
- 落地分两步:现行 = seed 命名常量(arda 六组 quota 即六个存档组合);`product.component_profiles` 表随运营制单 UI 后置(登记不做)。

## 7. 明确不采纳(防翻案重议)

| 方案                             | 否决理由                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 全量统一信用货币(一切折 credits) | 牺牲资源原生语义;credits 耗尽 = 全功能同时熄火;**Snowflake 自己都把存储排除在 credits 外按 TB 单算**。取其精华(ai.credit 内部费率表)弃其糟粕  |
| v1 超额后付(overage)             | 需成熟支付/信任/追缴体系,与预付制起步错配;metric 级策略位(hard-gate vs bill-overage)**登记**,日后一个标志切换                                 |
| 席位池化                         | §5 套利通道                                                                                                                                   |
| 为资源造产品行                   | §0/§4.2;资源长出服务面时按晋升规则另立新产品                                                                                                  |
| tier 第六值 "bundled"            | 曾为过渡实现;被 §3 布尔取代——并存时不吞事实、tier 类型对消费方保持纯五档                                                                      |
| enterprise 进 SaaS 自助售卖面    | §1.1:enterprise = 私有化/非 SaaS 授权制(operator_grant),不自助结账;自助升级引导止于 business。混入自助面会把"合同席位/私有部署"错当可购买 SKU |
| 把 §1.1 当功能清单强制规范       | §1.1 只约定档位骨架(自助/授权分面、席位轴、business≈pro+席位的定位);各档装哪些功能由产品能力矩阵自定(D12),平台不给产品定功能清单              |

## 8. 字段级落位摘要(实施车依据;精确 DDL 随车更新 data\_\* 文档)

1. `plan_components`:`billing_kind` → **`component_role` ∈ {primary, bundled}**(存量值 bundled_free/charged 全迁 primary);`tier` 改 **NULLABLE**,CHECK 成对(`primary` ⇒ 五档之一 / `bundled` ⇒ NULL),枚举**摘除 'bundled' 值**;新增 `source_profile_code varchar(64) NULL`;UNIQUE 改 NULLS NOT DISTINCT;
2. 新表 **`product.platform_metrics`**(metric_key PK、kind counter|gauge、consume_mode、metric_unit、reset_period、status)——§4.1 清单入 seed;
3. `metering.quota_pools`:`billing_kind` → `component_role` 同步改名;共享池匹配 = metric_key ∈ platform_metrics 时按 `(workspace_id, metric_key)` 跨产品匹配(consume 引擎),索引配套;
4. C2 引擎:§2 合并规则(tier 仅 primary/bundled 布尔/tiered primary 优先)+ 共享池注入每产品视图 + **top-level `subscription_status` 字段**(primary 订阅真实状态按 active>trialing>overdue>suspended>expired>cancelled 取代表,无订阅=null);值域来自 `@vxture/shared`,guardrail 校验 DDL 对齐;
5. seed:arda 目录 `varda.credit` → `ai.credit` 升格至 platform_metrics;storage.bytes 同迁;组件行补 role;
6. 护栏:linter 加规则——产品级 `product_metrics` 不得声明 platform_metrics 已有键。

## 9. 产品团队接入义务增量(arda 为首)

1. `quota.ts` 类型:`tier: Tier | null`(纯五档)+ `bundled: boolean` + **`subscription_status: SubscriptionStatus | null`**(六个真实状态或 null=从无订阅,含 `overdue` 欠费宽限——权益保留、催缴 UX);门控按 §3 公式;CTA 分岔按 `subscription_status`(null→订阅 / overdue→补款 / expired·cancelled·suspended→续订);
2. metric 常量:`varda.credit` → **`ai.credit`**(storage.bytes 键名不变);
3. 计费模型文档(biz-260 类)按 §2 改捆绑组件规格:`{ role:'bundled', quota:{...} }`,删除 `billing=bundled_free` 判别与 "tier rank=free" 表述;**并删除"平台配 bundled 组件"表述——bundled 配置归拥有 agent plan 的一方(§2 配置归属),被捆绑产品自己不 seed**;
4. 共享池展示:storage/ai.credit 余量为**该产品实际可消费口径**(§4.3:自留 +（若参与）可及共享;默认全保留 = 仅自留,各产品看到的是自己的额度,不会被别的产品烧掉);共享由租户管理员开启后才跨产品流动;
5. 其余(缓存/409/webhook/gauge)见 [`arda_200`](../20-specs/210-arda/30-arda_200_interface.md) 契约,不变。

## 10. 决策登记

D6(role 轴+bundled 布尔+profile 盖章)与 D7(L0 资源目录+ai.credit 升格+席位不池化+egress/ingress 预留)登记于 [`product_310_arda-integration.md`](./product_310_arda-integration.md) §4;行业对照依据(Snowflake credits/存储分离、Salesforce org 池、Metronome/Orb credit ledger、Google One 产品化案例)记于本文 §0/§4/§7,不另立 ADR。
