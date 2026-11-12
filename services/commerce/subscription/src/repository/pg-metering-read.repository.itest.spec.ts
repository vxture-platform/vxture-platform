/**
 * pg-metering-read.repository.itest.spec.ts — day 档按用户时区重切(owner 裁定 4,2026-10-04)。
 *
 * 只有真库才验得出的三件事:
 *   1. DST:Europe/Berlin 2026-10-25 是夏令时结束日(25 个本地小时)→ 24 / 25 / 24;
 *      固定偏移的 Asia/Shanghai → 24 / 24 / 24;
 *   2. UTC 重切与天表逐桶相等(同一份小时数据,两条路必须给同一个数);
 *   3. 与会话 TimeZone 无关:同一查询在 `-c timezone=Asia/Shanghai` 的会话里结果不变。
 *   另:pg_timezone_names 的认可与否(双重校验的库那一半)。
 *
 * 夹具:2026-10-23 00:00Z 起连续 120 个小时桶(amount 1)。
 *
 * Gated(需要一个已建库的平台 DB):
 *   SUBSCRIPTION_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgMeteringReadRepository } from "./pg-metering-read.repository";

const RUN = process.env.SUBSCRIPTION_ITEST === "1";

const USER = "00000000-0000-4000-8000-0000000b3004";
const TENANT = "00000000-0000-4000-8000-0000000b3005";
const WORKSPACE = "00000000-0000-4000-8000-0000000b3001";
const PRODUCT = "00000000-0000-4000-8000-0000000b3002";
const METRIC = "tz.itest.read";

describe.skipIf(!RUN)("metering read · 按用户时区重切本地日(真库)", () => {
  let pool: Pool;
  let repo: PgMeteringReadRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    repo = new PgMeteringReadRepository(pool);
    await pool.query(
      `insert into account.users (id, account, phone, phone_verified_at, source)
       values ($1, 'tzread', '+8613800000473', now(), 'web')
       on conflict (id) do nothing`,
      [USER],
    );
    await pool.query(
      `insert into tenancy.tenants (id, name, type, owner_user_id)
       values ($1, 'TZ Read Org', 'organization', $2) on conflict (id) do nothing`,
      [TENANT, USER],
    );
    await pool.query(
      `insert into tenancy.workspaces (id, tenant_id, name, is_default)
       values ($1, $2, 'TZ Read WS', true) on conflict (id) do nothing`,
      [WORKSPACE, TENANT],
    );
    await pool.query(
      `insert into product.products (id, product_code, product_name, product_type, status, standalone_subscribable)
       values ($1, 'tz-read-itest', 'tz-read-itest', 'agent', 'active', true)
       on conflict (product_code) do nothing`,
      [PRODUCT],
    );
    // 120 个小时桶:2026-10-23 00:00Z … 2026-10-27 23:00Z,每桶 1。
    await pool.query(
      `insert into metering.usage_summary_hours
         (workspace_id, product_id, metric_key, period_hour, total_amount)
       select $1, $2, $3, timestamptz '2026-10-23 00:00:00+00' + make_interval(hours => g), 1
         from generate_series(0, 24 * 5 - 1) g
       on conflict (workspace_id, product_id, metric_key, period_hour)
       do update set total_amount = excluded.total_amount`,
      [WORKSPACE, PRODUCT, METRIC],
    );
    // 天表(UTC 权威)按同一份小时数据写:每天 24。
    await pool.query(
      `insert into metering.usage_summary_days
         (workspace_id, product_id, metric_key, period_day, total_amount)
       select $1, $2, $3, date '2026-10-23' + g, 24
         from generate_series(0, 4) g
       on conflict (workspace_id, product_id, metric_key, period_day)
       do update set total_amount = excluded.total_amount`,
      [WORKSPACE, PRODUCT, METRIC],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  const localDays = (r: PgMeteringReadRepository, zone: string) =>
    r.listTrendRowsLocalDays({
      workspaceId: WORKSPACE,
      metric: METRIC,
      zone,
      fromDay: "2026-10-24",
      toDayExclusive: "2026-10-27",
    });

  it("Europe/Berlin:DST 结束日 10-25 有 25 个本地小时 → 24 / 25 / 24", async () => {
    const rows = await localDays(repo, "Europe/Berlin");
    expect(rows.map((r) => [r.period, r.total])).toEqual([
      ["2026-10-24", 24],
      ["2026-10-25", 25],
      ["2026-10-26", 24],
    ]);
    expect(rows[0]?.productCode).toBe("tz-read-itest");
  });

  it("Asia/Shanghai:固定 +08 → 每个本地日 24", async () => {
    const rows = await localDays(repo, "Asia/Shanghai");
    expect(rows.map((r) => [r.period, r.total])).toEqual([
      ["2026-10-24", 24],
      ["2026-10-25", 24],
      ["2026-10-26", 24],
    ]);
  });

  it("UTC 重切与天表(listTrendRows day)逐桶相等", async () => {
    const viaHours = await localDays(repo, "UTC");
    const viaDays = (
      await repo.listTrendRows({
        workspaceId: WORKSPACE,
        metric: METRIC,
        granularity: "day",
        windowStart: "2026-10-24",
      })
    ).filter((r) => r.period < "2026-10-27");
    expect(viaHours).toEqual(viaDays);
    expect(viaHours.map((r) => r.total)).toEqual([24, 24, 24]);
  });

  it("与会话 TimeZone 无关:Asia/Shanghai 会话里的柏林重切结果不变", async () => {
    const shanghaiSession = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: "-c timezone=Asia/Shanghai",
    });
    try {
      const shown = await shanghaiSession.query<{ TimeZone: string }>(
        "show timezone",
      );
      expect(shown.rows[0]?.TimeZone).toBe("Asia/Shanghai");
      const rows = await localDays(
        new PgMeteringReadRepository(shanghaiSession),
        "Europe/Berlin",
      );
      expect(rows.map((r) => [r.period, r.total])).toEqual([
        ["2026-10-24", 24],
        ["2026-10-25", 25],
        ["2026-10-26", 24],
      ]);
    } finally {
      await shanghaiSession.end();
    }
  });

  it("pg_timezone_names:真名认、假名不认;假名直接重切是错误而不是空结果", async () => {
    expect(await repo.isKnownTimeZone("Europe/Berlin")).toBe(true);
    expect(await repo.isKnownTimeZone("Asia/Shanghai")).toBe(true);
    expect(await repo.isKnownTimeZone("UTC")).toBe(true);
    expect(await repo.isKnownTimeZone("Mars/Olympus")).toBe(false);
    await expect(localDays(repo, "Mars/Olympus")).rejects.toThrow(
      /not recognized/,
    );
  });
  it("subscription pools project their effective validity without changing reset semantics", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Keep all fixture changes in one rollback-only connection.
      const txRepo = new PgMeteringReadRepository({
        query: client.query.bind(client),
      } as unknown as Pool);
      const plan = await client.query<{ id: string }>(
        "select plan_version_id as id from product.plan_components where component_role = 'primary' limit 1",
      );
      if (!plan.rows[0])
        throw new Error(
          "A seeded plan version is required for the integration fixture",
        );
      const sub = await client.query<{ id: string }>(
        `insert into metering.subscriptions
          (tenant_id, workspace_id, plan_version_id, subscription_kind, cycle_unit, start_at, end_at, status, created_by_type)
         values ($1, $2, $3, 'paid', 'year', now() - interval '2 months', now() + interval '10 months', 'active', 'system') returning id`,
        [TENANT, WORKSPACE, plan.rows[0].id],
      );
      const id = sub.rows[0]!.id;
      await client.query(
        `insert into metering.quota_pools
          (workspace_id, subscription_id, product_id, metric_key, quota_limit, quota_used,
           pool_source, reset_period, period_anchor, current_period_start)
         values ($1,$2,$3,'ai.credit',100,25,'subscription','month',now()-interval '2 months',now()-interval '2 months')`,
        [WORKSPACE, id, PRODUCT],
      );
      const read = async () =>
        (await txRepo.listActivePools(WORKSPACE)).find(
          (p) =>
            p.productCode === "tz-read-itest" &&
            p.poolSource === "subscription",
        )!;
      const bounds = await client.query<{ end_at: Date }>(
        "select end_at from metering.subscriptions where id=$1",
        [id],
      );
      const first = await read();
      expect(first.expiresAt).toEqual(bounds.rows[0]!.end_at);
      expect(first.effectiveUsed).toBe(0);
      expect(first.resetPeriod).toBe("month");
      await client.query(
        "update metering.quota_pools set expires_at = now() + interval '1 day' where subscription_id=$1",
        [id],
      );
      const earlier = await read();
      expect(earlier.expiresAt!.getTime()).toBeLessThan(
        first.expiresAt!.getTime(),
      );
      await client.query(
        "update metering.quota_pools set expires_at = null where subscription_id=$1",
        [id],
      );
      await client.query(
        "update metering.subscriptions set end_at = end_at + interval '1 year' where id=$1",
        [id],
      );
      expect((await read()).expiresAt!.getTime()).toBeGreaterThan(
        first.expiresAt!.getTime(),
      );
      await client.query(
        "update metering.subscriptions set subscription_kind='trial', trial_end_at=now()+interval '2 days', auto_renew=false where id=$1",
        [id],
      );
      expect((await read()).expiresAt!.getTime()).toBeLessThan(
        first.expiresAt!.getTime(),
      );
      await client.query(
        "update metering.subscriptions set end_at=now()+interval '1 day' where id=$1",
        [id],
      );
      const trialBounds = await client.query<{ end_at: Date }>(
        "select end_at from metering.subscriptions where id=$1",
        [id],
      );
      expect((await read()).expiresAt).toEqual(trialBounds.rows[0]!.end_at);
      await client.query(
        "insert into metering.quota_pools(workspace_id,metric_key,quota_limit,pool_source) values($1,'storage.bytes',200,'ws_base')",
        [WORKSPACE],
      );
      const base = (await txRepo.listActivePools(WORKSPACE)).find(
        (p) => p.poolSource === "ws_base",
      );
      expect(base!.expiresAt).toBeNull();

      await client.query(
        "update metering.subscriptions set subscription_kind='free', end_at=null, trial_end_at=null where id=$1",
        [id],
      );
      expect((await read()).expiresAt).toBeNull();
      await client.query(
        "update metering.subscriptions set status='expired' where id=$1",
        [id],
      );
      expect(await read()).toBeUndefined();
      await client.query(
        "update metering.subscriptions set status='cancelled' where id=$1",
        [id],
      );
      expect(await read()).toBeUndefined();
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
