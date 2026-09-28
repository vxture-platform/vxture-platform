/**
 * operator-notices.router.ts — 运营通告的发布面与本平面的收件面。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * owner 2026-09-20：「面向客户的由 admin 发布，面向内部运营的由 opera 发布」。
 * 所以**写侧只在这里**——admin / arche 只读（它们各自的 BFF 用本平面根码读）。
 *
 * 与 `admin.announcements` 的分界：那张是面向**客户**的平台公告（target_plans /
 * target_tenant_types / is_dismissible / cta_url，客户在 console 看见），发布面在
 * admin，能力码是 `content:announcement.*`。本表面向**运营者**，能力码
 * `ops:notice.*`，两条线互不相干。
 *
 * ── 撤回是软删，不是硬删 ──
 * 通告已经被人看过、已读关系也已经落表；硬删会让那些已读记录跟着 CASCADE 消失，
 * 于是「我读过没有」这个事实被改写。软删只是让它退出列表。
 *
 * ── system 这条路已经有真实写者了 ──
 * 2026-09-28 的前三批给 `source = 'system'` 接上了生产者（客户通知的运营镜像、业务
 * 事件巡检、运营动作巡检、维护窗口与产品生命周期）。写路在 `@vxture/service-notice`
 * 的 createSystemNotice，不经这个路由。这里仍然**拒绝**客户端传 source：人手发的
 * 一律 manual。
 *
 * ── 一个路由两个面，它们的作用域不同 ──
 * 2026-09-28 第四批：前三批刻意把信号做全，这一批让它读得懂。于是同一个路由上并存
 * 两种列表，回答的不是同一个问题：
 *
 *   GET /api/operator-notices        **发布面**。三个平面的通告全列——opera 是唯一
 *                                    的发布者，它要看得见自己发出去的全部。带
 *                                    targetPlanes / expiresAt 与撤回动作。
 *   GET /api/operator-notices/inbox  **收件面**。只有投放到 opera 的那些，读侧算法
 *                                    整条取 `@vxture/service-notice`。
 *
 * 发布面**不报未读数**，只报三档条数。报了就会有两个「未读」同时出现在同一屏上，
 * 而它们的作用域差着「含不含别的平面」「含不含已过期」两刀——两个都对、都解释得通，
 * 屏幕上却只能是一个数。未读数一律从收件面来，「全部标记已读」清掉的也正是它那一份
 * （PgNoticeRepository.markAllRead）：动作作用域必须等于那个数的作用域。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import {
  NOTICE_PLANES,
  NOTICE_SEVERITIES,
  NoticeFilterError,
  PgNoticeRepository,
  likePattern,
  parseNoticeFlag,
  parseNoticeKeyword,
  parseNoticeSeverities,
  parseNoticeSource,
  type ListNoticesResult,
  type MarkNoticeReadResult,
  type NoticePlane,
  type NoticeSeverity,
  type NoticeSource,
} from "@vxture/service-notice";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { PLANE_ROOT } from "../auth/plane";
import { withTransaction } from "../db/tx";
import {
  internalError,
  invalidRequest,
  notEntitled,
  notFound,
  unauthenticated,
} from "../errors/api-error";
import { OPERA_BFF_RO_POOL, OPERA_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import {
  LIST_LIMIT,
  optionalText,
  parseIso,
  requireOperatorId,
  requireText,
  requireUuid,
  toIso,
  toIsoOrNull,
} from "./router.shared";

/* 平面码与严重度取自 @vxture/service-notice：它们是表上那两条 CHECK 约束在代码
 * 里的投影，只该有一处。此前 opera 与 admin 各写了一份——加第四个平面时，改了
 * 一处没改另一处，症状分别是插入吃 23514、与新平面在读侧永远匹配不上。 */
const PLANES = NOTICE_PLANES;
type Plane = NoticePlane;

const SEVERITIES = NOTICE_SEVERITIES;
type Severity = NoticeSeverity;

/**
 * 本平面的代号，与 `target_planes` 里的值同一套（PLANE_ROOT 是 "opera.plane"）。
 *
 * 从根码切出来而不是再写一个 "opera" 字面量：这两者必须是同一个词，各写一份的话
 * 改一处漏一处的症状是「通告投到了一个没人读的平面」，而那不报错。
 */
const PLANE_NAME = PLANE_ROOT.split(".")[0] as Plane;

