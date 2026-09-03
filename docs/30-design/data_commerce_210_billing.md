# Commerce 域细化设计：billing（账单 / 发票 / 支付 / 退款 / 不可变流水）

<!-- data-architecture: target-state -->

> 状态：v1 草案 · 编号 `data_commerce_210`（细化设计层）· 待评审 · 未实施
> 上级权威：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md) §2.2.4 八条铁律
> 姊妹文件：[`data_commerce_200_metering.md`](./data_commerce_200_metering.md)（计量）、[`data_commerce_220_provisioning.md`](./data_commerce_220_provisioning.md)（开通）
> 取代范围：本文取代 [`data_platform_200_schema.md`](./data_platform_200_schema.md) §9（commerce 账务域）字段级内容。

---

## 0. 定位：资金 vs 成本分离拓扑

```
Organization / Tenant  =  billing account（资金/结算主体）
    · 预付款池、币种、开票抬头 → credits + billing_addresses
    · 月末汇总出账、扣预付款、开 fapiao → invoices + transactions + invoice_receipts
Workspace              =  cost center（成本/计量主体，见 metering schema）
    · 订阅(charged)、配额池、消耗 → metering.subscriptions / quota_pools
    · 各 workspace 成本独立归集，月末上卷到所属 org
```

账务头表（invoice/payment/refund/transaction/credit）以 `tenant_id` 为结算主体键（**方案A：不新建 org 汇总表**）；workspace 维度只出现在**明细行**（`invoice_items.workspace_id`）用于成本归集。

**跨 schema FK 修正（铁律一 sweep）**：`tenant_id` 一律建真 FK → `tenancy.tenants.id`；`workspace_id`（仅明细行）真 FK → `tenancy.workspaces.id`。

⚠️ **支付网关尚未接入**：`channel_*`/`pay_expire_at`/回调类字段为目标态占位，真实接入前为空；线下转账路径（`offline_*`+凭证）可先行。

> **actor 字段**：本域操作人记录遵循 [`data_commerce_200_metering.md §0.1`](./data_commerce_200_metering.md) 的 actor 约定——跨 realm 操作用 `actor_type`+`actor_id`（事件/流水表）或 `created_by_type`+`created_by_id`（可变实体表）；realm 确定的专职角色（如审核人 `auditor_id` 恒为 operator）保留专名字段。

> **周期模型**：计费按**订阅锚定周期**（非日历月，见 metering §0）。计量超额一律从 `metering.usage_events` 按订阅周期窗口 `[cycle_start, cycle_end)` 求和——**汇总表 `usage_summary_*` 只做统计/看板，从不作计费依据**。

> **两种计费模式（§2.2.4 铁律六，`credits.billing_mode`，结构预留、业务陆续接）**：**postpaid**（后付费）按订阅**锚定周期**出**应收账单** `invoices`；**prepaid**（预付费）用量**实时(~5min)**从资金池扣款（§7.2 `prepaid_charges` + `transactions`）、按**自然月**出**对账单**（§10.1，钱已扣、仅统计）。锚定 vs 自然月由模式决定，二者并存不冲突（预付费是 pay-as-you-go，无订阅周期可锚）。

---

## 1. `invoices`（账单头，org/tenant 级 rollup）

| 字段                                  | 类型          | 约束                                      | 说明                                                                                                                                                       |
| ------------------------------------- | ------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                  | uuid          | PK                                        |                                                                                                                                                            |
| `tenant_id`                           | uuid          | NOT NULL, FK→`tenancy.tenants.id`         | 结算主体                                                                                                                                                   |
| `bill_no`                             | varchar(64)   | UNIQUE NOT NULL                           | 可视码：`INV-{YYYYMM}-{6位seq}` 期次码模式（见 §12，权威可视码方案）                                                                                       |
| `subscription_id`                     | uuid          | NULL, FK→`metering.subscriptions.id`      | 可空：org rollup 账单跨多订阅；仅一次性账单填                                                                                                              |
| `bill_cycle`                          | varchar(8)    | NOT NULL                                  | 如 `'202607'`                                                                                                                                              |
| `cycle_start_date` / `cycle_end_date` | date          | NOT NULL                                  |                                                                                                                                                            |
| `total_amount`                        | numeric(12,2) | NOT NULL DEFAULT 0                        | = SUM(item.total_amount)；**折扣行(item_type=discount)恒负、税行(tax)恒正，SUM 已是净额**                                                                  |
| `discount_amount`                     | numeric(12,2) | DEFAULT 0                                 | **修正**：派生展示镜像（=SUM 折扣行绝对值），**不参与计算**——避免与折扣明细行双减                                                                          |
| `payable_amount`                      | numeric(12,2) | NOT NULL DEFAULT 0                        | **修正**：`= total_amount`（total 已含折扣/税净额，**不再减 discount_amount**，消除双减）                                                                  |
| `paid_amount`                         | numeric(12,2) | DEFAULT 0                                 | 预付款扣减 + 线上/线下实付合计                                                                                                                             |
| `currency`                            | varchar(16)   | DEFAULT `'CNY'`                           |                                                                                                                                                            |
| `bill_status`                         | varchar(32)   | NOT NULL DEFAULT `'unpaid'`, CHECK        | unpaid/paying/paid/partial/cancelled/overdue                                                                                                               |
| `bill_type`                           | varchar(32)   | DEFAULT `'normal'`                        | normal(周期,postpaid) / one_off(一次性) / adjustment(冲调) / **prepaid_statement(预付费自然月对账单，钱已实时扣，天生 bill_status=paid，仅统计/开票依据)** |
| `paid_at`                             | timestamptz   | NULL                                      |                                                                                                                                                            |
| `payment_method`                      | varchar(64)   | NULL                                      | 冗余展示，权威在 `payments`                                                                                                                                |
| `transaction_no`                      | varchar(128)  | NULL                                      | 关联 `transactions.transaction_no`                                                                                                                         |
| `created_by_type`                     | varchar(16)   | NOT NULL, CHECK(system/customer/operator) | §0.1；账单可系统月结/客户一次性购买/运营手工出账，故跨 realm                                                                                               |
| `created_by_id`                       | uuid          | NULL                                      | loose，按 type 解引用 account.users / admin.operator_accounts（边界#2）                                                                                    |
| `operate_remark`                      | text          | NULL                                      | 运营手工出账/调整备注（`created_by_type='operator'` 时填）                                                                                                 |
| `created_at` / `updated_at`           | timestamptz   | NOT NULL DEFAULT now()                    |                                                                                                                                                            |
| `deleted_at`                          | timestamptz   | NULL                                      |                                                                                                                                                            |

