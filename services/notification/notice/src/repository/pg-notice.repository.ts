/**
 * pg-notice.repository.ts — 运营通告读侧的唯一数据出口 + 系统来源的唯一写路。
 * @package @vxture/service-notice
 * @layer Infrastructure
 * @category Repository
 *
 * 「谁能看见哪些通告」这条谓词**只写在这里**。它此前在 admin-bff 里，arche 接入
 * 时本该复制第二份——两份一样的 SQL 没有守卫能盯住：比对两份是否一致的检查抓
 * 不到「两边一样地错」，而改漏一处又要等到有人报「arche 看不到那条通告」才发现。
 *
 * 写侧只收 **system** 来源（2026-09-28，客户事件的运营镜像）：人工发布仍在 opera
 * 自己的发布面。两条写路判重规则不同（见 CreateSystemNoticeInput），不合并。
 */

import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { likePattern } from "../filters/notice-filters";
import { NOTICE_PG_POOL } from "../tokens";
import { NOTICE_SEVERITIES } from "../types/notice.types";
import type {
  CreateSystemNoticeInput,
  CreateSystemNoticeResult,
  ListNoticesParams,
  ListNoticesResult,
  MarkNoticeReadResult,
  NoticePlane,
  NoticeSeverity,
  NoticeSeverityCounts,
  NoticeSource,
  OperatorNoticeView,
} from "../types/notice.types";

interface NoticeListRow {
  id: string;
  severity: string;
  title: string;
  body: string;
  link: string | null;
  source: string;
  published_at: Date;
  read_at: Date | null;
  created_by_name: string | null;
}

/**
 * 汇总行。**与页行分成两条语句**：计数曾经是页行上的附加列，那样写筛出 0 条时
 * 整排数字一起变成 0——而「按紧急筛完没了」恰恰是最需要看见「重要还有 12 条」
 * 的时刻。翻页翻过末页也是同一个坑（offset 越界 → 无行 → total 报 0）。
 *
 * 计数一律 `::text`：`count(*)` 是 bigint，pg 默认把它翻成字符串，声明成 number
 * 会在类型上撒谎。
 */
interface NoticeSummaryRow {
  total_count: string;
  unread_count: string;
  info_count: string;
  warning_count: string;
  critical_count: string;
}

function mapRow(row: NoticeListRow): OperatorNoticeView {
  return {
    id: row.id,
    severity: row.severity as NoticeSeverity,
    title: row.title,
    body: row.body,
    link: row.link,
    source: row.source as NoticeSource,
    publishedAt: row.published_at.toISOString(),
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdByName: row.created_by_name,
  };
}

/**
 * 可见性谓词——**只写在这里一处**。`$1` = 本平面代号，`$2` = 当前运营者。
 *
 * 读一页（`buildListQuery`）与「全部标记已读」（`MARK_ALL_READ_SQL`）都拄这一段。
 * 各写一份的话，那个按钮的作用域会和铃铛角标的作用域慢慢分岔：角标数 12 条、按一下
 * 少了 9 条，而剩下那 3 条谁都说不出为什么还在。动作作用域必须**字面等于**视图作用域，
 * 所以这里是同一段文本，不是两段「看起来一样」的文本。
 *
 * `target_planes = '{}'` 是「全部平面」的**唯一**表示——写侧把「三个都选」收敛成空数组
 * 正是为了这一句成立。两种写法各存一份的话，这个判据会漏掉一半。
 */
const VISIBLE_WHERE = `n.deleted_at is null
       and (n.expires_at is null or n.expires_at > now())
       and (n.target_planes = '{}' or $1 = any(n.target_planes))`;

/**
 * 摘要档谓词：**当天已读 + 所有未读**（owner 2026-09-20 定）。`$3` = 是否摘要档。
 *
 * `$3::bool` 留在谓词里而不是靠 JS 决定这一行要不要出现：它是个恒定形状的开关，
 * 关掉的写法（`not $3`）和打开的写法是同一个表达式，读得懂。新加的四项筛选做不到
 * 这一点，所以那四项才改成显式拼装——见 `NoticeFilters`。
 */
const DIGEST_WHERE = `(not $3::bool or read_at is null or read_at >= date_trunc('day', now()))`;

