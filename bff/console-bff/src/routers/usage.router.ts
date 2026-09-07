/**
 * usage.router.ts - 租户用量分析路由
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * 用量分析页(/usage,owner 2026-08-20 用量配额线)的读侧:
 *   GET /api/usage/trend   — 周期趋势(usage_summary_* 五档降采样,纯统计/
 *                            看板,永不作计费依据):granularity=hour|day|week|
 *                            month|year × span,含按产品拆分;窗口内每个周期
 *                            都有一桶(无数据补零),末桶 = 当前周期,全程 UTC;
 *   GET /api/usage/events  — 任务级调用记录(usage_events,每次 consume 一行,
 *                            含终端用户归因;NULL = 未归集用户容错桶),可筛可
 *                            翻页,并给筛选后合计;
 *   GET /api/usage/members — 商业版按成员统计(近 N 天 usage_events 按
 *                            end_user_id 聚合,未归集单列一桶)。
 *
 * SQL 归 @vxture/service-subscription 的 MeteringReadService(console 批 3
 * 下沉);这里只做参数收口与视图映射。全页无 UUID 出口——事件行以 request_id/
 * 时间定位,成员以显示名 + `user_no` 可视码呈现。
 *
 * ## events 2026-09-07 重建(owner:调用记录要能精准查)
 *
 * 原来只有 `limit`(默认 200 / 上限 500)、固定 90 天、无筛选无分页无合计。
 * 客户拿这页质疑计量时,既定位不到争议的那几条,也没法把明细加总去对账。现在:
 *
 *   · 时间窗 `from` / `to`(缺省近 30 天,最远回看 `EVENTS_MAX_DAYS`);
 *   · 四个筛选维度:产品 / 指标 / 成员(可视码,或 `unattributed` 单筛未归集)
 *     / 请求号;
 *   · 分页 `page` / `pageSize`;
 *   · `total` 与 `totalAmount` 是**筛选后全集**的口径,不随分页变——这是客户
 *     自己加总对账的那个数,也是这次改造的目的。
 *
 * 行上同时给出 `requestedAmount`(申请量)与 `amount`(实扣量):两者不等即说明
 * 这次调用没能全额扣到(超额准入自愈),「我调了为什么没扣」的答案就在这儿。
 */

import {
  Controller,
  BadRequestException,
  Get,
  Inject,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  MeteringReadService,
  type UsageGranularity,
} from "@vxture/service-subscription";
import type { RequestContext } from "../types/console.types";
import { RequireCapability } from "../auth/capability";

// ============================================================================
// View types (mirrored by portals/console/src/api/console-bff.ts)
// ============================================================================

export interface UsageTrendBucket {
  /**
   * UTC 桶键:hour `YYYY-MM-DD HH:00` / day `YYYY-MM-DD` / week `YYYY-MM-DD`
   * (ISO 周一)/ month `YYYYMM` / year `YYYY`
   */
  period: string;
  total: number;
  byProduct: { productCode: string; productName: string; total: number }[];
}

export interface UsageTrendView {
  metric: string;
  granularity: string;
  buckets: UsageTrendBucket[];
}

export interface UsageEventView {
  /** 事件时间(ISO) */
  at: string;
  productCode: string;
  productName: string;
  metric: string;
  /** 实扣量 */
  amount: number;
  /** 申请量;与 amount 不等 = 这次没能全额扣到(超额准入自愈)。null = 未记录 */
  requestedAmount: number | null;
  /** 终端用户显示名;null = 产品未归集(容错桶) */
  userName: string | null;
  /** 终端用户可视码;null = 未归集 */
  userNo: string | null;
  requestId: string | null;
}

/** 一页明细 + 筛选后全集的合计(见头注:合计不随分页变,是对账用的那个数)。 */
export interface UsageEventsView {
  items: UsageEventView[];
  total: number;
  totalAmount: number;
  page: number;
  pageSize: number;
  /** 实际生效的时间窗(ISO),回给页面显示——省得页面自己再推一遍 */
  from: string;
  to: string;
}

export interface UsageMemberView {
  /** null = 未归集桶 */
  userName: string | null;
  /** 可视码;null = 未归集桶。调用记录页按它筛成员 */
  userNo: string | null;
  total: number;
  eventCount: number;
  lastAt: string;
}

