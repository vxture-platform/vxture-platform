/**
 * product-catalog-deletion.spec.ts —— 产品删除(两步软删除，owner 2026-08-31)。
 *
 * 删除与退役的分工：退役是可见的终态；删除是「本不该在册」直接软删 `deleted_at`。
 * 判据是**无客户足迹即可删**——有用量/账单/开通/权益/上游生效授权任一者就只能退役。
 * 这条闸门的失败方式全是静默的(足迹没查、上游没问、确认没要求)，都表现为「删成功」，
 * 所以钉在这里：
 *
 *   1. confirm 不为 true → 400，一次上游/事务都不碰。
 *   2. 上游还有生效授权 → 409 PRODUCT_HAS_ACTIVE_GRANTS，事务没开。
 *   3. 有客户足迹 → 409 PRODUCT_HAS_CUSTOMER_FOOTPRINT，事务开了但产品没软删、回滚。
 *   4. 无足迹无授权 → 软删产品 + 软删 primary 套餐 + 停用 product 型 OIDC 客户端 + 审计。
 *   5. 预览只读：回 deletable / blockers / 连带项(套餐数、被停用的客户端)。
 *   6. 无 platform:product.manage → 403，闸门之前就停。
 *
 * 上游那一次读整个换成桩(同退役 spec)；pg 按 SQL 正则桩。
 */
import { HttpException } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VxConfigService } from "@vxture/core-config";
import type { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { RequestContext } from "../types/request-context";
import type { ActiveUpstreamGrants } from "../lib/upstream-grants";

vi.mock("@vxture/core-config", () => ({
  VxConfigService: class VxConfigService {},
}));

vi.mock("../lib/upstream-grants", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/upstream-grants")>();
  return { ...actual, fetchActiveUpstreamGrants: vi.fn() };
});

import { fetchActiveUpstreamGrants } from "../lib/upstream-grants";
import { ProductCatalogRouter } from "./product-catalog.router";

const fetchGrants = vi.mocked(fetchActiveUpstreamGrants);

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-000000000009";

function makeReq(caps: string[] = ["platform:product.manage"]) {
  return {
    operator: { id: "op-1", displayName: null },
    capabilities: caps,
    operatorAccessToken: "operator-access-token",
    headers: {},
  } as unknown as Request & RequestContext;
}

