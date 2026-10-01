/**
 * consume-reserve.itest.spec.ts — 真库验证 B1 的 `intent` 轴（owner 2026-10-01）。
 *
 * 这一条锁的性质**只有在真库上才看得见**：预留被拒时，`metering.usage_events` 里
 * 一行都不许多。桩测不出来——引擎是一条事务，「有没有 INSERT」不在返回值里。
 *
 * 四个用例对应四种坏法：
 *   1. reserve + 硬限 + 不足 → denied，**事件数不变**；
 *   2. report（默认档）+ 硬限 + 不足 → 仍然记账（2026-08-10 那条裁定没有被推翻）；
 *   3. reserve + 软限 + 不足 → **不拒**（只有硬限才兜底）；
 *   4. reserve + 硬限 + 够用 → 正常扣减，与 report 无差别。
 *
 * Gated（需要一个已建库的平台 DB）：
 *   SUBSCRIPTION_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgConsumeRepository } from "./pg-consume.repository";

const RUN = process.env.SUBSCRIPTION_ITEST === "1";

const USER = "00000000-0000-4000-8000-0000000b1004";
const TENANT = "00000000-0000-4000-8000-0000000b1005";
const WORKSPACE = "00000000-0000-4000-8000-0000000b1001";
const PROD_HARD = "00000000-0000-4000-8000-0000000b1002";
const PROD_SOFT = "00000000-0000-4000-8000-0000000b1003";
const METRIC_HARD = "b1test.hard";
const METRIC_SOFT = "b1test.soft";
/**
 * 幂等键每轮唯一。`usage_idempotency` 的键是主键且**永不过期**（本仓刻意如此：
 * 窗口外补投不会重复计费），所以固定键在第二遍就会命中重放——返回原结果、不写新
 * 事件，于是「事件数 +1」与状态断言全错。第一版就是这样：首轮 4/4 过，重跑 3 红。
 */
const RUN_ID = `${Date.now().toString(36)}`;

