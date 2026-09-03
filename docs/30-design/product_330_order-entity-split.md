# 订单实体拆分与订阅流程重设计（product_330）

> 版本：**v0.1 草案** · 状态：待 owner 评审，评审通过后按 §7 分 PR 实施
> 定位：把「订单」从 `metering.subscriptions` 里拆出来成为独立实体，订阅 / 订单 / 账务三分，
> 支撑新订、升级（折抵）、续订、退款（24h）、作废、过期六条流程。取代 [`product_320`](./product_320_offline-subscription-order-flow.md) §2 O1「一行两面」与 [`product_321`](./product_321_order-payment-and-settlement.md) 的段 1 / 段 2 拆法。
> 依据：owner 2026-09-03 七条决策（诊断文档「订阅链路诊断与重设计」）。
> 上游：[`data_commerce_200`](./data_commerce_200_metering.md)、[`data_commerce_210`](./data_commerce_210_billing.md)、[`data_commerce_220`](./data_commerce_220_provisioning.md)。

---

## 0. 为什么拆（留痕）

一行两面模型两次在生产出错，根因相同：一行只有一个状态 / 周期 / 金额，而订单与订阅在这三件事上天然不同。

- 2026-09-02：运营点「续期确认」把没收钱的订单壳翻成 active（迁移 `2026-09-02-repair-pending-orders-flipped-by-renew.sql`）。
- 2026-09-03：caimc 从 free 升 starter 年付，履约只搬套餐版本不搬周期 / 到期 / 金额，付了钱的订单行被标 cancelled。

owner 决策 1：拆分，参考大厂设计彻底拆，支撑订单各类流程。

## 1. 目标模型

```
billing.orders ──fulfill(幂等)──▶ metering.subscriptions（workspace × product 唯一一条当前）
      ▲                                   ▲
billing.invoices / payments（挂 order_id）   billing.refunds（挂 order_id，成功后回滚订阅）
```

| 实体 | 回答的问题                                             | 不再承担         |
| ---- | ------------------------------------------------------ | ---------------- |
| 订阅 | 现在是什么档、什么周期、到什么时候、自动续不续         | 钱、意图、付款态 |
| 订单 | 这次要付多少、付了没、履约了没、意图是什么、折抵了多少 | 权益状态         |
| 账务 | 钱的流水（账单 / 付款 / 退款 / 预付款）                | 订阅状态         |

## 2. 表设计

### 2.1 新表 `billing.orders`

```sql
create table billing.orders (
  id                     uuid primary key default gen_random_uuid(),
  order_no               varchar(32)  not null unique,                  -- ORD-YYYYMM-xxxxxxxxxx，沿用
  tenant_id              uuid not null,                                  -- 结算主体（90 跨 schema FK）
  workspace_id           uuid not null,                                  -- 权益主体
  product_id             uuid not null,                                  -- 冗余便于唯一/查询（plan_version 主组件产品）
  plan_version_id        uuid not null,                                  -- 目标套餐版本
  intent                 varchar(16)  not null,                          -- new | upgrade | renew
  cycle_unit             varchar(16)  not null,
  cycle_count            int          not null default 1,
  from_subscription_id   uuid,                                           -- upgrade / renew 的原订阅
  subscription_id        uuid,                                           -- 履约后指向（new 建的 / upgrade·renew 改的）
  list_amount            numeric(12,2) not null,                         -- 标价 P_new
  credit_amount          numeric(12,2) not null default 0,               -- 折抵（§4）
  payable_amount         numeric(12,2) not null,                         -- max(0, list − credit)
  leftover_amount        numeric(12,2) not null default 0,               -- 折抵溢出，进预付款
  currency               varchar(16)  not null default 'CNY',
  proration              jsonb,                                          -- {days_left, days_total, r, u, alpha, p_old, credit_time, credit_usage}
  status                 varchar(24)  not null default 'pending_payment',
  payment_ttl_minutes    int,
  declared_at            timestamptz,                                    -- 客户申报付款
  paid_at                timestamptz,                                    -- 运营确认 / 网关回调
  fulfilled_at           timestamptz,                                    -- 履约完成
  closed_at              timestamptz,                                    -- cancelled / expired / refunded 落地时间
  close_reason           varchar(32),                                    -- customer_cancel | operator_void | ttl_expired | refunded
  created_by_type        varchar(16)  not null,                          -- customer | operator | system
  created_by_id          uuid,
  operator_remark        varchar(512),
  created_at             timestamptz  not null default now(),
  updated_at             timestamptz  not null default now(),
  constraint chk_orders_intent  check (intent in ('new','upgrade','renew')),
  constraint chk_orders_status  check (status in ('pending_payment','pending_verify','paid','fulfilled','cancelled','expired','refunded')),
  constraint chk_orders_from    check ((intent = 'new') = (from_subscription_id is null)),
  constraint chk_orders_amounts check (list_amount >= 0 and credit_amount >= 0 and payable_amount >= 0 and leftover_amount >= 0),
  constraint chk_orders_fulfilled check ((status = 'fulfilled') = (fulfilled_at is not null and subscription_id is not null))
);
create index idx_orders_tenant_created   on billing.orders (tenant_id, created_at desc);
create index idx_orders_status           on billing.orders (status);
create index idx_orders_subscription     on billing.orders (subscription_id);
-- 一个工作区一个产品同一时刻只能有一张在途订单
create unique index uidx_orders_open_per_product on billing.orders (workspace_id, product_id)
  where status in ('pending_payment','pending_verify','paid');
```

