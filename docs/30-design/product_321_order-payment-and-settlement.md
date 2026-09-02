# arda 订阅商业闭环二期：付款结算全链路（product_321）

> 版本：**v1.3** · 状态：设计定稿（业务流程 / 金额模型 / UI 稿 owner 确认 2026-07-18；三轮对抗校审：v1.0→35 项→v1.1→11 项（否决"部分到账拆腿"改足额确认制）→v1.2→17 项（partial 族金额锚点/无腿路径恒等/段 2 永久失败出口/upgrade 幂等/admin partial 盲区）→v1.3），分批实施（PR0–PR5，见 §9）
> 定位：[product_320](product_320_offline-subscription-order-flow.md) 的紧邻续篇（插档 321）。320 打通"下单—人工确认—激活"骨架；本篇补齐**付款环节**：付款页、用户申报、驳回/超时、券结算引擎、钱包预留。
> 上游：[product_320](product_320_offline-subscription-order-flow.md) · [data_commerce_210_billing](data_commerce_210_billing.md) · [data_commerce_230_promotion](data_commerce_230_promotion.md) · `@vxture/shared` 值域
> 消费面：console-bff/console、admin-bff/admin、platform-api（jobs）、`@vxture/service-subscription`、新建 `@vxture/service-promotion`

---

## 1. 现状痛点（本篇要解决的）

320 上线后实测断点（2026-07-18 复盘）：

1. **无付款页**：下单后不跳转，仅 /subscribe 就地渲染"订单待确认"面板；汇款信息是 `pending.configPending` 占位（`OFFLINE_PAY_*` env 未配置）；收款码资产 `portals/console/public/assets/payment/vx-alipay.png` 零引用。
2. **无"已付款"申报**：用户付完款无处上报，admin 不知道哪单该核；用户可见状态仅 pending/confirmed/closed 三档。
3. **无超时**：待付款订单永久 `suspended` 挂起，无自动关闭。
4. **无券/无余额**：promotion 三表、`billing.credits` 均已建表但业务层全空（无核销引擎、无 credits 写路径、admin"新建优惠"禁用，TD-028/TD-030）。

## 2. 核心决策（P 系列，防回退留痕）

### P1 订单状态机扩为五态 + 一过渡态，判定为**有序谓词**（采纳）

用户可见状态（console 派生态，非新 DB 枚举；@shared 六值订阅状态不动）。**按序判定，首个命中即返回**（顺序 load-bearing）：

| 序  | 用户态                                | 判定谓词                                                                                                                                                                                                                    |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 开通处理中 `activating`（过渡）       | invoice `paid` **且** sub 仍 `suspended`+`offline_purchase`——全额券/确认后段 2 未跑的悬挂窗口，自愈见 P8；UI 显示"付款成功 · 开通处理中"，轮询即换终态                                                                      |
| 2   | 已完成 `completed`                    | invoice `bill_status='paid'`（升级单订单行 sub=cancelled 留痕亦判此态）                                                                                                                                                     |
| 3   | 已付款·待确认 `paid_pending_verify`   | 存在 `pending_verify` 现金腿（`billing.payments`）                                                                                                                                                                          |
| 4   | 已取消 `cancelled` / 已超时 `expired` | sub `cancelled`：histories 有 `order_expired` → `expired`，否则 `cancelled`                                                                                                                                                 |
| 5   | 待付款 `pending_payment`              | 其余（sub `suspended`+`offline_purchase` + invoice 未清=`bill_status IN ('unpaid','partial')`）；`paid_amount>0` 的存量部分收款单亦在此（cashDue 自动扣减已收，P5；该族 TTL 豁免 → `expireAt` 下发 null、付款页隐藏倒计时） |

wire 值域即上表六个 slug（`GET orders` 的 `orderStatus` 契约 + i18n key 同源），替换现有 pending/confirmed/closed 三值。**"invoice 未清"全文统一为 `bill_status IN ('unpaid','partial')`**——PR0 同步修订 320 O1 判定谓词（原文只写 `unpaid`，查不到 partial 存量单）并点名同步改动点：subscribe-context `pendingOrder` 查询、下单重复挂单 409 守卫。

- 申报动作写一条 `billing.payments`（`pay_source='offline'`、`pay_status='pending_verify'`、`total_amount`=还需实付、`actor_type='customer'`），DDL 预置而 320 未启用的中间态；admin 侧 `deriveOrderStatus` 已透传 `pending_verify`，另需新增"已付未开通"派生（对应序 1，置顶，**不得归入 confirmed**——否则悬挂单在运营视角"已完结"，永不被发现）。
- 渠道字段映射表（API↔落库，两处不得各写各的）：API body `payChannel ∈ alipay | bank_transfer` → 落库 `pay_channel='alipay'` + `offline_pay_type=NULL`，或 `pay_channel='bank'` + `offline_pay_type='bank_transfer'`。
- 否决：继续无申报纯人工翻单（现状痛点 2）。

### P2 申报后不可取消（用户 cancel 与 admin void 同受约束）；驳回必填原因、回待付款并重置倒计时（采纳）

- 存在 `pending_verify` 腿时：用户 cancel 返回 409；**admin void 同样拒绝**。"先驳回申报再 void"的处方**仅适用于零实收订单**（`invoice.paid_amount>0` 的订单本就被 `cancelOfflineOrder` 守卫 409，见 P9 终结边界）。失败腿（failed）保留留痕不转 closed。
- console 取消按钮对 `paid_amount>0` 订单**禁用**（而非放行后 409）。
- admin 驳回：现金腿 `pending_verify → failed`（`status_msg`=原因）+ **完整释放编排（P8b）** + histories `payment_rejected`，订单回"待付款"，原因透传用户付款页横幅，TTL 重锚（P4）。用户可重新申报（可换券）或取消。

### P3 订单生效 = 订阅生效，不拆分（采纳）

确认收款走 320 两段幂等编排（段 1 资金事务 + 段 2 激活独立事务 + commit 后 best-effort webhook），**收敛结果等价于原子**：任何中间态可重驱动（人工 + P8 自愈 job 双通道）。唯一已知的段 2 永久失败因子=确认前冒出的档位冲突（如挂单期用户另开了同产品 free 订阅——`findTierConflicts` 只扫 active/trialing，挂单互不可见），运营处方：取消冲突订阅→下一轮自愈自动收尾；防御前置两道：cashDue=0 分支收钱前预检（P8）、**free 即时开通分支服务端补挂单检查**（同 O5 语义：已有同产品待付款单 → 409 引导先处理订单，堵陈旧页签/直接 API 绕过）。拆两个订单状态只会制造无业务对应的中间态；悬挂窗口对用户呈现为 P1 序 1 过渡态。

### P4 超时只约束"待付款"阶段，TTL 按租户类型（个人 30 分钟 / 组织 48 小时），申报冻结时钟（采纳；2026-08-20 修订）

