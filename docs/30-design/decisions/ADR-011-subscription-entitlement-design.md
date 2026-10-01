# §11 多 Plan 订阅 · 统一 Product 合并 · 配额隔离 · 瀑布计量（定稿 v2）

> 状态：设计定稿 v2（承接 §3，落实多 Plan / 统一 Product / 两级 Membership）
> 范围：vxture 平台侧的订阅、Plan、权益解析、计量；产品端（arda/…）的消费契约
> 关系：本章细化并升级 §3.2「权益挂载粒度」，从 (workspace, product) 升级为
> 「workspace 下多 Subscription，每 Plan 含多 Product，能力就高合并 / 额度独立成池」
> v2 变更：① Membership 下沉为 Org/Workspace 两级；② 取消基座/核心区分，Product 统一可独立订阅可分档；
> ③ 附带基座 = free 来源、显示 standard，能力就高合并但不参与计费 → 无需差价抵扣。

---

## 11.0 核心结论速览

| 维度                       | 决定                                                               | 理由                                   |
| -------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| 资金/结算主体              | **Organization**                                                   | 预付款池、汇总求和、统一开票           |
| 订阅/权益/账单主体         | **Workspace**                                                      | cost center，持有订阅、权益、账单      |
| 成员关系                   | **两级：OrgMembership + WorkspaceMembership**                      | org 级管理权 + workspace 级访问控制    |
| 订阅唯一键                 | **(workspace, plan)**                                              | 一个 workspace 可订多个 Plan           |
| state（生命周期）          | 在 **Subscription** 层                                             | 整笔订阅 trial/subscribed/expired      |
| tier（档位）               | 在 **Plan.component** 层                                           | 同一 Plan 内各 Product 可不同档        |
| Product 模型               | **统一：不分基座/核心；均可被打包、可独立订阅、可分档、可合并**    | data/kb 与 agent 同构，逻辑统一        |
| 基座来源                   | **附带 = free 来源（显示 standard）/ 单独订阅 = 计费（可更高档）** | 能力就高合并，计费按来源各算，无重叠   |
| 能力型权益(tier/上限/功能) | **就高合并：max tier / max 数值 / union features**                 | 同能力多来源取最强，不叠加             |
| 消耗型权益(字数/调用包)    | **不合并：按订阅独立成配额池**                                     | 不同 Plan 的额度计费来源不同，各扣各的 |
| 配额扣减                   | **瀑布扣减（priority 升序，附带/赠送额度先扣）**                   | 平台内部路由，产品端无感，对账清晰     |
| 升级生效范围               | **workspace 级**                                                   | 基座是共享底座，升级则全局升           |
| 过期回落                   | **任一含该 product 的 active 订阅存活则保留；全过期回落 free**     | 数据不删，能力随订阅                   |
| 计量 used                  | **集中上报平台，平台为 SoT（计量事实非业务数据）**                 | 计费原材料，本属平台域                 |

---

## 11.1 分层语义与 SoR

```
层级                   SoT      角色                      关键键
────────────────────────────────────────────────────────────────────
User                  IdP      身份                      user_id
OrgMembership         平台     user×org 关系/组织角色     (user_id, org_id)
WorkspaceMembership   平台     user×workspace 关系/工区角色 (user_id, workspace_id)
Organization          平台     资金/结算主体              org_id (= billing account)
Workspace             平台     订阅/权益/账单/隔离主体     workspace_id (= 隔离键)
Subscription          平台     一次订阅(买了哪个 Plan)     (workspace_id, plan_id)
Plan                  运营     业务方案(多 Product 包)     plan_id
Product               运营     能力单元(统一,可独立订阅)   product_id
Entitlement           平台     合并/隔离后的能力(派生)     不建表
Usage                 平台     计量事实                   (subscription_id, product, metric)
```

**两条耦合契约（与 §1 一致）**：