索引：`(tenant_id, bill_cycle)`、`bill_status`、`deleted_at`。头表停在 org/tenant 级，是月末 rollup 的落点；workspace/订阅/计量维度全部下钻到明细行。

## 2. `invoice_items`（账单明细行，+workspace 成本归集）

| 字段                                    | 类型          | 约束                                 | 说明                                                                                                                                                                                         |
| --------------------------------------- | ------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                    | uuid          | PK                                   |                                                                                                                                                                                              |
| `bill_id`                               | uuid          | NOT NULL, FK→`invoices.id`           |                                                                                                                                                                                              |
| `tenant_id`                             | uuid          | NOT NULL, FK→`tenancy.tenants.id`    | 冗余结算主体，便于不连头表查询                                                                                                                                                               |
| `workspace_id`                          | uuid          | NOT NULL, FK→`tenancy.workspaces.id` | 成本中心归集键                                                                                                                                                                               |
| `subscription_id`                       | uuid          | NULL, FK→`metering.subscriptions.id` | charged 订阅费行必填                                                                                                                                                                         |
| `product_id`                            | uuid          | NULL, FK→`product.products.id`       |                                                                                                                                                                                              |
| `metric_key`                            | varchar(64)   | NULL                                 | 计量超额行填                                                                                                                                                                                 |
| `item_name`                             | varchar(128)  | NOT NULL                             |                                                                                                                                                                                              |
| `item_type`                             | varchar(32)   | NOT NULL, CHECK                      | subscription_fee/metered_overage/credit_adjustment/discount/tax                                                                                                                              |
| `item_unit`                             | varchar(64)   | NULL                                 |                                                                                                                                                                                              |
| `quantity`                              | numeric(12,4) | DEFAULT 1                            |                                                                                                                                                                                              |
| `unit_price`                            | numeric(12,2) | DEFAULT 0                            | 单价到分（资金类一律两位小数，§3.2 修订 2026-09-03；原 18,6 经 migrations/2026-09-03-money-two-decimals.sql 收口）                                                                           |
| `total_amount`                          | numeric(12,2) | NOT NULL DEFAULT 0                   | 行小计，并入头表 total                                                                                                                                                                       |
| `usage_cycle_start` / `usage_cycle_end` | timestamptz   | NULL                                 | 计量超额行的**结算窗口**（该订阅锚定周期）；超额 = `metering.usage_events` 在此窗口对 (workspace,product,metric) 求和，**不读汇总表**。窗口 +(workspace,product,metric) 即可复算，供审计追溯 |
| `remark`                                | varchar(512)  | NULL                                 |                                                                                                                                                                                              |
| `created_at` / `updated_at`             | timestamptz   | NOT NULL DEFAULT now()               |                                                                                                                                                                                              |
| `deleted_at`                            | timestamptz   | NULL                                 |                                                                                                                                                                                              |

索引：`bill_id`、`workspace_id`（按 workspace 成本拆分）、`item_type`、`deleted_at`。

**两类计费行**：`subscription_fee`（仅 `billing_kind='charged'` 组件 × `plan_version.price`，`bundled_free` 不进结算）；`metered_overage`（从 `metering.usage_events` 按订阅**锚定周期窗口** `[usage_cycle_start, usage_cycle_end)` 求和 − 含量，按 `model_price_rule` 计价——**不读汇总表**，汇总仅统计/看板）。

## 3. `invoice_receipts`（中国增值税发票 fapiao）

