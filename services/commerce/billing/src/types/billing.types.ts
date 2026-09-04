export interface InvoiceRecord {
  id: string;
  tenantId: string;
  billNo: string;
  subscriptionId: string | null;
  billCycle: string;
  cycleStartDate: Date;
  cycleEndDate: Date;
  totalAmount: string;
  discountAmount: string;
  payableAmount: string;
  paidAmount: string;
  currency: string;
  billStatus: string;
  billType: string | null;
  paidAt: Date | null;
  paymentMethod: string | null;
  transactionNo: string | null;
  operatorId: string | null;
  operateRemark: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface InvoiceItemRecord {
  id: string;
  billId: string;
  tenantId: string;
  workspaceId: string | null;
  productId: string | null;
  metricKey: string | null;
  subscriptionId: string | null;
  itemName: string;
  itemType: string;
  itemUnit: string | null;
  quantity: string;
  unitPrice: string;
  totalAmount: string;
  usageSummaryRef: string | null;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface InvoiceDetail extends InvoiceRecord {
  items: InvoiceItemRecord[];
}

export interface CreditRecord {
  id: string;
  tenantId: string;
  currency: string;
  balance: string;
  totalGranted: string;
  totalConsumed: string;
  version: number;
  updatedAt: Date;
}

export interface ListInvoicesParams {
  tenantId?: string;
  billStatus?: string;
  billCycle?: string;
  billType?: string;
  page?: number;
  pageSize?: number;
}

export interface ListInvoicesResult {
  items: InvoiceRecord[];
  total: number;
}

/**
 * 租户账单概览(console 批 3:SQL 聚合,取代「拉 200 条到内存数」)。
 * 金额一律 numeric(14,2) 文本(元,两位小数),不经浮点。
 */
export interface TenantBillingOverview {
  total: number;
  paid: number;
  /** 待收款合集:unpaid + paying + partial */
  unpaid: number;
  overdue: number;
  cancelled: number;
  /** 累计实收(paid_amount 求和,含部分收款) */
  paidTotal: string;
  /**
   * 本自然月实付:billing.payments pay_status='paid' 且 paid_at 落在本月(库会话
   * 时区的自然月,与 admin 租户「本月收入」同一口径)。收付实现制:钱在哪个月到
   * 就记哪个月,不做分摊。
   */
  paidThisMonth: string;
  /** 最近一张账单的币种;没有账单为 null */
  currency: string | null;
}

export interface CreateInvoiceItemInput {
  workspaceId?: string;
  productId?: string;
  metricKey?: string;
  subscriptionId?: string;
  itemName: string;
  itemType: string;
  itemUnit?: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  usageSummaryRef?: string;
  remark?: string;
}

export interface CreateInvoiceInput {
  tenantId: string;
  subscriptionId?: string;
  billCycle: string;
  cycleStartDate: Date;
  cycleEndDate: Date;
  currency?: string;
  billType?: string;
  createdBy?: string;
  items: CreateInvoiceItemInput[];
}

export interface UpdateInvoiceStatusInput {
  billStatus: string;
  paidAt?: Date;
  paymentMethod?: string;
  transactionNo?: string;
  operatorId?: string;
  operateRemark?: string;
  paidAmount?: number;
  updatedBy?: string;
}