export interface OperatorNoticeItem {
  id: string;
  /** 空数组 = 三个平面都看得见。 */
  targetPlanes: Plane[];
  severity: Severity;
  title: string;
  body: string;
  link: string | null;
  source: "manual" | "system";
  publishedAt: string;
  expiresAt: string | null;
  /** 发布人显示名；账号注销后读不到，显示「—」由前端决定。 */
  createdByName: string | null;
  createdAt: string;
  /**
   * **本人**读过的时刻；null = 没读过。
   *
   * 只对投到本平面的那些有意义（见 `onThisPlane`）：投给 admin 的通告在 opera 的
   * 发布面上也列着，但那不是给这个人看的信，它没有「未读」可言。
   */
  readAt: string | null;
  /** 这条通告投不投放到 opera。前端据此决定画不画「未读」，不自己判 targetPlanes。 */
  onThisPlane: boolean;
}

interface OperatorNoticeRow {
  id: string;
  target_planes: string[];
  severity: string;
  title: string;
  body: string;
  link: string | null;
  source: string;
  published_at: Date;
  expires_at: Date | null;
  created_by_name: string | null;
  created_at: Date;
  read_at: Date | null;
  on_this_plane: boolean;
}

/**
 * 汇总行。**与页行分成两条语句**：计数本可以写成页行的附加列，但那样筛出 0 条时
 * 整排数字会一起变成 0——而「按紧急筛完没了」恰恰是最需要看见「重要还有 12 条」的
 * 时刻（同 `@vxture/service-notice` 的同名取舍）。
 *
 * 一律 `::text`：count(*) 是 bigint，pg 默认把它翻成字符串，声明成 number 是在
 * 类型上撒谎。
 */
interface NoticeSummaryRow {
  total_count: string;
  matched_count: string;
  info_count: string;
  warning_count: string;
  critical_count: string;
}

function mapRow(row: OperatorNoticeRow): OperatorNoticeItem {
  return {
    id: row.id,
    targetPlanes: row.target_planes as Plane[],
    severity: row.severity as Severity,
    title: row.title,
    body: row.body,
    link: row.link,
    source: row.source as "manual" | "system",
    publishedAt: toIso(row.published_at),
    expiresAt: toIsoOrNull(row.expires_at),
    createdByName: row.created_by_name,
    createdAt: toIso(row.created_at),
    readAt: toIsoOrNull(row.read_at),
    onThisPlane: row.on_this_plane,
  };
}

/**
 * 三档都要有键，读不到的档是 0。
 *
 * 按 SEVERITIES 派生而不是手写三行：加一档严重度时这里会在类型上报少一列，
 * 而手写三行只会静默少报一档（同 service-notice 的 mapCounts）。
 */
function mapCounts(
  row: NoticeSummaryRow | undefined,
): Record<Severity, number> {
  const counts = {} as Record<Severity, number>;
  for (const severity of SEVERITIES) {
    counts[severity] = Number(row?.[`${severity}_count`] ?? 0);
  }
  return counts;
}

/**
 * 发布面三段 CTE。绑定值：
 *   $1 本平面代号 · $2 当前运营者 · $3 含不含已过期 · $4 来源（null = 不筛）
 *   $5 只看未读 · $6 关键词 ILIKE 模式（null = 不筛）· $7 严重度数组（空 = 不筛）
 *
 * 四项筛选一律写成「恒在谓词里、由 null / false 关掉」的形状，不靠 JS 拼 where：
 * SQL 一旦插值，lint:anchor-writes 那一族静态守卫当场读不懂语句，变瞎且恒绿。
 * 值也一个不进串——关键词里的 % 与 _ 由 likePattern 转义（那是语义，不是注入）。
 *
 * 三段的分工就是这一批的判据：
 *   · scoped    当前时效档下未撤回的全部（三个平面）。total 在它上面数——它是
 *               「一共有多少条」，不该随筛选变。
 *   · narrowed  加上来源 / 未读 / 关键词。counts 在它上面数，所以那排数字会随
 *               这三项动，但**不随严重度自己动**。
 *   · matched   再加上严重度。页行与 matched 在它上面——严重度晚一步生效，正是
 *               为了勾了「紧急」之后另两档还报得出数，否则那排数字退化成回声。
 *
 * `on_this_plane` 是**投影出来的一列**，不是一条 where：发布面要列三个平面的全部，
 * 「投没投到我这儿」是每行的一项事实，交给前端画标记，也给「只看未读」当判据。
 * 它与 `@vxture/service-notice` 的 VISIBLE_WHERE 里那一句同源（空数组 = 全部平面
 * 是唯一表示）；收件面整条走那一份，这里只借这一句的判法。
 *
 * 「只看未读」额外要求 not expired：过期的通告不再需要谁去看它，把它算进未读会让
 * 这个筛选与铃铛角标（收件面算的，恒不含过期）差出一批谁也解释不了的行。
 */