const GRANULARITIES = new Set<UsageGranularity>([
  "hour",
  "day",
  "week",
  "month",
  "year",
]);

/** 每档默认/最大跨度(桶数)。hour = 近 24 小时逐时(柱状图,2026-08-21)。 */
const SPAN_LIMITS: Record<UsageGranularity, { def: number; max: number }> = {
  hour: { def: 24, max: 48 },
  day: { def: 30, max: 90 },
  week: { def: 12, max: 26 },
  month: { def: 12, max: 24 },
  year: { def: 5, max: 10 },
};

const EVENTS_DEFAULT_DAYS = 30;
/** 最远回看:与 usage_events 的月分区保留窗口对齐。 */
const EVENTS_MAX_DAYS = 90;
const EVENTS_DEFAULT_PAGE_SIZE = 20;
const EVENTS_MAX_PAGE_SIZE = 100;

const METRIC_RE = /^[a-z][a-z0-9_.\-]{0,63}$/;
const PRODUCT_CODE_RE = /^[a-z0-9][a-z0-9_\-]{0,63}$/;
const REQUEST_ID_RE = /^[\w.:\-]{1,128}$/;
/** 成员筛选:可视码(纯数字)或未归集那一桶。 */
const USER_FILTER_RE = /^(\d{1,20}|unattributed)$/;

function parseMetric(raw: string | undefined): string {
  return METRIC_RE.test(raw ?? "") ? raw! : "ai.credit";
}

/** 可选筛选值:形状不合就当没传(不报错——筛选是收窄,给不出就别收窄)。 */
function optional(raw: string | undefined, re: RegExp): string | undefined {
  const v = raw?.trim();
  return v && re.test(v) ? v : undefined;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
}

/**
 * 时间窗收口:`from`/`to` 是 `YYYY-MM-DD`(用户在日期控件里选的那两天)。
 *
 *   · `to` 含当天 —— 用户选「到 9 月 7 日」意思是把 7 号整天算进去,
 *     所以取 8 号 00:00 做开区间右端,不是 7 号 00:00(那会把整天漏掉);
 *   · 起点不早于 `EVENTS_MAX_DAYS` 天前(再早分区已不在,查了也是空);
 *   · `from > to` 判为无效,整段回落默认窗口——别让页面拿到一个空结果却
 *     以为「这段时间真没有调用」。
 */
