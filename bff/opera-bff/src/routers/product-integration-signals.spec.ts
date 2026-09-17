/**
 * product-integration-signals.spec.ts —— 接入信号端点（2026-08-31）。
 *
 * 钉四件事，都是「错了不报错」的那类：
 *   1. 键的形状：`<prefix>integration:c2:<productCode>`——platform-api 写的就是这个串，
 *      拼错一个字符等于永远读不到，界面上表现为 C2 永远红。
 *   2. C3 那条 SQL 必须带 `created_at` 下界（分区裁剪）且按 `product_id` 过滤。
 *   3. 键在但形状不对 → 500 `INTEGRATION_SIGNAL_MALFORMED`，不当成「没拉过」。
 *   4. 门与 404 走 `api/products/*` 既有的口径（`product-authz.ts` / `CATALOG_PRODUCT_NOT_FOUND`）。
 *
 * pool 与 redis 都是假的：这个 router 只读，两处读法都在断言里。
 */
import { HttpException } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { RpRuntime } from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/request-context";
import {
  CONSUME_LOOKBACK,
  ProductIntegrationSignalsRouter,
  S2S_LOOKBACK,
  parseEntitlementSignal,
} from "./product-integration-signals.router";

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-000000000001";

function makeReq(
  opts: { capabilities?: string[]; anonymous?: boolean } = {},
): Request & RequestContext {
  return {
    operator: opts.anonymous ? undefined : { id: "op-1", displayName: null },
    capabilities: opts.capabilities ?? ["integration:product.read"],
  } as unknown as Request & RequestContext;
}

interface Fixture {
  productCode: string | null;
  usageRow?: { metric_key: string; created_at: Date };
  redisValue?: string | null;
  s2sRow?: {
    target_product: string | null;
    mode: string | null;
    created_at: Date;
  };
  /** 开通：`status='provisioned'` 的最近一行。 */
  provisionRow?: { workspace_id: string; provisioned_at: Date };
  /** 回调投递：`status='delivered'` 的最近一行。 */
  deliveryRow?: {
    event_type: string;
    workspace_id: string;
    response_code: number | null;
    last_attempt_at: Date | null;
  };
}