/**
 * 页行 + 汇总的两条语句，连同各自的绑定值。
 *
 * **导出仅为可测**：假 pool 不解析 SQL，「不给的筛选一个字都不出现」「值全部绑定」
 * 只能对语句文本断言（与 `CREATE_SYSTEM_NOTICE_SQL` 同一手法）。
 */
export interface NoticeListQuery {
  /** 一页行，带 limit / offset。 */
  readonly sql: string;
  readonly params: readonly unknown[];
  /** 计数汇总，**不带 limit / offset**——空页也要报得出数。 */
  readonly summarySql: string;
  readonly summaryParams: readonly unknown[];
}

/**
 * 按入参拼出两条语句。**只拼谓词文本，值一律 push 进数组后以 `$n` 引用**——
 * 一个外部字符串都不进 SQL 串（那一步会让 lint:anchor-writes 那一族静态守卫当场
 * 读不懂语句，变瞎且恒绿）。
 *
 * 三段 CTE 的分工是这一批的核心判据：
 *   · `visible`  本平面能看见的未撤回未过期通告。`unread` 在它上面数——角标要的是
 *                「还有几条没看」，不随筛选也不随分页变。
 *   · `filtered` 加上摘要档 + 未读 / 来源 / 关键词。`counts` 在它上面数，所以那排
 *                数字**会**随关键词和「只看未读」动，这是它该有的反应。
 *   · `scoped`   再加上严重度。`total` 与页行在它上面——严重度晚一步生效，正是为了
 *                让 `counts` 在勾了某一档之后还报得出另两档。
 */
export function buildListQuery(params: ListNoticesParams): NoticeListQuery {
  const values: unknown[] = [params.plane, params.operatorId, params.digest];
  /** 记一个值，回它的占位符。序号由数组长度决定，人不数。 */
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  // 给了才进 where。不给的那一项**一个字都不出现**——不是「出现但恒真」。
  const narrowed: string[] = [DIGEST_WHERE];
  if (params.unreadOnly === true) narrowed.push("read_at is null");
  if (params.source !== undefined) {
    narrowed.push(`source = ${bind(params.source)}`);
  }
  const keyword = params.keyword?.trim() ?? "";
  if (keyword !== "") {
    // 同一个占位符用两次：标题与正文是「或」，不是两个独立条件。
    const pattern = bind(likePattern(keyword));
    narrowed.push(
      `(title ilike ${pattern} escape '\\' or body ilike ${pattern} escape '\\')`,
    );
  }

  const severities = params.severities ?? [];
  const severityWhere =
    severities.length > 0
      ? ` where severity = any(${bind([...severities])}::varchar(16)[])`
      : "";

  // 汇总语句到此为止；limit / offset 只属于页行，多绑两个值汇总那条会被 pg 拒。
  const summaryParams = [...values];
  const limit = bind(params.limit);
  const offset = bind(params.offset);

  const ctes = `with visible as (
    select n.id, n.severity, n.title, n.body, n.link, n.source, n.published_at,
           r.read_at,
           nullif(a.display_name, '') as created_by_name
      from admin.operator_notices n
      left join admin.operator_notice_reads r
             on r.notice_id = n.id and r.operator_id = $2::uuid
      left join admin.operator_account a on a.id = n.created_by
     where ${VISIBLE_WHERE}
  ), filtered as (
    select * from visible
     where ${narrowed.join("\n       and ")}
  ), scoped as (
    select * from filtered${severityWhere}
  )`;

  return {
    sql: `
  ${ctes}
  select s.*
    from scoped s
   order by s.read_at is not null, s.published_at desc, s.id desc
   limit ${limit} offset ${offset}
`,
    params: values,
    summarySql: `
  ${ctes}
  select (select count(*) from scoped)::text                        as total_count,
         (select count(*) from visible  where read_at is null)::text as unread_count,
         (select count(*) from filtered where severity = 'info')::text     as info_count,
         (select count(*) from filtered where severity = 'warning')::text  as warning_count,
         (select count(*) from filtered where severity = 'critical')::text as critical_count
`,
    summaryParams,
  };
}