function productRow(status = "draft") {
  return {
    id: PRODUCT_ID,
    product_code: "ruyin",
    product_type: "client",
    category_id: 1,
    product_name: "如影",
    product_nick: "ruyin",
    description: null,
    capability_keys: [],
    tags: [],
    standalone_subscribable: true,
    status,
    is_customer_visible: true,
    is_workforce_visible: true,
    origin: "self",
    origin_provider: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
}

interface FootprintFlags {
  usage?: boolean;
  billing?: boolean;
  provisioning?: boolean;
  entitlements?: boolean;
}

/**
 * 假 pg：`pool.query` 服务事务外的预读/预览，`connect()` 的 client 服务删除事务。
 * `spy` 记下事务里发生过的写(产品软删、套餐软删、客户端停用、审计)，断言用。
 */
function makePool(opts: {
  status: string | null;
  footprint?: FootprintFlags;
  plansCount?: number;
  activeClients?: string[];
}) {
  const {
    status,
    footprint = {},
    plansCount = 1,
    activeClients = ["ruyin", "ruyin-beta"],
  } = opts;
  const spy = {
    beganTx: false,
    productDeleted: false,
    plansSoftDeleted: [] as string[],
    clientsDisabled: [] as string[],
    audited: false,
    rolledBack: false,
    committed: false,
  };
  const footprintRow = {
    has_usage: !!footprint.usage,
    has_billing: !!footprint.billing,
    has_provisioning: !!footprint.provisioning,
    has_entitlements: !!footprint.entitlements,
  };
  const client = {
    query: vi.fn(async (sql: string) => {
      if (/^\s*BEGIN/.test(sql)) {
        spy.beganTx = true;
        return { rows: [] };
      }
      if (/^\s*COMMIT/.test(sql)) {
        spy.committed = true;
        return { rows: [] };
      }
      if (/^\s*ROLLBACK/.test(sql)) {
        spy.rolledBack = true;
        return { rows: [] };
      }
      if (/FOR UPDATE/.test(sql)) {
        return { rows: status ? [productRow(status)] : [] };
      }
      if (/has_usage/.test(sql)) return { rows: [footprintRow] };
      if (/UPDATE product\.products/.test(sql)) {
        spy.productDeleted = true;
        return { rows: [productRow(status ?? "draft")] };
      }
      if (/UPDATE product\.plans/.test(sql)) {
        const rows = Array.from({ length: plansCount }, (_, i) => ({
          plan_code: `ruyin-plan-${i}`,
        }));
        spy.plansSoftDeleted = rows.map((r) => r.plan_code);
        return { rows };
      }
      if (/UPDATE appoidc\.oidc_clients/.test(sql)) {
        const rows = activeClients.map((c) => ({ client_id: c }));
        spy.clientsDisabled = activeClients;
        return { rows };
      }
      if (/insert into support\.audit_logs/i.test(sql)) {
        spy.audited = true;
        return { rows: [] };
      }
      throw new Error(`unexpected client sql: ${sql}`);
    }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (/SELECT product_code, status FROM product\.products/.test(sql)) {
        return {
          rows: status ? [{ product_code: "ruyin", status }] : [],
          rowCount: status ? 1 : 0,
        };
      }
      if (/SELECT product_code FROM product\.products/.test(sql)) {
        return { rows: status ? [{ product_code: "ruyin" }] : [] };
      }
      if (/SELECT 1 FROM product\.products/.test(sql)) {
        return { rows: status ? [{ "?column?": 1 }] : [] };
      }
      if (/has_usage/.test(sql)) return { rows: [footprintRow] };
      if (/count\(\*\)::int AS cnt FROM product\.plans/.test(sql)) {
        return { rows: [{ cnt: plansCount }] };
      }
      if (/SELECT client_id FROM appoidc\.oidc_clients/.test(sql)) {
        return { rows: activeClients.map((c) => ({ client_id: c })) };
      }
      throw new Error(`unexpected pool sql: ${sql}`);
    }),
    connect: vi.fn(async () => client),
  };
  return { pool: pool as unknown as Pool, connect: pool.connect, spy };
}

function makeRouter(opts: Parameters<typeof makePool>[0]) {
  const { pool, connect, spy } = makePool(opts);
  const config = {
    platform: {
      ATLAS_API_URL: "http://atlas.test/",
      RUNOS_API_URL: "http://runos.test/",
    },
  } as unknown as VxConfigService;
  const router = new ProductCatalogRouter(pool, config, {
    getToken: vi.fn(async () => "obo"),
  } as unknown as OperatorExchangeService);
  return { router, connect, spy };
}

function grants(atlasCount: number, runosCount: number): ActiveUpstreamGrants {
  return {
    productCode: "ruyin",
    atlas: { count: atlasCount, sample: [] },
    runos: { count: runosCount, sample: [] },
  };
}

