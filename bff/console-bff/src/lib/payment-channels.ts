/**
 * payment-channels.ts — 线下收款渠道配置(env 派生,product_321 §4.4)。
 * 订阅支付页与加油包购买共用同一套对公/支付宝收款配置——从
 * subscription.router 抽出为共享模块(2026-08-20 用量配额线,加油包接入)。
 */

export interface PaymentChannelInfo {
  channel: "alipay" | "wechat" | "bank_transfer";
  enabled: boolean;
  qrAsset?: string;
  account?: {
    accountName: string;
    bankName: string;
    accountNo: string;
    reference: string;
  };
}

/**
 * Payment channel config, env-derived (§4.4). enabled = every env of the
 * channel is present AND non-blank after trim — a missing/blank config must
 * never ship enabled:true with empty credentials (the §1 pain-point 1 replay).
 */
export function buildPaymentChannels(orderNo: string): PaymentChannelInfo[] {
  const trimmed = (v: string | undefined): string => (v ?? "").trim();
  const alipayQr = trimmed(process.env.OFFLINE_PAY_ALIPAY_QR);
  const accountName = trimmed(process.env.OFFLINE_PAY_ACCOUNT_NAME);
  const bankName = trimmed(process.env.OFFLINE_PAY_BANK_NAME);
  const accountNo = trimmed(process.env.OFFLINE_PAY_ACCOUNT_NO);
  const bankEnabled = Boolean(accountName && bankName && accountNo);
  return [
    {
      channel: "alipay",
      enabled: Boolean(alipayQr),
      ...(alipayQr ? { qrAsset: alipayQr } : {}),
    },
    { channel: "wechat", enabled: false },
    {
      channel: "bank_transfer",
      enabled: bankEnabled,
      ...(bankEnabled
        ? {
            account: { accountName, bankName, accountNo, reference: orderNo },
          }
        : {}),
    },
  ];
}
