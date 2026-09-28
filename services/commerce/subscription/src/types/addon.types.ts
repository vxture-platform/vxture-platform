// Addon pack (加油包/扩展包) contracts — product_220 §0/§4.2: an addon is a
// SKU that never enters the plan machinery; settlement directly grants a
// WS-level quota pool (pool_source='addon_purchase', product_id NULL,
// priority 200 so it burns after subscription pools).

export interface AddonPackRecord {
  id: string;
  packCode: string;
  packName: string;
  metricKey: string;
  /** bigint as string (bytes / credits) */
  amount: string;
  validityDays: number;
  /** NUMERIC(12,2) yuan string */
  price: string;
  currency: string;
  status: string;
  sort: number;
}

export interface AddonPurchaseRecord {
  id: string;
  tenantId: string;
  workspaceId: string;
  packId: string;
  packCode: string;
  packName: string;
  metricKey: string;
  amount: string;
  validityDays: number;
  price: string;
  currency: string;
  orderNo: string;
  status: "pending_payment" | "completed" | "cancelled";
  paymentTtlMinutes: number | null;
  invoiceId: string | null;
  /** joined bill_no visible code (null when invoice missing) */
  billNo: string | null;
  quotaPoolId: string | null;
  activatedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  /** true = a pending_verify payment leg exists (declared, awaiting operator) */
  paymentDeclared: boolean;
  createdAt: Date;
}

export interface CreateAddonOrderInput {
  tenantId: string;
  workspaceId: string;
  packCode: string;
  /** account.users.id of the purchasing customer */
  createdBy: string;
  paymentTtlMinutes?: number;
}

export interface DeclareAddonPaymentInput {
  tenantId: string;
  orderNo: string;
  /** 'alipay' | 'bank' (same vocabulary as the subscription declare) */
  payChannel: string;
  payerName?: string;
  transactionNo?: string;
  remark?: string;
  actorId: string;
}

/**
 * 加油包通知展示行（2026-09-28 批 5）。与 `AddonPurchaseRecord` 分开一张：
 * 后者是接口回给前端的那张单（console 的加油包板块、admin 的核销面都在读它），
 * 通知要的是**别的东西**——买它的人是谁、授予的池什么时候到期、指标的中文名。
 * 把 `created_by_id` 这类裸值加进那张单等于把它顺路发给浏览器，落点错。
 *
 * 形状照 `NotifyDisplay`（订阅侧同一手法）：一个查询取齐，服务层只负责翻成文案。
 */
export interface AddonNotifyDisplay {
  /** 可视码（唯一，去重键与文案都用它；purchase uuid 一个字都不出现）。 */
  orderNo: string;
  tenantId: string;
  packName: string;
  /** NUMERIC(12,2) 字符串（实付）。 */
  price: string;
  currency: string;
  /** 授予池的到期时刻（= 开通 + validity_days）；池没建起来时为 null。 */
  expiresAt: Date | null;
  /** 下单人 actor（'customer' 时把他也加进收件人，见 customerRecipients）。 */
  createdByType: string | null;
  createdById: string | null;
}

/**
 * 加油包生命周期巡检的候选行（2026-09-28 批 5）：已开通的加油包 × 它授予的那个池。
 *
 * 这里只装**事实**，不装裁定。「这一行算哪一档」由 `classifyAddonPool` 一处说了算
 * （service/addon-lifecycle.ts）——SQL 那侧只按时间窗 / 水位把范围收窄到有界，
 * 判据不许在 SQL 与 TS 各写一遍（两份各错一处是验证不出来的）。
 */
export interface AddonPoolCandidate extends AddonNotifyDisplay {
  /** 池的到期时刻。巡检的候选谓词要求非空，所以这里不是 nullable。 */
  expiresAt: Date;
  /** product.platform_metrics.kind：'counter' / 'gauge' / null（未分类的预留键）。 */
  metricKind: string | null;
  /** quota_pools.reset_period：加油包池恒为 'none'（授予时写死），仍然读回来当判据。 */
  resetPeriod: string;
  /** bigint 字符串（bytes / credits）——不转 number，超 2^53 会静默失真。 */
  quotaLimit: string;
  quotaUsed: string;
  /** 池上最后一次写入（消费会推进它）：「用尽」这一档的存量闸门按它算。 */
  poolUpdatedAt: Date;
}
