/**
 * platform-usage.service.spec.ts —— 配额耗尽的通告：一个周期一条、失败不留缓存、永不抛
 * （2026-09-28 第二批 C-2）。
 *
 * gated 是**持续状态**：客户端多半会接着重试，所以「一次请求一条」等于把运营台变成日志。
 * 进程内那层缓存是为此加的，它有一个必须钉住的细节：**写失败不许进缓存**——否则第一次
 * 因为权限或网络失败之后，这个周期就再也不会有人试了，缺口被自己藏起来。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { ConsumeService } from "@vxture/service-subscription";
import { PlatformUsageService } from "./platform-usage.service";
import type { PoolIdentity } from "./usage-view";

const WS = "11111111-1111-4111-8111-111111111111";

const pools: PoolIdentity[] = [
  {
    poolId: "p1",
    subscriptionId: "sub-1",
    view: { metric: "doc.words", limit: 1000, remaining: 0, priority: 10 },
    periodStart: new Date("2026-09-20T00:00:00.000Z"),
  },
];

/**
 * 一只池装两种查询：工作空间 → 租户可视码，以及通告的 insert。
 * subject: false 让解析回空行（查不到租户也必须照发）；insertThrows 让写库炸。
 */
function fakePool(opts: { subject?: boolean; insertThrows?: boolean } = {}) {
  const inserts: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("admin.operator_notices")) {
      inserts.push(params);
      if (opts.insertThrows) throw new Error("42501 permission denied");
      return { rows: [{ id: "notice-1" }], rowCount: 1 };
    }
    if (sql.includes("tenancy.workspaces")) {
      return opts.subject === false
        ? { rows: [], rowCount: 0 }
        : {
            rows: [
              {
                tenant_no: "2000000107",
                tenant_name: "示例科技",
                workspace_name: "默认空间",
              },
            ],
            rowCount: 1,
          };
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  return { pool: { query } as unknown as Pool, inserts, query };
}

const serviceWith = (pool: Pool) =>
  new PlatformUsageService(pool, {} as unknown as ConsumeService);

const input = (over: Record<string, unknown> = {}) => ({
  workspaceId: WS,
  productCode: "karda",
  metric: "doc.words",
  amount: "500",
  remainingTotal: 0,
  pools,
  now: new Date("2026-09-28T12:00:00.000Z"),
  ...over,
});

describe("PlatformUsageService.noteQuotaExhausted", () => {
  it("写一条 system 来源通告，标题带租户显示名与可视码", async () => {
    const { pool, inserts } = fakePool();
    await serviceWith(pool).noteQuotaExhausted(input());
    expect(inserts).toHaveLength(1);
    const [planes, severity, title, , link, refType, refId] = inserts[0]!;
    expect(planes).toEqual(["admin"]);
    expect(severity).toBe("warning");
    /* 带 T- 前缀（@shared 的 formatPrincipalNo）；链接里仍是裸号（那是路由，不是上屏）。 */
    expect(String(title)).toContain("T-2000000107");
    expect(link).toBe("/tenants/2000000107");
    expect(refType).toBe("ops_signal");
    expect(String(refId)).toBe(
      `quota_exhausted:${WS}:karda:doc.words:2026-09-20`,
    );
  });

  it("同一周期的第二次 gated 不再打库（客户端重试不该刷屏）", async () => {
    const { pool, inserts } = fakePool();
    const service = serviceWith(pool);
    await service.noteQuotaExhausted(input());
    await service.noteQuotaExhausted(input());
    await service.noteQuotaExhausted(input());
    expect(inserts).toHaveLength(1);
  });

  it("换一个周期起点就再写一条（新周期是新信息）", async () => {
    const { pool, inserts } = fakePool();
    const service = serviceWith(pool);
    await service.noteQuotaExhausted(input());
    await service.noteQuotaExhausted(
      input({
        pools: [
          {
            ...pools[0]!,
            periodStart: new Date("2026-10-20T00:00:00.000Z"),
          },
        ],
      }),
    );
    expect(inserts).toHaveLength(2);
  });

  it("写失败不进缓存：下一次 gated 还会再试一次", async () => {
    const { pool, inserts } = fakePool({ insertThrows: true });
    const service = serviceWith(pool);
    await service.noteQuotaExhausted(input());
    await service.noteQuotaExhausted(input());
    expect(inserts).toHaveLength(2);
  });

  it("写失败只记日志，绝不抛给热路径", async () => {
    const { pool } = fakePool({ insertThrows: true });
    await expect(
      serviceWith(pool).noteQuotaExhausted(input()),
    ).resolves.toBeUndefined();
  });

  it("租户解析不到也照发（少一个名字仍然是一条通告）", async () => {
    const { pool, inserts } = fakePool({ subject: false });
    await serviceWith(pool).noteQuotaExhausted(input());
    expect(inserts).toHaveLength(1);
    expect(String(inserts[0]![2])).toContain("（租户未知）");
    expect(inserts[0]![4]).toBeNull();
  });

  it("租户解析这一步炸了也照发（它不是发不发的判据）", async () => {
    const inserts: unknown[][] = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("admin.operator_notices")) {
        inserts.push(params);
        return { rows: [{ id: "notice-1" }], rowCount: 1 };
      }
      throw new Error("relation tenancy.workspaces does not exist");
    });
    const pool = { query } as unknown as Pool;
    await serviceWith(pool).noteQuotaExhausted(input());
    expect(inserts).toHaveLength(1);
  });
});