### 2.2 `metering.subscriptions` 变更

- 加 `product_id uuid not null`（回填自 plan_components 主组件），部分唯一索引：
  `create unique index uidx_subscriptions_live_per_product on metering.subscriptions (workspace_id, product_id) where status in ('active','trialing','expiring') and deleted_at is null;`
- 加 `paid_amount numeric(12,2)`（本周期实付，折抵输入 P_old；替代 `pay_amount` 的歧义），`current_order_id uuid`（最近一次履约它的订单）。
- **退役列**（P1 只停写、P2-d 停读 + 壳行软删、下一版删列）：`order_no`、`activation_method='offline_purchase'` 的「订单壳」语义（枚举值本身保留作历史开通方式）、`payment_ttl_minutes`、账单备注里的 intent JSON。
- 状态值域收敛为 `active / trialing / expiring / expired / cancelled / suspended`（`overdue` 并入 `expiring`，DDL / shared / README / 文档四处同源；admin `normalizeStatus` 遇未知值不再整页抛）。
- `subscription_kind` 真实写入：¥0 → `free`，试用 → `trial`，其余 `paid`。

### 2.3 账务

- `billing.invoices` 加 `order_id uuid`（新写路径必填，旧行回填）；`subscription_id` 保留给周期账单 / 计量超额行。
- `billing.refunds` 加 `order_id uuid not null`；执行成功触发 §5 回滚。
- 折抵落一条 `invoice_items(item_type='discount')`，金额 = −credit_amount；头表 `discount_amount` 仍是派生镜像。

### 2.4 `billing.order_events`（P1-b2）

订单阶段 append-only 审计：`order_id / event_type / from_status / to_status / actor_type / actor_id / remark / client_ip / created_at`。
事件词汇：`created · payment_declared · payment_rejected · payment_confirmed · fulfilled · cancelled · order_expired · restored`。
TTL 重锚（最近一次 `payment_rejected`）与付款页驳回横幅（`remark`）改读本表；admin 订单时间线 = 本表 ∪ 履约订阅的 `subscription_histories`。
迁移把 P1-a 回填出来的订单的旧订阅行历史复制一份进来（按 order_id × event_type × created_at 去重）。

## 3. 订单状态机

```
pending_payment ──客户申报──▶ pending_verify ──运营确认 / 网关回调──▶ paid ──fulfill──▶ fulfilled ──24h 退款──▶ refunded
      │                              │                                    │
      ├──客户取消 / 运营作废──▶ cancelled       ├──运营驳回──▶ pending_payment      └──履约失败──▶ 停在 paid，进「已收款未开通」待办
      └──TTL 到期──▶ expired
¥0 订单：pending_payment ──系统──▶ paid ──▶ fulfilled（同一事务，无收款动作）
```

- `paid → fulfilled` 由**唯一入口** `OrderService.fulfill(orderId)` 完成，幂等：已 fulfilled 直接返回；失败不回滚 paid，由 reconcile 重试 3 次后转人工。
- 付了钱的订单永远不会是 `cancelled`；作废只允许 `pending_payment / pending_verify`。

## 4. 履约动作（按 intent）