| 字段                             | 类型          | 约束                                 | 说明                                                                                                             |
| -------------------------------- | ------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `id`                             | uuid          | PK                                   |                                                                                                                  |
| `tenant_id`                      | uuid          | NOT NULL, FK→`tenancy.tenants.id`    | 开票主体                                                                                                         |
| `bill_id`                        | uuid          | NOT NULL, FK→`invoices.id`           |                                                                                                                  |
| `invoice_no`                     | varchar(64)   | UNIQUE NOT NULL                      | 平台内部发票申请号，可视码                                                                                       |
| `invoice_type`                   | varchar(32)   | NOT NULL                             | electronic_general/electronic_special/paper_special                                                              |
| `invoice_tax_type`               | varchar(32)   | NOT NULL, CHECK(general/special)     |                                                                                                                  |
| `invoice_title`                  | varchar(256)  | NOT NULL                             | 抬头                                                                                                             |
| `tax_no`                         | varchar(128)  | NULL                                 | 专票必填                                                                                                         |
| `company_info`                   | jsonb         | NOT NULL                             | 结构化抬头                                                                                                       |
| `bank_info`                      | jsonb         | NULL                                 | 专票必填                                                                                                         |
| `address_info`                   | jsonb         | NULL                                 | 纸质发票快递用                                                                                                   |
| `invoice_amount`                 | numeric(12,2) | NOT NULL                             | 价税合计                                                                                                         |
| `tax_amount`                     | numeric(12,2) | DEFAULT 0                            |                                                                                                                  |
| `currency`                       | varchar(16)   | DEFAULT `'CNY'`                      |                                                                                                                  |
| `invoice_status`                 | varchar(32)   | NOT NULL DEFAULT `'applying'`, CHECK | applying/approved/issued/sent/rejected/voided                                                                    |
| `status_remark`                  | text          | NULL                                 |                                                                                                                  |
| `invoice_code`                   | varchar(64)   | NULL                                 | 税务局发票代码（开具后回填）                                                                                     |
| `invoice_electronic_no`          | varchar(64)   | NULL                                 |                                                                                                                  |
| `invoice_file_url`               | text          | NULL                                 | PDF/OFD                                                                                                          |
| `issued_at`                      | timestamptz   | NULL                                 |                                                                                                                  |
| `express_company` / `express_no` | varchar(64)   | NULL                                 |                                                                                                                  |
| `send_at`                        | timestamptz   | NULL                                 |                                                                                                                  |
| `created_by_type`                | varchar(16)   | NOT NULL, CHECK(customer/operator)   | §0.1；开票申请人（客户自助申请或运营代申请）；**修正**：去 system（created_by_id NOT NULL，无 system 无人工 id） |
| `created_by_id`                  | uuid          | NOT NULL                             | loose，按 type 解引用（边界#2）                                                                                  |
| `auditor_id`                     | uuid          | NULL                                 | 审核人**恒为 operator**（realm 确定，保留专名）→ 逻辑引用 admin.operator_accounts，边界#2                        |
| `audit_at`                       | timestamptz   | NULL                                 |                                                                                                                  |
| `created_at` / `updated_at`      | timestamptz   | NOT NULL DEFAULT now()               |                                                                                                                  |
| `deleted_at`                     | timestamptz   | NULL                                 |                                                                                                                  |

**值快照，非外键**：申请发票时把某条 `billing_addresses` 快照成 `company_info`/`bank_info`/`tax_no`，抬头后续修改不影响已开发票（地址三层 SoT 第三层）。一张账单可能拆开多张发票，`bill_id` 非唯一。

## 4. `payments`（支付：线上+线下多渠道+凭证）

| 字段                                          | 类型          | 约束                                                           | 说明                                                           |
| --------------------------------------------- | ------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `id`                                          | uuid          | PK                                                             |                                                                |
| `tenant_id`                                   | uuid          | NOT NULL, FK→`tenancy.tenants.id`                              |                                                                |
| `bill_id`                                     | uuid          | NOT NULL, FK→`invoices.id` ON DELETE RESTRICT                  |                                                                |
| `transaction_id`                              | uuid          | NULL, FK→`transactions.id`                                     | 支付成功后写流水                                               |
| `pay_order_no`                                | varchar(64)   | UNIQUE NOT NULL                                                | "支付不能双份" 落地                                            |
| `pay_source`                                  | varchar(32)   | NOT NULL DEFAULT `'online'`, CHECK(online/offline)             |                                                                |
| `pay_channel`                                 | varchar(32)   | NULL                                                           | wechat/alipay/unionpay/bank                                    |
| `pay_method`                                  | varchar(32)   | NULL                                                           | qrcode/h5/app                                                  |
| `offline_pay_type`                            | varchar(32)   | NULL                                                           | bank_transfer/cash/check                                       |
| `offline_payer_name`                          | varchar(128)  | NULL                                                           |                                                                |
| `offline_pay_time`                            | timestamptz   | NULL                                                           |                                                                |
| `offline_evidence_url`                        | text          | NULL                                                           |                                                                |
| `total_amount`                                | numeric(12,2) | NOT NULL                                                       |                                                                |
| `paid_amount`                                 | numeric(12,2) | DEFAULT 0                                                      |                                                                |
| `currency`                                    | varchar(16)   | DEFAULT `'CNY'`                                                |                                                                |
| `pay_status`                                  | varchar(32)   | NOT NULL DEFAULT `'pending'`, CHECK                            | pending/pending_verify/paid/failed/closed/refunding            |
| `status_msg`                                  | text          | NULL                                                           |                                                                |
| `channel_order_no` / `channel_transaction_no` | varchar(128)  | NULL                                                           | 网关侧（占位，未接入为空）                                     |
| `channel_raw_data`                            | jsonb         | NULL                                                           | 回调原文留存                                                   |
| `pay_expire_at` / `paid_at` / `closed_at`     | timestamptz   | NULL                                                           |                                                                |
| `actor_type`                                  | varchar(16)   | NOT NULL DEFAULT `'customer'`, CHECK(system/customer/operator) | §0.1；客户发起线上支付 / 网关回调=system / 运营录线下=operator |
| `actor_id`                                    | uuid          | NULL                                                           | loose，按 actor_type 解引用（边界#2）                          |
| `operate_remark`                              | text          | NULL                                                           | 线下支付/手工对账备注                                          |
| `created_at` / `updated_at`                   | timestamptz   | NOT NULL DEFAULT now()                                         |                                                                |