- TTL 仅在"待付款"计时；申报即冻结（银行转账到账慢不受罚）。
- 锚点用 append-only 历史：`expire_at = GREATEST(sub.created_at, 本订单行最近 histories(change_type='payment_rejected').created_at) + TTL`（histories 按 `subscription_id`=订单行查，天然限定本单）——驳回自动重锚。否决用 `payments.updated_at` 做锚（无自动刷新触发器，且是通用簿记列，任何补录都会悄悄续期）。
- **修订（2026-08-20）——TTL 从"全局 env 常量"改为"每单定格"**：下单时 console-bff 依 `req.tenant.tenantType` 取 TTL（个人 `ORDER_PAYMENT_TTL_MINUTES` 默认 30；组织 `ORDER_PAYMENT_TTL_MINUTES_ORG` 默认 2880）并持久化到新列 `subscriptions.payment_ttl_minutes`（迁移 `2026-08-20-subscriptions-payment-ttl-minutes.sql`）。展示（console-bff `deriveExpireAt`）与关单（sweep 谓词）统一读列值，公式仅把常量 TTL 换成 `coalesce(payment_ttl_minutes, env 个人值)`——锚点/驳回重锚/申报冻结逐字不变，存量 NULL 行行为与修订前逐字一致。原"零 DDL"约束就此让位：否决"关单 sweep 现场 join tenancy 查租户类型"（跨 schema 依赖 + 三处判定各算各的漂移面），否决"持久化绝对 `payment_expire_at`"（驳回重锚要求改写该值，凭空多一条写路径且驳回处漏写即静默坏账）。
- 超时扫描谓词（护栏完整版）：超期 **且** 无 `pending_verify` 腿 **且** `invoice.paid_amount = 0` **且** `bill_status NOT IN ('paid','partial')`——有任何实收的订单**永不**自动关单（否则撞 `cancelOfflineOrder` 的 paid_amount>0 ConflictException 活锁）。
- 否决：`payments.pay_expire_at` 列（在线网关预留字段，挂单期尚无 payments 行）。

### P5 金额模型 = 计价层与结算层分离（采纳；否决"全过账余额"）

```
计价层（该付多少 → 落账单）
  原价 ¥1,200（invoice_items: subscription_fee 行）
  − 折扣券 ¥240（invoice_items: discount 负额行；invoices.discount_amount 同步镜像）
  = payable_amount ¥960（=total_amount，账单口径不双减）
结算层（怎么付 → 支付腿，Σ腿实收 ≡ payable）
  腿① 代金券 ¥100（payments 行 pay_source='voucher'，见 P7）
  腿② 余额   ——（预留，V1 休眠，见 P6）
  腿③ 现金   cashDue（支付宝/银行转账，pending_verify → paid）
还需实付：cashDue = max(0, payable − invoice.paid_amount − voucherOff)
         （含 −paid_amount 项：存量部分收款单进付款页时自动扣减已收，付款页展示"已收 ¥X"行）
不变量：invoices.paid_amount = Σ payments(pay_status='paid').paid_amount
```

- 结算顺序固定：折扣券 → 代金券 →（余额）→ 现金。券先耗（有有效期），余额是准货币。
- **partial 族金额锚点（防负 cashDue）**：代金券封顶锚**剩余应收**而非 payable——`voucherOff = min(面额, max(0, payable_after_discount − invoice.paid_amount))`；折扣券可用性谓词（P7 三处同套）追加 `payable_after_discount ≥ invoice.paid_amount`，不满足即不可用（quote 勾选即拦，防折后应付低于已收）。代金券**不找零不退差**。每单折扣券、代金券各限 1 张；**V1 券一律 `max_uses=1`**（复用折扣券的多单并发占用语义 V1 不定义，发券表单固定为 1）。币种统一 CNY；券面额 effect JSONB 整数分，服务层 helper 统一 cents↔元。
- **计价通道唯一**：折扣一律走 discount 负额行 + 重算。挂单账单（在途订单关联、未清）**禁用** admin 应收减免/作废/标逾期三运营操作（409 引导走订单侧），防第二折扣通道与 `operate_remark` 覆写（P10）。
- **否决"一切支付先+入余额再−消费"**（owner 初提思路，已明示按最佳实践修正）：①充值与消费是两种开票事项，直付伪装成充值引来预付卡合规负担；②退款必须原路退回，现金变余额退不回渠道；③渠道对账多一层虚拟映射；④`credits.total_granted/consumed` 被直付虚增失真。

### P6 钱包 V1 休眠（采纳）

- 钱包（`billing.credits`，挂租户、一租户一池——与 owner 建议一致，DDL 既有设计不动）定位 = 未来**按量扣款**（postpaid/prepaid 计量计费）资金池。V1 无扣款业务 → 余额恒 0，console 只读展示（数据通路见 §4.1 credits 端点），付款页余额行仅 balance>0 时渲染。
- **预留不实现**：充值订单（`bill_type` 扩 `'recharge'`）、credits 写引擎（grant/consume/refund 乐观锁）、余额支付腿、运营余额调账、充值弹层/充值付款页。启用时**余额腿同样落 payments 行**（`pay_source='balance'`，届时再扩 CHECK 并同步修订 210 的 `paid_amount` 注释口径），P5 不变量无需改。
- **钱 ≠ 配额（铁律）**：钱包=CNY 预收款负债；AI 积分/存储=产品配额（metering 配额池，扣量引擎已建成验证）。积分包/存储包 = 普通加购订单，激活时 grant 配额入池，**绝不入钱包**。
- 凡可购之物一律**一单一账单**（套餐/续费/升级/加购统一管道），单品订单、无购物车。

### P7 券语义与落库：折扣券=计价层，代金券=结算腿（采纳，修订 230 两处）

| 券型                                     | V1   | 层     | 占用（declare）                                                         | 终态（足额确认，P9）                                                                                                               | 释放（驳回/取消/超时）                                  |
| ---------------------------------------- | ---- | ------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `discount` 折扣券                        | ✅   | 计价   | `assigned→reserved` 占 `used_count` + 写 invoice discount 负额行 + 重算 | 落 `voucher_redemptions` 回填 `invoice_item_id`，券 `redeemed`                                                                     | 券回 `assigned` 退 `used_count` **+ 计价层回滚（P8b）** |
| `credit_voucher` 代金券                  | ✅   | 结算腿 | `assigned→reserved`                                                     | 建 payments 券腿（`pay_source='voucher'`、`pay_status='paid'`、`paid_amount`=抵扣额）+ redemption 回填 `payment_id`，券 `redeemed` | 券回 `assigned` 退 `used_count`                         |
| `recharge_card` 充值卡                   | 预留 | 钱包   | —（入余额语义不变，随 P6 启用）                                         |                                                                                                                                    |                                                         |
| `redemption` 兑换码 / `extension` 展期券 | 预留 | —      | 本期不启用                                                              |                                                                                                                                    |                                                         |

核销行（`voucher_redemptions`）三归属：`tenant_id`/`workspace_id` 取订单订阅行归属（两列 NOT NULL 已有），`user_id`=申报操作用户。

对 [data_commerce_230_promotion](data_commerce_230_promotion.md) 的两处**语义修订**（PR0 同步改该文档，留痕）：

