/**
 * metering-read.types.ts — 计量读侧(配额总览 / 用量分析)的行与视图类型。
 * @package @vxture/service-subscription
 *
 * console 批 3(2026-09-04):这些查询原先裸写在 console-bff 的 quota / usage
 * router 里(X5),下沉到服务层——BFF 只做视图映射与权限门,SQL 归数据一侧。
 */

/** 活跃可用池一行(effective_used = 懒重置周期感知视图)。 */
export interface QuotaPoolRow {
  metricKey: string;
  /** subscription / manual_override / ws_base / addon_purchase */
  poolSource: string;
  /** NULL = WS 级池(底池 / 加油包,不属任何产品) */
  productCode: string | null;
  productName: string | null;
  quotaLimit: number;
  /** 周期感知已用(周期已翻篇按 0 计,与 C2 同口径) */
  effectiveUsed: number;
  resetPeriod: string;
  expiresAt: Date | null;
  platformKind: string | null;
}

/** 各产品最新水位切片(usage_gauges,LWW 快照)。 */
export interface UsageGaugeRow {
  metricKey: string;
  productCode: string;
  productName: string;
  value: number;
  observedAt: Date;
}

/** 共享策略参与行。 */
export interface SharingPolicyRow {
  metricKey: string;
  productCode: string;
  productName: string;
}

export interface QuotaOverviewRows {
  pools: QuotaPoolRow[];
  gauges: UsageGaugeRow[];
  sharing: SharingPolicyRow[];
}

export type UsageGranularity = "hour" | "day" | "week" | "month" | "year";

export interface UsageTrendQuery {
  workspaceId: string;
  metric: string;
  granularity: UsageGranularity;
  /** 桶数;窗口 = 以当前周期为末桶、向前数 span 个桶(含当前)。 */
  span: number;
}

export interface UsageTrendBucket {
  /**
   * 桶键(UTC):hour = `YYYY-MM-DD HH:00`;day / week(ISO 周一)= `YYYY-MM-DD`;
   * month = `YYYYMM`;year = `YYYY`。
   */
  period: string;
  total: number;
  byProduct: { productCode: string; productName: string; total: number }[];
}

/** 趋势:窗口内**每个**周期都有一桶(无数据补零),末桶 = 当前周期。 */
export interface UsageTrendResult {
  metric: string;
  granularity: UsageGranularity;
  buckets: UsageTrendBucket[];
}

export interface UsageEventRow {
  createdAt: Date;
  productCode: string;
  productName: string;
  metricKey: string;
  totalAmount: number;
  /** 终端用户显示名;null = 产品未归集(容错桶) */
  userName: string | null;
  requestId: string | null;
}

export interface UsageEventsQuery {
  workspaceId: string;
  /** 回看天数(月分区裁剪谓词) */
  days: number;
  limit: number;
}

/** 调用记录:items 之外把硬顶说出来——满额即可能被截断,页面据此提示。 */
export interface UsageEventsResult {
  items: UsageEventRow[];
  days: number;
  limit: number;
  truncated: boolean;
}

export interface UsageMemberRow {
  /** null = 未归集桶 */
  userName: string | null;
  total: number;
  eventCount: number;
  lastAt: Date;
}