const NOTICE_SCOPE_CTE = `
  with scoped as (
    select n.id, n.target_planes, n.severity, n.title, n.body, n.link, n.source,
           n.published_at, n.expires_at, n.created_at,
           nullif(a.display_name, '') as created_by_name,
           r.read_at,
           (n.target_planes = '{}' or $1 = any(n.target_planes)) as on_this_plane,
           (n.expires_at is not null and n.expires_at <= now()) as expired
      from admin.operator_notices n
      left join admin.operator_account a on a.id = n.created_by
      left join admin.operator_notice_reads r
             on r.notice_id = n.id and r.operator_id = $2::uuid
     where n.deleted_at is null
       and ($3::bool or n.expires_at is null or n.expires_at > now())
  ), narrowed as (
    select * from scoped
     where ($4::varchar is null or source = $4::varchar)
       and (not $5::bool or (read_at is null and on_this_plane and not expired))
       and ($6::text is null
            or title ilike $6::text escape '\\'
            or body ilike $6::text escape '\\')
  ), matched as (
    select * from narrowed
     where cardinality($7::varchar(16)[]) = 0
        or severity = any($7::varchar(16)[])
  )
`;

/**
 * 页行。$8 = limit；分页仍由前端做，这里只挡「一次拉全表」。
 *
 * **导出仅为可测**：假 pool 不解析 SQL，「计数算在 narrowed 上而不是 matched 上」
 * 「汇总那条比页行少绑一个值」这两条只能对语句文本断言（与 service-notice 的
 * CREATE_SYSTEM_NOTICE_SQL 同一手法）。
 */
export const LIST_SQL = `${NOTICE_SCOPE_CTE}
  select m.id, m.target_planes, m.severity, m.title, m.body, m.link, m.source,
         m.published_at, m.expires_at, m.created_at, m.created_by_name,
         m.read_at, m.on_this_plane
    from matched m
   order by m.published_at desc, m.id desc
   limit $8
`;

/**
 * 计数汇总，**不带 limit**：恒回一行，筛出 0 条时也报得出「别的档还有几条」。
 * 也因此它比页行少绑一个值——多绑一个 pg 会直接拒。
 */
export const LIST_SUMMARY_SQL = `${NOTICE_SCOPE_CTE}
  select (select count(*) from scoped)::text as total_count,
         (select count(*) from matched)::text as matched_count,
         (select count(*) from narrowed where severity = 'info')::text as info_count,
         (select count(*) from narrowed where severity = 'warning')::text as warning_count,
         (select count(*) from narrowed where severity = 'critical')::text as critical_count
`;

/** 回读刚发布的那一行时用的单行查询。$8 = 通告 id。导出仅为可测（打真库那一份）。 */
export const READBACK_SQL = `${NOTICE_SCOPE_CTE}
  select m.id, m.target_planes, m.severity, m.title, m.body, m.link, m.source,
         m.published_at, m.expires_at, m.created_at, m.created_by_name,
         m.read_at, m.on_this_plane
    from matched m
   where m.id = $8
`;

export interface OperatorNoticeListResult {
  items: OperatorNoticeItem[];
  /** 当前时效档下未撤回的总条数，**不受四项筛选影响**。 */
  total: number;
  /** 命中四项筛选的条数。items 被 LIST_LIMIT 截断时它仍然是真数。 */
  matched: number;
  /** 三档各有多少条；口径 = 除严重度以外的筛选都算上。 */
  counts: Record<Severity, number>;
}

/** 「全部标记已读」的结果。marked = 真的从未读翻成已读的条数，0 也是合法答案。 */
export interface MarkAllReadResult {
  marked: number;
}

/** 发布面的四项筛选，规整过的形状。 */
export interface NoticeListFilters {
  readonly includeExpired: boolean;
  /** 空数组 = 三档都要。三档全给也收敛成空数组，与「没给」是同一种表示。 */
  readonly severities: Severity[];
  readonly source: NoticeSource | null;
  readonly unreadOnly: boolean;
  /** 已 trim；空串 = 不筛。 */
  readonly keyword: string;
}