1. `credit_voucher` effect 语义由"赠额入余额"改为"**直接抵扣账单的结算腿**"（effect `{amount_cents, currency}`，删 `credit_expires_in_days`）；效果追溯 FK 由 `transaction_id` 改为 **`payment_id`**（列与真 FK 均已存在）。理由：入余额=现金过账钱包的变体，P5 四条反对理由同样适用；且钱包休眠期代金券必须可独立工作。
2. "非 discount 型核销即终态、无中间态"补例外：**挂单场景下 `credit_voucher` 允许 `reserved` 中间态**（CHECK 已含 `reserved`，零 DDL）——申报占用、确认终态、释放回 assigned，与 discount 对齐。

**券可用性谓词（list / quote / reserve 三处同一套，写进 reserve 的原子 UPDATE JOIN 谓词，杜绝"列表能选、最后一步 409"）**：

```
vouchers.status='assigned'
AND (batch.tenant_id IS NULL OR batch.tenant_id = 订单.tenant_id)         -- 平台级或本租户批次
AND (assigned_user_id IS NULL OR assigned_user_id = 当前 user)            -- 归属断言（防核销他人券）
AND (assigned_workspace_id IS NULL OR assigned_workspace_id = 订阅.workspace_id)
AND (batch.tenant_id IS NOT NULL OR assigned_user_id IS NOT NULL
     OR assigned_workspace_id IS NOT NULL)                                -- 平台级批次必须已定向，禁"通用无主券"
AND batch.status='active' AND now() BETWEEN batch.valid_from AND batch.valid_until
AND (expires_at IS NULL OR expires_at > now())
```

- **tenant 定向 = tenant 专属批次**（`voucher_batches.tenant_id`，建批次时定死；券置 assigned 可不填 user/workspace 两列 = 租户全员可用）。assign 端点目标仅 workspace / user 两维；不加 `assigned_tenant_id` 列（维持零 promotion DDL）。
- 券过期 V1 **读时过滤**（上述谓词三处生效），不建 expired 转态 sweep（开放项）；`expired` 状态值 V1 不落库。
- **占用即锁定**：reserved 期间券过期、批次 paused/archived 一律不回收，finalize **不复检**有效期与批次状态（用户现金已汇出，不得卡确认）；释放回 assigned 后落在已下线批次的券由列表谓词自然屏蔽。
- effect 门槛字段 `applicable_plan_ids` / `min_user_level`：**V1 发券表单禁配**（zod 拒绝），quote/reserve 遇到已配置这些字段的存量券直接过滤不可用（防未实现的门槛被静默绕过）。

### P8 结算时机 = 申报时原子过账；悬挂窗口**自愈**（采纳）

- 付款页勾选券 → 调 quote **纯试算**（无副作用，可反复；校验集=P7 可用性谓词全集，失败前移到勾选时）。
- 点"我已完成付款" = **资金事务**单 commit：锁订阅行 `FOR UPDATE` 校验待付款态 + **断言 invoice 无残留未删 discount 负额行**（防御）→ 折扣券 reserve（230 §5.2 受影响行数=1 抢占，UPDATE 谓词含 P7 归属断言）+ 写 discount 负额行 + 重算 invoice `total/payable/discount_amount` → 代金券 reserve → 建现金腿 payments 行 `pending_verify`（金额=cashDue 锁定；`channel_raw_data` 写结算凭据，P10）→ histories `payment_declared`。
- **cashDue=0 覆盖**（券 + 已收合力覆盖应付，不限全额券场景）：资金事务内**先预检档位冲突**（`assertNoTierConflict`，冲突 409 快速失败于收钱/finalize 之前）→ 直接 finalize 券 + invoice `paid`（无现金腿）；**commit 后同请求串行触发段 2**（独立事务，与 admin 确认同构——否决"同事务激活"：既有 `activateOrder` 自开连接，事务内调用会自锁挂死）。`activatePendingOrder`/`activateOrder` 扩 actor 参数（`customer`/`system`，现硬编码 operator）。按钮文案切"确认并生效"。
- **悬挂自愈（三道，替代 v1.1 单靠 admin 重驱动——那条通道实际不可达：悬挂单在 admin 队列派生 confirmed 且 confirm 端点 body 校验强制 paidAmount>0）**：
  1. 用户面：P1 序 1"开通处理中"过渡态 + 付款页轮询（不误示"已生效"，不放用户重复 declare——declare 幂等谓词对 invoice 已清单直接返回当前态）。
  2. **系统面（主通道）**：`OrderPaymentExpiryJob` 同宿主加对账扫描——`invoice paid ∧ sub suspended+offline_purchase ∧ 无 pending_verify 腿 ∧ 段 1 落库 > 2 分钟`（锚=本单最近一条 histories(`payment_declared`/`offline_payment_confirmed`).created_at，append-only 专用痕迹；**禁锚 paid_at**——admin 手填的真实转账时刻常在数天前，静默期会失效导致与在途段 2 抢跑）→ 按 `operate_remark` intent 分派段 2（actor=system）。**幂等逐臂**：activate 臂=既有 CAS（`WHERE status='suspended'`）天然幂等；**upgrade 臂需加守卫**——target 已 active 且 `planVersionId` 已=订单目标版本时视为"换版已完成"，跳过 `upgradeSubscription` 只补订单行转 cancelled 留痕（否则重驱动会重物化配额池清零 `quota_used`、重复发 webhook）。**失败退避**：逐单失败计数，连续 3 次失败停自动重试并升运营告警（admin 队列"已付未开通"行标"自愈失败"）。
  3. 运营面：admin 队列"已付未开通"态置顶（P1）；confirm 端点把 stage1Done 检测**提前到 body 强校验之前**（重驱动分支免除 paidAmount>0 等申报字段），人工兜底真正可点。
- 幂等：同单已存在 `pending_verify` 现金腿 → declare 返回既有申报（200），不重复过账。
- 否决"确认时才扣券"：admin 确认时券可能已被别单用掉/过期，"还需实付"金额漂移对不上账。

### P8b 释放编排（驳回 / 取消 / 超时共用，同一事务）

释放**必须对称回滚 declare 的全部副作用**，缺一即资损。**前置守卫：凭据所列券均 `status='reserved'`（即本单尚未 finalize）才执行；存在本单 redemption 行（券已终态）时拒绝走释放编排，转人工**——防御任何实现偏差导致"回滚已核销折扣"（redemption FK 断裂 + 事后追折）。

1. 券侧：`reserved→assigned` 退 `used_count`（UPDATE 限定 `status='reserved'` 且与本单结算凭据匹配——防 stale 凭据误放别单占用，P10）。
2. **计价侧：软删本单 discount 负额行（invoice_items.deleted_at）+ 重算 invoice `total/payable/discount_amount` 归还原价**。
3. 凭据侧：现金腿 `channel_raw_data.settlement.released=true`（P10）。
4. histories 留痕（`payment_rejected` / `cancelled` / `order_expired`）。

### P9 admin 确认 = **足额全有 / 驳回全无**；编排唯一入口（采纳；**否决 v1.1 部分到账拆腿**）

