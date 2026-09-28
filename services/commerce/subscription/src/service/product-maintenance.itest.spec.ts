/**
 * product-maintenance.itest.spec.ts — 产品级维护窗口的四个仓储查询在**真库**上的行为
 * （2026-09-27）。服务层的顺序在 product-maintenance-sweep.spec 用 fake 仓储钉；这里钉的是
 * SQL 本身：候选谓词、幂等（开了 episode 就不再是候选）、释放谓词（产品不再打着同一个窗口）
 * 与顺延同步只改真的不同的行。
 *
 * 整个 suite 跑在**一笔事务里并 ROLLBACK**：仓储拿到的「pool」其实是同一个 client，于是它
 * 发的每一条查询都在这笔事务里。造的窗口 / 绑定 / 打标 / episode 全部随 rollback 消失，
 * 跑完库和跑前一样（最后一个用例回查）。
 *
 * Gated (needs a seeded platform DB):
 *   SUBSCRIPTION_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 * 加 SUBSCRIPTION_ITEST_TRACE=1 把每一步的查询结果打出来。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { PgSubscriptionRepository } from "../repository/pg-subscription.repository";

const RUN = process.env.SUBSCRIPTION_ITEST === "1";
const TRACE = process.env.SUBSCRIPTION_ITEST_TRACE === "1";
const trace = (label: string, value: unknown): void => {
  if (TRACE)
    console.log(`[maintenance-itest] ${label}: ${JSON.stringify(value)}`);
};

const OPERATOR = "00000000-0000-4000-8000-00000000d201";
const USER = "00000000-0000-4000-8000-00000000d202";
const TENANT = "00000000-0000-4000-8000-00000000d203";
const WORKSPACE = "00000000-0000-4000-8000-00000000d204";

const IN_SERVICE = ["active", "trialing", "expiring", "overdue"];

describe.runIf(RUN)(
  "product maintenance window — repository SQL (live DB, rolled back)",
  () => {
    let pool: Pool;
    let client: PoolClient;
    let repo: PgSubscriptionRepository;
    let windowId: string;
    let productId: string;
    let subscriptionId: string;
    let until: Date;
    let episodeId: string;

    beforeAll(async () => {
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
      client = await pool.connect();
      await client.query("begin");
      // 仓储的 pool.query 全部落到这一个连接 → 同一笔事务，afterAll 一起 rollback。
      repo = new PgSubscriptionRepository(client as unknown as Pool);

      // 一条在服务中、有产品、没有未闭合 episode 的订阅；库里没有就在事务里造一条。
      const existing = await client.query<{
        id: string;
        product_id: string;
      }>(
        `select s.id, s.product_id
           from metering.subscriptions s
          where s.deleted_at is null
            and s.product_id is not null
            and s.status = any($1::text[])
            and not exists (
              select 1 from metering.subscription_suspensions x
               where x.subscription_id = s.id and x.resumed_at is null
            )
          order by s.created_at asc
          limit 1`,
        [IN_SERVICE],
      );
      if (existing.rows[0]) {
        subscriptionId = existing.rows[0].id;
        productId = existing.rows[0].product_id;
      } else {
        await client.query(
          `insert into account.users (id, account, phone, phone_verified_at, source)
           values ($1, 'maint-itest', '+8613800000462', now(), 'web')
           on conflict (id) do nothing`,
          [USER],
        );
        await client.query(
          `insert into tenancy.tenants (id, name, type, owner_user_id)
           values ($1, 'Maintenance Org', 'organization', $2) on conflict (id) do nothing`,
          [TENANT, USER],
        );
        await client.query(
          `insert into tenancy.workspaces (id, tenant_id, name, is_default)
           values ($1, $2, 'Maintenance WS', true) on conflict (id) do nothing`,
          [WORKSPACE, TENANT],
        );
        const pv = await client.query<{ id: string }>(
          `select pv.id from product.plan_versions pv
             join product.plan_components pc
               on pc.plan_version_id = pv.id and pc.component_role = 'primary'
            where pv.is_locked = true
            limit 1`,
        );
        expect(pv.rows).toHaveLength(1);
        // product_id 由 95 的 trg_subscriptions_fill_product_id 按主组件补齐。
        const created = await client.query<{ id: string; product_id: string }>(
          `insert into metering.subscriptions (
             tenant_id, workspace_id, plan_version_id, subscription_kind, cycle_unit, cycle_count,
             start_at, end_at, status, activation_method, auto_renew, currency,
             created_by_type, created_by_id
           ) values ($1, $2, $3, 'paid', 'month', 1, now(), now() + interval '30 days',
                     'active', 'offline_purchase', false, 'CNY', 'operator', $4)
           returning id, product_id`,
          [TENANT, WORKSPACE, pv.rows[0]!.id, USER],
        );
        subscriptionId = created.rows[0]!.id;
        productId = created.rows[0]!.product_id;
      }
      trace("fixture", { subscriptionId, productId });
    });

    afterAll(async () => {
      // 最后一个用例已经 rollback；这里再保一道（没有事务时只是一条 WARNING）。
      await client.query("rollback");
      client.release();
      await pool.end();
    });

    it("跑前：没有产品打着窗口时，候选 / 释放 / 同步都是空", async () => {
      const stamped = await client.query<{ n: string }>(
        `select count(*)::text as n from product.products where maintenance_window_id is not null`,
      );
      trace("stamped products before", stamped.rows[0]);
      const candidates = await repo.findMaintenanceCandidates();
      const releases = await repo.findMaintenanceReleases();
      const synced = await repo.syncMaintenanceExpectedResume();
      trace("before stamping", { candidates, releases, synced });
      expect(candidates.map((c) => c.subscriptionId)).not.toContain(
        subscriptionId,
      );
      expect(releases.map((r) => r.subscriptionId)).not.toContain(
        subscriptionId,
      );
      expect(synced).toEqual([]);
    });

    it("进窗口：窗口 + 绑定 + 产品打标后，名下在服务中的订阅被捞为候选", async () => {
      until = new Date(Date.now() + 2 * 3600_000);
      const win = await client.query<{ id: string }>(
        `insert into admin.maintenance_windows
           (severity, status, title, start_at, end_at, created_by)
         values ('major', 'in_progress', 'itest window', now(), $1, $2)
         returning id`,
        [until, OPERATOR],
      );
      windowId = win.rows[0]!.id;
      await client.query(
        `insert into admin.maintenance_window_products (window_id, product_id) values ($1, $2)`,
        [windowId, productId],
      );
      // opera-bff start 打标的那两列（本 spec 里是事务内的模拟，随 rollback 消失）。
      await client.query(
        `update product.products
            set maintenance_window_id = $2, maintenance_until = $3, updated_at = now()
          where id = $1`,
        [productId, windowId, until],
      );

      const candidates = await repo.findMaintenanceCandidates();
      trace("candidates after stamping", candidates);
      const mine = candidates.find((c) => c.subscriptionId === subscriptionId);
      expect(mine).toBeDefined();
      expect(mine).toMatchObject({
        productId,
        maintenanceWindowId: windowId,
      });
      expect(mine!.maintenanceUntil.getTime()).toBe(until.getTime());
      expect(IN_SERVICE).toContain(mine!.status);

      // 还没有 episode：释放 / 同步都没东西可做。
      expect(await repo.findMaintenanceReleases()).toEqual([]);
      expect(await repo.syncMaintenanceExpectedResume()).toEqual([]);
    });

    it("开 episode（system / platform_ops / 顺延 / 带窗口 id）→ 不再是候选（幂等）", async () => {
      episodeId = await repo.openSuspension({
        subscriptionId,
        tenantId: (
          await client.query<{ tenant_id: string }>(
            `select tenant_id from metering.subscriptions where id = $1`,
            [subscriptionId],
          )
        ).rows[0]!.tenant_id,
        reason: "platform_ops",
        extendsTerm: true,
        autoRenewBefore: true,
        expectedResumeAt: until,
        actorType: "system",
        maintenanceWindowId: windowId,
      });
      const row = await client.query(
        `select reason, extends_term, actor_type, actor_id, auto_renew_before,
                maintenance_window_id, expected_resume_at, resumed_at
           from metering.subscription_suspensions where id = $1`,
        [episodeId],
      );
      trace("episode row", row.rows[0]);
      expect(row.rows[0]).toMatchObject({
        reason: "platform_ops",
        extends_term: true,
        actor_type: "system",
        actor_id: null,
        auto_renew_before: true,
        maintenance_window_id: windowId,
        resumed_at: null,
      });

      const candidates = await repo.findMaintenanceCandidates();
      trace("candidates after opening episode", candidates);
      expect(candidates.map((c) => c.subscriptionId)).not.toContain(
        subscriptionId,
      );
    });

    it("窗口进行中：不释放；顺延同步只改真的不同的行，改完再跑是 0", async () => {
      // 服务层的 CAS 走 repo.update（自己开连接，进不了这笔事务）；这里直接把状态摆到
      // suspended，钉的是释放谓词本身。
      await client.query(
        `update metering.subscriptions set status = 'suspended', updated_at = now() where id = $1`,
        [subscriptionId],
      );
      const releases = await repo.findMaintenanceReleases();
      trace("releases while window still on product", releases);
      expect(releases.map((r) => r.subscriptionId)).not.toContain(
        subscriptionId,
      );

      // 同步：expected_resume_at 已等于 maintenance_until → 0 行。
      expect(await repo.syncMaintenanceExpectedResume()).toEqual([]);
      // 运营顺延一小时（opera-bff 会同步 products.maintenance_until）→ 1 行。
      const later = new Date(until.getTime() + 3600_000);
      await client.query(
        `update product.products set maintenance_until = $2, updated_at = now() where id = $1`,
        [productId, later],
      );
      const synced = await repo.syncMaintenanceExpectedResume();
      trace("synced after extending maintenance_until", synced);
      // 回送被改的那一行（不只条数）：预计恢复变了，发侧凭它知道该通知谁、说哪个日子。
      expect(synced).toEqual([{ subscriptionId, expectedResumeAt: later }]);
      const after = await client.query<{ expected_resume_at: Date }>(
        `select expected_resume_at from metering.subscription_suspensions where id = $1`,
        [episodeId],
      );
      trace("episode expected_resume_at after sync", after.rows[0]);
      expect(after.rows[0]!.expected_resume_at.getTime()).toBe(later.getTime());
      // 再跑一遍：已经一致，0 行。
      expect(await repo.syncMaintenanceExpectedResume()).toEqual([]);
    });

    it("产品换了别的窗口 / 清了标 → episode 被捞为释放；闭合后不再捞", async () => {
      // 另一个窗口占了这个产品：旧窗口的 episode 也算「不再打着同一个窗口」。
      const other = await client.query<{ id: string }>(
        `insert into admin.maintenance_windows
           (severity, status, title, start_at, end_at, created_by)
         values ('minor', 'in_progress', 'itest window 2', now(), $1, $2)
         returning id`,
        [until, OPERATOR],
      );
      await client.query(
        `update product.products set maintenance_window_id = $2, updated_at = now() where id = $1`,
        [productId, other.rows[0]!.id],
      );
      let releases = await repo.findMaintenanceReleases();
      trace("releases after another window took the product", releases);
      expect(
        releases.find((r) => r.subscriptionId === subscriptionId),
      ).toMatchObject({
        id: episodeId,
        status: "suspended",
        autoRenewBefore: true,
        maintenanceWindowId: windowId,
      });
      // 同步不碰它：窗口 id 已不同。
      expect(await repo.syncMaintenanceExpectedResume()).toEqual([]);

      // complete / cancel 清标（两列同空）。
      await client.query(
        `update product.products
            set maintenance_window_id = null, maintenance_until = null, updated_at = now()
          where id = $1`,
        [productId],
      );
      releases = await repo.findMaintenanceReleases();
      trace("releases after clearing the stamp", releases);
      expect(releases.map((r) => r.subscriptionId)).toContain(subscriptionId);

      await repo.closeSuspension(subscriptionId);
      releases = await repo.findMaintenanceReleases();
      trace("releases after closing the episode", releases);
      expect(releases.map((r) => r.subscriptionId)).not.toContain(
        subscriptionId,
      );
      const closed = await client.query<{ resumed_at: Date | null }>(
        `select resumed_at from metering.subscription_suspensions where id = $1`,
        [episodeId],
      );
      expect(closed.rows[0]!.resumed_at).not.toBeNull();
    });

    it("rollback 之后库和跑前一样：窗口、episode、打标都不在", async () => {
      await client.query("rollback");
      const win = await pool.query(
        `select 1 from admin.maintenance_windows where id = $1`,
        [windowId],
      );
      const episode = await pool.query(
        `select 1 from metering.subscription_suspensions where id = $1`,
        [episodeId],
      );
      const stamped = await pool.query(
        `select 1 from product.products where id = $1 and maintenance_window_id is not null`,
        [productId],
      );
      trace("after rollback", {
        window: win.rowCount,
        episode: episode.rowCount,
        stamped: stamped.rowCount,
      });
      expect(win.rowCount).toBe(0);
      expect(episode.rowCount).toBe(0);
      expect(stamped.rowCount).toBe(0);
    });
  },
);