function makeRouter(fx: Fixture) {
  const sqls: string[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    sqls.push(sql);
    if (/FROM product\.products/.test(sql)) {
      expect(params).toEqual([PRODUCT_ID]);
      return {
        rows: fx.productCode ? [{ product_code: fx.productCode }] : [],
      };
    }
    if (/FROM metering\.usage_events/.test(sql)) {
      expect(params).toEqual([PRODUCT_ID]);
      return { rows: fx.usageRow ? [fx.usageRow] : [] };
    }
    if (/FROM provisioning\.provisionings/.test(sql)) {
      expect(params).toEqual([PRODUCT_ID]);
      return { rows: fx.provisionRow ? [fx.provisionRow] : [] };
    }
    if (/FROM provisioning\.webhook_deliveries/.test(sql)) {
      expect(params).toEqual([PRODUCT_ID]);
      return { rows: fx.deliveryRow ? [fx.deliveryRow] : [] };
    }
    if (/FROM support\.audit_logs/.test(sql)) {
      /* 按**产品码**反查，不是产品 id——审计里记的是 caller_product。 */
      expect(params).toEqual(["oidc.token_exchange.issued", fx.productCode]);
      return { rows: fx.s2sRow ? [fx.s2sRow] : [] };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
  const get = vi.fn(async () => fx.redisValue ?? null);
  const router = new ProductIntegrationSignalsRouter(
    { query } as unknown as Pool,
    { get },
    { keyPrefix: "vx:" } as RpRuntime,
  );
  return { router, sqls, get };
}

async function failure(
  promise: Promise<unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  return {
    status: http.getStatus(),
    body: http.getResponse() as Record<string, unknown>,
  };
}

describe("GET /api/products/:id/integration-signals", () => {
  it("两条痕迹都在：C2 从 Redis 键解出来，C3 取最近一行", async () => {
    const at = new Date("2026-08-30T08:00:00.000Z");
    const { router, sqls, get } = makeRouter({
      productCode: "arda",
      usageRow: { metric_key: "tokens", created_at: at },
      redisValue: JSON.stringify({
        lastSeenAt: "2026-08-31T01:02:03.000Z",
        via: "s2s",
        workspaceId: "ws-1",
      }),
    });

    const out = await router.get(makeReq(), PRODUCT_ID);

    expect(out).toEqual({
      entitlement: {
        lastSeenAt: "2026-08-31T01:02:03.000Z",
        via: "s2s",
        workspaceId: "ws-1",
      },
      consume: { lastEventAt: "2026-08-30T08:00:00.000Z", metricKey: "tokens" },
      s2s: null,
      provision: null,
      delivery: null,
    });
    expect(get).toHaveBeenCalledWith("vx:integration:c2:arda");

    const usageSql = sqls.find((s) => /metering\.usage_events/.test(s))!;
    expect(usageSql).toMatch(/product_id = \$1/);
    expect(usageSql).toContain(`interval '${CONSUME_LOOKBACK}'`);
    expect(usageSql).toMatch(/ORDER BY created_at DESC/);
    expect(usageSql).toMatch(/LIMIT 1/);
  });

  it("都没有：五个字段都是 null（不是 404，产品在，只是没接通）", async () => {
    const { router } = makeRouter({ productCode: "karda" });
    await expect(router.get(makeReq(), PRODUCT_ID)).resolves.toEqual({
      entitlement: null,
      consume: null,
      s2s: null,
      provision: null,
      delivery: null,
    });
  });

  it("开通与投递：判 status，且**不带**时间下界（这两张表不是分区表）", async () => {
    const { router, sqls } = makeRouter({
      productCode: "arda",
      provisionRow: {
        workspace_id: "ws-1",
        provisioned_at: new Date("2026-08-29T10:00:00.000Z"),
      },
      deliveryRow: {
        event_type: "grant.invalidated",
        workspace_id: "ws-1",
        response_code: 200,
        last_attempt_at: new Date("2026-08-30T11:00:00.000Z"),
      },
    });

    const out = await router.get(makeReq(), PRODUCT_ID);
    expect(out.provision).toEqual({
      lastProvisionedAt: "2026-08-29T10:00:00.000Z",
      workspaceId: "ws-1",
    });
    expect(out.delivery).toEqual({
      eventType: "grant.invalidated",
      workspaceId: "ws-1",
      responseCode: 200,
      lastAttemptAt: "2026-08-30T11:00:00.000Z",
    });

    const provSql = sqls.find((x) => /provisioning\.provisionings/.test(x))!;
    /* 判 `status='provisioned'` 而不是「有行」：行在 pending 时就已经存在，
       那只说明有人点了开通，不说明开通成功。 */
    expect(provSql).toMatch(/status = 'provisioned'/);
    expect(provSql).toMatch(/product_id = \$1/);

    const delSql = sqls.find((x) => /webhook_deliveries/.test(x))!;
    /* 判 `status='delivered'` 而**不是** `delivered_at`：那一列建了但全仓没人写
       （markDelivered 只写 status 与 response_code），用它会得到一条永远不满足的检查。 */
    expect(delSql).toMatch(/status = 'delivered'/);
    expect(delSql).not.toMatch(/delivered_at\s*IS NOT NULL/);

    /* **两条都不带 `created_at` 下界**：这两张表没有 PARTITION BY，不需要裁剪。
       C3 那条带下界是因为 usage_events 按月分区——照着它抄一个时间窗到这里，
       会把「半年前开通、至今在用」的产品判成没开通过。这一条就是拦那个的。 */
    expect(provSql).not.toContain("interval");
    expect(delSql).not.toContain("interval");
  });

  it("C1 出站：从换票审计读出来，且按产品码而不是产品 id 反查", async () => {
    const { router, sqls } = makeRouter({
      productCode: "arda",
      s2sRow: {
        target_product: "atlas",
        mode: "obo",
        created_at: new Date("2026-08-30T09:00:00.000Z"),
      },
    });

    const out = await router.get(makeReq(), PRODUCT_ID);
    expect(out.s2s).toEqual({
      lastSeenAt: "2026-08-30T09:00:00.000Z",
      target: "atlas",
      mode: "obo",
    });

    const sql = sqls.find((x) => /support\.audit_logs/.test(x))!;
    /* 三条判据缺一不可：只按 action 查会把别的产品的换票算到本产品头上；
       不带 result 会把失败的尝试算成接通；不带时间下界，分区表不裁剪。 */
    expect(sql).toMatch(/after->>'caller_product' = \$2/);
    expect(sql).toMatch(/result = 'success'/);
    expect(sql).toContain(`interval '${S2S_LOOKBACK}'`);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(sql).toMatch(/LIMIT 1/);
  });

  it("C1 出站：审计行缺 target/mode 不让整条信号消失", async () => {
    /* 旧审计行可能没有这两个 jsonb 键。那不是故障——「换过票」这个结论仍然成立，
       不该因为缺一个展示字段就退回「没换过」。 */
    const { router } = makeRouter({
      productCode: "arda",
      s2sRow: {
        target_product: null,
        mode: null,
        created_at: new Date("2026-08-30T09:00:00.000Z"),
      },
    });
    const out = await router.get(makeReq(), PRODUCT_ID);
    expect(out.s2s?.lastSeenAt).toBe("2026-08-30T09:00:00.000Z");
    expect(out.s2s?.target).toBeTruthy();
  });

  it("产品不存在 → 404 CATALOG_PRODUCT_NOT_FOUND，不碰 Redis", async () => {
    const { router, get } = makeRouter({ productCode: null });
    const { status, body } = await failure(router.get(makeReq(), PRODUCT_ID));
    expect(status).toBe(404);
    expect(body["code"]).toBe("CATALOG_PRODUCT_NOT_FOUND");
    expect(get).not.toHaveBeenCalled();
  });

  it("id 不是 uuid → 400 VALIDATION_INVALID_UUID，带 field", async () => {
    const { router } = makeRouter({ productCode: "arda" });
    const { status, body } = await failure(router.get(makeReq(), "nope"));
    expect(status).toBe(400);
    expect(body["code"]).toBe("VALIDATION_INVALID_UUID");
    expect(body["field"]).toBe("id");
  });

  it("没有 product.read / manage 能力 → 403 NOT_ENTITLED；没会话 → 401", async () => {
    const { router } = makeRouter({ productCode: "arda" });
    const denied = await failure(
      router.get(
        makeReq({ capabilities: ["capability:runos.read"] }),
        PRODUCT_ID,
      ),
    );
    expect(denied.status).toBe(403);
    expect(denied.body["code"]).toBe("NOT_ENTITLED");

    const anon = await failure(
      router.get(makeReq({ anonymous: true }), PRODUCT_ID),
    );
    expect(anon.status).toBe(401);
    expect(anon.body["code"]).toBe("AUTH_NO_SESSION");
  });

  it("键在但不是契约形状 → 500 INTEGRATION_SIGNAL_MALFORMED，不当成没拉过", async () => {
    const { router } = makeRouter({
      productCode: "arda",
      redisValue: JSON.stringify({ seen: true }),
    });
    const { status, body } = await failure(router.get(makeReq(), PRODUCT_ID));
    expect(status).toBe(500);
    expect(body["code"]).toBe("INTEGRATION_SIGNAL_MALFORMED");
    expect(body["retryable"]).toBe(false);
  });
});

describe("parseEntitlementSignal", () => {
  it("null 键 = 没拉过", () => {
    expect(parseEntitlementSignal(null, "k")).toBeNull();
  });

  it("workspaceId 缺省或非字符串落 null，其余两字段原样", () => {
    expect(
      parseEntitlementSignal(
        JSON.stringify({ lastSeenAt: "t", via: "internal-auth" }),
        "k",
      ),
    ).toEqual({ lastSeenAt: "t", via: "internal-auth", workspaceId: null });
  });

  it("非 JSON 抛 500", () => {
    expect(() => parseEntitlementSignal("{not json", "k")).toThrow(
      HttpException,
    );
  });
});