- **确认成功**（`orders/:orderId/offline-payment-confirm`，不换端点）：对申报单（存在 pending_verify 腿），**确认金额必须恒等于现金腿锁定额**（`paidAmount === leg.total_amount`，弹窗默认且只读展示，不符走驳回）。段 1 资金事务扩展——现金腿 `pending_verify→paid` 回填 `paid_amount`、**按既有模式落 `billing.transactions` 流水并回填 `leg.transaction_id`**（保持对账链两世代一致）+ 券 finalize（redemption 落行 + 券腿 payments 行 + `redeemed`；**券腿不落 TXN**——transactions 是钱包变动通道，券非资金池变动，券对账以 payments+redemptions 为准，cashDue=0 分支同此裁定）+ invoice `paid_amount` 累加足额转 `paid`。**无申报腿路径**（"旧式"非订单世代属性而是瞬时属性——驳回后订单同样无腿，该路径对全体订单永续开放）：金额校验**同样收紧为恒等 `paidAmount === payable − invoice.paid_amount`**（≤ 会经此路径持续新造 partial 僵死单，把拆腿方案否决掉的四连雷原样接回来；320 存量 partial 单照样一次收尾消化，只是禁止新造）。段 2 激活原样。
- **金额不符（实收 ≠ 申报额）**：一律**驳回**（P8b 全量释放，原因注明实收金额），实收线下协商——退回重汇或补齐后重新申报全额。**V1 系统不建部分到账状态**：v1.1 拆腿方案（翻腿+差额腿）经二轮校审证伪——finalize 时机二义、差额腿 `pay_order_no` 撞 UNIQUE、凭据双拷贝破坏活凭据唯一性、部分实收订单不可终结（void/cancel/超时三路全 409）四连雷，复杂度全部来自一个低频运营场景，否决留档。存量（320 期）partial 订单由 P5 cashDue 公式自然消化。
- **确认失败**（新端点 `POST orders/:orderId/payment-reject`）：`@RequireStepUp` + `commerce:payment.settle`（与确认同码同级，否决对齐台账 `payment.manage`——驳回申报与确认收款是同一职责的正反面）；reason ≥4 字必填 → P8b 释放编排。编排宿主=orders.router 裸 SQL 事务 + `PromotionService.releaseReserved(client)`（与确认段 1 同构）。
- **旁路封堵（本期必修，校审 blocker）**：payments 台账（`payments.router`）的既有 `verify` / `reject` 端点，对**在途订单账单**（bill 关联 `suspended`+`offline_purchase` 订阅，或在途申报腿）一律 **409 引导走订单侧**两端点——台账 verify 只结算资金不碰订阅（O6.1 同款旁路，带券单会永久卡死），台账 reject 不释放券不留痕无 step-up。已完成/非订单账单的台账行为不变（谓词以 sub 在途态收窄，不误伤）。

### P10 结算凭据落**现金腿** `payments.channel_raw_data`（采纳；否决 invoice.operate_remark）

- declare 时写入现金腿：`channel_raw_data = { settlement: { discountVoucherId?, creditVoucherId?, voucherOff, cashDue, reservedAt, released: false } }`（released 在 settlement **内层**，与 P8b 步 3 路径一致——两处形状不一致会使防重放判定静默失效）。确认段 1 / 驳回释放均以**被操作的那条腿**上的凭据定位 reserved 券（**禁止按订单聚合扫描凭据**——聚合扫描在券被他单 re-reserve 时会穿透双保险误放）；释放置 `released=true`。足额确认制下**整单至多一条在途腿、至多一份活凭据**，天然成立。
- 全额券覆盖单无现金腿：declare 资金事务内直接 finalize，凭据无需持久化（redemption 行即终态凭据）。
- **否决 `invoices.operate_remark` 追加 settlement**（v1.0 方案，校审否）：该列被 admin billing 三条运营 SQL（作废/标逾期/应收减免）当自由文本**无条件整体覆写**，settlement 与 320 既有 intent 都会丢（升级单被错激活成第二订阅、券卡死）。intent 仍留 operate_remark（320 既有不动），保护 = P5 的挂单账单三操作 409 封堵。

### P11 订阅侧对待收款订单壳**只读**；收款事项进总览待办（采纳，2026-09-02 owner 实测后补）

- **缺陷**：一条待收款订单在 `metering.subscriptions` 里是 `suspended + offline_purchase`，admin「订阅管理」把它当一条暂停的订阅展示，四个动作（续期确认/暂停/恢复/取消）照常可点，而「确认收款」只在「订单管理」。owner 付了 0.01 并申报后在订阅页找不到收款入口，点了「续期确认」：`subscriptions.router` 的 renew 只看 status 不看 `billing.*`，把订单壳翻成 `active` 并延一个周期，账单仍 `unpaid`、现金腿仍 `pending_verify`、段 2 一步没跑——运营台「已生效」、客户端「待付款」，两端对不上。
- **裁定**：订单壳（product_320 O1 谓词：`suspended ∧ offline_purchase ∧ 最新账单 unpaid/partial`）对订阅侧四个动作**一律 409**（`resolveTargetStatus` 前置守卫；锁行 SQL 带 `activation_method` + 最新账单态）。理由：renew/resume 会不收钱就开通；cancel 写 `end_at=now()` 会把订单侧「恢复订单」（要求 `end_at IS NULL`）封死；suspend 本就幂等拒绝。钱的正反面只在订单侧：`offline-payment-confirm`（段 1 记账 + 段 2 激活 + provisioning）/ `payment-reject` / `void`。
- **admin 呈现**：订阅列表/详情对订单壳显示「待收款」（不再显示「暂停」），行菜单与详情头部给唯一出口「确认收款」→ `/orders/:order_no`；四个动作禁用并写明理由；状态筛选加「待收款」档，`expired` 正名「已到期」（此前落到「已取消」）。「续期确认」描述明确写「本动作不记账」。
- **待办**：`ops-todos` 新增「收款确认」一类，按订单态派生：`pending_verify`（客户已申报，最急）/ `paid_unprovisioned`（钱到没开通）/ `partial_pending`（尾款挂账），直达订单详情。`pending`（客户还没付）不是待办。
- **存量修复**：迁移 `2026-09-02-repair-pending-orders-flipped-by-renew.sql` 把被误翻的行翻回订单壳（`suspended` / `end_at NULL` / 留痕 `pending_order_repaired`），之后订单侧确认收款走正常 `isPendingOrderRow` 分支。

## 3. 数据层落点

**DDL 变更（唯一一条）**：`chk_payments_pay_source` CHECK 扩值 `('online','offline')` → `('online','offline','voucher')`。走 320-C 同路径：DDL 文件改 + seed 内嵌幂等 `ALTER TABLE ... DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT`（活库自足），生产经 db-init owner 审批门。

零 DDL 达成的其余落点：