1. `workspaceId` 隔离键 —— 产品端按此隔离全部业务数据。
2. 解析后的 Entitlement —— 平台实时下发，产品端只读消费，不存订阅/Plan。

**资金 vs 成本的分离**：

- Organization = billing account：钱从这里出（预付款池、汇总、开票）。
- Workspace = cost center：账算在这里（订阅、配额、消耗）。
- 一个 Org 下多个 Workspace 各自订阅，消费各自归集，最终在 Org 汇总结算。

---

## 11.1a 两级 Membership（v2 新增）

标准两层 RBAC（组织级 + 工作区级，对标 Slack / Notion / GitHub）。

```
OrgMembership {            // 组织级：能否管理 org、是否账单管理员
  user_id
  org_id
  role        // owner | admin | member
  status      // active | invited | suspended
  // (user_id, org_id) 唯一
}

WorkspaceMembership {      // 工作区级：能进哪些 workspace、在里面什么角色
  user_id
  workspace_id
  role        // admin | editor | viewer
  status      // active | invited | suspended
  // (user_id, workspace_id) 唯一
}
```

职责分工：

- **OrgMembership** 管「属于哪个组织、能否碰账单与组织设置」。owner/admin = 账单与成员管理员。
- **WorkspaceMembership** 管「能进哪几个 workspace、能干什么」，是数据隔离的访问控制面。
- 一个 org member 不必能进 org 下所有 workspace —— workspace 访问由 WorkspaceMembership 显式授予。

**约束**：WorkspaceMembership 的 user 必须先是该 workspace 所属 org 的 OrgMembership 成员（除非走访客邀请机制）。

**与配额的联动**：`member.max`（seat 类配额）对应 workspace 内 active 的 WorkspaceMembership 数量。
例：「3 人写方案 / 5 人分析」即对应不同 workspace 的 WorkspaceMembership 计数上限。

> **收口（2026-07-20，对齐 §6#26 / [`../product_220_catalog-resource-model.md`](../product_220_catalog-resource-model.md) §5）**：`member.max` 是**每产品**权益上限（不池化，各产品 plan 各自带 `member.max`、经 C2 下发），**执行在产品侧**——每产品席位数可不同，平台无法在「加入 workspace」这一 product-agnostic 时点执行 per-product 数；产品按其自己的成员使用面对 `member.max` 门控。本节「active WorkspaceMembership 数量」= 门控**度量的成员池**（单产品 workspace 下二者重合；多产品下每产品各自计其使用面）。若另需 **workspace 级总人数**硬门，那是**独立**的平台 tenancy 门，与 per-product `member.max` 是两个量、不混。

---

## 11.2 实体定义