| intent  | 对订阅的动作                                                                                                                                                                  | 备注                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| new     | `insert subscriptions`（active，start=now，end=now+周期，kind 按金额，paid_amount=payable，current_order_id=本单）                                                            | 部分唯一索引兜底：已有当前订阅则 409，前端不应走到这里 |
| upgrade | `update` 原订阅：plan_version、tier、cycle_unit/count、start=now、end=now+周期、paid_amount=payable、current_order_id；旧消耗性池 retire，新池全额发放；旧周期视为在 now 结清 | 折抵见 §4.1；不允许降档                                |
| renew   | `update` 原订阅：end = greatest(end, now) + 周期；周期可换（月→年）；paid_amount=payable；消耗性池按新周期重置                                                                | 同档；`assertNoTierConflict` 不涉及                    |

履约后统一 `fireVersionChange / fireEntitlementInvalidate / tenant.provisioned`（沿用 provisioning 钩子）。

### 4.1 升级折抵（决策 2）

```
P_old   = 原订阅 paid_amount（free 为 0）
r       = days_left / days_total            -- 按天取整，[0,1]
u       = 加权平均_m( max(0, (granted_m − used_m) / granted_m) )   -- 消耗性配额（pool 型：ai.credit、service.api.call、quality.check.run）
α       = 套餐主组件配置 consumable_share（默认 0.5；无消耗性配额为 0）
credit  = round2( P_old × ((1 − α) × r + α × u) )
payable = max(0, P_new − credit)
leftover= max(0, credit − P_new)   → 进 billing.credits（trade_type='grant'，remark=order_no）
```

三个输入与结果写入 `orders.proration`，确认订单页与账单明细行都能追溯。`consumable_share` 加到 `product.plan_components` 主组件的 `quota` 旁（jsonb 键 `_pricing.consumable_share`），admin 套餐编辑框可填。

## 5. 退款（决策 3）

条件（全部满足）：

1. 订单 `fulfilled_at` 起 24 小时内（平台参数 `refund.window_hours`，默认 24）；
2. 该 workspace × product 的**首次** fulfilled 订单（折抵后的升级单不算首次）；
3. 履约后消耗性配额使用率 < 阈值（平台参数 `refund.max_usage_ratio`，默认 0.1）。

动作：`refunds(order_id)` 两段审核 → 执行成功 → 订单 `refunded` → 订阅**整体回到未订阅**（`cancelled`，end=now，池 retire），含 free——旧档价值已折进这张单、旧周期已在升级时结清。退款金额 = `payable_amount`；leftover 已进预付款的部分一并冲回。

console 订单确认页与订单详情页放「退款说明」链接（新页 `/legal/refund-policy`，官网统一维护，newtab，不打断确认）。

## 6. 各面改动清单

| 面                             | 改动                                                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| console-bff                    | `POST /api/subscription/orders` 写 orders；`subscribe-context` 返回 pending order 从 orders 查；「我的订阅」只列 subscriptions（不再减订单壳）；新 `GET /api/orders/:id`、`POST /api/orders/:id/cancel`、`POST /api/orders/:id/refund-request` |
| admin-bff                      | orders.router 改读 orders 表（列表 / 详情 / 确认收款 / 驳回 / 作废 / 恢复 / 退款审核）；subscriptions.router 去掉订单壳判定与 409 分支；待办改为服务端 `GET /api/ops/todos` 从 orders 派生                                                     |
| services/commerce/subscription | 新 `OrderService`（create / declare / confirm / fulfill / cancel / expire / refund-rollback）；`SubscriptionService` 只剩权益动作（changePlan / extend / cancel / suspend / resume）                                                           |
| website-bff                    | 代表行 = 唯一当前订阅（索引保证），`canUpgrade` 按档位阶梯                                                                                                                                                                                     |
| console 前端                   | 订单确认页：摘要加折抵行 + 退款说明链接；我的订阅卡：续订走订单；订单列表 / 详情页                                                                                                                                                             |
| admin 前端                     | 交易订单页按新状态机；订阅管理页去掉订单相关列                                                                                                                                                                                                 |
| 守卫                           | `lint:anchor-writes` 覆盖 orders；新守卫：禁止 BFF 直接 UPDATE `metering.subscriptions.status`（必须经 service）                                                                                                                               |

## 7. 迁移与分 PR