/**
 * 查询串原样。四项筛选的线上名字与 admin 侧**逐字相同**（`severity` / `source` /
 * `unread` / `q`）：同一件事在两个平面该叫同一个词，否则接第三个平面的人只能靠读
 * 两份代码猜哪个对。
 *
 * **名字相同不够，值也得相同**：这四个名字曾经在两侧各解析一份，于是 `unread=1` 在
 * 这边开、在 admin 静默忽略，`severity=all` 在这边是「不筛」、在 admin 是 400，关键词
 * 上限这边 128、那边 200——同一个 URL 两种行为，而「不筛」那一半不报错。值的词汇现在
 * 整条取 `@vxture/service-notice` 的 `parseNotice*`（见那一份的文件头），两侧同一个
 * 解析器，接第三个平面的人读那一份就够。
 *
 * `keyword` 也收：读模型那一侧的字段就叫 `keyword`（`NoticeFilters.keyword`），照着
 * 服务包的词汇写客户端的人会很自然地送这个名字。两个都认、以 `q` 为先，比让其中
 * 一半静默失效好——那种失效的症状是「搜了但没筛」，和「搜到了很多条」长得一样。
 */
export interface NoticeListQueryInput {
  readonly includeExpired?: string | undefined;
  readonly severity?: string | string[] | undefined;
  readonly source?: string | undefined;
  readonly unread?: string | undefined;
  /** 线上名。与 admin 同名。 */
  readonly q?: string | undefined;
  /** 别名，与读模型的字段同名。见上。 */
  readonly keyword?: string | undefined;
}

/**
 * 规整四项筛选 + 时效档。**值的词汇一个字都不在这里**：四个解析器整条取
 * `@vxture/service-notice`（`parseNoticeSeverities` / `parseNoticeSource` /
 * `parseNoticeFlag` / `parseNoticeKeyword`），admin 读的是同一份。
 *
 * 留在这一侧的只有本 BFF 的 HTTP 关切：把包里的 `NoticeFilterError` 翻成带 `code` 与
 * `field` 的 400 封套——控制台靠 `field` 高亮出错的那一格，而包不该认识 opera 的封套
 * （admin 那一侧翻的是 `BadRequestException`，两种封套不是一个）。
 *
 * `includeExpired` 走同一个 `parseNoticeFlag`：它不是读侧筛选（换的是数据集，不是少看
 * 几行，所以不在 `NoticeFilters` 里），但它是个开关——同一屏上两个开关各认一套值是
 * 没人记得住的。
 */
export function normalizeListFilters(
  input: NoticeListQueryInput,
): NoticeListFilters {
  try {
    return {
      includeExpired: parseNoticeFlag(input.includeExpired),
      severities: parseNoticeSeverities(input.severity),
      source: parseNoticeSource(input.source),
      unreadOnly: parseNoticeFlag(input.unread),
      keyword: parseNoticeKeyword(input.q ?? input.keyword),
    };
  } catch (error) {
    if (error instanceof NoticeFilterError) {
      throw invalidRequest(error.code, error.message, error.field);
    }
    throw error;
  }
}

/**
 * 两条语句共用的绑定值（页行再追加一个 limit，回读追加一个 id）。
 *
 * 导出仅为可测：假 pool 不解析 SQL，「不给的那一项落成 null / false / 空数组」只能
 * 对这个数组断言。
 */
export function noticeListValues(
  plane: Plane,
  operatorId: string,
  filters: NoticeListFilters,
): unknown[] {
  return [
    plane,
    operatorId,
    filters.includeExpired,
    filters.source,
    filters.unreadOnly,
    filters.keyword === "" ? null : likePattern(filters.keyword),
    filters.severities,
  ];
}

/**
 * 回读一行时的筛选：**四项全关，时效全开**。
 *
 * 刚发布的通告可能一出生就过期（发布时填了一个过去的失效时间），那时 includeExpired
 * 为假会让回读扑空，于是一条已经插进库的通告以 500 回给运营者。
 */
const READBACK_FILTERS: NoticeListFilters = {
  includeExpired: true,
  severities: [],
  source: null,
  unreadOnly: false,
  keyword: "",
};

