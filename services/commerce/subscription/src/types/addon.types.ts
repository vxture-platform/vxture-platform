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
