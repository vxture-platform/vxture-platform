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

### 2.5 `metering.subscription_suspensions`（2026-09-25，暂停原因轴）

owner 定的三条前提：**不做退钱**、**客户不承担暂停期间的代价**、**暂停是平台动作**（客户无法自助暂停，自助值域只剩 upgrade / cancel）。前两条合起来意味着暂停要**顺延服务期**——不退钱，就把那些天还回去。

但「一律顺延」是错的：平台因**客户违规**暂停，顺延等于让违规者白得那些天。所以顺不顺延取决于「那一次是谁的错」，而此前 `suspended` 就是 `suspended`，无从判断。

一次暂停 = 一行（episode），不是订阅上加两列——**原因是「一次暂停」的属性，不是订阅的属性**：挂在订阅行上只存得住最近一次，而「本周期累计顺延几天」「到点了该恢复还是终止」都要按次聚合。`metering.subscriptions` 一列都不加。

| 列                                      | 说明                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reason`                                | 四档：`platform_ops` / `dispute_review` / `customer_violation` / `other`。值域权威在 `@vxture-platform/shared` catalog-domains（`SUSPENSION_REASONS`），与 `chk_subscription_suspensions_reason` 由 `lint:catalog-domains` 逐值对账                                            |
| `extends_term`                          | 由 `reason` 派生（`SUSPENSION_REASON_EXTENDS_TERM`，同一份被 admin-bff 与 admin 界面共用）。**除了客户违规一律顺延**——公道的那一侧是默认值不是例外。争议审查也顺延：审查期间客户用不了服务，查完无事凭什么让他损失那些天；真查实了违规，运营再按 `customer_violation` 重新处置 |
| `paused_at` / `resumed_at`              | 这一次暂停的窗口。`resumed_at is null` = 进行中，靠部分唯一索引 `uidx_subscription_suspensions_open` 保证同一条订阅同时只有一次                                                                                                                                                |
| `granted_seconds`                       | 恢复时结算的顺延秒数（**步骤三写**，本步恒为 NULL；CHECK 允许「已闭合但还没结算」）                                                                                                                                                                                            |
| `reason_note` / `actor_*` / `client_ip` | 运营补充说明与审计痕迹                                                                                                                                                                                                                                                         |

`extends_term` **落库而不是每次从 reason 现算**：政策以后可能改，但已经发生的那一次暂停不该被改写（同 `plan_versions` 不可变）。除收尾三列（`resumed_at` / `granted_seconds` / `reason_note`）外全部进锚点列锁（`column-locks.shared.mjs` 的 `EXTRA_ANCHOR`）。

**episode 的开合按状态转移判，不按动作名**：离开 `suspended` 的路不止 `resume` 一条——`renew` 会把冻结行翻回 `active`、`cancel` 会把它带进终态。只认 `resume` 就是给另外两条留门，那条 episode 会永远挂着，而到点处置正是按未闭合 episode 扫的。

**参数**：`admin.settings` 的 `subscription.max_suspend_days`（默认 60，与 `refund.window_hours` 同机制，运营台可改）。没有上限的话有效到期日会随暂停时长一直往后走，那条订阅永不到期、永不释放、也永不再计费。

### 2.6 顺延本身（2026-09-25，步骤三）

| 机制               | 落点                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **有效到期日**     | `end_at + 进行中那次暂停已累计的时长`。**只长在谓词与闸门里，不写库**：顺延在恢复时才结算，冻结期间把它写进 `end_at` 会让「到期时间」这一列每次刷新都不一样。三处用它：到期扫描（`findExpiredSubscriptionIds`）、恢复的前置校验（admin-bff 锁行查询）、界面灰不灰「恢复订阅」（记录上的 `effectiveEndAt`）。`extends_term = false` 不加 |
| **结算**           | `settleResumedSuspensions`：已闭合但 `granted_seconds IS NULL` 的 episode → 结成秒数写回，并加到 `end_at`。**按天向上取整**（停 3 小时也还一整天，差额平台吃；向下取整会让所有不足一天的暂停归零）。`extends_term = false` 结成 0（否则那条 episode 永远「未结算」，每趟重算）                                                          |
| **为什么事后结算** | 离开 `suspended` 的路有四条（运营恢复 / 续期 / 退订 / 到点强制恢复）。把这段数学放进每个写入方 = 四份同样的算式各自漂移。幂等判据 `granted_seconds IS NULL` 让两个调用点（admin-bff 提交后即时结算 + 作业每趟兜底）同时跑也只结一次，**失败下一趟自愈**——顺延是欠客户的账，不能静默丢                                                   |
| **续费意愿**       | 新列 `auto_renew_before`：暂停会关掉 `auto_renew`，恢复要还原成**暂停那一刻**的值。无脑置 `true` 会给本来关着自动续费的客户悄悄打开它；不还原等于运营暂停一次就替客户永久关掉了它。两个方向都静默。存量 episode 该列为 NULL ⇒ 不动它                                                                                                    |
| **到点处置**       | 超过 `subscription.max_suspend_days`（默认 60）还没恢复：平台原因（运维 / 争议审查 / 其他）→ **强制恢复**（拖着不查是平台的问题）；客户违规 → **终止**。终止发新通知 `subscription.suspension_ended`（不复用 `cancelled_*` 那三条——它们讲的是「这张单退不退钱」，而这条讲的是「服务不会再恢复」）                                       |
| **客户侧**         | `subscribePage.hint.suspended` 拆成两条完整句，按 `suspensionExtendsTerm` 选。只回传这个布尔，**不回传原因**：原因里有「客户违规」那一档，是运营的判断，不该从客户界面读出来                                                                                                                                                            |

**撤掉了原计划里的一项：「延长配额 `period_anchor`」。** 先验它会不会动——当时不动：`period_anchor` 全仓**只有写入方**，配额重置的真实判据按日历对齐、不读锚点。改它是个看起来生效的空操作。

> **后续（2026-09-26）**：那处「注释说锚定、代码按日历」的不一致查下去是**代码没实现铁律五**，owner 裁定单独排一批改实现，已落地（见 `data_commerce_200_metering.md` 铁律五与 `quota-period.utils`）。**顺延仍然不去动 `period_anchor`**——顺延要还的是服务期，不是把客户的额度刷新日整体后移；后者会让他更晚拿到下一期额度。两件事各走各的。

配额这一侧的公道由顺延本身给：多出来的那些天落在某个刷新周期里，那个周期有它自己的额度。

**存量被冻结的订阅没有 episode**（原因轴是步骤二才加的）——那是「按设计没有」，不是缺一条记录：无 episode = 有效到期日等于 `end_at` = 不顺延，没有要补的账。

### 2.7 冻结中的订阅仍占槽位（2026-09-26，上线走查发现）

owner 走查时看到的是「订阅被暂停期间，官网产品卡片显示『订阅』而不是『升级』」。那是露出来的一角，真正的问题在 `uidx_subscriptions_live_per_product` 的谓词里没有 `suspended`。本机库上实测的完整链条：

1. 订阅 → `suspended`
2. 同 workspace×product 再建一条 `active`（客户从卡片点「订阅」买第二份）→ **索引不拦**
3. 运营点「恢复订阅」→ `23505` → **那条被冻结的订阅从此恢复不了**（付费档还多付一次钱）

**根因是一个集合被两个问题共用**，而两者在 `suspended` 这一档上答案相反：

| 问题                                             | 集合                           | `suspended` 该不该在里面     |
| ------------------------------------------------ | ------------------------------ | ---------------------------- |
| 在不在服务（C2 / 用量 / 消费 / app-scope）       | `active`+`trialing`            | **不该** —— 冻结就是不给服务 |
| 占不占槽位（还能不能再买、恢复后回不回得到原地） | 唯一索引 / 官网卡片 / 下单守卫 | **该** —— 它还在，只是停着   |

全仓 17 处用了 `active/trialing` 这一族，**大多数是对的**（它们答的是第一个问题）。这一批只改答第二个问题的那几处：

- **库**：索引谓词加 `suspended`（迁移带存量违例预检，有重复就中止并点名，不静默失败）
- **下单**：`assertNoSuspendedSubscriptionForProduct` —— 不分 intent 一律 409。`new` 会造重复行；`upgrade`/`renew` 会改动那条被平台冻结的订阅，等于客户自己解了冻，而暂停是平台动作
- **官网卡片**：`suspended` 进「已订阅」集合，但走**自己的分支**——三个入口都不给（订阅会造重复、进入是死控件因为产品正停着服务、升级会动那条冻结订阅），只显示状态字
- **console 确认页**：同理关掉提交按钮并给 Banner。点下去必定 409 的按钮是死控件，比灰着更糟

**展示态：原因不出网，但也不能一律说「维护中」。** 值域里有 `customer_violation`，那是运营的判断，不该从客户界面读出来；可是对一个因违规被停的客户说「维护中」，是平台替自己撒谎。所以 BFF 把原因映射成一组客户看得懂、且都为真的词：

| reason               | 展示态        | 文案     |
| -------------------- | ------------- | -------- |
| `platform_ops`       | `maintenance` | 维护中   |
| `dispute_review`     | `review`      | 审核中   |
| `customer_violation` | `restricted`  | 服务受限 |
| `other` / 无 episode | `paused`      | 已暂停   |

`suspensionExtendsTerm` 照实出网——客户真正关心的是「停掉的这些天还不还给我」，那不是运营判断，是他的账。

**详情弹窗与倒计时（2026-09-26，owner 选了「加选填字段」那条路）**：episode 加 `expected_resume_at`（选填，运营暂停时填）。

- **倒计时的终点只能是它**，不能是 `max_suspend_days`。后者是内部处置阈值（到点平台原因强制恢复、客户违规终止），显示出去客户会读成「最晚那天就好了」——平台从没这么说过。没填就只显示「已暂停 N 天」。
- **它可改，不进锚点列**（与 `reason`/`extends_term` 相反）。那两个是已经发生的事实，改它们等于改写历史；而这是个**估计**，维护拖长了运营该能改。一个改不了的估计比没有更糟——客户盯着一个早就过期的倒计时。
- **过点之后不翻负数**，落回「已暂停 N 天」。估计错了是常事，界面不该把它演成一个承诺被违背的样子。
- 「已暂停 N 天」**向上取整到 1**，与顺延的取整口径一致：两处取整不同，客户会看到「已暂停 0 天」却被顺延了 1 天。

踩到并记下的一条：这几条文案带占位符，**必须用 `t.raw` 取模板**交给弹窗在渲染时填。`useMemo` 里用 `t(key, { days: 0 })` 会当场把占位符替换掉，结果永远显示「已暂停 0 天」，而且不报错。

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
3. ~~履约后消耗性配额使用率 < 阈值（平台参数 `refund.max_usage_ratio`，默认 0.1）。~~

动作：`refunds(order_id)` 两段审核 → 执行成功 → 订单 `refunded` → 订阅**整体回到未订阅**（`cancelled`，end=now，池 retire），含 free——旧档价值已折进这张单、旧周期已在升级时结清。leftover 已进预付款的部分一并冲回。

- **修订（2026-09-25）——第 3 条改为折算退，退款金额不再等于 `payable_amount`**：owner 决定「考虑配额消耗，后续再补充再 24H 内，也需要折算，我们有成本」。用量**不再是不可退的理由**，而是决定退多少：`refund = round2(实付 × (1 − α × 已用比))`，α 就是升级折抵那个 `_pricing.consumable_share`（`money/proration.ts` 的 `computeWindowRefund`，与 `computeProration` 同一文件同一个 α，不另写一套）。**窗口内 `r` 取 1**：退款窗口恰好是「刚买、几乎没用」那段时间，原样代入 `r = daysLeft/daysTotal` 会让买了 2 小时就退的月付单只退 96.7%，是对「24h 全额退」的回退。`refund.max_usage_ratio` 这个参数与 `usage_over_threshold` 这个原因码**都保留但不再产生**——将来要重新立「用超多少不得退」的规则，两样都是现成开关。折算下来为 0（α=1 且配额用尽）时不可退，新原因码 `fully_consumed`（不开一张 ¥0 的退款单：那对客户是「已退款 ¥0」的假象）。退款单的 `refund_type` 按**金额**判（少于实付 = `partial`），不反过来用类型推金额。完整算例见 owner 定稿文档《订单与服务状态机》的「折算退的算例」一节。
- **修订（2026-09-25）——运营侧退订也走结算**：admin 的订阅动作在 `cancel` 且确实终止时调同一个 `OrderService.settleAfterCancel`，`actorType='operator'` 决定退款单的 `created_by_type` 与**通知发给客户而不是发给运营**。**仍存的缺口**：那条写路径是裸 SQL，不触发 provisioning 的 deprovision / entitlement invalidate（客户自助那条会触）——运营停了服务，产品侧可能还在给。要修得把那条写路径整体改走 `SubscriptionService`。
- **修订（2026-09-25，批 5）——上一条那个缺口已补**：写入仍是裸 SQL（它带着 `renew` 的 `change_type='renewed'`、试用转付费的 `subscription_kind` 翻转、在库里算 `end_at` 的周期数学），但提交后调 `SubscriptionService.applyExternalStatusChange`，跑的是**同一套** `applyTransitionHooks`。顺带更正上一条的机制表述：`suspended` 既不在 `ACTIVATED` 也不在 `DEACTIVATED` 集合里，所以**按设计暂停本来就不发 deprovision**（平台不停服，产品按权益信封里的状态自己停）——暂停缺的是那一次权益缓存失效，退订才是 deprovision 与失效两样都缺。事务外三件事的顺序是：先对齐产品侧 → 再发消息 → 最后结算钱。
- **修订（2026-09-25，批 6）——本节这些条件不是绝对的**：上面三条（窗口 / 首购 / 用量）是**政策**，运营有 `POST /api/orders/:id/refund-create` 这条逃生口可以按个案推翻（`commerce:payment.settle` + step-up，理由必填并带「运营发起（绕过自动资格判定）」前缀落 `refund_reason` 与 `order_events`）。**不可推翻的是事实与账目完整性**：未履约、0 元单、已有在途退款单——给什么理由都拒。加这条的判据是本仓那条通则「判据自动算的就必需逃生口」：此前 24 小时一过，计费错误 / 服务事故 / 误驳回全都退不了，而运营连创建一张退款单的入口都没有。逃生口创建的单**仍走审核 → 执行**，库级门一视同仁。

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
| P2-g  | **客户通知：站内 + 邮件**（已实施，owner 2026-09-03「通知先做站内 + 邮件」）：新包 `@vxture/service-notification`（`NotificationDispatcher`：收件人默认租户 owner + 订单下单人；先落 `support.inbox_messages` 去重键，落成才按 `NotificationPreferences` 发邮件（subscription / billing 主题邮件默认开、可关），每次投递记 `support.notification_logs`）；`OrderService` / `SubscriptionService` 以 setter 注入 `CustomerNotifier`（三个 BFF 装配：platform-api 作业、console-bff 客户动作、admin-bff 运营动作；platform-api compose 补 platform-mail.env）；触发：到期前提醒（自动续费关、LEAD_DAYS 内，`SubscriptionRenewalJob` 第三趟）/ 到期 / 续费单待付 / 履约开通 / 续费成功 / 退款四阶段；console 铃铛抽屉 + `/inbox` 页 + 未读数；未做：短信、公告推送、模板 i18n                                                                                              | `2026-09-08-inbox-messages.sql`                                                             |
| P2-f  | **自动续费默认关、客户显式开启**（owner 2026-09-03，取代决策 5 的「默认开」）：确认页「合计」下方一行「自动续费」+ 信息图标 tooltip（机制说明只在 tooltip，不铺在页面）+ DS Switch 默认关；renew / upgrade 预填当前订阅的设置；`billing.orders.auto_renew` 随单留痕，履约时写入订阅（new 建订阅带上；renew / upgrade 不相等才 `setAutoRenew` 留历史）；系统续费单恒 true；`subscriptions.auto_renew` 列默认 true → false；`order-data-repair` 的静默翻开步骤删除；存量被静默翻开且无 `auto_renew_on` 记录的翻回并写 `auto_renew_off` 历史；续费引擎提前量 `SUBSCRIPTION_RENEW_LEAD_DAYS` 默认 7 → 3                                                                                                                                                                                                                                                                     | `2026-09-07-auto-renew-opt-in.sql`                                                          |
| P2-e  | **删列**（已实施；生产 P2-d 报数 orphan=0 / 活壳=0 后）：`ALTER TABLE metering.subscriptions DROP COLUMN order_no / payment_ttl_minutes`（唯一约束、CHECK、列级 UPDATE 授权随列消失；98_column_locks 锚点改 `[id, created_at]`）；DDL 50_metering / 两份 prisma 镜像 / seed-demo·seed-bulk-core 同步去列；引用旧列的五个历史迁移（payment-ttl、repair-pending-orders、orders-entity-split、order-events、legacy-order-retire）整体包进 psql `\if :has_legacy_order_no`（db-init 全量重放，列不在就跳过）；删列迁移自身先断言 orphan / 活壳 = 0 否则 RAISE 中止。验收：空库 DDL → 全量迁移重放 → seed 三件一次跑通（消费方形态）                                                                                                                                                                                                                                         | `2026-09-06-subscriptions-drop-legacy-order-columns.sql`（v0.26.55 发版之后跑，代码已停读） |

## 8. 不变式（守卫要盯）

1. workspace × product 至多一条当前订阅（索引）；至多一张在途订单（索引）。
2. 订阅状态只由 `SubscriptionService` 改；订单状态只由 `OrderService` 改；BFF 不直写。
3. `orders.status='fulfilled'` ⇔ `subscription_id` 非空 ⇔ 对应订阅 `current_order_id` 指回来。
4. 付了钱的订单（paid_at 非空）不可 cancelled / expired。
5. 待收款谓词只剩一处：`orders.status in ('pending_verify','paid' and fulfilled_at is null)`。