| PR    | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 迁移                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P1-a  | DDL：orders 表、subscriptions 加 product_id / paid_amount / current_order_id、invoices/refunds 加 order_id；回填脚本：`order_no` 非空的订阅行 → orders（intent 从账单备注 JSON 解析；status 由 订阅状态 × 账单状态 映射：suspended+unpaid→pending_payment、suspended+paid→paid、active→fulfilled、cancelled+paid→fulfilled(历史升级单，subscription_id=upgrade_of)、cancelled+unpaid→cancelled）；**同批修 caimc**：行 A → starter 年付、end 2027-09-03、paid_amount 0.10；行 B 的订单 → fulfilled 指向行 A                                                                                                                                                                                                                                                                                                                                                             | 一条 migration，db-init migrate                                                             |
| P1-b1 | 双写过渡（#150 / v0.26.47）：下单仍建 suspended 订阅行 + 同步写 orders；`applyOrderTermsOnUpgrade` 搬周期/金额；读侧以 orders 为准                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 无                                                                                          |
| P1-b2 | **订单实体独立**：`PgOrderRepository` + `OrderService`（createOrder / declarePayment / fulfill(new·upgrade·renew) / cancel / restore / sweepExpired / reconcileHungPaid）；下单只建 orders + 账单（`invoices.order_id`），**不建订阅行**；履约才建 / 换版本 / 延期订阅并回写 `paid_amount / current_order_id`；console-bff 订单五端点、admin-bff 确认 / 驳回 / 作废 / 恢复、platform-api TTL 与自愈作业全部锁 `billing.orders` 行；账单侧在途封堵改判 `orders.status`；对外 orderId = `orders.id`；旧 SubscriptionService 订单方法保留但不再被调用（P2 删）                                                                                                                                                                                                                                                                                                             | `2026-09-03-order-events.sql`                                                               |
| P1-c  | 前端：console 订单页、admin 交易订单页、待办服务端化                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 无                                                                                          |
| P2-a  | **升级折抵**（已实施）：`money/proration.ts` 纯函数（§4.1 公式，只对总额取整一次）；`PgOrderRepository.getProrationBasis`（P_old = paid_amount、周期起止、消耗性池剩余比 = Σmax(0,limit−used)/Σlimit，消耗性 = product_metrics.merge_strategy='pool' 或 platform_metrics.kind='counter'；α = 主组件 `quota._pricing.consumable_share`，未配默认 0.5、无消耗性池 0）；`OrderService.quoteUpgrade` 与下单同一函数；upgrade 单落 list/credit/payable/leftover + `proration` 快照，账单落一条 `credit_adjustment` 负行（不用 discount，券逻辑不碰它）；履约后 leftover 经 `grantLeftoverToPrepaid` 进 `billing.credits`（grant 流水，related_no=order_no 幂等）；console `GET /api/subscription/upgrade-quote` + 确认页「升级折抵 / 应付 / 溢出提示」。admin 套餐草稿编辑器 α 字段（`quota._pricing.consumable_share`，写侧校验 [0,1]，P2-d 补上）                          | 无                                                                                          |
| P2-b  | **24h 退款**（已实施）：平台参数 `admin.settings` `refund.window_hours`=24 / `refund.max_usage_ratio`=0.10（seed + 迁移，治理台可改）；`OrderService.getRefundEligibility`（已履约 new 单、该工作区×产品首笔、窗口内、消耗性配额已用比 < 阈值、实付 > 0、无在途退款单，原因码全列）；客户 `POST /orders/:id/refund-request` → `billing.refunds(order_id)` pending + `refund_requested` 事件；运营 admin `refund-audit`（approved/rejected）→ 按原渠道打款 → `refund-execute`：一个事务里 refunds success + `refund` 冲正流水（预付池快照不动）+ 折抵溢出回冲（adjust）+ 订单 `refunded`，随后 `cancelSubscription` 整体回到未订阅（含 free 前身）；console 完成态面板：资格 / 申请 / 进度 + 官网「退款说明」newtab（`/legal/refund`，website 法务页 registry 新条目）；未做：退款进度通知                                                                               | 无                                                                                          |
| P2-c  | **到期扫描 + 自动续费**（已实施，platform-api `SubscriptionRenewalJob`，每 tick 先续后扫）：① 自动续费：`auto_renew` 开、在用族、`end_at ≤ now + LEAD_DAYS`（默认 3，owner 2026-09-03 由 7 改 3）的非试用订阅，由系统开 `renew` 单（`created_by_type='system'`，TTL = 到期 + GRACE_DAYS，默认 3）；¥0 同事务结清并立即履约（end_at 以旧到期为基顺延一个周期；按周期发放的消耗性池经 `quota_pool_resets` 归零重发，周期池重锚）；付费单等客户在「我的订单」付款；无同周期价目（自定义 / 企业档）跳过记日志。重复保护：同产品在途单 / lead 窗口内已开过续订单。② 到期扫描：`end_at` 已过、仍在用（active/expiring/overdue）的非试用订阅 → `expired`（CAS + provisioning 钩子）；之后付款履约 = 复活（从 now 起算）。状态值 `expiring` 不写入——"即将到期"由读侧按 end_at 派生（权益引擎只认 active/trialing）。退役旧列另开 PR                                             | 无（复用 P1 表结构）                                                                        |
| P2-d  | **退役旧模型**（已实施）：① 删 `SubscriptionService` 八个订单方法 + `parseOrderIntent` + `PgSubscriptionRepository` 十一个订单壳方法及两份 spec；② `subscriptions.order_no / payment_ttl_minutes` 停写（`create()` 不再落列，履约不再带 order_no、去掉 23505 重试）、账单备注不再写 intent JSON；③ admin-bff 四个路由（订阅 / 搜索 / 租户 / 用量·核销）可视码改经 `current_order_id → billing.orders.order_no`，代码不再引用 `s.order_no`；④ 「订单壳」谓词（suspended + offline_purchase + 未付）从 admin-bff 409 守卫 / `pendingOrder` 字段 / admin 三页「待收款」伪状态 / console-bff 列表排除中整体删除；⑤ 迁移：壳行软删 + 存量 `current_order_id` 回填 + NOTICE 报数（orphan / 活壳都为 0 才删列）。**删列（order_no、payment_ttl_minutes、uq_subscriptions_order_no、CHECK、列锁 grant、两份 prisma 镜像、两份 seed）留到下一版**，以生产 db-init 日志的报数为门 | `2026-09-05-subscriptions-legacy-order-retire.sql`（先于发版跑）                            |
| P2-f  | **自动续费默认关、客户显式开启**（owner 2026-09-03，取代决策 5 的「默认开」）：确认页「合计」下方一行「自动续费」+ 信息图标 tooltip（机制说明只在 tooltip，不铺在页面）+ DS Switch 默认关；renew / upgrade 预填当前订阅的设置；`billing.orders.auto_renew` 随单留痕，履约时写入订阅（new 建订阅带上；renew / upgrade 不相等才 `setAutoRenew` 留历史）；系统续费单恒 true；`subscriptions.auto_renew` 列默认 true → false；`order-data-repair` 的静默翻开步骤删除；存量被静默翻开且无 `auto_renew_on` 记录的翻回并写 `auto_renew_off` 历史；续费引擎提前量 `SUBSCRIPTION_RENEW_LEAD_DAYS` 默认 7 → 3                                                                                                                                                                                                                                                                     | `2026-09-07-auto-renew-opt-in.sql`                                                          |
| P2-e  | **删列**（已实施；生产 P2-d 报数 orphan=0 / 活壳=0 后）：`ALTER TABLE metering.subscriptions DROP COLUMN order_no / payment_ttl_minutes`（唯一约束、CHECK、列级 UPDATE 授权随列消失；98_column_locks 锚点改 `[id, created_at]`）；DDL 50_metering / 两份 prisma 镜像 / seed-demo·seed-bulk-core 同步去列；引用旧列的五个历史迁移（payment-ttl、repair-pending-orders、orders-entity-split、order-events、legacy-order-retire）整体包进 psql `\if :has_legacy_order_no`（db-init 全量重放，列不在就跳过）；删列迁移自身先断言 orphan / 活壳 = 0 否则 RAISE 中止。验收：空库 DDL → 全量迁移重放 → seed 三件一次跑通（消费方形态）                                                                                                                                                                                                                                         | `2026-09-06-subscriptions-drop-legacy-order-columns.sql`（v0.26.55 发版之后跑，代码已停读） |

## 8. 不变式（守卫要盯）

1. workspace × product 至多一条当前订阅（索引）；至多一张在途订单（索引）。
2. 订阅状态只由 `SubscriptionService` 改；订单状态只由 `OrderService` 改；BFF 不直写。
3. `orders.status='fulfilled'` ⇔ `subscription_id` 非空 ⇔ 对应订阅 `current_order_id` 指回来。
4. 付了钱的订单（paid_at 非空）不可 cancelled / expired。
5. 待收款谓词只剩一处：`orders.status in ('pending_verify','paid' and fulfilled_at is null)`。