索引：`bill_id`、`pay_order_no`、`pay_status`、`tenant_id`。幂等回调按 `channel_transaction_no`+`pay_order_no` 去重。

## 5. `refunds`（退款，双状态机）

| 字段                        | 类型          | 约束                                | 说明                                                                                  |
| --------------------------- | ------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| `id`                        | uuid          | PK                                  |                                                                                       |
| `tenant_id`                 | uuid          | NOT NULL, FK→`tenancy.tenants.id`   |                                                                                       |
| `bill_id`                   | uuid          | NOT NULL, FK→`invoices.id`          |                                                                                       |
| `pay_record_id`             | uuid          | NOT NULL, FK→`payments.id`          |                                                                                       |
| `transaction_id`            | uuid          | NULL, FK→`transactions.id`          | 退款成功写冲正流水                                                                    |
| `refund_no`                 | varchar(64)   | UNIQUE NOT NULL                     | 可视码                                                                                |
| `refund_amount`             | numeric(12,2) | NOT NULL                            |                                                                                       |
| `currency`                  | varchar(16)   | DEFAULT `'CNY'`                     |                                                                                       |
| `refund_reason`             | varchar(512)  | NULL                                |                                                                                       |
| `refund_type`               | varchar(32)   | DEFAULT `'normal'`                  | normal/partial/dispute                                                                |
| `audit_status`              | varchar(32)   | NOT NULL DEFAULT `'pending'`, CHECK | pending/approved/rejected                                                             |
| `audit_remark`              | text          | NULL                                |                                                                                       |
| `auditor_id`                | uuid          | NULL                                | 审核人**恒为 operator**（realm 确定，保留专名）→ admin.operator_accounts，边界#2      |
| `audit_at`                  | timestamptz   | NULL                                |                                                                                       |
| `channel_refund_no`         | varchar(128)  | NULL                                | 网关退款单号（占位）                                                                  |
| `refund_status`             | varchar(32)   | NOT NULL DEFAULT `'pending'`, CHECK | pending/processing/success/failed                                                     |
| `refund_at`                 | timestamptz   | NULL                                |                                                                                       |
| `created_by_type`           | varchar(16)   | NOT NULL, CHECK(customer/operator)  | §0.1；退款发起方（客户申请或运营发起）；**修正**：去 system（created_by_id NOT NULL） |
| `created_by_id`             | uuid          | NOT NULL                            | loose，按 type 解引用（边界#2）                                                       |
| `created_at` / `updated_at` | timestamptz   | NOT NULL DEFAULT now()              |                                                                                       |

索引：`audit_status`、`refund_no`、`tenant_id`。两段状态机：先审核（`audit_status`），通过后才执行（`refund_status`）。退款**不回改原支付/流水**，而是成功时**追加冲正流水**（`trade_type='refund'`），并回写 `credits`（若退回预付款池）。

> **无 `deleted_at` 例外声明（修正 finding）**：`payments` / `refunds` / `credits` 三张**金融记录表有意不软删**（作废走状态字段/冲正流水，仿 `transactions` append-only 例外）——与本域其余可变实体（invoices/invoice_receipts/billing_addresses/payment_methods/payment_mandates 含 deleted_at）不同，此为刻意，非遗漏四件套。

## 6. `transactions`（资金流水，不可变账本）

| 字段                               | 类型          | 约束                                                              | 说明                                                                             |
| ---------------------------------- | ------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `id`                               | uuid          | PK                                                                |                                                                                  |
| `tenant_id`                        | uuid          | NOT NULL, FK→`tenancy.tenants.id`                                 | 资金账户主体                                                                     |
| `bill_id`                          | uuid          | NULL                                                              | 关联账单（出账扣款时），逻辑引用（可能跨分区/已删场景，不强制 FK）               |
| `transaction_no`                   | varchar(64)   | UNIQUE NOT NULL                                                   | 可视码：####`                                                                    |
| `trade_type`                       | varchar(32)   | NOT NULL, CHECK                                                   | recharge/consume/refund/grant/adjust                                             |
| `source_method`                    | varchar(24)   | NULL, CHECK(online/offline/recharge_card/credit_voucher/operator) | **新增·充值方式**（仅 recharge/grant 时填）——余额充值/赠送的来源渠道；可扩展枚举 |
| `amount`                           | numeric(12,2) | NOT NULL                                                          | 本笔变动，正=入账负=出账                                                         |
| `currency`                         | varchar(16)   | DEFAULT `'CNY'`                                                   |                                                                                  |
| `balance_before` / `balance_after` | numeric(12,2) | NOT NULL                                                          | 变动前后 `credits.balance` 快照                                                  |
| `trade_status`                     | varchar(32)   | NOT NULL DEFAULT `'success'`                                      |                                                                                  |
| `related_no`                       | varchar(128)  | NULL                                                              | 关联单号（pay_order_no/refund_no）                                               |
| `remark`                           | varchar(512)  | NULL                                                              |                                                                                  |
| `actor_type`                       | varchar(16)   | NOT NULL, CHECK(system/customer/operator)                         | §0.1；充值/出账/退款/赠送/冲正的发起方（一行=一操作）                            |
| `actor_id`                         | uuid          | NULL                                                              | loose，按 actor_type 解引用（边界#2）                                            |
| `client_ip`                        | varchar(64)   | NULL                                                              |                                                                                  |
| `created_at`                       | timestamptz   | NOT NULL DEFAULT now()                                            | **无 `updated_at`/`deleted_at`：append-only，永不修改/软删**                     |

