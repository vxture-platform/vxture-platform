# arda 订阅商业闭环：线下订单全链路（product_320）

> 版本：**v1.0** · 状态：设计定稿，分批实施中（PR0–PR6，见 §6）
> 定位：以 arda（智能数据治理平台 = arda 平台 + varda 智能体助手）为首发产品，打通「官网产品卡片 → console 订阅下单 → 线下付款 → admin 人工确认收款 → 立即开通 + provisioning webhook 通知产品栈」的完整商业闭环。**支付网关未接入（payment plane pending），本期为线下收款 + 人工核销形态；在线支付接入时本文订单模型不变，仅替换"人工确认"为网关回调。**
> 上游：[`product_220`](./product_220_catalog-resource-model.md)（目录·权益·资源模型）、[`product_310`](./product_310_arda-integration.md)（arda 对接，D10/D12 决策）、[`data_commerce_200`](./data_commerce_200_metering.md)（metering）、[`data_commerce_210`](./data_commerce_210_billing.md)（billing）、[`data_commerce_220`](./data_commerce_220_provisioning.md)（provisioning）、`@vxture/shared` 值域（六值订阅状态契约，**本设计不新增状态值**）。
> 消费面：console `/subscribe`（#777 深链承接的后续闭环）、admin 订单工作队列、website `/products` 改版。

---

## 1. 商业口径（owner 拍板，2026-07-14）

### 1.1 套餐构成

「智能数据治理平台」套餐主组件 = **arda**（primary），**varda 智能体助手随套餐档位以权益开关放开**（`varda.enabled` / `varda.readonly` tiered 指标，现有模型不变，不新建独立 varda 产品组件）。订阅围绕 **plan**（plan 可 bundle 产品）；business 档为固定 5 席位打包价，V1 不做按席位加购。

### 1.2 定价（plan_version v2，CNY）

| 档位                  | 月付                                                                                    | 年付   | 年付折扣           |
| --------------------- | --------------------------------------------------------------------------------------- | ------ | ------------------ |
| free                  | 0                                                                                       | —      | —                  |
| starter               | 199                                                                                     | 1,999  | ≈8.4 折，省 ¥389   |
| pro                   | 499                                                                                     | 4,999  | ≈8.3 折，省 ¥989   |
| business（含 5 席位） | 1,999                                                                                   | 19,999 | ≈8.3 折，省 ¥3,989 |
| enterprise            | 私有化部署，联系销售：**无 plan_prices 行**，目录自动呈现"联系销售"，服务端拒绝自助下单 |

营销口径：**年付约 8.3 折（相当于买 10 个月送 2 个月）**。

### 1.3 权益配额（workspace 级总量，全员共享；-1 = 不限；pool 型按月重置）

| 指标                   | free   | starter | pro     | business  | enterprise               |
| ---------------------- | ------ | ------- | ------- | --------- | ------------------------ |
| member.max（席位）     | 1      | 1       | 3       | 5         | -1                       |
| dataset.max            | 50     | 500     | 5,000   | -1        | -1                       |
| datasource.max         | 2      | 5       | 20      | 100       | -1                       |
| service_endpoint.max   | 0      | 1       | 10      | -1        | -1                       |
| retention.days         | 30     | 90      | 365     | -1        | -1                       |
| varda 助手             | ✗      | ✓ 只读  | ✓ 只读  | ✓ 可写    | ✓ 可写                   |
| sync.frequency         | manual | daily   | hourly  | realtime  | realtime                 |
| storage.bytes          | 1 GiB  | 10 GiB  | 100 GiB | 1 TiB     | 10 TiB                   |
| service.api.call /月   | 1,000  | 20,000  | 200,000 | 2,000,000 | 20,000,000               |
| quality.check.run /月  | 100    | 1,000   | 10,000  | 100,000   | 1,000,000                |
| ai.credit /月（varda） | 0      | 100     | 1,000   | 10,000    | 100,000 预置（按合同调） |

相对 v1 seed 的变更：`member.max` pro 1→3、business 10→5（按 5 席位打包价重标定）；`ai.credit` starter 50→100、pro 500→1,000、business 50,000→10,000。

## 2. 订单模型（核心决策，防回退留痕）

### O1 订单表示 = suspended 订阅行 + unpaid 账单（采纳）

**每笔订单 = 一行 `metering.subscriptions`（`status='suspended'`，`activation_method='offline_purchase'`）+ 一张 `billing.invoices`（`bill_status='unpaid'`，`subscription_id` 指向订单行）+ 一行 `invoice_items`（`subscription_fee`）。** 不新增订阅状态值（@shared 六值为已发布产品契约），不建独立 order 表（维持 admin 合成订单视图模型）。

