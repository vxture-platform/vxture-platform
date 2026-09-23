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
  /** 登录：`session.refresh_tokens` 的最近一行（按 product_id 聚合的客户端集合）。 */
  loginRow?: { client_id: string; created_at: Date };
  /** 开通：`status='provisioned'` 的最近一行。 */
  provisionRow?: {
    workspace_id: string;
    provisioned_at: Date;
    /* 回执:同一行 metadata 里取出的两个 jsonb 值;没回执过时两列都是 NULL。 */
    ack_at?: string | null;
    ack_status?: string | null;
  };
  /** 收口：沙箱工作区（不传 = 不收口，与加这个参数之前逐字等价）。 */
  scopeWorkspaceId?: string;
  /** 收口：沙箱租户（登录段专用——登录发生在选定工作区之前）。 */
  scopeTenantId?: string;
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
  /* 每条查询实际收到的参数，按表名留一份——收口测试断言的是**参数真的传下去了**，
     而不是「端点没报错」。少了这一份，收口参数传没传到 SQL 上没有任何东西看得见。 */
  const paramsByTable = new Map<string, unknown[]>();
  const ws = fx.scopeWorkspaceId ?? null;
  const tid = fx.scopeTenantId ?? null;
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    sqls.push(sql);
    if (/FROM product\.products/.test(sql)) {
      expect(params).toEqual([PRODUCT_ID]);
      return {
        rows: fx.productCode ? [{ product_code: fx.productCode }] : [],
      };
    }
    if (/FROM metering\.usage_events/.test(sql)) {
      paramsByTable.set("usage_events", params ?? []);
      expect(params).toEqual([PRODUCT_ID, ws]);
      return { rows: fx.usageRow ? [fx.usageRow] : [] };
    }
    if (/FROM session\.refresh_tokens/.test(sql)) {
      /* 按**产品 id** 聚合：子查询先拿 product_id 取客户端集合，
         而不是拿单个 client_id——一个产品可能有三个渠道客户端。
         第二个参数是**沙箱租户**不是工作区：refresh_tokens 没有 workspace_id
         （登录发生在选定工作区之前），所以登录段按「登录的人是这个租户的成员」收口。 */
      paramsByTable.set("refresh_tokens", params ?? []);
      expect(params).toEqual([PRODUCT_ID, tid]);
      return { rows: fx.loginRow ? [fx.loginRow] : [] };
    }
    if (/FROM provisioning\.provisionings/.test(sql)) {
      paramsByTable.set("provisionings", params ?? []);
      expect(params).toEqual([PRODUCT_ID, ws]);
      return { rows: fx.provisionRow ? [fx.provisionRow] : [] };
    }
    if (/FROM provisioning\.webhook_deliveries/.test(sql)) {
      paramsByTable.set("webhook_deliveries", params ?? []);
      expect(params).toEqual([PRODUCT_ID, ws]);
      return { rows: fx.deliveryRow ? [fx.deliveryRow] : [] };
    }
    if (/FROM support\.audit_logs/.test(sql)) {
      /* 按**产品码**反查，不是产品 id——审计里记的是 caller_product。
         换票**不收口**：audit_logs 没有 workspace_id，而换票也不在认证那五段里。 */
      paramsByTable.set("audit_logs", params ?? []);
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
  return { router, sqls, get, paramsByTable };
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
      /* 这份 fixture 没给 loginRow——首段缺席是 null，不是报错。 */
      login: null,
      entitlement: {
        lastSeenAt: "2026-08-31T01:02:03.000Z",
        via: "s2s",
        workspaceId: "ws-1",
      },
      consume: { lastEventAt: "2026-08-30T08:00:00.000Z", metricKey: "tokens" },
      s2s: null,
      provision: null,
      provisionAck: null,
      delivery: null,
    });
    expect(get).toHaveBeenCalledWith("vx:integration:c2:arda");

    const usageSql = sqls.find((s) => /metering\.usage_events/.test(s))!;
    expect(usageSql).toMatch(/product_id = \$1/);
    expect(usageSql).toContain(`interval '${CONSUME_LOOKBACK}'`);
    expect(usageSql).toMatch(/ORDER BY created_at DESC/);
    expect(usageSql).toMatch(/LIMIT 1/);
  });

  it("都没有：七个字段都是 null（不是 404，产品在，只是没接通）", async () => {
    const { router } = makeRouter({ productCode: "karda" });
    await expect(router.get(makeReq(), PRODUCT_ID)).resolves.toEqual({
      login: null,
      entitlement: null,
      consume: null,
      s2s: null,
      provision: null,
      provisionAck: null,
      delivery: null,
    });
  });

  it("开通回执：与开通取同一行，回执缺席时是 null 而不是报错", async () => {
    /* 回执写在 `provisionings.metadata.ack` 里，不改 status/version/provisioned_at——
       所以它和「开通」取的是同一行，两个时间戳答的是两件事:`provision` 是**平台下令**，
       `provisionAck` 是**产品确认**。此前只有前者，而接入检查把它当「开通成功」在读。 */
    const { router } = makeRouter({
      productCode: "arda",
      provisionRow: {
        workspace_id: "ws-1",
        provisioned_at: new Date("2026-08-29T10:00:00.000Z"),
        ack_at: "2026-08-29T10:00:31.000Z",
        ack_status: "ready",
      },
    });
    const out = await router.get(makeReq(), PRODUCT_ID);
    expect(out.provisionAck).toEqual({
      /* 原样带出，不过 toIso——这一列存的是平台自己写进 metadata 的 ISO 串，
         不是列上的 timestamptz。 */
      ackedAt: "2026-08-29T10:00:31.000Z",
      status: "ready",
      workspaceId: "ws-1",
    });
  });

  it("开通回执：产品报 failed 也照实带出，不当成没回执", async () => {
    /* 回执要能说坏消息。把 failed 读成 null，等于把「对方明说建不起来」
       和「对方没理我」画成同一格。 */
    const { router } = makeRouter({
      productCode: "arda",
      provisionRow: {
        workspace_id: "ws-1",
        provisioned_at: new Date("2026-08-29T10:00:00.000Z"),
        ack_at: "2026-08-29T10:00:31.000Z",
        ack_status: "failed",
      },
    });
    const out = await router.get(makeReq(), PRODUCT_ID);
    expect(out.provisionAck?.status).toBe("failed");
  });

  it("开通行在、但从没回执过：provisionAck 是 null，provision 照常有值", async () => {
    const { router } = makeRouter({
      productCode: "arda",
      provisionRow: {
        workspace_id: "ws-1",
        provisioned_at: new Date("2026-08-29T10:00:00.000Z"),
      },
    });
    const out = await router.get(makeReq(), PRODUCT_ID);
    expect(out.provision).not.toBeNull();
    expect(out.provisionAck).toBeNull();
  });
  it("登录：按 product_id 聚合客户端，不按单个 client_id", async () => {
    const { router, sqls } = makeRouter({
      productCode: "arda",
      loginRow: {
        client_id: "arda-beta",
        created_at: new Date("2026-09-17T02:00:00Z"),
      },
    });
    const out = await router.get(makeReq(), PRODUCT_ID);
    expect(out.login).toEqual({
      lastLoginAt: "2026-09-17T02:00:00.000Z",
      clientId: "arda-beta",
    });
    const sql = sqls.find((x) => /session\.refresh_tokens/.test(x))!;
    /* 子查询走 oidc_clients，条件是 product_id + client_kind——这才能覆盖
       stable / beta / canary 三个渠道。 */
    expect(sql).toMatch(/FROM appoidc\.oidc_clients/);
    expect(sql).toMatch(/c\.product_id = \$1/);
    expect(sql).toMatch(/c\.client_kind = 'product'/);
  });

  it("登录：**不带** created_at 下界（refresh_tokens 不是分区表）", async () => {
    /* 照搬 C3 的时间窗会把「半年前登过、至今在用」的产品判成没人登过。 */
    const { router, sqls } = makeRouter({ productCode: "arda" });
    await router.get(makeReq(), PRODUCT_ID);
    const sql = sqls.find((x) => /session\.refresh_tokens/.test(x))!;
    expect(sql).not.toMatch(/created_at >= now\(\)/);
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
    /* 判 `status='delivered'` 而**不是** `delivered_at`。2026-09-17 起 markDelivered
       已经写 `delivered_at` 了，但这条断言不跟着改：status 是状态机的权威，
       时间戳是派生记录；而且补写之前落库的存量行 `delivered_at` 永远是 NULL，
       换判据会把那些已经投成的行全判成未投递。 */
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

/*
 * 收口（2026-10-30）。这一组守的是**认证只认沙箱里那一次**。
 *
 * 不收口时 A 客户的真实使用会把 B 产品的认证喂绿——那正是旧 `acceptance` 判据的
 * 毛病。所以断言必须落在「参数真的传到 SQL 上了」，而不是「端点没报错」：后者在
 * 收口参数被悄悄吞掉时照样绿。
 */
describe("integration-signals · 沙箱收口", () => {
  const WS = "8f1c0a44-0000-4000-8000-0000000000aa";
  const TID = "8f1c0a44-0000-4000-8000-0000000000bb";

  it("四条 SQL 各自收到该收的那个 id：工作区给三条，沙箱租户给登录那条", async () => {
    const { router, paramsByTable } = makeRouter({
      productCode: "arda",
      scopeWorkspaceId: WS,
      scopeTenantId: TID,
    });
    await router.get(makeReq(), PRODUCT_ID, WS, TID);

    expect(paramsByTable.get("usage_events")).toEqual([PRODUCT_ID, WS]);
    expect(paramsByTable.get("provisionings")).toEqual([PRODUCT_ID, WS]);
    expect(paramsByTable.get("webhook_deliveries")).toEqual([PRODUCT_ID, WS]);
    /* 登录段收的是**沙箱租户**：refresh_tokens 没有 workspace_id。 */
    expect(paramsByTable.get("refresh_tokens")).toEqual([PRODUCT_ID, TID]);
    /* 换票段**不收口**且不该被误传：audit_logs 没有 workspace_id，
       而换票也不在认证那五段里（它归上线门）。 */
    expect(paramsByTable.get("audit_logs")).toEqual([
      "oidc.token_exchange.issued",
      "arda",
    ]);
  });

  it("不传收口参数时逐字等价于加这个能力之前：四条都收到 null", async () => {
    const { router, paramsByTable } = makeRouter({ productCode: "arda" });
    await router.get(makeReq(), PRODUCT_ID);
    expect(paramsByTable.get("usage_events")).toEqual([PRODUCT_ID, null]);
    expect(paramsByTable.get("refresh_tokens")).toEqual([PRODUCT_ID, null]);
    expect(paramsByTable.get("provisionings")).toEqual([PRODUCT_ID, null]);
    expect(paramsByTable.get("webhook_deliveries")).toEqual([PRODUCT_ID, null]);
  });

  it("C2 是 Redis 上的键，收口在代码里做：工作区对不上就不算", async () => {
    const { router } = makeRouter({
      productCode: "arda",
      scopeWorkspaceId: WS,
      redisValue: JSON.stringify({
        lastSeenAt: "2026-08-31T01:02:03.000Z",
        via: "s2s",
        workspaceId: "另一个工作区",
      }),
    });
    const out = await router.get(makeReq(), PRODUCT_ID, WS);
    expect(out.entitlement).toBeNull();
  });

  it("C2 工作区对得上：照常算", async () => {
    const { router } = makeRouter({
      productCode: "arda",
      scopeWorkspaceId: WS,
      redisValue: JSON.stringify({
        lastSeenAt: "2026-08-31T01:02:03.000Z",
        via: "s2s",
        workspaceId: WS,
      }),
    });
    const out = await router.get(makeReq(), PRODUCT_ID, WS);
    expect(out.entitlement?.workspaceId).toBe(WS);
  });

  it("C2 没带工作区：收口时算不在范围内，不放行", async () => {
    /* 保守是有意的：认证要证的是「沙箱里那一次」，证不出来就不该算。
       放行的代价是一条认证凭着别处的流量通过，而那是静默的。 */
    const { router } = makeRouter({
      productCode: "arda",
      scopeWorkspaceId: WS,
      redisValue: JSON.stringify({
        lastSeenAt: "2026-08-31T01:02:03.000Z",
        via: "s2s",
        workspaceId: null,
      }),
    });
    const out = await router.get(makeReq(), PRODUCT_ID, WS);
    expect(out.entitlement).toBeNull();
  });

  it("收口参数不是合法 uuid：400，不静默退回「不收口」", async () => {
    /* 悄悄退回不收口 = 一次本该收口的认证读到了全量流量，而没有任何东西看得见。 */
    const { router } = makeRouter({ productCode: "arda" });
    const out = await failure(router.get(makeReq(), PRODUCT_ID, "not-a-uuid"));
    expect(out.status).toBe(400);
  });
});
