/**
 * announcements.ts — 公告推送（P2-h，design_notification_100「公告推送」扩展点）。
 * @package @vxture/service-notification
 *
 * 运营在 admin 发布公告（admin.announcements，status=published，publish_at 到点）→ 按
 * target_tenant_types / target_plans 圈租户 → 每个租户 owner 一条站内消息（+ 按偏好 product 主题
 * 发邮件，默认只站内）。公告自带语言与标题正文，不走模板表。
 * 幂等两层：行级 meta.broadcast_at（跑过就不再扫）；收件人级 inbox 唯一键（同一公告 × 同一人只一条）。
 */
import type { Pool } from "pg";
import type { NotificationDispatcher, NotifyResult } from "./dispatcher";

export interface PendingAnnouncement {
  id: string;
  title: string;
  content: string;
  ctaUrl: string | null;
  targetPlans: string[];
  targetTenantTypes: string[];
}

interface AnnouncementRow {
  id: string;
  title: string;
  content: string;
  cta_url: string | null;
  target_plans: string[] | null;
  target_tenant_types: string[] | null;
}

/** 已发布、到点、未过期、还没广播过的公告。 */
export async function findPendingAnnouncements(
  pool: Pool,
  limit = 20,
): Promise<PendingAnnouncement[]> {
  const res = await pool.query<AnnouncementRow>(
    `select id, title, content, cta_url, target_plans, target_tenant_types
       from admin.announcements
      where status = 'published'
        and deleted_at is null
        and publish_at <= now()
        and (expires_at is null or expires_at > now())
        and (meta is null or meta->>'broadcast_at' is null)
      order by publish_at asc
      limit $1`,
    [limit],
  );
  return res.rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    ctaUrl: r.cta_url,
    targetPlans: r.target_plans ?? [],
    targetTenantTypes: r.target_tenant_types ?? [],
  }));
}

/** 圈租户：类型交集 + （给了套餐时）在用订阅命中任一 plan_code；都空 = 全部在用租户。 */
export async function findAnnouncementTenants(
  pool: Pool,
  a: PendingAnnouncement,
): Promise<string[]> {
  const res = await pool.query<{ id: string }>(
    `select t.id
       from tenancy.tenants t
      where t.deleted_at is null
        and t.status = 'active'
        and (cardinality($1::varchar[]) = 0 or t.type = any($1::varchar[]))
        and (cardinality($2::varchar[]) = 0 or exists (
          select 1
            from metering.subscriptions s
            join product.plan_versions pv on pv.id = s.plan_version_id
            join product.plans pl on pl.id = pv.plan_id
           where s.tenant_id = t.id
             and s.deleted_at is null
             and s.status in ('active', 'trialing', 'expiring', 'overdue')
             and pl.plan_code = any($2::varchar[])
        ))
      order by t.created_at asc`,
    [a.targetTenantTypes, a.targetPlans],
  );
  return res.rows.map((r) => r.id);
}

export interface BroadcastSummary {
  announcements: number;
  tenants: number;
  inboxCreated: number;
  emailsSent: number;
}

/**
 * 广播一趟：每条待播公告 → 圈租户 → 逐租户 notify（收件人 = 租户 owner）→ 打 meta.broadcast_at。
 * 单条公告内部单租户失败只记日志（dispatcher 已 best-effort）；打标记在租户循环之后，
 * 中途崩掉下一趟会重扫，收件人级唯一键保证不重复投递。
 */
export async function broadcastAnnouncements(
  pool: Pool,
  dispatcher: NotificationDispatcher,
  options: { limit?: number; logger?: { warn(m: string): void } } = {},
): Promise<BroadcastSummary> {
  const summary: BroadcastSummary = {
    announcements: 0,
    tenants: 0,
    inboxCreated: 0,
    emailsSent: 0,
  };
  const pending = await findPendingAnnouncements(pool, options.limit);
  for (const a of pending) {
    const tenants = await findAnnouncementTenants(pool, a);
    let created = 0;
    let emails = 0;
    for (const tenantId of tenants) {
      const r: NotifyResult = await dispatcher.notify({
        tenantId,
        templateCode: "announcement.published",
        reference: { type: "announcement", id: a.id },
        params: { title: a.title, content: a.content },
        ...(a.ctaUrl ? { link: a.ctaUrl } : {}),
      });
      created += r.inboxCreated;
      emails += r.emailsSent;
    }
    await pool.query(
      `update admin.announcements
          set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
                'broadcast_at', now(),
                'broadcast', jsonb_build_object('tenants', $2::int, 'inbox', $3::int, 'emails', $4::int)),
              updated_at = now()
        where id = $1`,
      [a.id, tenants.length, created, emails],
    );
    summary.announcements += 1;
    summary.tenants += tenants.length;
    summary.inboxCreated += created;
    summary.emailsSent += emails;
  }
  return summary;
}