```
Organization {
  id
  name
  type                 // personal | organization
  billing_account {    // 资金/结算主体
    prepaid_balance    // 预付款池
    currency
    invoice_profile    // 开票抬头/税号等
  }
}

// OrgMembership / WorkspaceMembership 见 §11.1a

Workspace {
  id
  org_id               // 归属 org（结算汇聚到此 org）
  name
  region
  status
  seed_status?         // 平台标记：是否需示例数据填充（见 §4）
}

Product {              // 统一模型：不分基座/核心
  id                   // data | kb | agent_writing | agent_analysis
  name                 // 客户可见：数据平台 / 知识库平台 / ...
  capability_keys      // 可门控功能键（产品端定义，§3.4）
  metrics: [           // 每个计量维度声明合并策略
    { key: "data.tier",   merge: "max"   },  // 能力档位 → 就高
    { key: "storage.max", merge: "max"   },  // 上限型 → 就高
    { key: "member.max",  merge: "max"   },
    { key: "doc.words",   merge: "pool"  },  // 消耗型 → 独立成池
    { key: "ai.calls",    merge: "pool"  }
  ]
  standalone_subscribable   // 是否允许单独订阅（data/kb = true）
}

Plan {                 // 业务方案 = 多 Product 打包，每 Product 各自档位/配额/计费
  id
  name                 // 客户可见：方案编写智能体 / 数据分析智能体 / 数据平台
  billing_cycle
  price
  components: [
    {
      product_id       // 引用 Product
      tier             // 显示档位：standard | starter | pro | business | enterprise
      billing          // bundled_free（附带白送，0元）| charged（计费）
      features         // 该档开放的功能键（业务语言，客户能懂）
      quota: {         // 业务语言配额，非 token
        "doc.words": 1000000        // merge=pool → 独立成池
        "storage.max": "100GB"      // merge=max  → 就高合并
      }
      priority         // 仅 pool 型额度的瀑布扣减用；附带/赠送额度数值小，先扣
    }
  ]
}
// 「单独订阅/升级基座」= 一个只含单 component 的 Plan
//   例：data:pro 升级包 = Plan{ components:[{product:data, tier:pro, billing:charged}] }

Subscription {
  id
  workspace_id
  plan_id
  state                // trial | subscribed | expired | none
  start_at / end_at / renew_at
  // (workspace_id, plan_id) 唯一；tier 在 component 级
}

// —— 派生/计量结构（不建镜像表）——
Entitlement (派生, 平台实时计算, 产品端不存)   // 规则见 §11.3
UsageMeter (平台 SoT, 计量事实) {
  subscription_id      // 配额按订阅独立 → used 也按订阅计
  product
  metric               // doc.words | ai.calls | ...
  used
  window               // month | day
}
```

---

## 11.3 权益解析算法（能力就高合并 + 额度独立成池）

对 workspace `W`，取其全部 state ∈ {trial, subscribed} 的 Subscription 的 components，
**按 metric 的 merge 策略分两路处理**（不再区分基座/核心，区分能力 vs 额度）：

```
INPUT: W 下全部 active Subscription 的 components（含附带的 bundled_free 与单独订的 charged）

═══ 路 A：能力型（merge = "max" / union）═══
  按 product 分组，组内：
    tier      = max(各 component.tier)        # 档位就高
    features  = union(各 component.features)   # 功能取并集
    上限配额   = max(各 component.quota[max型]) # storage.max/member.max 等就高
  → 同一 product 多来源(附带 standard ×N + 单独订 pro)就高合并为最强档
  → 升级生效范围 = workspace 级（共享底座，升则全局升）

═══ 路 B：消耗型（merge = "pool"）═══
  不合并。每个 (subscription, product, metric) = 一个独立配额池：
    pool = { subscription_id, product, metric, limit, used, priority, billing }
  → 例：W 下 agent_writing.doc.words 为两个独立池：
      pool_A = { sub=S1, limit=1,000,000, priority=20 }  // 专业写方案
      pool_B = { sub=S2, limit=  500,000, priority=10 }  // 分析附带报告

═══ 计费正交（与能力合并解耦）═══
  billing = bundled_free 的 component → 价格 0，不进结算（附带白送）
  billing = charged     的 component → 正常计费
  ∴ 「方案编写Plan(附带data:standard,free) + 单独订data:pro(charged)」：
     能力合并 → data.tier = max(standard, pro) = pro（workspace 全局生效）
     计费     → 仅单独订的 pro 收费；附带那份恒 0
     → 无重叠、无差价抵扣

OUTPUT (Entitlement 视图):
  {
    "data":           { tier:"pro", features:[...union...] },      // 就高(被单独pro覆盖)
    "kb":             { tier:"standard", features:[...] },
    "agent_writing":  { features:[...union...],
                        quota_pools:[                               // 额度独立
                          { metric:"doc.words", limit:500000,  remaining:.., priority:10 },
                          { metric:"doc.words", limit:1000000, remaining:.., priority:20 }
                        ] },
    "agent_analysis": { tier:"starter", features:[...],
                        quota_pools:[ { metric:"analysis.hour", limit:50, .. } ] }
  }
```

> 产品端拿到的 `quota_pools` 是剩余额度合计视图（前端展示「还剩多少」）；
> 具体扣哪个池由平台在 consume 时按 priority 决定（§11.5），产品端不需懂订阅结构。