export interface OperatorNoticeWriteBody {
  title?: unknown;
  body?: unknown;
  link?: unknown;
  severity?: unknown;
  targetPlanes?: unknown;
  expiresAt?: unknown;
}

interface NormalizedNotice {
  title: string;
  body: string;
  link: string | null;
  severity: Severity;
  targetPlanes: Plane[];
  /** parseIso 回的是 ISO 串,不是 Date——pg 直接收字符串。 */
  expiresAt: string | null;
}

function normalize(input: OperatorNoticeWriteBody): NormalizedNotice {
  const title = requireText(input.title, "title", 256);
  const body = requireText(input.body, "body", 8000);
  const link = optionalText(input.link, "link", 512);

  const severityRaw = input.severity === undefined ? "info" : input.severity;
  if (!SEVERITIES.includes(severityRaw as Severity)) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      `severity must be one of ${SEVERITIES.join("/")}`,
      "severity",
    );
  }

  // 未给 = 空数组 = 三个平面都看得见。**不展开成三个元素**：将来加平面时，
  // 展开过的历史行会把新平面漏掉，而空数组自动包含它。
  let targetPlanes: Plane[] = [];
  if (input.targetPlanes !== undefined) {
    if (!Array.isArray(input.targetPlanes)) {
      throw invalidRequest(
        "VALIDATION_INVALID_VALUE",
        "targetPlanes must be an array",
        "targetPlanes",
      );
    }
    const seen = new Set<string>();
    for (const raw of input.targetPlanes) {
      if (typeof raw !== "string" || !PLANES.includes(raw as Plane)) {
        throw invalidRequest(
          "VALIDATION_INVALID_VALUE",
          `targetPlanes must contain only ${PLANES.join("/")}`,
          "targetPlanes",
        );
      }
      seen.add(raw);
    }
    // 三个都选 = 全选，收敛成空数组，与「未给」落成同一种表示。
    // 两种写法在库里各存一份的话，读侧的 target_planes = '{}' 判据就会漏掉一半。
    targetPlanes = seen.size === PLANES.length ? [] : ([...seen] as Plane[]);
  }

  const expiresAt =
    input.expiresAt === undefined || input.expiresAt === null
      ? null
      : parseIso(String(input.expiresAt), "expiresAt");

  return {
    title,
    body,
    link,
    severity: severityRaw as Severity,
    targetPlanes,
    expiresAt,
  };
}