describe.skipIf(!RUN)("consume · intent=reserve（真库）", () => {
  let pool: Pool;
  let repo: PgConsumeRepository;

  const eventCount = async (): Promise<number> => {
    const r = await pool.query<{ n: string }>(
      `select count(*)::text as n from metering.usage_events where workspace_id = $1`,
      [WORKSPACE],
    );
    return Number(r.rows[0]?.n ?? "0");
  };

  const setPool = async (
    productId: string,
    metric: string,
    limit: number,
    used: number,
  ) => {
    await pool.query(
      `insert into metering.quota_pools
         (workspace_id, product_id, metric_key, quota_limit, quota_used, priority,
          component_role, pool_source, reset_period, status, effective_at)
       values ($1, $2, $3, $4, $5, 100, 'primary', 'manual_override', 'none', 'active', now())
       on conflict do nothing`,
      [WORKSPACE, productId, metric, String(limit), String(used)],
    );
    // 重新激活并设额度：afterAll 把池**退役**（不能删，明细行引用着它），所以重跑时
    // 这里必须把 status 带回 active，否则 consume 找不到候选池——第一版漏了这一句，
    // 第二次跑就 3 个用例红。
    await pool.query(
      `update metering.quota_pools
          set quota_limit = $4, quota_used = $5, status = 'active', retired_at = null
        where workspace_id = $1 and product_id = $2 and metric_key = $3`,
      [WORKSPACE, productId, metric, String(limit), String(used)],
    );
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    repo = new PgConsumeRepository(pool);

    // quota_pools.workspace_id 有外键 → 先造 user → tenant → workspace 这条链。
    // 形状照 trial-expiry.itest.spec.ts，不自己编一套。
    await pool.query(
      `insert into account.users (id, account, phone, phone_verified_at, source)
       values ($1, 'b1-itest', '+8613800000471', now(), 'web')
       on conflict (id) do nothing`,
      [USER],
    );
    await pool.query(
      `insert into tenancy.tenants (id, name, type, owner_user_id)
       values ($1, 'B1 Org', 'organization', $2) on conflict (id) do nothing`,
      [TENANT, USER],
    );
    await pool.query(
      `insert into tenancy.workspaces (id, tenant_id, name, is_default)
       values ($1, $2, 'B1 WS', true) on conflict (id) do nothing`,
      [WORKSPACE, TENANT],
    );

    // 两个产品、两个 pool 型指标：一个声明有成本（硬限），一个声明零成本（软限）。
    for (const [id, code] of [
      [PROD_HARD, "b1test-hard"],
      [PROD_SOFT, "b1test-soft"],
    ] as const) {
      await pool.query(
        `insert into product.products (id, product_code, product_name, product_type, status, standalone_subscribable)
         values ($1, $2, $2, 'agent', 'active', true)
         on conflict (product_code) do nothing`,
        [id, code],
      );
    }
    await pool.query(
      `insert into product.product_metrics
         (product_id, metric_key, merge_strategy, consume_mode, metric_unit, reset_period, cost_class)
       values ($1, $3, 'pool', 'divisible', 'calls', 'none', 'cost_bearing'),
              ($2, $4, 'pool', 'divisible', 'calls', 'none', 'zero_cost')
       on conflict (product_id, metric_key) do update set cost_class = excluded.cost_class`,
      [PROD_HARD, PROD_SOFT, METRIC_HARD, METRIC_SOFT],
    );
  });

  afterAll(async () => {
    // **usage_events 不删。** 它是 append-only，95 触发器对 DELETE 硬阻断（对 owner 也
    // 生效），第一版在这里 delete 直接把 afterAll 弄红了——那是库在教一件对的事：
    // 用量事件不可销毁。所以本套件的断言全部用**增量**（before + 1），不依赖绝对条数，
    // 重跑也成立；幂等键带本套件前缀，重跑命中幂等重放而不是写新行。
    // 池也**不删，退役**：usage_event_pools 的明细行引用着它，而那些行删不掉
    // （同 append-only）。这是既有真库测试的做法（trial-expiry.itest.spec.ts），
    // 第一版只抄了一半，连撞两次才补齐。产品与指标行同理留着——池引用它们。
    // fixture 全部 `on conflict do nothing` + 退役，所以重跑干净。
    await pool.query(
      `update metering.quota_pools set status = 'retired', retired_at = now()
        where workspace_id = $1 and status = 'active'`,
      [WORKSPACE],
    );
    await pool.end();
  });

  it("reserve + 硬限 + 额度不足 → denied，且一行用量事件都没写", async () => {
    await setPool(PROD_HARD, METRIC_HARD, 10, 10); // 余 0
    const before = await eventCount();

    const res = await repo.consume({
      workspaceId: WORKSPACE,
      productId: PROD_HARD,
      metricKey: METRIC_HARD,
      amount: 5,
      idempotencyKey: `b1-reserve-denied-${RUN_ID}`,
      intent: "reserve",
    });

    expect(res.status).toBe("denied");
    expect(res.consumed).toBe("0");
    expect(res.perPool).toEqual([]);
    // 这一条是本文件存在的理由：拒绝必须是「什么都没发生」。
    expect(await eventCount()).toBe(before);
  });

  it("report（默认档）+ 硬限 + 额度不足 → 照旧记账（2026-08-10 没被推翻）", async () => {
    await setPool(PROD_HARD, METRIC_HARD, 10, 10);
    const before = await eventCount();

    const res = await repo.consume({
      workspaceId: WORKSPACE,
      productId: PROD_HARD,
      metricKey: METRIC_HARD,
      amount: 5,
      idempotencyKey: `b1-report-recorded-${RUN_ID}`,
      // 刻意不传 intent —— 旧调用方就是这个形状。
    });

    expect(res.status).toBe("insufficient");
    expect(await eventCount()).toBe(before + 1);
  });

  it("reserve + 软限 + 额度不足 → 不拒（只有硬限才兜底）", async () => {
    await setPool(PROD_SOFT, METRIC_SOFT, 10, 10);
    const before = await eventCount();

    const res = await repo.consume({
      workspaceId: WORKSPACE,
      productId: PROD_SOFT,
      metricKey: METRIC_SOFT,
      amount: 5,
      idempotencyKey: `b1-reserve-soft-${RUN_ID}`,
      intent: "reserve",
    });

    expect(res.status).not.toBe("denied");
    expect(await eventCount()).toBe(before + 1);
  });

  /*
   * 库级反例。**这一条是因为约束曾经形同虚设才存在的**：
   *
   * 第一版判据写成 `merge_strategy <> 'pool' OR cost_class IN ('cost_bearing','zero_cost')`，
   * 而 pool + NULL 时 `cost_class IN (...)` 求值为 NULL，整条得 `false OR NULL` = NULL ——
   * CHECK **只在 FALSE 时拒**，于是它对唯一想防的那种行恰好放行（2026-10-02 实测插进去了）。
   * 判据改成 `cost_class IS NOT NULL`。
   *
   * 钉在真库测试里而不是静态守卫里：这条性质只有库自己答得出，正则看不出三值逻辑。
   */
  it("库级反例：pool 型不带成本档必须插不进去", async () => {
    await expect(
      pool.query(
        `insert into product.product_metrics
           (product_id, metric_key, merge_strategy, consume_mode, metric_unit, reset_period)
         values ($1, $2, 'pool', 'divisible', 'x', 'none')`,
        [PROD_HARD, `b1test.nocost.${RUN_ID}`],
      ),
    ).rejects.toThrow(/chk_product_metrics_pool_cost/);
  });

  it("reserve + 硬限 + 额度够用 → 正常扣减", async () => {
    await setPool(PROD_HARD, METRIC_HARD, 100, 0);
    const before = await eventCount();

    const res = await repo.consume({
      workspaceId: WORKSPACE,
      productId: PROD_HARD,
      metricKey: METRIC_HARD,
      amount: 5,
      idempotencyKey: `b1-reserve-ok-${RUN_ID}`,
      intent: "reserve",
    });

    expect(res.status).toBe("ok");
    expect(res.consumed).toBe("5");
    expect(await eventCount()).toBe(before + 1);
  });
});
