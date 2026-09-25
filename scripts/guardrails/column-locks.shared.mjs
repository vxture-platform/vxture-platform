// ─────────────────────────────────────────────────────────────────────────────
// 锚点列列级锁的**共享判据**（TD-018 铁律八）——被两个守卫同时引用：
//   · check-column-locks.mjs   ：98_column_locks.sql 与 DDL 列定义是否一致（锁的形状）
//   · check-anchor-writes.mjs  ：应用代码里的 SQL UPDATE 有没有碰锚点列（锁的消费方）
// 两边必须用同一张表，否则「锁说不能写、守卫说可以写」会各说各话。
// ─────────────────────────────────────────────────────────────────────────────

/** 规则⑤：显式安全语义锚点列（schema.table.column）。 */
export const EXTRA_ANCHOR = new Set([
  "admin.operator_role.rank",
  /*
   * 租户用途（2026-10-29）。形状上它是普通可写列（非 PK、非 `_no`、非 created_*），
   * 所以规则②不会把它当锚点——但它**建了就不该改**，语义上是锚点：
   *   customer      无特权、计入全部对外口径；
   *   certification 唯一特权是认证订阅可指向未发布的套餐版本，不计入任何口径。
   * 把一行从 customer 改成 certification，等于让一个普通租户拿到「订未发布版本」
   * 那条特权；反过来改，等于把沙箱数据倒灌进收入报表。**两个方向都是静默的**——
   * 没有异常、没有告警，只是数字从此对不上。
   *
   * 所以它有意不进 98 的 UPDATE 白名单：认证租户由认证编排在 INSERT 时写，客户租户
   * 拿 DEFAULT，**没有任何人工场景需要改它**。列在这里 = 98 不授权它、check-column-locks
   * 不再报「漏列可写列」、check-anchor-writes 反过来盯住应用代码别去 UPDATE 它。
   *
   * 要给租户分类（自有测试、受邀参与）不动这一列：那些是 tenancy.tenant_tags 的标签
   * 与可查的既有事实，它们不改变任何行为或数字。
   */
  "tenancy.tenants.purpose",
  /*
   * 认证台账的产品归属（2026-10-30）。形状上是普通外键列，但**换个产品就不是同一
   * 件事**：改它等于把 A 产品的认证结论挪给 B，而发布门只读结论、不看来历——
   * 静默的授权转移。一次认证跑动认的就是那一个产品，所以它是出生即定的锚点。
   */
  "product.certification_runs.product_id",
  /*
   * 暂停 episode 的出生事实（2026-09-25，metering.subscription_suspensions）。
   * 形状上它们都是普通可写列，语义上**整条 episode 除了收尾那几列全是出生即定**：
   *
   *   reason / extends_term —— 这一次暂停为什么发生、因此要不要顺延服务期。改 reason
   *     等于改写历史：一次违规暂停被改成「平台运维」，客户凭空得到那几十天；反过来，
   *     一次平台故障被改成「客户违规」，客户凭空损失同样多。两个方向都静默。政策以后
   *     可能改，但**已经发生的那一次不该被改写**（同 plan_versions 不可变）。
   *   subscription_id / tenant_id / paused_at —— 这次暂停发生在谁身上、从哪一刻起。
   *     paused_at 一动，顺延的天数就跟着动。
   *   actor_type / actor_id / client_ip —— 谁按的那个按钮。审计痕迹不该可改。
   *
   * 可写的只有 `resumed_at` / `granted_seconds`（恢复时收尾）与 `reason_note`
   * （运营补说明）/ `updated_at`，98 里 GRANT 的正是这四列。
   */
  "metering.subscription_suspensions.subscription_id",
  "metering.subscription_suspensions.tenant_id",
  "metering.subscription_suspensions.reason",
  "metering.subscription_suspensions.extends_term",
  "metering.subscription_suspensions.paused_at",
  "metering.subscription_suspensions.actor_type",
  "metering.subscription_suspensions.actor_id",
  "metering.subscription_suspensions.client_ip",
]);

/**
 * 规则②的**例外**：形如 `_no` 但**一次写入发生在 INSERT 之后**的列（"晚绑定"）——
 * 发票的快递单号只有寄出时才有、电子发票号只有开出时才有、网关单号只有回调时才有。
 * 它们仍是"写一次不改"的语义，但那一次写是 UPDATE，不是 INSERT；把它们当锚点锁死
 * 等于把整条业务动作锁死（2026-09-02 生产实测：确认收款事务因 invoices.transaction_no
 * 42501 整体回滚；发票寄送/开具同款）。列在这里 = 98 里 GRANT 它、守卫放行它。
 *
 * 不在这里的 `_no` 列一律锚点：invoices.transaction_no 不列——流水↔账单的关联在
 * transactions.bill_id，读侧派生即可，没有必要回写。
 */
export const LATE_BOUND_WRITABLE = new Set([
  "billing.invoice_receipts.express_no",
  "billing.invoice_receipts.invoice_electronic_no",
  "billing.payments.channel_order_no",
  "billing.payments.channel_transaction_no",
  // 开票抬头的纳税人识别号：是客户可编辑的资料字段，不是系统签发的码——`_no` 后缀
  // 撞上了规则②的形状判据。抬头快照进 invoice_receipts.tax_no 的那一份仍是锚点。
  "billing.billing_addresses.tax_no",
]);