---

## 11.4 过期回落规则

```
对 workspace W 的每个 Product P：
  active = W 下 state∈{trial,subscribed} 且含 P 的订阅
  if active 非空:
      P 保留 → 在 active 内按 §11.3 合并/隔离
      （某笔过期 → 其 component 退出 → 能力回落到剩余订阅的就高值；其配额池移除）
  else:
      P 全部过期 → 回落 free（features 最小集，quota free 默认）；业务数据不删（§3.1）
```

要点：过期是 **component 逐笔退出**，非 product 立即消失。
例：S2 过期 → agent_writing 仅剩 S1 的 100 万池；data 若仅 S2 附带则回落到其他来源的就高值。

---

## 11.5 瀑布扣减算法（多池消费路由）

产品端只上报「workspace 的某 metric 消耗了多少」，平台内部按 priority 瀑布扣减，产品端无感。

```
consume(workspace=W, product=P, metric=M, amount=N):
  pools = W 下 P 的所有 active 配额池(metric=M)，按 priority 升序   // 附带/赠送先扣
  for pool in pools:
      take = min(N, pool.limit - pool.used)
      pool.used += take              // 写入平台 UsageMeter(SoT)
      N -= take
      if N == 0: break
  if N > 0:                          // 全池耗尽仍有剩余 → 门控：拒绝/降级/购买引导
  return { consumed, per_pool_breakdown, remaining_total }
```

**优先级约定（运营配置硬规则）**：
`附带/赠送能力的 priority  <  核心付费能力的 priority`
→ 附带额度先扣，保护用户花钱买的专业额度（Azure/AWS「赠送额度先于付费额度」标准顺序）。
**此规则必须落到运营配置校验**，不靠人记，否则会先扣掉用户付费额度。

> 例：写报告 60 万字 → 先扣 pool_B(附带 50 万) → 溢出 10 万扣 pool_A(专业 100 万)。
> 用户与产品端均无需声明场景，平台按 priority 自动路由。

---

## 11.6 计量归属（计量事实 vs 业务数据）

```
used（消耗了多少）  → 平台 SoT，集中存储    ← 计费原材料，属平台域，非业务数据
内容（消耗了什么）  → 产品端 SoT            ← 业务数据（方案正文/数据集/KB），§1 边界
```

`POST /usage/consume` 上报数字（amount + metric），不上报内容。
内容留产品端、数字进平台 → 不违反「业务数据全在产品端」的 SoR 边界。

---

## 11.7 API 契约

**查询维度 = product，永不暴露 plan。** plan 是用户购买时的商业打包概念；合并跨了哪些
plan/subscription 是平台内部行为，产品端运行时只认自己的 product。返回里的「多个」只有两处：
多 product（批量端点的 map）、同 product 同 metric 的多额度池（quota_pools 数组）。

返回体分两块（对应 §11.3 双路解析）：

- `capabilities`：能力型权益（就高合并后的**单值**）—— tier / 上限 / features 并集。
- `quota_pools`：消耗型权益（按订阅独立的**多池**）—— 字数包、调用包等。