function parseWindow(
  fromRaw: string | undefined,
  toRaw: string | undefined,
): { from: Date; to: Date } {
  const day = (raw: string | undefined): Date | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw ?? "")) return null;
    const d = new Date(`${raw}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const now = Date.now();
  const floor = new Date(now - EVENTS_MAX_DAYS * 86_400_000);
  const fallbackFrom = new Date(now - EVENTS_DEFAULT_DAYS * 86_400_000);
  // 右端 = 明天 00:00(UTC),把「今天」整天含进来
  const fallbackTo = new Date(
    Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate() + 1,
    ),
  );
  const parsedFrom = day(fromRaw);
  const parsedTo = day(toRaw);
  const to = parsedTo
    ? new Date(parsedTo.getTime() + 86_400_000) // 含 to 当天
    : fallbackTo;
  const from = parsedFrom ?? fallbackFrom;
  if (from.getTime() >= to.getTime()) {
    return { from: fallbackFrom, to: fallbackTo };
  }
  return { from: from < floor ? floor : from, to };
}

// ============================================================================
// UsageRouter
// ============================================================================

@RequireCapability("tenant.quota.read")
@Controller("api/usage")
export class UsageRouter {
  constructor(
    @Inject(MeteringReadService)
    private readonly metering: MeteringReadService,
  ) {}

  // --------------------------------------------------------------------------
  // GET /api/usage/trend?metric=ai.credit&granularity=day&span=30
  // --------------------------------------------------------------------------

  @Get("trend")
  async getTrend(
    @Req() req: Request & RequestContext,
    @Query("metric") metricRaw?: string,
    @Query("granularity") granularityRaw?: string,
    @Query("span") spanRaw?: string,
  ): Promise<UsageTrendView> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);

    const granularity: UsageGranularity = GRANULARITIES.has(
      granularityRaw as UsageGranularity,
    )
      ? (granularityRaw as UsageGranularity)
      : "day";
    const limits = SPAN_LIMITS[granularity];
    const result = await this.metering.getUsageTrend({
      workspaceId,
      metric: parseMetric(metricRaw),
      granularity,
      span: parsePositiveInt(spanRaw, limits.def, limits.max),
    });
    return {
      metric: result.metric,
      granularity: result.granularity,
      buckets: result.buckets,
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/usage/events
  //   ?from=2026-09-01&to=2026-09-07&product=&metric=&user=&requestId=
  //   &page=1&pageSize=20
  // 任务级调用记录(时间倒序)+ 筛选后合计。见头注「events 2026-09-07 重建」。
  // --------------------------------------------------------------------------

  @Get("events")
  async getEvents(
    @Req() req: Request & RequestContext,
    @Query("from") fromRaw?: string,
    @Query("to") toRaw?: string,
    @Query("product") productRaw?: string,
    @Query("metric") metricRaw?: string,
    @Query("user") userRaw?: string,
    @Query("requestId") requestIdRaw?: string,
    @Query("page") pageRaw?: string,
    @Query("pageSize") pageSizeRaw?: string,
  ): Promise<UsageEventsView> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);
    const { from, to } = parseWindow(fromRaw, toRaw);
    const pageSize = parsePositiveInt(
      pageSizeRaw,
      EVENTS_DEFAULT_PAGE_SIZE,
      EVENTS_MAX_PAGE_SIZE,
    );
    // 页码上限用 Number.MAX_SAFE_INTEGER：越界页由 total 在页面侧夹回,
    // 这里不假定总数(还没查出来)。
    const page = parsePositiveInt(pageRaw, 1, Number.MAX_SAFE_INTEGER);
    // 指标在这条路由上是**可选筛选**,不套 parseMetric 的 ai.credit 缺省——
    // 审计要看的可能正是别的指标,默认收窄会让人以为「那条调用不存在」。
    const result = await this.metering.listUsageEvents({
      workspaceId,
      from,
      to,
      ...(optional(productRaw, PRODUCT_CODE_RE)
        ? { productCode: optional(productRaw, PRODUCT_CODE_RE)! }
        : {}),
      ...(optional(metricRaw, METRIC_RE)
        ? { metricKey: optional(metricRaw, METRIC_RE)! }
        : {}),
      ...(optional(userRaw, USER_FILTER_RE)
        ? { user: optional(userRaw, USER_FILTER_RE)! }
        : {}),
      ...(optional(requestIdRaw, REQUEST_ID_RE)
        ? { requestId: optional(requestIdRaw, REQUEST_ID_RE)! }
        : {}),
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
    return {
      items: result.items.map((r) => ({
        at: r.createdAt.toISOString(),
        productCode: r.productCode,
        productName: r.productName,
        metric: r.metricKey,
        amount: r.totalAmount,
        requestedAmount: r.requestedAmount,
        userName: r.userName,
        userNo: r.userNo,
        requestId: r.requestId,
      })),
      total: result.total,
      totalAmount: result.totalAmount,
      page,
      pageSize,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/usage/members?days=30 — 按成员统计(商业版细分;未归集单列一桶)
  // --------------------------------------------------------------------------

  @Get("members")
  async getMembers(
    @Req() req: Request & RequestContext,
    @Query("days") daysRaw?: string,
    @Query("metric") metricRaw?: string,
  ): Promise<UsageMemberView[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);
    const rows = await this.metering.listUsageByMember({
      workspaceId,
      metric: parseMetric(metricRaw),
      days: parsePositiveInt(daysRaw, 30, 365),
    });
    return rows.map((r) => ({
      userName: r.userName,
      userNo: r.userNo,
      total: r.total,
      eventCount: r.eventCount,
      lastAt: r.lastAt.toISOString(),
    }));
  }

  private async resolveDefaultWorkspace(tenantId: string): Promise<string> {
    const id = await this.metering.findDefaultWorkspaceId(tenantId);
    if (!id) throw new BadRequestException("租户缺少默认工作空间");
    return id;
  }
}