- **待支付订单判定谓词**（全平台统一，勿散写）：`status='suspended' AND activation_method='offline_purchase' AND 最新 invoice bill_status IN ('unpaid','partial')`——**321 修订**：原 `='unpaid'` 查不到有实收的存量部分收款单（admin 部分确认路径产生），[product_321](product_321_order-payment-and-settlement.md) P1 将其纳入"待付款"族（cashDue 自动扣减已收）；同步改动点=subscribe-context `pendingOrder` 查询、下单重复挂单 409 守卫（PR2 落地）。与"用户主动暂停"（activation_method 为原购买方式、无未付账单）可区分。
- 配额池随单物化，但 D10 门控（仅 active/trialing 可消费）使挂单期天然不可烧——无需额外防护。
- 挂单不触发 provisioning（ACTIVATED 集合不含 suspended）；确认激活时经服务层状态迁移钩子恰好补发一次 `tenant.provisioned`。

**否决：invoice-only（确认时才建订阅行）**——新购订单无 `subscription_id` 在订阅驱动的 admin 合成视图中不可见（被迫重写 ORDER_BASE_SQL）；`order_no` 失去设计落点；升级目标 plan_version 仍需借道 invoice 走私。放弃。

### O2 订单号

`ORD-{YYYYMM}-{10位hex}` 写入 `subscriptions.order_no`（沿用 admin `billingCode()` 生成模式）；账单号 `INV-…`、支付单号 `PAY-…` 沿用现规。console"我的订单"与 admin 工作队列均以 order_no 可查。**待办**：`order_no` 部分唯一索引（`WHERE order_no IS NOT NULL`）进 DDL 治理（§8.3）。

### O3 支付行时机

**下单时不建 `billing.payments` 行**（付款事件未发生；预建 `pending_verify` 会在确认插入新行后留永久悬挂行）。admin 确认时一次性插入 `pay_source='offline', pay_status='paid'`（现有逻辑）。工作队列过滤 = 未付 invoice 的 offline 订单，而非 pay_status。客户"我已转账"上报为 V2 预留（届时确认段升级既有 pending_verify 行而非新插）。

### O4 意图统一走订单

| intent                          | 行为                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| new                             | 新 suspended 行 + unpaid invoice                                                                                                                                                                                                                                                                                                      |
| renew（expired/cancelled 再订） | 同 new——新行新单号，旧行不改（符合 metering "续费=新增订阅"既有注释）；确认时旧行已死不触发档位冲突                                                                                                                                                                                                                                   |
| upgrade（active 换档）          | 新 suspended 行**落在目标 plan_version**（行自身记住升级目标）；`invoices.operate_remark` 存机读 JSON `{"intent":"upgrade","upgrade_of":"<旧订阅id>"}`；确认时对**旧行**执行 `upgradeSubscription`（in-place 换版，D12 裁定），订单行转 cancelled 留痕（从未 live → 不发 deprovision）。旧行确认前已失效 → 回落为新开通（确定性规则） |
| free                            | 不产生订单：直接 `createSubscription(status='active', kind='free', activation_method='free', end_at=null)`，即时开通即时发 webhook；已有存活订阅则 409                                                                                                                                                                                |
| enterprise                      | 无价格行 → 目录呈现"联系销售"，服务端统一守卫"无精确价格行即拒单"（同时覆盖误配 plan）                                                                                                                                                                                                                                                |

### O5 防护与取消

- **重复挂单防护**：同 workspace × product 已有待支付订单 → 409 携带既有订单，console 直接跳转其待支付面板。
- **取消未付订单**（客户 console cancel / 运营 admin void）：invoice → cancelled、订阅行 → cancelled、池退役；**不走 `cancelSubscription()`**（其无条件 `fireDeprovisionIfUncovered` 会对从未开通的 workspace 误发 `tenant.deprovisioned`）。
- **恢复已取消订单**（2026-07-30 新增，admin 管理入口）：仅限从未激活过（`end_at is null`，即从未走过 `cancelSubscription()`）且未收到任何支付的 offline_purchase 订单——把订阅行拉回 `suspended`、账单拉回 `unpaid`、还原被软删的折扣行；新权限码 **`commerce:order.restore`** + step-up（`POST /api/orders/:orderId/restore`）。**范围外**：已激活后再取消的订阅（真实退量/解除配置已发生，恢复需重新开通，不在此端点范围）。
- **确认即开通**：`start_at = now()`（确认时刻重算，非下单时刻）、`end_at = start + cycle_count × cycle_unit`、**配额池 `period_anchor`/`current_period_start` 重锚**——否则月池重置锚在下单时间产生配额漂移。