```
# ① 单 product 查询（运行时门控主用，高频，缓存友好）
GET /platform/entitlements?workspace_id={W}&product={P}
→ 200 {
    workspace_id, product,
    capabilities: {                       # 能力型(就高合并后),结构化单值
      "data.tier": "pro",
      "storage.max": "100GB",
      "member.max": 20,
      "features": ["agent.document.enabled", ...]    # union 后
    },
    quota_pools: [                        # 消耗型(按订阅独立),数组
      { metric:"doc.words", limit:500000,  remaining:.., priority:10 },
      { metric:"doc.words", limit:1000000, remaining:.., priority:20 }
    ]
  }

# ② 批量查询（首屏/多 product 一次拿，省往返）
GET /platform/entitlements?workspace_id={W}&products=data,kb,agent_writing
→ 200 {
    workspace_id,
    entitlements: {                       # product → 该 product 合并结果
      "data":          { capabilities:{...}, quota_pools:[...] },
      "kb":            { capabilities:{...}, quota_pools:[...] },
      "agent_writing": { capabilities:{...}, quota_pools:[...] }
    }
  }

# ③ 产品端上报消耗（平台内部瀑布扣减 + 写 UsageMeter）
POST /usage/consume
  body: { workspace_id, product, metric, amount, idempotency_key }
→ 200 {
    consumed,                             # 本次实际扣减总量
    remaining_total,                      # 该 (product,metric) 跨所有池剩余合计
    per_pool_breakdown: [                 # 本次各池扣了多少(对账/审计)
      { subscription_id, metric, took, remaining }
    ],
    gated: false
  }
→ 409 {
    gated: true, reason: "quota_exhausted",
    consumed,                             # 耗尽前扣减的部分(部分成功语义,见下)
    remaining_total: 0
  }
# 上面这个 409 已两次被取代，ADR 记录当时的决定、不改写；权威形状见 product_200 §4.1：
#   ① 2026-08-10（owner 裁定）：整条取消 —— 覆盖不住改回 200 + body 里的 gated，照常记账。
#   ② 2026-10-01（owner 裁定）：409 以**另一种形状**回来 —— 请求体 intent="reserve" 且指标有成本时
#      额度不足回 409，consumed=0 且**不写任何事件**（与上面「部分成功也 409」正好相反）。

# ④ 平台→产品端失效通知（与 seed/wipe 共用鉴权通道，§5.1）
PUSH invalidate { workspace_id, products:[...] }   # 权益变更秒级生效;支持多 product
```

约定：

- `?product=` 单个 / `?products=` 逗号分隔批量，二选一；**无 `?plan=` 入口**。
- `idempotency_key` 防重放/重复计量；consume 必须幂等（§5.1 同一保证）。
- consume 超额语义需明确（实现时定）：**全有或全无**（额度不足整笔拒绝、不扣）
  vs **部分成功**（能扣多少扣多少、返回 409 + consumed>0）。建议**对可分割消耗
  （字数）用部分成功，对原子动作（一次生成）用全有或全无**，由 metric 声明。

---

## 11.8 端到端时序

```
① 下单/升级（计费侧）
   计费 → 平台写 Subscription(workspace, plan, state) → invalidate(W, products)
   （单独升级 data:pro = 新增一笔只含 data 的 charged 订阅）

② 门控
   用户进入 arda → GET /entitlements?ws=W&product=P（或 ?products= 批量首屏）
   → 平台 resolve（能力就高合并→capabilities / 额度独立成池→quota_pools / 计费正交）
   → 产品端缓存(短TTL) + 按 capabilities.features 渲染 + 展示 quota_pools 合计

③ 消费
   写报告 60 万字 → POST /usage/consume{W, agent_writing, doc.words, 600000}
   → 瀑布扣减(pool_B 50万 → pool_A 10万) → 写 UsageMeter → 返回 remaining

④ 结算（资金侧）
   Org 汇总各 Workspace 的订阅费(仅 charged) + 计量超额 → 预付款扣减 / 开票
```

---

## 11.9 与 §3 / v1 的差异

| §3 原设计                              | v1                                              | v2（本稿）                                             |
| -------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| 权益粒度 (workspace,product) 一行      | workspace 下多 Subscription，每 Plan 多 Product | 同 v1                                                  |
| 账单主体 = Org                         | 账单=Workspace / Org=资金结算                   | 同 v1                                                  |
| Membership 单层 (user,org)             | 单层                                            | **两级：Org + Workspace**                              |
| 基座 = 特殊（不计价/不分档/kind=base） | 同                                              | **取消区分：Product 统一，可独立订阅、可分档**         |
| ——                                     | quota 一律按订阅隔离                            | **按 merge 策略二分：能力就高 / 额度独立成池**         |
| ——                                     | 基座重叠计费需差价抵扣                          | **附带=free 来源不计费，单独订=charged，无重叠无抵扣** |