@Controller("api/operator-notices")
export class OperatorNoticesRouter {
  constructor(
    @Inject(OPERA_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(OPERA_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  private noticeRepo: PgNoticeRepository | null = null;

  /**
   * 收件面与两处「标记已读」都走 `@vxture/service-notice` 的那一份算法。
   *
   * 懒建而不引 NoticeModule：那个模块自带一个 NOTICE_PG_POOL，同名令牌在一个容器里
   * 会静默互相覆盖，而且会为同一个库再开一条池——与 console-bff 里
   * `new PgNoticeRepository(this.pool)` 同一手法。
   *
   * 池取 **RW**，连读也取它：markAllRead 之后要立刻把未读数读回来，而 RO 那条可以
   * 指向只读副本（REPORTING_RO_DATABASE_URL）。从副本读会拿到复制延迟里的旧数——
   * 按完「全部标记已读」角标还挂着 12，那在屏幕上读作「按钮没生效」。
   */
  private notices(): PgNoticeRepository {
    if (!this.noticeRepo) {
      this.noticeRepo = new PgNoticeRepository(this.rwPool);
    }
    return this.noticeRepo;
  }

  /**
   * GET /api/operator-notices —— 发布面。
   *
   * 列的是**这个平台发布过的全局清单**（三个平面都列），不是「我的收件箱」。默认隐去
   * 已过期的：发布面关心的是还在生效的那些。
   *
   * 四项筛选（severity / source / unread / keyword）在**库里**生效，不在前端。前端筛
   * 的话，matched 与三档计数只能按已经被 LIST_LIMIT 截断过的那一段算——于是「共 37 条」
   * 在第 501 条之后开始说谎，而没人看得出来。
   */
  @Get()
  async listNotices(
    @Req() req: Request & RequestContext,
    @Query("includeExpired") includeExpired?: string,
    @Query("severity") severity?: string | string[],
    @Query("source") source?: string,
    @Query("unread") unread?: string,
    @Query("q") q?: string,
    @Query("keyword") keyword?: string,
  ): Promise<OperatorNoticeListResult> {
    assertCanReadNotices(req);
    const operatorId = requireOperatorId(req);
    const filters = normalizeListFilters({
      includeExpired,
      severity,
      source,
      unread,
      q,
      keyword,
    });
    const values = noticeListValues(PLANE_NAME, operatorId, filters);

    // 两条都是只读，并发发出：快照差几毫秒不影响任何判断，串起来则每次筛选多一个往返。
    const [page, summary] = await Promise.all([
      this.pool.query<OperatorNoticeRow>(LIST_SQL, [...values, LIST_LIMIT]),
      this.pool.query<NoticeSummaryRow>(LIST_SUMMARY_SQL, values),
    ]);
    const totals = summary.rows[0];
    return {
      items: page.rows.map(mapRow),
      total: Number(totals?.total_count ?? 0),
      matched: Number(totals?.matched_count ?? 0),
      counts: mapCounts(totals),
    };
  }

  /**
   * GET /api/operator-notices/inbox —— 收件面（只有投放到 opera 的）。
   *
   * 整条走 `@vxture/service-notice`：可见性谓词、摘要档、未读数、三档计数都在那一份
   * 里。铃铛角标、「需要处理」那一块、以及「全部标记已读」清掉的集合必须是同一个集合
   * ——各写一份的话，按一下角标不归零，而没人能从界面上看出剩下那几条凭什么还在。
   *
   * scope=digest（默认）是 owner 那条摘要规则：**当天已读 + 所有未读**。scope=all
   * 去掉已读那一条谓词，给「看全部」用。
   *
   * 平面与运营者都不从请求取：平面是本 BFF 自己的身份，人是会话里的那个。收了就等于
   * 开一个「读别的平面 / 别人已读状态」的探测面。
   */
  @Get("inbox")
  async listInbox(
    @Req() req: Request & RequestContext,
    @Query("scope") scope?: string,
    @Query("severity") severity?: string | string[],
    @Query("source") source?: string,
    @Query("unread") unread?: string,
    @Query("q") q?: string,
    @Query("keyword") keyword?: string,
    @Query("limit") limitParam?: string,
    @Query("offset") offsetParam?: string,
  ): Promise<ListNoticesResult> {
    assertCanReadNotices(req);
    const operatorId = requireOperatorId(req);
    const filters = normalizeListFilters({
      severity,
      source,
      unread,
      q,
      keyword,
    });
    const digest = scope !== "all";
    return this.notices().list({
      plane: PLANE_NAME,
      operatorId,
      digest,
      limit: clampInt(limitParam, digest ? 20 : 50, 1, 200),
      offset: clampInt(offsetParam, 0, 0, 100_000),
      // exactOptionalPropertyTypes：没给的那一项**不出现**，不是「出现且为 undefined」。
      ...(filters.severities.length > 0
        ? { severities: filters.severities }
        : {}),
      ...(filters.source !== null ? { source: filters.source } : {}),
      ...(filters.unreadOnly ? { unreadOnly: true } : {}),
      ...(filters.keyword !== "" ? { keyword: filters.keyword } : {}),
    });
  }

  /** POST /api/operator-notices —— 发布一条。source 恒为 manual，见文件头。 */
  @Post()
  async createNotice(
    @Req() req: Request & RequestContext,
    @Body() body: OperatorNoticeWriteBody,
  ): Promise<OperatorNoticeItem> {
    assertCanManageNotices(req);
    const createdBy = requireOperatorId(req);
    const input = normalize(body);

    return withTransaction(this.rwPool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into admin.operator_notices
           (target_planes, severity, title, body, link, expires_at, created_by)
         values ($1::varchar(16)[], $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          input.targetPlanes,
          input.severity,
          input.title,
          input.body,
          input.link,
          input.expiresAt,
          createdBy,
        ],
      );
      const created = rows[0];
      if (!created) {
        // 库没按要求插进去 = 本方故障。回 400 会让运营者以为是自己填错了，
        // 然后反复改一个永远改不好的输入。
        throw internalError(
          "OPERATOR_NOTICE_INSERT_FAILED",
          "Operator notice insert returned no row",
        );
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.operator_notice.create",
        resourceType: "operator_notice",
        resourceId: created.id,
        after: {
          title: input.title,
          severity: input.severity,
          targetPlanes: input.targetPlanes,
        },
      });
      const { rows: fresh } = await client.query<OperatorNoticeRow>(
        READBACK_SQL,
        [
          ...noticeListValues(PLANE_NAME, createdBy, READBACK_FILTERS),
          created.id,
        ],
      );
      if (!fresh[0]) {
        throw internalError(
          "OPERATOR_NOTICE_READBACK_FAILED",
          "Operator notice read-back returned no row",
        );
      }
      return mapRow(fresh[0]);
    });
  }