| 事项                      | 落点                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 申报/驳回/超时留痕        | `subscription_histories.change_type` 开放集新值 `payment_declared` / `payment_rejected` / `order_expired`（无 CHECK，实证开放）                                                                                                                                                                                                                                                                  |
| 结算凭据                  | 现金腿 `payments.channel_raw_data`（P10）；intent 仍在 `invoices.operate_remark`（320 既有）                                                                                                                                                                                                                                                                                                     |
| 超时/悬挂派生             | P4 谓词（histories 锚点 + `payment_ttl_minutes` 每单 TTL，2026-08-20 修订前无新列）+ P8 对账谓词                                                                                                                                                                                                                                                                                                 |
| 券占用/核销/归属          | promotion 三表既有结构 + 230 §5.2 原子规则 + P7 谓词（tenant 定向=批次级，不加列）                                                                                                                                                                                                                                                                                                               |
| 计价回滚                  | `invoice_items.deleted_at` 软删（列已有）+ 应用层重算                                                                                                                                                                                                                                                                                                                                            |
| 现金腿可更新              | `billing.payments` 无 append-only 触发器（`transactions` 才有），`pending_verify→paid/failed` 合法                                                                                                                                                                                                                                                                                               |
| 权限码 seed               | 新增 `promotion:campaign.read`、`promotion:campaign.manage`（high-risk，发券/发放）——TD-028 部分销号                                                                                                                                                                                                                                                                                             |
| **TD-020 服务角色白名单** | `97_service_roles`：`svc_console_bff` 补 promotion + **provisioning**（cashDue=0 分支段 2 在 console-bff 进程内 enqueue webhook；free 即开同样受益）；`svc_platform_api` 补 billing + promotion（sweep/对账/释放所需）；`svc_admin_bff` 缺 provisioning 属 320 期既有缺口，随本批 97 修订一并收口；同步回写 data_platform_330 进程→schema 映射。**漏此项则 TD-020 切换后全线 permission denied** |

## 4. API 设计

### 4.1 console-bff（`@Controller("api/subscription")`，裸 JSON 无信封，沿用现状）