§3.5（实时拉取+缓存+失效）、§3.4（features 键产品定义、档位映射平台下发）、§1（SoR 边界）**保留不变**。

---

# §12 MVP 切分（三阶段）

## MVP-1：单 Plan 订阅闭环（最小可用）

**目标**：一个 workspace 订一个 Plan，权益下发、门控、计量跑通。

- 实体：User / OrgMembership / WorkspaceMembership / Org / Workspace / Subscription / Plan / Product
  （Subscription 限制为 workspace 下**仅一条**）。
- 两级 Membership 建模到位（即使 MVP-1 常态 1 org 1 workspace 1 member）。
- `GET /entitlements` 实时 resolve 单订阅 → features + 单配额池（瀑布退化为单池）。
- `POST /usage/consume` 单池扣减。
- §3.5 实时拉取 + 短 TTL 缓存 + invalidate。
- EntitlementGate 按 features/quota 渲染放行（§3.4，无 free 特例）。

**砍掉**：多订阅、能力合并、多池瀑布、Org 资金结算、附带/升级、过期逐笔退出（先整笔 expired→free）。
**验收**：订一个方案编写 Plan → arda 显示功能 → 写满配额被拦 → invalidate 后秒级生效。

## MVP-2：多 Plan 合并与配额隔离（核心价值）

**目标**：落实 §11.3–11.5 + 基座独立订阅/升级。

- 解除「仅一条」限制，workspace 下多 Subscription。
- §11.3 双路解析：能力就高合并（含基座多来源合并、单独订阅升级覆盖）/ 额度独立成池。
- component 的 `billing`（bundled_free / charged）：附带不计费、单独订计费。
- §11.5 瀑布扣减（priority 升序）+ **运营配置硬校验**（附带 priority < 付费 priority）。
- §11.4 过期逐笔退出（component 级）。
- 基座单独订阅/升级（只含单 component 的 Plan）→ workspace 级全局生效。
- `quota_pools` 多池视图；consume 返回 per_pool_breakdown；UsageMeter 按 (subscription,product,metric)。

**砍掉**：Org 资金结算、预付款、开票。
**验收**：复现需求例 —— S1(方案编制,100万) + S2(数据分析,附带50万)；data 多来源就高合并，单独订 data:pro 则全局升 pro；写 60 万字先扣 S2 的 50 万再扣 S1 的 10 万；S2 过期后仅剩 S1 的 100 万池；附带的 data 不计费、单独订的 pro 计费。

## MVP-3：资金结算与开票（商业闭环）

**目标**：Org 作为资金/结算主体闭环。

- Org.billing_account：预付款池、币种、开票抬头。
- 多 Workspace 的 charged 订阅费 + 计量超额 → Org 维度汇总。
- 预付款扣减 / 出账 / 开票。
- 计费来源接入（第三方 or 自建）→ 写平台 Subscription（§10 待确认项）。

**验收**：一个 Org 下两个 Workspace 各自订阅 → 月末 Org 汇总一张账单（仅计 charged）→ 预付款扣减 → 开票。

---

## 依赖与起步顺序

```
前置(§8 步骤0)：定义 arda 领域数据模型(data source/dataset/project/AI写作上下文)
   ↓ DB 与模板 seed 的真前置
MVP-1(平台侧)：订阅/权益/计量最小闭环，可与领域建模并行
   ↓
MVP-2(平台侧)：多 Plan 合并 + 基座独立订阅 —— 核心差异化，重点投入
   ↓
MVP-3(资金侧)：结算开票 —— 按商业进度迭代
```

> MVP-2 是本设计的核心（多方案打包 + 统一 Product 就高合并 + 额度独立成池 + 瀑布扣减），
> 值得最多设计评审投入。运营配置侧务必落地「附带 priority < 付费 priority」校验。