### O6 既有旁路封堵（本期必修）

1. **admin `offline-payment-confirm` 裸 SQL 激活绕过 SubscriptionService → 不发 provisioning webhook**（既有 bug）：改两段幂等，段2 激活走服务层（§4.3）。
2. **console `POST /api/subscription/actions` 的 upgrade 为即时免费换档**：真实价格落库后即计费漏洞，客户侧升级全部改走订单。
3. admin subscriptions.router 的 renew/resume 裸 SQL 同类旁路——**本期外**，记 tech-debt（§8.5）。

## 3. 全链路时序

```
website /products 卡片（未登录→登录，卡片态：可试用|已开通）
  └─ {订阅} 深链 console /subscribe?product=arda&intent=subscribe[&target_tier=…]
       └─ 选档 + 月/年周期 → POST /api/subscription/orders
            ├─ free → 即时 active + tenant.provisioned → 完
            ├─ 409 已有待支付单 → 跳其待支付面板
            └─ 201 {orderNo, 金额, 线下汇款指引} → 待支付面板（可取消）
                 └─ 客户线下汇款（备注 orderNo）
admin 订单工作队列（待核销筛选，按 orderNo 检索）
  └─ step-up + commerce:payment.settle → offline-payment-confirm
       ├─ 段1（资金）：transactions + payments(offline,paid) + invoice paid
       └─ 段2（激活，走服务层）：按 intent 分派
            ├─ new/renew → activatePendingOrder（suspended→active，起止重算，池重锚）
            └─ upgrade  → applyUpgradeOrder（旧行 in-place 换版，订单行 cancelled 留痕）
       → 状态迁移钩子发 tenant.provisioned / 版本变更事件 → arda（HMAC webhook，tailnet）
console 显示已开通/配额 · website 卡片翻转「已开通 + 升级/进入」
```

## 4. 各面实施要点

### 4.1 目录定价 v2 reseed（`deploy/database/seed/seed-catalog.mjs`）

锁定版本不可变（95 触发器），改价 = 每个付费 plan 幂等切 v2：

1. `insert plan_versions(version_no=2, is_locked=false) on conflict do nothing`；
2. **仅当 v2 未锁**（首跑/断点重跑）：从 v1 拷 `plan_components`（叠加 §1.3 配额补丁）→ 插月付+年付 `plan_prices`（enterprise 不插）→ 锁 v2；
3. `current_version_id` 从 v1 **条件**重指 v2（不覆盖未来 v3）。

free / beta-trial 保持 v1。既有订阅钉在 v1 不受影响；console `queryPlanLadder` 只认 current+locked，自动改供 v2。同批入 `commerce:order.void` 权限码（§4.3）。验证：`pnpm lint:seed`、seed 双跑、`arda-catalog.itest.spec.ts` 扩展（各付费档 v2 月/年价对、enterprise 零价格行、free 不动）。

### 4.2 订阅服务订单原语（`services/commerce/subscription`）

- `CreateSubscriptionInput`/`SubscriptionRecord`/`repo.create` 参数化 status / subscriptionKind / activationMethod / createdByType / cycleCount（现硬编码 active/paid/customer 为已标注占位债）。
- 新增：`createOfflineOrder`（单事务 suspended 订阅 + invoice + items；预检价格行/重复单/档位冲突）、`activatePendingOrder`（CAS suspended→active + 起止重算 + 池重锚 + `applyTransitionHooks`）、`applyUpgradeOrder`、`cancelPendingOrder`（§2 O4/O5 语义）。
- 测试：镜像 `subscription-provisioning.spec.ts`（挂单零 webhook、确认恰一次、取消零 deprovision）+ `SUBSCRIPTION_ITEST` itest。

### 4.3 admin 确认链路（`bff/admin-bff`，先于客户下单上线）

- 以 itest 同款**无模块直构**在 admin-bff 实例化 SubscriptionService/ProvisioningService（尊重"运营治理面不引服务模块"边界；只 enqueue，派发仍在 platform-api job）。
- `offline-payment-confirm` 两段幂等：段1 资金（原事务保留；**"已付清但仍 suspended"改跳段1 直入段2**，崩溃单可重驱动）；段2 按 `operate_remark` intent 分派 activate/upgrade（遗留已 active 单 no-op）。保留 `@RequireStepUp()` + `commerce:payment.settle`。
- 新 `POST /api/orders/:orderId/void`（驳回未付订单）：新权限码 **`commerce:order.void`** + step-up；存在 paid 支付则拒绝。
- 列表加 status/orderNo 过滤；OrdersPage 加"待核销"预设筛选；OrderDetailPage 加驳回（扩展既有组件，不新建）。