索引：`tenant_id`、`trade_type`、`transaction_no`。

### 6.1 不可变约束（DB 硬阻断）

```sql
CREATE OR REPLACE FUNCTION billing.tt_block_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transactions 不可变（账本是法律证据），更正请追加冲正流水(trade_type=adjust/refund)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tt_no_update BEFORE UPDATE ON billing.transactions
  FOR EACH ROW EXECUTE FUNCTION billing.tt_block_mutation();
CREATE TRIGGER trg_tt_no_delete BEFORE DELETE ON billing.transactions
  FOR EACH ROW EXECUTE FUNCTION billing.tt_block_mutation();
```

理由：`RAISE EXCEPTION` 而非 `DO INSTEAD NOTHING` RULE——后者会"静默吞写"（UPDATE/DELETE 返回成功但 0 行），篡改企图被悄悄无视；金融账本被改必须硬失败、可告警。

流水是**预付款池 `credits` 的唯一变动通道**：任何 `balance` 变化都必须伴随一条流水，`balance_before`/`balance_after` 与 `credits.version` 自增形成可重建对账链。

## 7. `credits`（预付款池，乐观锁）

| 字段                        | 类型          | 约束                                                   | 说明                                                                                                 |
| --------------------------- | ------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `id`                        | uuid          | PK                                                     |                                                                                                      |
| `tenant_id`                 | uuid          | UNIQUE NOT NULL, FK→`tenancy.tenants.id`               | 一 org 一池                                                                                          |
| `billing_mode`              | varchar(16)   | NOT NULL DEFAULT `'postpaid'`, CHECK(postpaid/prepaid) | **新增·预留**：结算模式。postpaid=锚定周期出应收账单；prepaid=用量实时(~5min)从本池扣款+自然月对账单 |
| `currency`                  | varchar(16)   | NOT NULL DEFAULT `'CNY'`                               |                                                                                                      |
| `balance`                   | numeric(12,2) | NOT NULL DEFAULT 0                                     | 预付款余额（充值 recharge / 代金券 grant 同入此池）                                                  |
| `total_granted`             | numeric(12,2) | NOT NULL DEFAULT 0                                     | 累计赠送/充值                                                                                        |
| `total_consumed`            | numeric(12,2) | NOT NULL DEFAULT 0                                     | 累计出账消耗                                                                                         |
| `version`                   | int           | NOT NULL DEFAULT 0                                     | 乐观锁                                                                                               |
| `created_at` / `updated_at` | timestamptz   | NOT NULL DEFAULT now()                                 |                                                                                                      |

**乐观锁并发模型**：`UPDATE credits SET balance=balance-:amt, version=version+1 ... WHERE tenant_id=:t AND version=:v`，影响 0 行即重试——配合不可变流水，杜绝双份扣款/余额漂移。多币种扩展：若需要，唯一键改 `(tenant_id, currency)`（当前单币种/org）。

### 7.1 卡券体系 → 已迁 `promotion` schema

> 早期在此的 `coupons` 单表设计（五型：代金券/充值卡/兑换码/折扣券/展期券）已升级为 **批次/码/核销三表结构**，独立成 `promotion` schema——见 [`data_commerce_230_promotion.md`](./data_commerce_230_promotion.md)。其效果落在 billing（`transactions`/`credits`/`invoice_items`/`payments`）与 metering（`subscriptions`），由 promotion 侧真跨 schema FK 追溯。

### 7.2 `prepaid_charges`（预付费实时扣费批次，~5min）【结构预留，业务陆续接】

预付费账号（`credits.billing_mode='prepaid'`）用量**实时扣款**记录：定时(~5min) Job 聚合窗口内 `metering.usage_events`，按 `model_price_rule` 计价，从 `credits` 扣款并写一条 `transactions`；自然月对账单（§10.1）从本表聚合。

| 字段                          | 类型          | 约束                                                         | 说明                                                       |
| ----------------------------- | ------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| `id`                          | uuid          | PK                                                           |                                                            |
| `tenant_id`                   | uuid          | NOT NULL, FK→`tenancy.tenants.id`                            | 扣款主体                                                   |
| `workspace_id`                | uuid          | NULL, FK→`tenancy.workspaces.id`                             | 成本归集（可空=跨 ws 汇总扣）                              |
| `window_start` / `window_end` | timestamptz   | NOT NULL                                                     | 计费用量窗口 `[start,end)`（自然时间滚动，**非订阅锚定**） |
| `idempotency_key`             | varchar(128)  | UNIQUE NOT NULL                                              | = `tenant+window` 派生，防同窗口重复扣                     |
| `amount`                      | numeric(12,2) | NOT NULL                                                     | 本批扣款额（窗口内 usage×price 汇总）                      |
| `currency`                    | varchar(16)   | NOT NULL DEFAULT `'CNY'`                                     |                                                            |
| `breakdown`                   | jsonb         | NULL                                                         | 按 product/metric 明细（供对账单展开）                     |
| `transaction_id`              | uuid          | NOT NULL, FK→`transactions.id`                               | 本批扣款的 consume 流水                                    |
| `status`                      | varchar(16)   | NOT NULL DEFAULT `'charged'`, CHECK(charged/failed/reversed) | 余额不足=failed（触发低余额提醒/降级）                     |
| `created_at`                  | timestamptz   | NOT NULL DEFAULT now()                                       | append-only                                                |