async function failure(promise: Promise<unknown>) {
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

beforeEach(() => {
  fetchGrants.mockReset();
});

describe("DELETE /:id —— 两步软删除", () => {
  it("confirm 不为 true → 400 DELETION_NOT_CONFIRMED，不打上游、不开事务", async () => {
    const { router, connect } = makeRouter({ status: "draft" });
    const { status, body } = await failure(
      router.remove(makeReq(), PRODUCT_ID, {}),
    );
    expect(status).toBe(400);
    expect(body["code"]).toBe("DELETION_NOT_CONFIRMED");
    expect(fetchGrants).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("上游还有生效授权 → 409 PRODUCT_HAS_ACTIVE_GRANTS，事务没开", async () => {
    const { router, connect, spy } = makeRouter({ status: "active" });
    fetchGrants.mockResolvedValue(grants(1, 0));
    const { status, body } = await failure(
      router.remove(makeReq(), PRODUCT_ID, { confirm: true }),
    );
    expect(status).toBe(409);
    expect(body["code"]).toBe("PRODUCT_HAS_ACTIVE_GRANTS");
    expect(connect).not.toHaveBeenCalled();
    expect(spy.productDeleted).toBe(false);
  });

  it("已退役产品删除仍强制查上游(不吃 deprecated 短路) → 有授权就 409", async () => {
    const { router, connect } = makeRouter({ status: "deprecated" });
    fetchGrants.mockResolvedValue(grants(0, 2));
    const { status, body } = await failure(
      router.remove(makeReq(), PRODUCT_ID, { confirm: true }),
    );
    expect(status).toBe(409);
    expect(body["code"]).toBe("PRODUCT_HAS_ACTIVE_GRANTS");
    expect(fetchGrants).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it("有客户足迹 → 409 PRODUCT_HAS_CUSTOMER_FOOTPRINT，产品没软删、事务回滚", async () => {
    const { router, spy } = makeRouter({
      status: "active",
      footprint: { usage: true },
    });
    fetchGrants.mockResolvedValue(grants(0, 0));
    const { status, body } = await failure(
      router.remove(makeReq(), PRODUCT_ID, { confirm: true }),
    );
    expect(status).toBe(409);
    expect(body["code"]).toBe("PRODUCT_HAS_CUSTOMER_FOOTPRINT");
    expect(String(body["message"])).toContain("用量记录");
    expect(spy.beganTx).toBe(true);
    expect(spy.productDeleted).toBe(false);
    expect(spy.rolledBack).toBe(true);
    expect(spy.committed).toBe(false);
  });

  it("无足迹无授权 → 软删产品 + 软删 primary 套餐 + 停用 product 型客户端 + 审计 + 提交", async () => {
    const { router, spy } = makeRouter({
      status: "draft",
      footprint: {},
      plansCount: 2,
      activeClients: ["ruyin", "ruyin-beta"],
    });
    fetchGrants.mockResolvedValue(grants(0, 0));

    const result = await router.remove(makeReq(), PRODUCT_ID, {
      confirm: true,
    });

    expect(result.productCode).toBe("ruyin");
    expect(spy.productDeleted).toBe(true);
    expect(spy.plansSoftDeleted).toHaveLength(2);
    expect(spy.clientsDisabled).toEqual(["ruyin", "ruyin-beta"]);
    expect(spy.audited).toBe(true);
    expect(spy.committed).toBe(true);
    expect(spy.rolledBack).toBe(false);
  });

  it("产品不存在 → 404，一次上游都不打", async () => {
    const { router } = makeRouter({ status: null });
    const { status, body } = await failure(
      router.remove(makeReq(), PRODUCT_ID, { confirm: true }),
    );
    expect(status).toBe(404);
    expect(body["code"]).toBe("CATALOG_PRODUCT_NOT_FOUND");
    expect(fetchGrants).not.toHaveBeenCalled();
  });

  it("无 platform:product.manage → 403，确认之前就停", async () => {
    const { router, connect } = makeRouter({ status: "draft" });
    const { status } = await failure(
      router.remove(makeReq(["platform:product.read"]), PRODUCT_ID, {
        confirm: true,
      }),
    );
    expect(status).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });
});

describe("GET /:id/deletion-preview —— 只读影响面", () => {
  it("无足迹无授权：deletable=true，回连带项(套餐数、会被停用的客户端)", async () => {
    const { router } = makeRouter({
      status: "draft",
      plansCount: 1,
      activeClients: ["ruyin", "ruyin-beta"],
    });
    fetchGrants.mockResolvedValue(grants(0, 0));

    const impact = await router.deletionPreview(makeReq(), PRODUCT_ID);

    expect(impact.deletable).toBe(true);
    expect(impact.blockers).toEqual([]);
    expect(impact.cascade.plans).toBe(1);
    expect(impact.cascade.oidcClients).toEqual(["ruyin", "ruyin-beta"]);
  });

  it("有足迹或上游授权：deletable=false，blockers 列出原因", async () => {
    const { router } = makeRouter({
      status: "active",
      footprint: { billing: true },
    });
    fetchGrants.mockResolvedValue(grants(3, 0));

    const impact = await router.deletionPreview(makeReq(), PRODUCT_ID);

    expect(impact.deletable).toBe(false);
    expect(impact.blockers).toContain("HAS_BILLING");
    expect(impact.blockers).toContain("HAS_UPSTREAM_ATLAS");
    expect(impact.upstreamAtlas).toBe(3);
  });

  it("产品不存在 → 404", async () => {
    const { router } = makeRouter({ status: null });
    const { status } = await failure(
      router.deletionPreview(makeReq(), PRODUCT_ID),
    );
    expect(status).toBe(404);
  });
});
