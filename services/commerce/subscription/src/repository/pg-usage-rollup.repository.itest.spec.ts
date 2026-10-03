/**
 * pg-usage-rollup.repository.itest.spec.ts — 回归锁:rollup 的天表不许随会话 TimeZone 变
 * （owner 裁定 4,2026-10-04:「用量日表时区,默认按照 UTC+0」）。
 *
 * 这一条**只有在真库、且会话时区不是 UTC 时才看得见**:旧写法
 * `h.period_hour >= (now() at time zone 'UTC')::date - interval '35 days'` 的右式是
 * timestamp（无时区）,PostgreSQL 与 timestamptz 列比较时按会话 TimeZone 解释它——
 * Asia/Shanghai 会话下边界落在 UTC 第 D-36 天的 16:00Z,那一天被重算成 8 小时的合计;
 * America/New_York 会话下边界落在 D-35 的 04:00Z,D-35 被重算成 20。两种会话各锁一条,
 * 东西半球各占一边:改回旧 SQL,这两条各自红在不同的那一天。
 *
 * 模拟「非 UTC 的 RDS 参数组」靠 pg 的 `options: '-c timezone=…'`——它在连接启动参数里
 * 设会话 TimeZone,与库级 ALTER DATABASE … SET 的默认无关(连接参数优先),所以这条锁
 * 在库级默认已钉成 UTC 的库上照样能分辨旧 SQL。用例里先 `show timezone` 断言会话真的
 * 在那个时区——判据先验它会不会动。
 *
 * 夹具:D-36 与 D-35 各 24 个小时行(amount 1),天表两行各 24(= 一次正确的 pass 写过的样子)。
 * 跑 rollup 后两天仍须都是 24。
 *
 * 两道锁要分开验(2026-10-04 审查):rollup() 整段跑在 SET LOCAL TIME ZONE 'UTC' 的事务里,
 * 所以前两条用例锁的是「两道锁合起来的结果」——把第 50 行的边界改回旧写法而留着 SET LOCAL,
 * 它们照样绿。第三条用例把 HOURS_TO_DAYS_SQL 的**语句文本**单独拿到一条不开事务、不 SET LOCAL
 * 的 Asia/Shanghai 会话上跑:旧文本在这里给 D-36 = 8(实测),新文本 24 / 24。
 *
 * Gated(需要一个已建库的平台 DB):
 *   SUBSCRIPTION_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  HOURS_TO_DAYS_SQL,
  PgUsageRollupRepository,
} from "./pg-usage-rollup.repository";

const RUN = process.env.SUBSCRIPTION_ITEST === "1";

const USER = "00000000-0000-4000-8000-0000000b2004";
const TENANT = "00000000-0000-4000-8000-0000000b2005";
const WORKSPACE = "00000000-0000-4000-8000-0000000b2001";
const PRODUCT = "00000000-0000-4000-8000-0000000b2002";
const METRIC = "tz.itest.rollup";

describe.skipIf(!RUN)("usage rollup · 会话 TimeZone ≠ UTC(真库)", () => {
  let admin: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    // usage_summary_*.workspace_id / product_id 有跨 schema FK → 先造 user → tenant →
    // workspace 与 product 这条链。形状照 consume-reserve.itest.spec.ts,不自己编一套。
    await admin.query(
      `insert into account.users (id, account, phone, phone_verified_at, source)
       values ($1, 'tzrollup', '+8613800000472', now(), 'web')
       on conflict (id) do nothing`,
      [USER],
    );
    await admin.query(
      `insert into tenancy.tenants (id, name, type, owner_user_id)
       values ($1, 'TZ Rollup Org', 'organization', $2) on conflict (id) do nothing`,
      [TENANT, USER],
    );
    await admin.query(
      `insert into tenancy.workspaces (id, tenant_id, name, is_default)
       values ($1, $2, 'TZ Rollup WS', true) on conflict (id) do nothing`,
      [WORKSPACE, TENANT],
    );
    await admin.query(
      `insert into product.products (id, product_code, product_name, product_type, status, standalone_subscribable)
       values ($1, 'tz-rollup-itest', 'tz-rollup-itest', 'agent', 'active', true)
       on conflict (product_code) do nothing`,
      [PRODUCT],
    );
  });

  afterAll(async () => {
    await admin.end();
  });

  /** 夹具按 UTC 日 D = 今天写:D-36、D-35 各 24 个小时桶(amount 1),天表两行各 24。 */
  const seedFixture = async () => {
    await admin.query(
      `insert into metering.usage_summary_hours
         (workspace_id, product_id, metric_key, period_hour, total_amount)
       select $1, $2, $3,
              ((x.d0 - 36)::timestamp at time zone 'UTC') + make_interval(hours => g),
              1
         from generate_series(0, 47) g,
              (select (now() at time zone 'UTC')::date as d0) x
       on conflict (workspace_id, product_id, metric_key, period_hour)
       do update set total_amount = excluded.total_amount`,
      [WORKSPACE, PRODUCT, METRIC],
    );
    await admin.query(
      `insert into metering.usage_summary_days
         (workspace_id, product_id, metric_key, period_day, total_amount)
       select $1, $2, $3, (now() at time zone 'UTC')::date - back, 24
         from unnest(array[36, 35]) as back
       on conflict (workspace_id, product_id, metric_key, period_day)
       do update set total_amount = excluded.total_amount`,
      [WORKSPACE, PRODUCT, METRIC],
    );
  };

  const dayTotals = async (): Promise<{ back: number; total: number }[]> => {
    const r = await admin.query<{ back: string; total: string }>(
      `select ((now() at time zone 'UTC')::date - period_day)::text as back,
              total_amount::text as total
         from metering.usage_summary_days
        where workspace_id = $1 and product_id = $2 and metric_key = $3
          and period_day in ((now() at time zone 'UTC')::date - 36, (now() at time zone 'UTC')::date - 35)
        order by period_day`,
      [WORKSPACE, PRODUCT, METRIC],
    );
    return r.rows.map((x) => ({
      back: Number(x.back),
      total: Number(x.total),
    }));
  };

  for (const tz of ["Asia/Shanghai", "America/New_York"]) {
    it(`会话 ${tz}:rollup 之后 D-36 / D-35 仍各 24`, async () => {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c timezone=${tz}`,
      });
      try {
        // 判据先验它会不会动:这只池的会话真的在 tz 里。
        const shown = await pool.query<{ TimeZone: string }>("show timezone");
        expect(shown.rows[0]?.TimeZone).toBe(tz);

        await seedFixture();
        await new PgUsageRollupRepository(pool).rollup();

        expect(await dayTotals()).toEqual([
          { back: 36, total: 24 },
          { back: 35, total: 24 },
        ]);
      } finally {
        await pool.end();
      }
    });
  }

  it("hours → days 的语句文本本身与会话无关:Asia/Shanghai 会话、无事务、无 SET LOCAL,D-36 / D-35 仍各 24", async () => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: "-c timezone=Asia/Shanghai",
      max: 1,
    });
    try {
      const shown = await pool.query<{ TimeZone: string }>("show timezone");
      expect(shown.rows[0]?.TimeZone).toBe("Asia/Shanghai");

      await seedFixture();
      // 不经 rollup():那条路有第二道锁(SET LOCAL),看不见文本的退化。
      await pool.query(HOURS_TO_DAYS_SQL);

      expect(await dayTotals()).toEqual([
        { back: 36, total: 24 },
        { back: 35, total: 24 },
      ]);
    } finally {
      await pool.end();
    }
  });

  it("rollup 不把 SET LOCAL 泄漏到池里的下一位借用者", async () => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: "-c timezone=Asia/Shanghai",
      max: 1,
    });
    try {
      await new PgUsageRollupRepository(pool).rollup();
      const shown = await pool.query<{ TimeZone: string }>("show timezone");
      expect(shown.rows[0]?.TimeZone).toBe("Asia/Shanghai");
    } finally {
      await pool.end();
    }
  });
});
