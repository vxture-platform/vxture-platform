// ─────────────────────────────────────────────────────────────────────────────
// 锚点列列级锁的**共享判据**（TD-018 铁律八）——被两个守卫同时引用：
//   · check-column-locks.mjs   ：98_column_locks.sql 与 DDL 列定义是否一致（锁的形状）
//   · check-anchor-writes.mjs  ：应用代码里的 SQL UPDATE 有没有碰锚点列（锁的消费方）
// 两边必须用同一张表，否则「锁说不能写、守卫说可以写」会各说各话。
// ─────────────────────────────────────────────────────────────────────────────

/** 规则⑤：显式安全语义锚点列（schema.table.column）。 */
export const EXTRA_ANCHOR = new Set(["admin.operator_role.rank"]);

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