/**
 * 三档都要有键，读不到的档是 0（缺档会在前端被读成「没这个档」而不是「这档 0 条」）。
 *
 * 按 `NOTICE_SEVERITIES` 派生而不是手写三行：加一档严重度时，这里会因为少一个
 * `${severity}_count` 列**在类型上**报错，而手写三行只会静默少报一档。
 */
function mapCounts(row: NoticeSummaryRow | undefined): NoticeSeverityCounts {
  const counts = {} as Record<NoticeSeverity, number>;
  for (const severity of NOTICE_SEVERITIES) {
    counts[severity] = Number(row?.[`${severity}_count`] ?? 0);
  }
  return counts;
}

/**
 * 标记已读。
 *
 * `on conflict do update` 而不是 `do nothing`：`do nothing` 时 returning 不回行，
 * 调用方拿不到 read_at，只能自己编一个时间——那就与库里的值分了岔。
 *
 * `where exists` 里嵌的是**同一段** `VISIBLE_WHERE`，不是另写一句「看起来一样」的
 * —— 这正是上面那段注释要求的「动作作用域字面等于视图作用域」。
 *
 * **2026-10-02 修**：此前这里只校验 `deleted_at is null`，**少了平面谓词**。于是
 * admin 平面的运营者拿一个只投给 opera/arche 的通告 uuid 调这条，会落一行 read 并回
 * 200 + read_at 而不是 404。不泄露内容（只回时间戳）、也到不了客户面，但它是个弱探针：
 * 200 vs 404 能区分「这个 uuid 是不是一条本平面看不见的通告」。
 * 更要紧的是纪律：「全部标记已读」拄着 VISIBLE_WHERE，单条却没有 —— **同一个判据长在
 * 一条分支上，另一条就是门没关**。A2 的两轮审查各自独立撞到过这一处。
 *
 * 参数位因此改成 `$1`=平面、`$2`=运营者、`$3`=通告 id（与 VISIBLE_WHERE 对齐）。
 */
const MARK_READ_SQL = `
  insert into admin.operator_notice_reads (notice_id, operator_id)
  select $3::uuid, $2::uuid
   where exists (select 1 from admin.operator_notices n
                  where n.id = $3::uuid and ${VISIBLE_WHERE})
     on conflict (notice_id, operator_id) do update set read_at = now()
  returning read_at
`;

/**
 * 「全部标记已读」——一条语句把本平面此刻**可见且未读**的通告全部记上。
 *
 * 作用域刻意**不含** digest、也不含那四项筛选：这个按钮长在铃铛抽屉里，而角标数的是
 * `visible` 上的全部未读。按钮清掉的集合必须等于角标数的集合，否则按完角标不归零，
 * 而没人能从界面上看出剩下那几条凭什么还在。/messages 上有筛选，所以那一页**不放**
 * 这个按钮——「全部」在一屏筛过的列表上读作「这一屏」，两种读法差一个数量级。
 *
 * `left join ... where r.read_at is null` 而不是 `not exists`：同一条 join 既用来筛出
 * 未读、又让 `on conflict` 那一路几乎不会被触发，并发下再由 `do nothing` 兜住。
 *
 * 逐条循环也能做到，但那是 N 次往返，且中途失败会留下一半已读一半未读——一条语句
 * 要么全记上要么一条不记。`rowCount` 就是「刚才那一下管到了几条」。
 */
const MARK_ALL_READ_SQL = `
  insert into admin.operator_notice_reads (notice_id, operator_id)
  select n.id, $2::uuid
    from admin.operator_notices n
    left join admin.operator_notice_reads r
           on r.notice_id = n.id and r.operator_id = $2::uuid
   where ${VISIBLE_WHERE}
     and r.read_at is null
     on conflict (notice_id, operator_id) do nothing
`;

/**
 * 系统来源通告的唯一写路（2026-09-28）。
 *
 * `on conflict ... do nothing` 的冲突目标**必须原样照抄** `uq_operator_notices_system`
 * 的列与 where 谓词（`source = 'system' and deleted_at is null`）——部分唯一索引只有
 * 谓词完全匹配时 Postgres 才认它是可用的冲突仲裁；写漏 where，语句直接报
 * 「there is no unique or exclusion constraint matching the ON CONFLICT specification」。
 *
 * `do nothing` 而不是 `do update`：同一件事已经播过一次，再来一次不该把标题、正文
 * 或 published_at 刷新——那会让一条已读的通告重新浮到未读上面。代价是 returning 在
 * 冲突时不回行，所以结果用 `inserted` 说话。
 *
 * `created_by` 写 null：系统没有运营账号；读侧对 null 回 createdByName=null，前端画「—」。
 *
 * **导出仅为可测**：假 pool 不解析 SQL，谓词只能靠字面断言钉住（与 dispatch 包的
 * DEDUPE_SQL 同一手法）。
 */