  /**
   * POST /api/operator-notices/read-all —— 把本平面此刻可见且未读的全部记上。
   *
   * 作用域**不含**发布面那四项筛选，也不含摘要档：它清掉的正是铃铛角标数的那一份。
   * 所以界面上这个按钮必须挨着那个数字放、标签里带着那个数——「全部」放在一屏筛过的
   * 列表旁边会被读成「这一屏」，两种读法差一个数量级。
   *
   * 不记审计：标记已读是「我看过了」，不是一项管理面变更；admin / arche 的读侧同样
   * 不记。要审的是发布与撤回，那两处记着。
   */
  @Post("read-all")
  async markAllNoticesRead(
    @Req() req: Request & RequestContext,
  ): Promise<MarkAllReadResult> {
    assertCanReadNotices(req);
    const operatorId = requireOperatorId(req);
    const marked = await this.notices().markAllRead(PLANE_NAME, operatorId);
    return { marked };
  }

  /** POST /api/operator-notices/:id/read —— 标记本人已读。幂等。 */
  @Post(":id/read")
  async markNoticeRead(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<MarkNoticeReadResult> {
    assertCanReadNotices(req);
    const operatorId = requireOperatorId(req);
    const noticeId = requireUuid(id, "id", "Invalid notice id");

    const marked = await this.notices().markRead(noticeId, operatorId);
    // 服务层回 null = 通告不存在或已撤回。那是调用方要据以说话的结果，不是故障，
    // 所以 404 在这里翻，不在包里抛。
    if (!marked) {
      throw notFound("OPERATOR_NOTICE_NOT_FOUND", "Operator notice not found");
    }
    return marked;
  }

  /**
   * DELETE /api/operator-notices/:id —— 撤回（软删）。
   *
   * 不硬删：已读关系挂着 ON DELETE CASCADE，硬删会连带抹掉「谁读过」这个事实。
   * 软删只是让它退出列表。
   */
  @Delete(":id")
  async withdrawNotice(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{ id: string; withdrawn: true }> {
    assertCanManageNotices(req);
    const noticeId = requireUuid(id, "id", "Invalid notice id");

    return withTransaction(this.rwPool, async (client) => {
      // 条件 UPDATE：已撤回的再撤一次影响 0 行,与「不存在」在这里是同一个回答
      // ——撤回是幂等意图,不值得为「你撤过了」单独报一个错。
      const { rows } = await client.query<{ id: string }>(
        `update admin.operator_notices
            set deleted_at = now(), updated_at = now()
          where id = $1 and deleted_at is null
          returning id`,
        [noticeId],
      );
      if (!rows[0]) {
        const { rows: exists } = await client.query<{ id: string }>(
          `select id from admin.operator_notices where id = $1`,
          [noticeId],
        );
        if (!exists[0]) {
          throw notFound(
            "OPERATOR_NOTICE_NOT_FOUND",
            "Operator notice not found",
          );
        }
        // 已经是撤回态：按幂等回成功，不报 409。
        return { id: noticeId, withdrawn: true as const };
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.operator_notice.withdraw",
        resourceType: "operator_notice",
        resourceId: noticeId,
      });
      return { id: noticeId, withdrawn: true as const };
    });
  }
}

/** 入参兜底。limit 上限与 admin / arche 同 200：再大只会把一页撑到没人读得完。 */
function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

// ── 能力门 ──────────────────────────────────────────────────────────────────
// 读需要 read 或 manage（能发的人当然能看）；写只认 manage。
// 「标记已读」归读：它改的是「我看过没有」，不是通告本身。

function assertCanReadNotices(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (
    !req.capabilities ||
    (!req.capabilities.includes("ops:notice.read") &&
      !req.capabilities.includes("ops:notice.manage"))
  ) {
    throw notEntitled("ops:notice.read");
  }
}

function assertCanManageNotices(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (!req.capabilities || !req.capabilities.includes("ops:notice.manage")) {
    throw notEntitled("ops:notice.manage");
  }
}