### 4.4 console 下单（`bff/console-bff` + `portals/console`）

- `POST /api/subscription/orders`（productCode / planVersionId / cycleUnit / intent / upgradeOf → 201 orderNo+金额+汇款指引；free 短路；409 DUPLICATE_PENDING_ORDER / TIER_CONFLICT / 400 NOT_PURCHASABLE）、`GET /api/subscription/orders`、`POST …/orders/:id/cancel`。workspace 服务端按 tenant 解析 default workspace（不信任 `req.tenant.workspace` 字符串）。
- `subscribe-context` 增 `pendingOrder`；`KNOWN_INTENTS` + `subscribe`（词表演进，合入后知会 arda 线，§8.4）。
- SubscribePage 状态机：待支付面板 ｜ 未订阅（月/年切换 + 五档卡：free 免费开通 / paid 订阅·续费 / enterprise 联系销售）｜ active → 升级下单 ｜ SubscriptionPage/BillingPage 增"我的订单"。
- 汇款指引（户名/开户行/账号）走平台配置，**账户信息待 owner 提供**（§8.1）。

### 4.5 website `/products` 改版（`portals/website` + `bff/website-bff`）

- IA：`/products` 总介绍页 = hero + **六产品卡片**（L1 Atlas/Ontos/Runos + L2 Arda/Karda/Terra）+ **arda 五档定价区块**（月/年切换；V1 静态 i18n 与目录人工对齐，后续接公开目录 API）；`/products/[slug]` 详情页——arda 承接原"全域数智平台"内容更正归位，其余 5 个"待建设"占位。
- 卡片：克隆 `AgentMarketplacePage` 解剖，**去 capabilities/tags**，留 logo + 类型 + 标题 + 概要 + 业务价值；title 徽标 `可试用|已开通`；操作区：未订阅 {订阅}+[申请演示]+[产品介绍(新tab)] / 已订阅 {升级}+[进入]+[产品介绍] / 待建设禁用。
- 订阅态：website-bff 新 `GET /api/me/product-subscriptions`（active_org 的 default workspace，C2 同款代表订阅谓词）；未登录一律未订阅态。
- 深链：`console-entry.ts` 加 `buildConsoleSubscribeUrl`；护栏：新 token 进 DS `tokens-website.css`，`pnpm lint:design` 必跑；i18n 静态 switch 注册。

## 5. 生产发布形态

reseed（v2 定价 + order.void 权限）按生产 reseed runbook 走（先 perm 后代码次序参照 TD-027 经验）；服务部署按 CI/CD 晋升链（develop→beta→main），逐步单独确认，不随本设计自动执行。

## 6. 批次（每批独立可合入 develop）

| 批      | 内容                                                                | 验证                                 |
| ------- | ------------------------------------------------------------------- | ------------------------------------ |
| PR0     | 本设计文档                                                          | 评审                                 |
| PR1     | seed：arda v2 定价+配额 + enterprise 去价格 + `commerce:order.void` | lint:seed、双跑、目录 itest          |
| PR2     | subscription 服务订单原语                                           | 单测 + itest                         |
| PR3     | admin 两段确认（修 O6.1）+ void + 工作队列                          | 守卫 spec + webhook_deliveries itest |
| PR4     | console-bff 订单端点 + O6.2 封堵 + SubscribePage 状态机             | bff spec + 手工 e2e                  |
| PR5     | website /products 总页+卡片+详情+订阅态端点+定价区块                | lint:design + 双语双主题走查         |
| PR6(选) | 订单邮件、文档回填、生产 runbook                                    | —                                    |

PR3 先于 PR4：客户能下单那一刻，确认路径已能正确通知 arda。

## 7. 端到端验收

官网卡片 → 深链 → 选档下单得 ORD 号 → admin 按单号检索 → step-up 确认 → 订阅 active + 池重锚 → `provisioning.webhook_deliveries` 落 `tenant.provisioned` 且派发 2xx → console 已开通 → 官网卡片翻转。另验：重复下单 409、取消、升级确认、free 即开、enterprise 无入口。

## 8. 开放项

1. **线下收款账户信息**（户名/开户行/账号）——PR4 文案阻塞项，需 owner 提供。
2. §1.3 配额为建议值，PR1 评审可直接改数。
3. `order_no` 部分唯一索引进 DDL 的治理路径（98_column_locks）。
4. `KNOWN_INTENTS` + `subscribe` 合入后知会 arda 对接线（arda_303 词表容错契约允许先行）。
5. admin subscriptions.router renew/resume 同类 provisioning 旁路 → tech-debt 登记。
6. 客户"我已转账"上报（pending_verify）、按席位加购 addon、在线支付网关 → V2。
