import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { BillingService } from "@vxture/service-billing";
import { SessionAggregator } from "../aggregators/session.aggregator";
import type { RequestContext } from "../types/console.types";

/**
 * 全局搜索：header ⌘K 面板的数据来源。
 *
 * 刻意做成**聚合而非索引**——扇出到已有的成员/发票读路径，在内存里按关键词
 * 过滤后截断。理由：这两处的数据量以租户为界（成员几十、发票按周期出），
 * 单租户可枚举，引一套检索引擎（索引维护、重建、一致性）在这个量级上是净负
 * 债。当任一数据源单租户超过千级，这里就该换成库侧 ILIKE 查询或真索引，届时
 * 接口形状不变，只换实现。
 *
 * 页面/功能的搜索**不在这里**：那份数据是前端导航注册表（含 i18n 文案与授权
 * 过滤结果），后端没有、也不该有一份副本。前端本地匹配后与本接口结果合并。
 */

/** 单类结果的返回上限。面板一屏能看的量，多了也只是滚动噪音。 */
const PER_KIND_LIMIT = 5;
/** 低于此长度不检索：一两个字符的命中率约等于"全量返回"。 */
const MIN_QUERY_LENGTH = 2;
/** 扇出时的取数上限，防止大租户把整表拉进内存。 */
const SCAN_LIMIT = 200;

export type SearchResultKind = "member" | "invoice";

export interface SearchResultItem {
  kind: SearchResultKind;
  id: string;
  /** 主行文案。 */
  label: string;
  /** 副行文案（邮箱、周期…）；无则省略。 */
  description?: string;
  /** 右端补充（角色、金额…）。 */
  meta?: string;
  /** 前端据此跳转；由后端给，前端不拼路径。 */
  href: string;
}

export interface SearchResponse {
  query: string;
  items: SearchResultItem[];
  /** 是否因为查询串太短而未检索——前端据此区分"没搜"和"搜了没有"。 */
  skipped: boolean;
}

function matches(
  needle: string,
  ...haystack: Array<string | null | undefined>
) {
  return haystack.some((value) => value?.toLowerCase().includes(needle));
}

@Controller("api/search")
export class SearchRouter {
  constructor(
    @Inject(SessionAggregator)
    private readonly sessionAggregator: SessionAggregator,
    @Inject(BillingService)
    private readonly billingService: BillingService,
  ) {}

  @Get()
  async search(
    @Req() req: Request & RequestContext,
    @Query("q") q?: string,
  ): Promise<SearchResponse> {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!req.tenant)
      throw new UnauthorizedException("Tenant context is required");

    const query = (q ?? "").trim();
    if (query.length < MIN_QUERY_LENGTH) {
      return { query, items: [], skipped: true };
    }
    const needle = query.toLowerCase();

    // 两个数据源互不依赖，并发取；任一失败只丢自己那一类，不整体 500——
    // 搜索是辅助入口，半份结果远好过一个错误弹窗。
    const [members, invoices] = await Promise.all([
      this.sessionAggregator
        .listMembers(req.user.id, req.tenant.id)
        .catch(() => []),
      this.billingService
        .listInvoices({ tenantId: req.tenant.id, pageSize: SCAN_LIMIT })
        .then((result) => result.items)
        .catch(() => []),
    ]);

    const memberHits: SearchResultItem[] = members
      .filter((m) => matches(needle, m.name, m.username, m.email, m.phone))
      .slice(0, PER_KIND_LIMIT)
      .map((m) => ({
        kind: "member" as const,
        id: m.id,
        label: m.name || m.username,
        ...(m.email ? { description: m.email } : {}),
        ...(m.role ? { meta: m.role } : {}),
        href: `/members?member=${encodeURIComponent(m.id)}`,
      }));

    const invoiceHits: SearchResultItem[] = invoices
      .filter((inv) =>
        matches(needle, inv.billNo, inv.billCycle, inv.transactionNo),
      )
      .slice(0, PER_KIND_LIMIT)
      .map((inv) => ({
        kind: "invoice" as const,
        id: inv.id,
        label: inv.billNo,
        description: inv.billCycle,
        meta: `${inv.currency} ${inv.payableAmount}`,
        href: `/billing?invoice=${encodeURIComponent(inv.id)}`,
      }));

    return {
      query,
      items: [...memberHits, ...invoiceHits],
      skipped: false,
    };
  }
}
