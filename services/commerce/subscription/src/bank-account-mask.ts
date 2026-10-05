/**
 * bank-account-mask.ts — 银行账号掩码：只留末四位（2026-12-01 退款转账线）。
 * @package @vxture/service-subscription
 *
 * 客户的收款账号是 PII。它只在两处以明文出现：库里的 billing.refunds.recipient_bank_account，
 * 与持 `user:pii.read` 的运营在 admin 订单页看到的那一行。其余一切落地文本——order_events
 * 的 remark、support.audit_logs 的 after、通知参数、运营镜像标题、客户自己看到的进度行——
 * 都只写这个掩码。admin-bff 的 pii-mask 直接 re-export 本函数，一个实现、两个读者。
 */

/** `****1234`：只留末四位；短于四位的全掩；空值原样。 */
export function maskBankAccount(account: string | null): string | null {
  if (!account) return account;
  const compact = account.replace(/\s+/g, "");
  if (compact.length <= 4) return "****";
  return `****${compact.slice(-4)}`;
}