- **幂等**：`idempotency_key` 全局唯一，同窗口重跑不双扣（同 metering `usage_idempotencies` 思路）。
- **不透支**：`status='failed'` + 提醒/降级；透支须业务显式授信。
- 窗口用**自然时间**(~5min 滚动)，不锚定订阅——预付费纯 pay-as-you-go 无订阅周期。

## 8. `billing_addresses`（开票抬头）

| 字段                           | 类型         | 约束                              | 说明                                                                                                        |
| ------------------------------ | ------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`                           | uuid         | PK                                |                                                                                                             |
| `tenant_id`                    | uuid         | NOT NULL, FK→`tenancy.tenants.id` |                                                                                                             |
| `invoice_tax_type`             | varchar(32)  | NOT NULL                          | general/special                                                                                             |
| `title`                        | varchar(256) | NOT NULL                          | 抬头                                                                                                        |
| `tax_no` / `phone` / `address` | varchar      | NULL                              |                                                                                                             |
| `bank_name` / `bank_account`   | varchar(256) | NULL                              |                                                                                                             |
| `is_default`                   | boolean      | NOT NULL DEFAULT false            | 每 tenant 至多一条 default                                                                                  |
| `created_by`                   | uuid         | NOT NULL, FK→`account.users.id`   | **补齐**：哪个成员创建（财务配置=客户 realm 自管，realm 确定用专名 FK；运营代改经 support.audit_logs 记录） |
| `updated_by`                   | uuid         | NULL, FK→`account.users.id`       | **补齐**：末次修改成员                                                                                      |
| `created_at` / `updated_at`    | timestamptz  | NOT NULL DEFAULT now()            |                                                                                                             |
| `deleted_at`                   | timestamptz  | NULL                              |                                                                                                             |

**地址三层 SoT 第二层**（可复用簿）：与组织注册地址（`tenancy.tenant_profiles.address`）各自独立，非同一份数据；申请发票时快照进 `invoice_receipts`（第三层，不可变）。

## 9. `payment_methods`（支付方式）

| 字段                        | 类型         | 约束                                                | 说明                                                           |
| --------------------------- | ------------ | --------------------------------------------------- | -------------------------------------------------------------- |
| `id`                        | uuid         | PK                                                  |                                                                |
| `tenant_id`                 | uuid         | NOT NULL, FK→`tenancy.tenants.id`                   |                                                                |
| `method_type`               | varchar(32)  | NOT NULL                                            | wechat/alipay/bank_card/bank_transfer                          |
| `status`                    | varchar(32)  | NOT NULL DEFAULT `'active'`, CHECK(active/disabled) |                                                                |
| `display_name`              | varchar(128) | NOT NULL                                            |                                                                |
| `external_id`               | varchar(256) | NULL                                                | 网关侧绑定标识，token 化，**不存卡号/密钥明文**                |
| `is_default`                | boolean      | NOT NULL DEFAULT false                              |                                                                |
| `last_used_at`              | timestamptz  | NULL                                                |                                                                |
| `created_by`                | uuid         | NOT NULL, FK→`account.users.id`                     | **补齐**：哪个成员绑定（客户 realm 自管，realm 确定用专名 FK） |
| `updated_by`                | uuid         | NULL, FK→`account.users.id`                         | **补齐**：末次修改成员                                         |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                              |                                                                |
| `deleted_at`                | timestamptz  | NULL                                                |                                                                |

### 9.1 `payment_mandates`（代扣签约，自动续订授权）【结构预留，业务陆续接】

自动续订走**网关代扣**（`renewal_source='mandate'`）时的授权协议：用户绑定支付方式并签约，授权平台按周期自动扣款。余额续订（`balance`）不需要本表。

| 字段                        | 类型          | 约束                                                                         | 说明                                           |
| --------------------------- | ------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| `id`                        | uuid          | PK                                                                           |                                                |
| `tenant_id`                 | uuid          | NOT NULL, FK→`tenancy.tenants.id`                                            | 结算主体                                       |
| `user_id`                   | uuid          | NOT NULL, FK→`account.users.id`                                              | 签约授权人                                     |
| `payment_method_id`         | uuid          | NOT NULL, FK→`payment_methods.id`                                            | 绑定的支付方式                                 |
| `gateway_agreement_no`      | varchar(128)  | NULL                                                                         | 网关签约号/mandate token（外部引用，token 化） |
| `status`                    | varchar(16)   | NOT NULL DEFAULT `'pending'`, CHECK(pending/active/paused/cancelled/expired) |                                                |
| `signed_at`                 | timestamptz   | NULL                                                                         | 签约时刻                                       |
| `expires_at`                | timestamptz   | NULL                                                                         | 协议到期                                       |
| `max_amount_per_cycle`      | numeric(12,2) | NULL                                                                         | 单周期扣款上限（风控，防超额代扣）             |
| `created_at` / `updated_at` | timestamptz   | NOT NULL DEFAULT now()                                                       |                                                |
| `deleted_at`                | timestamptz   | NULL                                                                         |                                                |

索引：`(tenant_id, status)`。`metering.subscriptions.payment_mandate_id` 反向引用本表（自动续订绑定）。

---

## 10. 结算流程（锚定周期，单事务/批跑）

> **周期模型**：订阅按**锚定周期**闭合出账（非日历月，见 metering §0/§13）。下面的 "org rollup" 是**待决的一种归集形态**——其触发节奏（日历月归集已闭合周期 vs 每订阅周年单独出账）尚未拍板（metering §13 待办）；此处只描述计算步骤，不预设归集节奏。

```
① rollup 取数（按 org=tenant + bill_cycle）
   a. charged 订阅费：扫该 tenant 下各 workspace 的 active subscriptions，
      **仅 subscription_kind='paid' 且不在试用窗口内**（free/trial 无 charged 费用行），
      取 plan_component.billing_kind='charged' 组件 × plan_version.price
      → 每 (workspace, subscription) 生成一条 item_type='subscription_fee'。
   b. 计量超额：从 metering.usage_events 按该订阅**锚定周期窗口** [cycle_start, cycle_end) 对
      (workspace,product,metric) 求和（**不读汇总表**——汇总仅统计），减含量后按 model_price_rule 计价
      → 每 (workspace, product, metric) 生成一条 item_type='metered_overage'，记 usage_cycle_start/end 供复算。
   （bundled_free 组件不计。）
