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
  /**
   * 运营授予的原因（`pool_source = 'manual_override'` 才有值）。
   *
   * 透到租户侧是 owner 2026-09-09 的裁定：额度多出来一块却看不见来由，
   * 比看见「运营授予 · <原因>」更难受——他只会看到总额度对不上自己买的那些。
   */
  grantReason: string | null;
  /**
   * 本池生效时刻。有它才能画「用了周期的百分之多少」——只有 `expiresAt` 画不出
   * 进度，一条没有起点的线只能显示剩余天数。
   */
  effectiveAt: Date | null;
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

/**
 * `bucketZone` 没能等于用户时区的原因（owner 裁定 4，2026-10-04）：
 *   retention   — 窗口超过小时表可重切的天数（REBUCKET_HORIZON_DAYS），只能回 UTC 日表；
 *   granularity — 只有 day 档按用户时区重切，周/月/年保持 UTC 权威（hour 桶与时区无关）；
 *   unsupported — 账号里存的时区 Node 或 PostgreSQL 认不出，按 UTC 展示并让页面提示重选。
 *                 对**每个档位**都会报（优先级最高）：hour 档的轴标按 userZone 换算，
 *                 页面见到它就不得再拿 userZone 去换算 / 标注。
 */
export type UsageZoneFallbackReason =
  | "retention"
  | "granularity"
  | "unsupported";

export interface UsageTrendQuery {
  workspaceId: string;
  metric: string;
  granularity: UsageGranularity;
  /** 桶数;窗口 = 以当前周期为末桶、向前数 span 个桶(含当前)。 */
  span: number;
  /**
   * 请求用户的时区设置（account.user_profiles.timezone，IANA 名）；null / 空 = 未设置。
   * 只影响 day 档（§3）：天表是 workspace 级共享、时区是 user 级，所以天表不改，
   * 读侧从小时表按这个时区现场重切成本地日。
   */
  zone?: string | null;
}

export interface UsageTrendBucket {
  /**
   * 桶键:hour = `YYYY-MM-DD HH:00`（UTC 小时）;day / week(ISO 周一)= `YYYY-MM-DD`;
   * month = `YYYYMM`;year = `YYYY`。day 档的日期语义跟随 `UsageTrendResult.bucketZone`，
   * 其余档位恒为 UTC。
   */
  period: string;
  total: number;
  byProduct: { productCode: string; productName: string; total: number }[];
}

/** 趋势:窗口内**每个**周期都有一桶(无数据补零),末桶 = 当前周期。 */
export interface UsageTrendResult {
  metric: string;
  granularity: UsageGranularity;
  /** 桶边界所在时区（IANA）。'UTC' 或用户设置的时区；只有 day 档才可能不是 UTC。 */
  bucketZone: string;
  /** 请求用户的时区设置；null = 未设置。页面据它换算 hour 档轴标。 */
  userZone: string | null;
  /** bucketZone ≠ userZone 时的原因；null = 已按用户时区（或用户本就没设 / 设的就是 UTC）。 */
  zoneFallbackReason: UsageZoneFallbackReason | null;
  buckets: UsageTrendBucket[];
}

export interface UsageEventRow {
  createdAt: Date;
  productCode: string;
  productName: string;
  metricKey: string;
  /** 实扣量(= Σ 各池 took);超额时可能小于 requestedAmount,甚至为 0 */
  totalAmount: number;
  /** 申请量;与 totalAmount 不等即说明这次调用没能全额扣到(超额准入自愈) */
  requestedAmount: number | null;
  /** 终端用户显示名;null = 产品未归集(容错桶) */
  userName: string | null;
  /** 终端用户可视码(主体码 v4);null = 未归集。UUID 不出口 */
  userNo: string | null;
  requestId: string | null;
}

/**
 * 调用记录查询(2026-09-07 重建)。
 *
 * 原来只有 `days` + `limit`:固定 90 天、最多 500 条、无筛选无分页无合计。
 * 客户拿这页质疑计量时,既定位不到争议的那几条,也没法把明细加总去对账——
 * 所以这次把它做成**能查得准**的接口:时间窗 + 四个筛选维度 + 分页 + 独立合计。
 */
export interface UsageEventsQuery {
  workspaceId: string;
  /** 时间窗(闭开区间 [from, to));也是月分区的裁剪谓词 */
  from: Date;
  to: Date;
  productCode?: string;
  metricKey?: string;
  /**
   * 终端用户筛选:可视码 user_no,或 `"unattributed"` 单独筛未归集那一桶。
   * 不收 UUID——本页出口一律可视码。
   */
  user?: string;
  requestId?: string;
  offset: number;
  limit: number;
}

/**
 * 调用记录结果。`total` / `totalAmount` 是**筛选后全集**的口径(不随分页变)——
 * 客户能用它直接与配额页、账单对数,这正是这张表存在的理由。
 */
export interface UsageEventsResult {
  items: UsageEventRow[];
  /** 筛选后总条数 */
  total: number;
  /** 筛选后实扣量合计 */
  totalAmount: number;
  offset: number;
  limit: number;
}

export interface UsageMemberRow {
  /** null = 未归集桶 */
  userName: string | null;
  /** 可视码;null = 未归集桶。二级页按它做成员筛选 */
  userNo: string | null;
  total: number;
  eventCount: number;
  lastAt: Date;
}
