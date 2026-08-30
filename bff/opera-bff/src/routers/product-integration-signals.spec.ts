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
  parseEntitlementSignal,
} from "./product-integration-signals.router";

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-000000000001";

function makeReq(
  opts: { capabilities?: string[]; anonymous?: boolean } = {},
): Request & RequestContext {
  return {
    operator: opts.anonymous ? undefined : { id: "op-1", displayName: null },
    capabilities: opts.capabilities ?? ["platform:product.read"],
  } as unknown as Request & RequestContext;
}

interface Fixture {
  productCode: string | null;
  usageRow?: { metric_key: string; created_at: Date };
  redisValue?: string | null;
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
    });
    expect(get).toHaveBeenCalledWith("vx:integration:c2:arda");

    const usageSql = sqls.find((s) => /metering\.usage_events/.test(s))!;
    expect(usageSql).toMatch(/product_id = \$1/);
    expect(usageSql).toContain(`interval '${CONSUME_LOOKBACK}'`);
    expect(usageSql).toMatch(/ORDER BY created_at DESC/);
    expect(usageSql).toMatch(/LIMIT 1/);
  });

  it("都没有：两个字段都是 null（不是 404，产品在，只是没接通）", async () => {
    const { router } = makeRouter({ productCode: "karda" });
    await expect(router.get(makeReq(), PRODUCT_ID)).resolves.toEqual({
      entitlement: null,
      consume: null,
    });
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
      router.get(makeReq({ capabilities: ["platform:oidc.read"] }), PRODUCT_ID),
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