export const CREATE_SYSTEM_NOTICE_SQL = `
  insert into admin.operator_notices
    (target_planes, severity, title, body, link, source,
     reference_type, reference_id, expires_at, created_by)
  values ($1::varchar(16)[], $2, $3, $4, $5, 'system', $6, $7, $8, null)
  on conflict (reference_type, reference_id)
    where source = 'system' and deleted_at is null
    do nothing
  returning id
`;

@Injectable()
export class PgNoticeRepository {
  // 必须显式 @Inject：BFF 打包走 esbuild，它**不产 emitDecoratorMetadata**。
  // 漏了不会在启动期抛，而是造出一个依赖为 undefined 的壳，第一次调用才 500。
  constructor(@Inject(NOTICE_PG_POOL) private readonly pool: Pool) {}

  async list(params: ListNoticesParams): Promise<ListNoticesResult> {
    const query = buildListQuery(params);
    // 两条语句并发发出：都是只读，快照差几毫秒不影响任何判断，而串起来会让
    // 每次筛选都多一个往返。
    const [page, summary] = await Promise.all([
      this.pool.query<NoticeListRow>(query.sql, [...query.params]),
      this.pool.query<NoticeSummaryRow>(query.summarySql, [
        ...query.summaryParams,
      ]),
    ]);
    const totals = summary.rows[0];
    return {
      items: page.rows.map(mapRow),
      // 汇总语句无 limit/offset，恒回一行——空页也报得出数，不像附加列那样一起归零。
      total: Number(totals?.total_count ?? 0),
      unread: Number(totals?.unread_count ?? 0),
      counts: mapCounts(totals),
    };
  }

  /**
   * 把本平面此刻可见且未读的通告一次全部记上，回真的记上了几条。
   *
   * `plane` 与 `operatorId` 都由调用方从自身身份与会话里取，不收请求参数——收了它
   * 就变成一个「替别人把通告全读掉」的面。
   */
  async markAllRead(plane: NoticePlane, operatorId: string): Promise<number> {
    const result = await this.pool.query(MARK_ALL_READ_SQL, [
      plane,
      operatorId,
    ]);
    // 一条都没未读时 pg 回 rowCount 0；null 只出现在不回行的语句上，兜一下。
    return result.rowCount ?? 0;
  }

  /** 返回 null = 通告不存在或已撤回，由调用方翻成 404。 */
  async markRead(
    noticeId: string,
    operatorId: string,
    plane: NoticePlane,
  ): Promise<MarkNoticeReadResult | null> {
    /* 参数顺序跟着 VISIBLE_WHERE：$1 平面、$2 运营者、$3 通告。 */
    const result = await this.pool.query<{ read_at: Date }>(MARK_READ_SQL, [
      plane,
      operatorId,
      noticeId,
    ]);
    const row = result.rows[0];
    return row ? { id: noticeId, readAt: row.read_at.toISOString() } : null;
  }

  /**
   * 写一条系统来源通告；同一去重锚已有未撤回的一条时不写，回 `inserted: false`。
   * 参数全部绑定，不拼串——标题正文里有客户填的退款理由，那是外部输入。
   */
  async createSystemNotice(
    input: CreateSystemNoticeInput,
  ): Promise<CreateSystemNoticeResult> {
    const result = await this.pool.query<{ id: string }>(
      CREATE_SYSTEM_NOTICE_SQL,
      [
        [...input.targetPlanes],
        input.severity,
        input.title,
        input.body,
        input.link ?? null,
        input.referenceType,
        input.referenceId,
        input.expiresAt ?? null,
      ],
    );
    const row = result.rows[0];
    return row ? { inserted: true, id: row.id } : { inserted: false, id: null };
  }
}
