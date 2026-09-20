/**
 * pg-notice.repository.ts — 运营通告读侧的唯一数据出口。
 * @package @vxture/service-notice
 * @layer Infrastructure
 * @category Repository
 *
 * 「谁能看见哪些通告」这条谓词**只写在这里**。它此前在 admin-bff 里，arche 接入
 * 时本该复制第二份——两份一样的 SQL 没有守卫能盯住：比对两份是否一致的检查抓
 * 不到「两边一样地错」，而改漏一处又要等到有人报「arche 看不到那条通告」才发现。
 */

import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { NOTICE_PG_POOL } from "../tokens";
import type {
  ListNoticesParams,
  ListNoticesResult,
  MarkNoticeReadResult,
  NoticeSeverity,
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
  total_count: string;
  unread_count: string;
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
 * $1 = 本平面代号，$2 = 当前运营者，$3 = 是否摘要档，$4 = limit，$5 = offset。
 *
 * `$3::bool` 写成谓词的一部分而不是靠 JS 拼 where：SQL 一旦插值，那一族静态守卫
 * （lint:anchor-writes）当场读不懂它，变瞎且恒绿。
 *
 * `visible` 先收敛出「本平面能看见的未撤回未过期通告」，两个计数与分页都基于它，
 * 免得三处各写一遍过滤条件、日后改漏一处。
 *
 * `target_planes = '{}'` 是「全部平面」的**唯一**表示——写侧把「三个都选」收敛成
 * 空数组正是为了这一句成立。两种写法各存一份的话，这个判据会漏掉一半。
 *
 * 排序 `read_at is not null` 在前：未读的顶上去。
 */
const LIST_SQL = `
  with visible as (
    select n.id, n.severity, n.title, n.body, n.link, n.source, n.published_at,
           r.read_at,
           nullif(a.display_name, '') as created_by_name
      from admin.operator_notices n
      left join admin.operator_notice_reads r
             on r.notice_id = n.id and r.operator_id = $2::uuid
      left join admin.operator_account a on a.id = n.created_by
     where n.deleted_at is null
       and (n.expires_at is null or n.expires_at > now())
       and (n.target_planes = '{}' or $1 = any(n.target_planes))
  ), scoped as (
    select * from visible
     where not $3::bool
        or read_at is null
        or read_at >= date_trunc('day', now())
  )
  select s.*,
         (select count(*) from scoped)::text                       as total_count,
         (select count(*) from visible where read_at is null)::text as unread_count
    from scoped s
   order by s.read_at is not null, s.published_at desc, s.id desc
   limit $4 offset $5
`;

/**
 * 标记已读。
 *
 * `on conflict do update` 而不是 `do nothing`：`do nothing` 时 returning 不回行，
 * 调用方拿不到 read_at，只能自己编一个时间——那就与库里的值分了岔。
 *
 * `where exists` 挡住已撤回与不存在的通告：软删过的通告不该还能被标记已读。
 */
const MARK_READ_SQL = `
  insert into admin.operator_notice_reads (notice_id, operator_id)
  select $1::uuid, $2::uuid
   where exists (select 1 from admin.operator_notices
                  where id = $1::uuid and deleted_at is null)
     on conflict (notice_id, operator_id) do update set read_at = now()
  returning read_at
`;

@Injectable()
export class PgNoticeRepository {
  // 必须显式 @Inject：BFF 打包走 esbuild，它**不产 emitDecoratorMetadata**。
  // 漏了不会在启动期抛，而是造出一个依赖为 undefined 的壳，第一次调用才 500。
  constructor(@Inject(NOTICE_PG_POOL) private readonly pool: Pool) {}

  async list(params: ListNoticesParams): Promise<ListNoticesResult> {
    const result = await this.pool.query<NoticeListRow>(LIST_SQL, [
      params.plane,
      params.operatorId,
      params.digest,
      params.limit,
      params.offset,
    ]);
    const first = result.rows[0];
    return {
      items: result.rows.map(mapRow),
      // 空结果集拿不到计数列——那时两个数都是 0，与库里一致。
      total: Number(first?.total_count ?? 0),
      unread: Number(first?.unread_count ?? 0),
    };
  }

  /** 返回 null = 通告不存在或已撤回，由调用方翻成 404。 */
  async markRead(
    noticeId: string,
    operatorId: string,
  ): Promise<MarkNoticeReadResult | null> {
    const result = await this.pool.query<{ read_at: Date }>(MARK_READ_SQL, [
      noticeId,
      operatorId,
    ]);
    const row = result.rows[0];
    return row ? { id: noticeId, readAt: row.read_at.toISOString() } : null;
  }
}