| 端点                                   | 新/改 | 说明                                                                                                                                                                                                                                          |
| -------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET orders/:orderId`                  | 新    | 付款页详情：订单摘要 + 金额分解（含"已收 ¥X"行，P5）+ 可用券列表（P7 谓词）+ 支付腿 + 六态（P1 有序判定）+ `expireAt` + `rejectReason`（最近 `payment_rejected` histories remark）+ `paymentChannels`（§4.4）                                 |
| `POST orders/:orderId/quote`           | 新    | body `{discountVoucherId?, creditVoucherId?}` → `{listPrice, discountOff, payable, paidAmount, voucherOff, balanceOff:0, cashDue}` 纯试算（cashDue 公式=P5，§5.3 单点实现）；校验集=P7 谓词全集                                               |
| `POST orders/:orderId/payment-declare` | 新    | body `{payChannel:"alipay"\|"bank_transfer", discountVoucherId?, creditVoucherId?, payerName?, transactionNo?, remark?}` → P8 原子过账（渠道映射表见 P1；payChannel 须在当前 `paymentChannels` 派生结果中 `enabled`，否则 400）；返回订单新态 |
| `GET credits`                          | 新    | `{balance, currency}`——余额卡与付款页余额行的数据通路（服务方法 `getCreditBalance` 已有，端点缺席；tenant 上下文取法同现有订单端点）                                                                                                          |
| `POST orders`                          | 改    | 响应补 `expireAt`；前端付费路径创建后跳付款页（不再就地渲染面板）                                                                                                                                                                             |
| `GET orders`                           | 改    | 行 `orderStatus` 扩六态 + `expireAt` + `orderType`（V1 恒 `subscription`，`recharge` 预留）+ 券抵扣摘要                                                                                                                                       |
| `POST orders/:orderId/cancel`          | 改    | 仅"待付款"且 `paid_amount=0` 可取消；已申报 409（P2）                                                                                                                                                                                         |
| `GET subscribe-context`                | 改    | `pendingOrder` 补 `expireAt` + `paymentState`（进付款页恢复现场）                                                                                                                                                                             |

归属校验沿用现有订单归属断言（tenant 维度）；券操作另加 P7 归属谓词。

### 4.2 admin-bff

| 端点                                           | 新/改 | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST orders/:orderId/offline-payment-confirm` | 改    | P9：321 申报单足额恒等校验+翻腿+券 finalize；stage1Done 重驱动检测**提前到 body 校验之前**（P8 自愈三）；旧式订单原插行路径兼容                                                                                                                                                                                                                                                                                                                                                       |
| `POST orders/:orderId/payment-reject`          | 新    | P9/P8b；`@RequireStepUp` + `commerce:payment.settle`；宿主=orders.router 裸 SQL 事务 + `releaseReserved(client)`                                                                                                                                                                                                                                                                                                                                                                      |
| `POST orders/:orderId/void`                    | 改    | 存在 `pending_verify` 腿时 409（先驳回再 void，仅零实收单适用，P2）                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `GET orders`                                   | 改    | 行补 `orderType`、申报信息（渠道/时间/付款人/流水号/备注）；`pending_verify`、"已付未开通"、**"部分收款·待付款"**（在途订单 ∧ `invoice.paid_amount>0` 未清——现 `deriveOrderStatus` 把 partial/paid 腿一律判 confirmed，运营视角"已完结"永不被发现，与 P1 序 1 同款盲区）三态置顶；已完结判定收窄为 invoice paid ∧ 订阅非在途；**代表支付行口径改现金腿优先 + `OrderPaySource` 映射扩 `voucher`，`paidAmount` 展示改用 `invoice.paid_amount`**（否则券腿顶掉现金腿、金额显示为抵扣额） |
| `payments.router` `verify` / `reject`          | 改    | 在途订单账单/申报腿一律 409 引导订单侧（P9 旁路封堵；已完成/非订单账单不变）                                                                                                                                                                                                                                                                                                                                                                                                          |
| `billing.router` 作废/标逾期/应收减免          | 改    | 挂单账单 409（P5 计价通道唯一 + P10 覆写保护）                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST commercial/voucher-batches`              | 新    | 创建券批次；kind 限 `discount`/`credit_voucher`、`max_uses` 固定 1、effect 结构化表单（禁配门槛字段）；`promotion:campaign.manage` + step-up                                                                                                                                                                                                                                                                                                                                          |
| `POST commercial/vouchers/assign`              | 新    | 发放事务规格：**码按需生成**（assign 时生成 voucher 行，`issued_count`=已发放数）、`issued_count` 原子自增抢占（`WHERE issued_count < total_count` 受影响行数=1）、`per_user_limit` 仅对 user 目标生效（按 `assigned_user_id` 计数；workspace 定向不受此限）；目标=workspace/user（tenant 定向走 tenant 专属批次，P7）                                                                                                                                                                |
| `GET commercial/promotions`                    | 改    | 台账补面额/折扣列（effect 解读展示）——销 TD-030                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### 4.3 platform-api job

`OrderPaymentExpiryJob`：`@Interval(sweepIntervalMs(ORDER_PAYMENT_SWEEP_INTERVAL_MS))`（默认 60s）+ 实例 `inFlight` 防重入 + try/catch 不杀 interval（trial-expiry 同款）；单 job 两职：

1. **超时关单**：`SubscriptionService.sweepExpiredPaymentOrders(fallbackTtlMinutes)`（env `ORDER_PAYMENT_TTL_MINUTES` 默认 30，仅作存量 NULL 行回退——每单 TTL 读 `subscriptions.payment_ttl_minutes`，P4 修订）：谓词=P4 完整护栏版，逐单 `FOR UPDATE` CAS 关单 + P8b 释放编排 + histories `order_expired`，actor `system`。
2. **悬挂对账**（P8 自愈二）：`invoice paid ∧ sub suspended+offline_purchase ∧ 无 pending_verify 腿 ∧ 存续 > 2 分钟` → 按 intent 分派段 2 激活（actor=system，CAS 幂等）。

**部署注记**：①首轮 sweep 会一次性关闭 320 期存量超期挂单——上线前 owner 决断：预清理存量挂单，或首日调大 TTL 放行观察。②对账扫描会激活历史上"invoice 已清但订阅未激活"的存量悬挂单（如曾被台账 verify 旁路卡住的单）——业务上正确（用户已付款），但激活即发 webhook 通知产品栈，上线前 owner 核一遍该谓词的生产存量数。

### 4.4 支付方式配置下发

`GET orders/:orderId` 返回 `paymentChannels`，env 驱动（console-bff 读取）。**`enabled` = 该渠道全部 env 齐备（trim 后非空——现行 `?? ""` 兜底会把"存在但为空"判齐备）的派生布尔**：alipay 缺 `OFFLINE_PAY_ALIPAY_QR` → `enabled:false`；bank_transfer 三值缺一 → `enabled:false`；**缺配渠道不得以 enabled:true + 空凭据下发**（重蹈 §1 痛点 1 覆辙）；全渠道 disabled 时付款页展示"支付渠道配置中，请联系客服"降级文案。

```jsonc
[
  {
    "channel": "alipay",
    "enabled": true,
    "qrAsset": "/assets/payment/vx-alipay.png",
  }, // OFFLINE_PAY_ALIPAY_QR
  { "channel": "wechat", "enabled": false }, // 占位"即将开放"
  {
    "channel": "bank_transfer",
    "enabled": true,
    "account": {
      "accountName": "…",
      "bankName": "…",
      "accountNo": "…",
      "reference": "<orderNo>",
    },
  }, // 既有 OFFLINE_PAY_* 三值真配
]
```

新 env：`OFFLINE_PAY_ALIPAY_QR`（console 站内资产路径，由 console 前端按根路径 `/assets/...` 解释，BFF 仅透传字符串）；既有 `OFFLINE_PAY_ACCOUNT_NAME/BANK_NAME/ACCOUNT_NO` 上生产真值（320 §8 开放项①就此收口）。

## 5. 服务层设计

### 5.1 新建 `@vxture/service-promotion`（services/commerce/promotion）

- 结构镜像 subscription 包：`dto/ module/ repository/ service/ types/ + tokens.ts + index.ts`；**DI 全显式 `@Inject`**（仓级铁律：esbuild bundle 无 decorator metadata，隐式构造注入静默 undefined，见 `subscription.service.ts` 头注）。
- **`PromotionModule` 自建 `COMMERCE_PG_POOL` provider 且不 export**（BillingModule 同款两池并存模式；若 export 同名 token，console-bff 同时 import 两模块后注入解析随 import 顺序漂移）。
- **接线清单（缺一编译不过/静默缺位）**：①`tsconfig.base.json` paths 增 `@vxture/service-promotion`(+`/*`) 两条；②消费方 package.json 加 `workspace:*` 依赖，**含 `@vxture/service-subscription` 自身**（subscription→promotion 真实依赖：declare/sweep 编排注入 PromotionService）；③`SubscriptionModule` imports `PromotionModule` + `SubscriptionService` 构造器显式 `@Inject(PromotionService)`；④admin-bff `commerce-services.provider.ts` module-less 工厂同步扩参——**禁止做成可选参数**（可选参下 admin/job 路径的 P8b 券释放静默缺位，正是仓级 DI 教训同类）。
- `PromotionService` 原语：`listAvailableVouchers(orderScope)` / `quote(payable, vouchers)`（纯函数，单测覆盖）/ `reserveForOrder(client, …)` / `finalizeReserved(client, …)` / `releaseReserved(client, legCredential)`——写原语接受外部 `PoolClient` 参与调用方事务；reserve/release 的 UPDATE 谓词分别含 P7 归属断言与 P10 凭据双保险（凭据仅取自被操作腿）。

### 5.2 SubscriptionService / repository 扩展（如实列改造量）

- 新增 `declarePayment(orderId, legs, actor)`（P8 编排）/ `sweepExpiredPaymentOrders(ttl)` / `reconcileHungPaidOrders()`（§4.3 两职）。
- `cancelPendingOrder`：actorType 扩 `'system'`（现仅 customer|operator）、changeType 参数化（默认 `cancelled`，超时传 `order_expired`——repo 现硬编码）。
- `repo.cancelOfflineOrder` / `repo.activateOrder`：**拆出接受外部 `PoolClient` 的事务内核**（现自开连接自管事务，服务层拿不到 client，P8b 释放/计价回滚无法同事务）；保留自管事务外壳向后兼容。`activateOrder`/`activatePendingOrder` 扩 actor（P8）。
- admin 确认段 1 保持 orders.router 裸 SQL 事务（最小改动），券 finalize 经 `PromotionService.finalizeReserved(client)` 挂入同事务；payments/billing 台账封堵（§4.2）为独立小改。

### 5.3 金额工具

cents↔元换算、折扣计算（percent 向下取整到分 / fixed、`max_off_cents` 封顶）、代金券 cap、**cashDue 公式（P5，含 −invoice.paid_amount 项）**、invoice 重算公式（`total=Σ未删 items`、`payable=total`、`discount_amount=|Σ discount 行|` 镜像）集中一个纯函数模块（quote / declare / 释放 / 付款页分解四处共用，杜绝多处算账不一致）。

### 5.4 邮件

V1 不加（现状仅订阅 actions 有 fire-and-forget 邮件）；申报/确认/驳回通知列开放项。

## 6. 前端实施要点

### 6.1 console（视觉规格见 UI 设计稿——深空蓝科技风已定稿：<https://claude.ai/code/artifact/31ba98bb-6c0d-42c1-8e3c-de745db081e7>（owner 私有 artifact，2026-07-18 定稿），实施以 DS 组件+token 复现）

- 新路由 `src/app/[locale]/(console)/subscribe/pay/[orderId]/page.tsx` 薄壳 → `modules/commerce/OrderPayPage.tsx`。
- DS 组件映射：Tabs（支付方式）/ Card/SectionCard / Badge/StatusBadge / Dialog（申报确认弹层）/ Checkbox（券勾选）/ Button / Skeleton / Toast；支付来源分段控件走 `vx-tab` 按钮组惯例（SubscriptionPage 先例）；倒计时=纯文本 hook 自实现（DS 无 Countdown）。
- **样式落位（文件级，零护栏改动）**：组件样式新叶 `packages/design/design-system/src/styles/console-order-pay.css`（只 `var()` 引用，禁 hex）`@import` 进既有注册入口；科技风渐变/发光/玻璃卡色值落 `tokens-console-order-pay.css`（token-owner 文件名模式，hex 合法）`@import` 进 `tokens.css`；**不要在 portal 侧新建样式入口**（会撞 `IMPORT_ONLY_STYLE_ENTRIES` 硬编码 Map，变成护栏变更）；**每次改 CSS 必跑 `pnpm lint:design`**。
- lint:design 其余红线：禁裸 `<button/input/table>`（用 DS）、禁应用层硬编码尺度/颜色/`--vx-*`。
- i18n：新 namespace `orderPay`（`messages/zh-CN.json` + `en-US.json` 对称顶层 key）；订单 Tab（SubscriptionPage 内）状态文案接 `orderPay`（整页 i18n 化仍留 320 已记技术债，不扩 scope）。
- B 态轮询：15s `setInterval` + focus/visibilitychange 触发 + in-flight 去重 + cleanup（ConsoleSessionProvider 同款）+ 手动刷新钮；"开通处理中"态同轮询。
- 余额卡：/subscription 总览只读 ¥0.00（`GET credits`），无充值入口（P6）。
- 免费档（即时开通）/企业档（联系销售）流程不变。

### 6.2 website

深链 wire 值域固定 `cycle=month|year`：website 调用点做 `monthly→month / yearly→year` 映射（两侧 Cycle 类型不同名，直传必静默失配）；`buildConsoleSubscribeUrl` 加第 5 个**可选**参数（`ProductsOverviewPage` 的 upgrade 深链无周期上下文，不传）；console SubscribePage 读参预选周期。

### 6.3 admin

- OrdersPage：类型列/筛选（V1 恒"订阅"）、`pending_verify`+"已付未开通"置顶高亮、行内申报信息、代表支付行口径修正（§4.2）。
- OrderDetailPage：申报信息卡（渠道/时间/付款人/流水号/凭证）+ "驳回申报"按钮（模块内新 Dialog，reason 必填，`runWithStepUp` 包裹——OrderOfflinePaymentDialog 同款落位）；确认弹窗对 321 申报单金额只读=腿锁定额（P9）。
- PromotionsPage：启用"新建优惠"（批次创建 Dialog）+ 发放 Dialog；台账补面额/折扣列（TD-030）。

## 7. 状态机权威定义（事件 × 转移）

```
                    ┌──── 用户 cancel / admin void（均限无申报腿且零实收）──→ 已取消
创建订单 → 待付款 ──┼──── 超时 job（P4 完整谓词）──────────────────────────→ 已超时
   │                └─ 用户 declare（quote→P8 原子过账）
   │                     ├─ cashDue > 0 → 已付款·待确认 ─┬─ admin 确认(足额恒等) → [开通处理中]* → 已完成
   │                     │                               └─ admin 驳回(含金额不符) → P8b 释放
   │                     │                                    → 待付款(TTL 重锚,原因横幅)
   │                     └─ cashDue = 0（券+已收覆盖）→ 预检冲突 → 资金事务即 paid
   │                            → [开通处理中]* → 段 2 / 自愈 job → 已完成
   │                        (* 过渡态通常瞬时不可见,段 2 悬挂时驻留,自愈见 P8)
   └─ free 档：不产生订单即时开通；enterprise：拒单（320 不变）
```

竞态与幂等规则（实现必守）：

1. **锁序两条承重规则**（declare / cancel / 超时 job / 对账 job / admin 确认 / admin 驳回全体遵守；否决 v1.2 的"五对象全序"——它与 P8/P8b/P9 各自的步骤序自相矛盾且不做功）：①**sub 行锁先行**——每条编排第一步 `FOR UPDATE` 锁订阅行（必要时紧接锁本单 invoice），同一订单的全部流程由此串行化，后续对象（invoice/券/腿/流水/histories）的写序即步骤序，无争用环；②**券内固定序**——折扣券先、代金券后（reserve/finalize/release 三原语同序），assigned 态竞争由单行 CAS 化解（后到 409）。`billing.transactions` 纯 insert 不参与争用。**不变量：任何变更 reserved 券的路径必须先持有占用方订单的 sub 行锁**（未来券回收/过期 sweep 设计时对照，防引入环）。
2. 每单同时至多一条 `pending_verify` 现金腿：declare 在锁内查重，重复申报幂等返回既有；invoice 已清单 declare 直接返回当前态（防悬挂窗口重复过账）。
3. cancel / void 仅在无 `pending_verify` 腿且零实收时允许（P2）；超时 job 谓词含"无申报腿 + 零实收"（P4），与 declare 互斥于行锁。
4. admin 确认可重驱动（stage1Done 检测前置，段 1 已足额跳段 1 直入段 2）；券 finalize 幂等（redemption 存在即跳过）；段 2 幂等**逐臂**（activate=CAS；upgrade=版本相等守卫，§4.3）；悬挂窗口由对账 job 自愈 + 人工重驱动双兜底（P8）。
5. 同一张券跨订单并发 declare：230 §5.2 原子 UPDATE 抢占，后到者 409（§8.9 验收）。

## 8. 验收清单（e2e，全部真实链路）

> **实测回填（2026-07-18）**：可执行子集已由活库集成套件
> `bff/admin-bff/src/routers/order-payment-e2e.itest.spec.ts`（`ORDER_PAYMENT_E2E=1`
>
> - `DATABASE_URL` 门控）覆盖并 **13/13 通过**——对应下表 1、2、3（含悬挂对账自愈）、
>   4、5（含 stale 凭据）、6、7、9、10、11、13、14；该轮走查抓出并修复系统 actor
>   字符串写 uuid 列的生产级缺陷（PR#6=`208b1501`）。生产无凭据段已过：v0.20.0
>   部署（7m32s）、OFFLINE*PAY*\* 落 runtime、/pricing 渲染、深链 `cycle=year`
>   实测、OIDC 跳转链路。**余下真人段（owner）**：8（升级单带券）、12 中的
>   webhook 送达 arda 尾环、15 全量回归，以及登录后浏览器动线 + step-up 仪式。
>   附带专项：货币两位小数 28 项修复 = PR#65（`b979dd77`，v0.20.1）。

1. 无券整单：下单 → 付款页支付宝 Tab 展示收款码/金额/倒计时 → 申报 → admin 确认（足额恒等）→ 生效 + webhook。
2. 折扣券+代金券复合：quote 分解正确（percent 封顶/cap 不找零/cashDue 含 −paid_amount 项）→ 申报锁定 → 确认后 invoice `paid_amount`=Σ腿 `paid_amount`、redemption 两行落库回填正确 FK。
3. cashDue=0 覆盖：申报即 paid → 段 2 生效，histories actor=customer；**人为掐断段 2（kill 进程）→ 用户见"开通处理中"（非"已生效"误示）→ 对账 job ≤3 分钟自愈激活 + webhook 补发**（2 分钟静默期 + 一个扫描周期；验收可调小两参数）；挂单期另开 free 订阅后 declare → 预检 409 于收钱之前。
4. 驳回重申报（不换券）：原因横幅 + 券释放 + **invoice 金额恢复原价（discount 行软删、payable 还原）** + TTL 重锚 + 二次申报金额正确。
5. 驳回换券重申报：新券占用、旧券可用于他单、invoice 仅一条在用 discount 行、金额分解正确（v1.1 blocker 回归）。
6. 释放幂等：主动构造 stale 凭据/中断场景（驳回后同券被另一单 reserve，再触发本单关单）——释放原语不得误放别单占用；已 finalize 单触发释放编排被前置守卫拒绝。
7. 超时：无申报 30 分钟关单，histories `order_expired`，券零残留、invoice 折扣行零残留。
8. 取消边界：待付款零实收可取消、已申报 409（用户 cancel 与 admin void 双口径）、`paid_amount>0` 按钮禁用。
9. 并发：同单双端 declare / declare×超时 job（行锁）；**同一张券两个订单并发 declare（原子抢占，后到 409）**。
10. 金额不符驳回：申报 860 实收 500 → admin 驳回（原因含实收）→ 券释放、invoice 还原、订单回待付款；无腿路径恒等校验拒绝登记 500（禁新造 partial 回归）。
11. 存量 partial 订单（320 期）：进付款页展示"已收 ¥X"、无倒计时（expireAt=null）、cashDue=真实差额（含券锚点边界：代金券面额>剩余应收时 cap、折后应付<已收时折扣券不可用）、申报-确认闭环正确；admin 队列派生"部分收款·待付款"置顶非 confirmed。
12. 升级单带券：目标订阅换版正确、订单行 cancelled 留痕、六态派生"已完成"不误判"已取消"（P1 有序判定回归）。
13. admin：发券（issued_count 抢占/per_user_limit）→ 定向发放 → console 付款页可见可勾选；权限码/step-up 生效；无码 403。
14. 旁路封堵：payments 台账对在途订单腿 verify/reject 均 409（已完成单不受影响）；billing 三运营操作对挂单账单 409。
15. 回归：free 即时开通、enterprise 拒单、pause/resume/cancel actions、320 验收全绿。

## 9. 批次（每批独立可合 develop；端点先于 UI，320 惯例）

| 批  | 内容                                                                                                                                                                                                                                                                                                                                                                                | 验证                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR0 | 本文档 + 230 语义修订（P7 两处）+ **320 O1 谓词修订**（未清=`IN ('unpaid','partial')`，P1）+ UI 稿定稿链接                                                                                                                                                                                                                                                                          | `pnpm lint:data-design` 绿                                                                                                                                |
| PR1 | `@vxture/service-promotion` 包（券引擎原语 + 金额纯函数 + §5.1 接线清单全项）+ 单测                                                                                                                                                                                                                                                                                                 | 单测：230 §5.2 并发抢占、归属谓词、释放幂等（stale 凭据/前置守卫）、金额边界（含 cashDue paid_amount 项）                                                 |
| PR2 | console-bff **四新端点**（orders/:orderId、quote、payment-declare、credits）+ **四端点改**（createOrder、GET orders 六态、cancel、subscribe-context；含 320 O1 谓词统一 `IN ('unpaid','partial')` 与 free 分支挂单检查）+ `SubscriptionService` 三方法 + repo 事务内核拆分 + 超时/对账 job + seed（pay_source `voucher` 幂等 ALTER + promotion 权限码 + **97 服务角色白名单扩展**） | boot-smoke（DI）+ 端点集成测试 + **sweep/对账单测**（P4 四护栏、驳回重锚 expire_at、悬挂对账谓词/upgrade 幂等守卫、行锁竞态——job 无端点，集成测试测不到） |
| PR3 | admin-bff：确认段 1 扩展（足额恒等/翻腿/stage1Done 前置）/payment-reject/void 收紧/队列口径修正 + **payments·billing 台账旁路封堵** + admin 订单侧 UI（申报卡/驳回 Dialog/确认弹窗只读金额）                                                                                                                                                                                        | admin 实测确认/驳回/重驱动/封堵 409                                                                                                                       |
| PR4 | console 付款页/订单列表六态/余额卡/i18n + website cycle 深链（值域映射）+ 收款码资产入库接线                                                                                                                                                                                                                                                                                        | `pnpm lint:design` + 真人走查                                                                                                                             |
| PR5 | admin 发券三端点（§4.2 voucher-batches/assign/promotions 改——**端点+UI 同批，"端点先于 UI"惯例的有意例外**：发券线独立于订单主线，无跨批依赖）+ 发券/发放 UI + 台账面额列（TD-030）+ e2e §8 全清单 + 320 §8 开放项①收口回填                                                                                                                                                         | §8 十五项全绿                                                                                                                                             |

生产依赖：PR2 的 seed 变更（CHECK 扩值 + 权限码 + 角色白名单）经 db-init owner 审批门落库后，PR3/PR5 功能才可在生产启用；`OFFLINE_PAY_*` + `OFFLINE_PAY_ALIPAY_QR` env 生产配真值（owner 提供）；§4.3 部署注记（存量挂单）owner 决断。

## 10. 开放项

1. 申报/确认/驳回邮件通知（MailService 既有，挂接即可）。
2. 在线支付网关（支付宝当面付/微信 Native）：现金腿 `pay_source='online'` + `pay_expire_at` + 渠道回调走同一段 1/段 2 编排——"自动确认"第二通道，状态机零改动。
3. 钱包启用包（P6 预留清单：充值订单、credits 写引擎、余额腿落 payments `pay_source='balance'`、调账、充值 UI）。
4. 手输券码兑换栏（V1 仅定向发放券自动列出）；券过期 `expired` 转态 sweep（V1 读时过滤；设计时对照 §7 规则 1 锁序不变量——**前置能力缺口**：reserved 券无占用方反查指针（凭据只在腿侧 jsonb 无索引），启用券侧主动转态/批次 revoke 前需先解决反查（redemption 预落 reserved 行或加 `vouchers.reserved_by_payment_id` 列，均需重估零 DDL 决策）；当前不变量仅约束订单侧发起的路径）。
5. 加购 SKU（存储包/AI 积分包）：管道已通（一单一账单 + 激活 grant 配额），待产品定义 SKU 与配额映射。
6. **部分到账系统化**：V1 足额确认制（P9，申报腿与无腿路径双恒等，系统不再新造 partial；实收不符一律驳回+线下退回/补齐，320 存量 partial 由付款页差额闭环消化）；若线下实务高频出现金额不符，再评估拆腿方案（v1.1 版留档于 git 历史，四连雷见 P9 否决理由）或"登记实收+人工退款单"轻量方案（refunds 表有结构无业务）。
7. `redemption` 兑换码 / `extension` 展期券启用；`max_uses>1` 复用折扣券（多单并发占用语义届时定义）。
8. `applicable_plan_ids` / `min_user_level` 门槛启用（含等级折扣叠加规则，230 §6）。
9. 工程债（PR1 评审记档）：`promotion.vouchers` 可用券列表查询无伴随索引（现有索引对 `IS NULL OR =` 谓词形态不生效，V1 券量小可接受；量起后加 `(assigned_workspace_id, assigned_user_id) WHERE status='assigned'` 部分索引，走 DDL 治理）；commerce 五模块 pg Pool useFactory 逐字重复（收敛为共享 `createCommercePool` helper，独立小 PR）。