② 生成账单：INSERT invoices(...) + invoice_items × N（带 workspace_id 成本归集）。
③ 预付款扣减：乐观锁 UPDATE credits + INSERT transactions（不可变）；
   回写 invoice.paid_amount/bill_status。
④ 余额不足部分：走 payments（线上/线下补齐）→ 成功再写一条 transactions。
⑤ 开票：按需 INSERT invoice_receipts，快照 billing_addresses 的抬头/税号/银行。
```

### 10.1 预付费自然月对账单（prepaid，钱已扣→仅统计）【结构预留】

`billing_mode='prepaid'` 账号的月度"账单"是**对账单（statement）非应收**——钱已由 §7.2 实时扣走。**自然月**（非锚定，pay-as-you-go 无订阅周期）聚合 `prepaid_charges` → `INSERT invoices(bill_type='prepaid_statement', bill_status='paid', paid_amount=total)` + `invoice_items`（引用 prepaid_charges 明细）。对账单**天生已付**，只作统计/开票依据，不触发收款。这是 prepaid 用自然月、postpaid 用锚定周期的分野。

---

## 11. 状态机汇总

- **账单** `bill_status`：`unpaid → paying → paid`；`unpaid/paying → partial`；`unpaid → overdue`；`* → cancelled`。
- **支付** `pay_status`：`pending → pending_verify → paid|failed`；`pending/pending_verify → closed`；`paid → refunding`。
- **退款**：审核 `pending → approved|rejected`；执行 `pending → processing → success|failed`。
- **发票** `invoice_status`：`applying → approved → issued → sent`；`applying → rejected`；`issued → voided`。
- **卡券**（批次/码/核销状态机）→ 见 [`data_commerce_230_promotion.md §7`](./data_commerce_230_promotion.md)。
- **预付费扣费** `prepaid_charges.status`：`charged`（成功）｜`failed`（余额不足）｜`reversed`（冲正，配 grant/adjust 流水）。

---

## 12. 可视码方案（财务类，期次前缀码）

延续 `data_identity_200_schema.md §11` 的可视码原则（非关联键，只用于展示/对账），财务类采用**带期次前缀码**（非纯数字 sequence，需体现单据类型+周期）：

| 码               | 模式                      | 示例                    |
| ---------------- | ------------------------- | ----------------------- |
| `bill_no`        | `INV-{YYYYMM}-{6位seq}`   | `INV-202607-000123`     |
| `invoice_no`     | `FP-{YYYYMM}-{6位seq}`    | `FP-202607-000045`      |
| `pay_order_no`   | `PAY-{YYYYMMDD}-{8位seq}` | `PAY-20260704-00000012` |
| `refund_no`      | `RF-{YYYYMMDD}-{6位seq}`  | `RF-20260704-000003`    |
| `transaction_no` | `TXN-{YYYYMM}-{8位seq}`   | `TXN-202607-00000456`   |

生成靠应用层（非 DB sequence，因需按周期重置计数），落地细节由 `data_commerce_3**` 实施文档定 sequence/计数器方案。

---

## 13. 跨 schema FK 速查表

| 从                                                                                                                 | 到                                     | 类型              | 依据                                                             |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| `*.tenant_id`                                                                                                      | `tenancy.tenants.id`                   | 真 FK             | 普通引用（本次修正）                                             |
| `invoice_items.workspace_id`                                                                                       | `tenancy.workspaces.id`                | 真 FK             | 普通引用                                                         |
| `invoice_items.subscription_id`                                                                                    | `metering.subscriptions.id`            | 真 FK             | 普通引用，跨 schema                                              |
| `invoices.subscription_id`                                                                                         | `metering.subscriptions.id`            | 真 FK             | 普通引用，跨 schema（可空：org rollup 跨多订阅，仅一次性账单填） |
| `payments.transaction_id` / `refunds.transaction_id` / `prepaid_charges.transaction_id`                            | `transactions.id`                      | 真 FK             | 同 schema                                                        |
| `prepaid_charges.workspace_id`                                                                                     | `tenancy.workspaces.id`                | 真 FK             | 普通引用                                                         |
| （被 `promotion.voucher_redemptions` 追溯：其 `transaction_id`/`invoice_item_id`/`payment_id` → 本 schema）        | 见 `data_commerce_230_promotion.md §9` | 真 FK             | 卡券效果落 billing                                               |
| `*.actor_id` / `created_by_id`（actor_type=operator 时）/ `auditor_id`                                             | `admin.operator_accounts.id`           | **裸值**，不建 FK | 边界#2（realm 隔离，operator 主体）                              |
| `*.actor_id` / `created_by_id`（actor_type=customer 时）                                                           | `account.users.id`                     | **裸值**，不建 FK | 边界#2（按 actor_type 解引用，同列可能指两 realm，不建 FK）      |
| `billing_addresses.created_by`/`updated_by`、`payment_methods.created_by`/`updated_by`、`payment_mandates.user_id` | `account.users.id`                     | 真 FK             | 客户 realm 确定（财务配置/签约自管）                             |
| `payment_mandates.payment_method_id`                                                                               | `payment_methods.id`                   | 真 FK             | 同 schema（代扣绑定的支付方式）                                  |

---

## 14. 待办 / 开放项

- 支付网关接入前 `channel_*` 字段为空占位，接入时补充实施文档。
- 可视码 sequence/计数器机制待 `data_commerce_3**` 定案。
- 迁移步骤由实施文档另定。
- **预付费/卡券为结构预留，业务陆续实现**：以下属实施逻辑、本文只备数据结构——① 预付费 consume gate 改为**余额充足性**判断（metering consume 当前是 quota gate）；② ~5min 实时扣费 Job（聚合 usage_events→计价→扣 credits→写 prepaid_charges+transactions）；③ 低余额提醒/停服降级策略；④ 卡券五型核销引擎（§7.1）+ 折扣券×等级校验（§7.1.1）；⑤ 卡券是否长成独立 `promotion` schema（现放 billing）视活动/投放需求再定。
- `billing_mode` 现挂 `credits`（per-tenant）——是否需 per-workspace/per-subscription 粒度待业务确认（当前 per-tenant 账号级）。

## 13. `orders`（订单实体，product_330，2026-09-03）

订单从 `metering.subscriptions` 拆出成独立实体（[`product_330`](./product_330_order-entity-split.md)），放在 billing 域：订单是钱、意图、履约态的载体，账单 / 付款 / 退款都挂 `order_id`；订阅只回答"现在有什么"。履约（fulfill）是订单→订阅的唯一入口，幂等。

| 字段                                                                      | 类型          | 约束                                              | 说明                                                                                     |
| ------------------------------------------------------------------------- | ------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `id`                                                                      | uuid          | PK                                                |                                                                                          |
| `order_no`                                                                | varchar(64)   | UNIQUE NOT NULL                                   | 可视码 `ORD-{YYYYMM}-{10位hex}`（沿用）                                                  |
| `tenant_id` / `workspace_id`                                              | uuid          | NOT NULL, FK→tenancy                              | 结算主体 / 权益主体                                                                      |
| `product_id` / `plan_version_id`                                          | uuid          | NOT NULL, FK→product                              | 目标套餐版本与其主组件产品                                                               |
| `intent`                                                                  | varchar(16)   | CHECK new/upgrade/renew                           |                                                                                          |
| `cycle_unit` / `cycle_count`                                              |               |                                                   | 所购周期                                                                                 |
| `from_subscription_id`                                                    | uuid          | FK→metering.subscriptions；`intent<>'new'` 时必填 | upgrade / renew 的原订阅                                                                 |
| `subscription_id`                                                         | uuid          | FK→metering.subscriptions；fulfilled 时必填       | 履约后指向                                                                               |
| `list_amount` / `credit_amount` / `payable_amount` / `leftover_amount`    | numeric(12,2) | ≥0                                                | 标价 / 折抵 / 应付 / 折抵溢出（进预付款）                                                |
| `proration`                                                               | jsonb         |                                                   | 折抵输入与结果快照                                                                       |
| `status`                                                                  | varchar(24)   | CHECK                                             | pending_payment → pending_verify → paid → fulfilled → refunded；旁路 cancelled / expired |
| `declared_at` / `paid_at` / `fulfilled_at` / `closed_at` / `close_reason` |               |                                                   | 时间线                                                                                   |
| `created_by_type` / `created_by_id`                                       |               |                                                   | §0.1 actor                                                                               |

索引：`(tenant_id, created_at desc)`、`workspace_id`、`status`、`subscription_id`；部分唯一 `(workspace_id, product_id) WHERE status IN ('pending_payment','pending_verify','paid')`（一个工作区一个产品同一时刻只有一张在途订单）。

联动：`invoices.order_id`（订单账单必填）、`refunds.order_id`（退款挂订单）、`metering.subscriptions.product_id / paid_amount / current_order_id`（product_id 由触发器自 plan_components 主组件填；`uidx_subscriptions_live_per_product` 保证一个 workspace × product 至多一条当前订阅）。金融例外：无 deleted_at。
