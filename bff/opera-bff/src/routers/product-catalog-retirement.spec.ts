/**
 * product-catalog-retirement.spec.ts —— 产品退役闸门（2026-08-31，owner 优先级 #1）。
 *
 * `PATCH /api/products/:id/state` 写 `deprecated` 之前必须问两个上游「这个产品还有
 * 没有生效中的授权」。这条闸门的失败方式全是静默的：闸门没挂、挂错了边、或者
 * 上游读失败被当成「没有」——每一种都表现为「退役成功」，日志里一个字都没有。
 * 所以钉在这里：
 *
 *   1. 有生效授权 → 409 `PRODUCT_HAS_ACTIVE_GRANTS`，体里带两边的条数与样本；
 *      **事务一次都没开**（检查在 RW 事务之外）。
 *   2. 两边都是零 → 放行，状态写成 deprecated。
 *   3. 上游读不到 → 502 `UPSTREAM_UNAVAILABLE`，同样不开事务、不写库。
 *   4. 其它迁移（停用 / 恢复 / 上线）一次上游都不打——闸门只挂在 deprecated 这条边。
 *   5. 已退役产品重放 deprecated 是幂等空操作，不打上游。
 *
 * 上游那一次读（`lib/upstream-grants.ts`）整个换成桩：它自己的形状由
 * `upstream-grants.spec.ts` 钉；这里只关心 router 怎么用它的结果。
 */
import { HttpException } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VxConfigService } from "@vxture/core-config";
import type { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { RequestContext } from "../types/request-context";
import type { ActiveUpstreamGrants } from "../lib/upstream-grants";

/* 路由文件把 `VxConfigService` 当 DI 令牌（`@Inject(VxConfigService)`），所以它是
   运行时引用；`@vxture/core-config` 的入口指向 dist，这里给一个空类顶替令牌位，
   免得单测依赖一次 workspace 构建（同 admin-bff `runos.router.spec.ts` 的做法）。 */
vi.mock("@vxture/core-config", () => ({
  VxConfigService: class VxConfigService {},
}));

/* 只桩掉那一次上游读，`upstreamCheckUnavailable` 用真的——502 的形状不该在这里
   重新发明一遍。 */
vi.mock("../lib/upstream-grants", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/upstream-grants")>();
  return { ...actual, fetchActiveUpstreamGrants: vi.fn() };
});

import {
  fetchActiveUpstreamGrants,
  upstreamCheckUnavailable,
} from "../lib/upstream-grants";
import { ProductCatalogRouter } from "./product-catalog.router";

const fetchGrants = vi.mocked(fetchActiveUpstreamGrants);

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-000000000001";

function makeReq(): Request & RequestContext {
  return {
    operator: { id: "op-1", displayName: null },
    capabilities: ["platform:product.manage"],
    operatorAccessToken: "operator-access-token",
  } as unknown as Request & RequestContext;
}

/** 一整行产品，`RETURNING ${SELECT_COLUMNS}` 要用。 */
function productRow(status: string) {
  return {
    id: PRODUCT_ID,
    product_code: "karda",
    product_type: "agent",
    category_id: null,
    product_name: "Karda",
    product_nick: null,
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

/**
 * 假的 pg pool：`pool.query` 服务闸门的预读，`pool.connect()` 给出的 client 服务
 * 状态机那段事务。记下写进去的状态与事务有没有开过——后者正是「检查在事务之外」
 * 这条断言要看的。
 */
function makePool(currentStatus: string | null) {
  const writes: string[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (/SELECT status/.test(sql)) {
        return { rows: currentStatus ? [{ status: currentStatus }] : [] };
      }
      if (/UPDATE product\.products/.test(sql)) {
        const next = String(params?.[0]);
        writes.push(next);
        return { rows: [productRow(next)] };
      }
      throw new Error(`unexpected client sql: ${sql}`);
    }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (/SELECT product_code, status/.test(sql)) {
        return {
          rows: currentStatus
            ? [{ product_code: "karda", status: currentStatus }]
            : [],
          rowCount: currentStatus ? 1 : 0,
        };
      }
      throw new Error(`unexpected pool sql: ${sql}`);
    }),
    connect: vi.fn(async () => client),
  };
  return { pool: pool as unknown as Pool, connect: pool.connect, writes };
}

function makeRouter(currentStatus: string | null) {
  const { pool, connect, writes } = makePool(currentStatus);
  const config = {
    platform: {
      ATLAS_API_URL: "http://atlas.test/",
      RUNOS_API_URL: "http://runos.test/",
    },
  } as unknown as VxConfigService;
  const router = new ProductCatalogRouter(pool, config, {
    getToken: vi.fn(async () => "obo"),
  } as unknown as OperatorExchangeService);
  return { router, connect, writes };
}

function grants(atlasCount: number, runosCount: number): ActiveUpstreamGrants {
  return {
    productCode: "karda",
    atlas: {
      count: atlasCount,
      sample: atlasCount
        ? [{ id: "a-1", endpointCode: "chat/default", expiresAt: null }]
        : [],
    },
    runos: {
      count: runosCount,
      sample: runosCount
        ? [
            {
              grantId: "g-1",
              capabilityId: "arda.invoice-query",
              grantType: "direct",
            },
          ]
        : [],
    },
  };
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

beforeEach(() => {
  fetchGrants.mockReset();
});

describe("退役闸门：目标态 deprecated", () => {
  it("上游还有生效授权 → 409 PRODUCT_HAS_ACTIVE_GRANTS，带两边条数与样本；事务没开、库没写", async () => {
    const { router, connect, writes } = makeRouter("active");
    fetchGrants.mockResolvedValue(grants(2, 1));

    const { status, body } = await failure(
      router.setState(makeReq(), PRODUCT_ID, { state: "deprecated" }),
    );

    expect(status).toBe(409);
    expect(body["code"]).toBe("PRODUCT_HAS_ACTIVE_GRANTS");
    expect(body["retryable"]).toBe(false);
    expect(body["productCode"]).toBe("karda");
    expect(body["atlas"]).toEqual({
      count: 2,
      sample: [{ id: "a-1", endpointCode: "chat/default", expiresAt: null }],
    });
    expect((body["runos"] as { count: number }).count).toBe(1);
    expect(String(body["message"])).toContain("Atlas 2 条");
    expect(String(body["message"])).toContain("Runos 1 条");

    expect(connect).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("只有一边有授权也拦（Runos 0 / Atlas 1）", async () => {
    const { router } = makeRouter("inactive");
    fetchGrants.mockResolvedValue(grants(1, 0));
    const { status } = await failure(
      router.setState(makeReq(), PRODUCT_ID, { state: "deprecated" }),
    );
    expect(status).toBe(409);
  });

  it("草稿也走闸门：草稿期发出去的授权同样是挂在产品码上的活授权", async () => {
    const { router } = makeRouter("draft");
    fetchGrants.mockResolvedValue(grants(0, 3));
    const { status } = await failure(
      router.setState(makeReq(), PRODUCT_ID, { state: "deprecated" }),
    );
    expect(status).toBe(409);
  });

  it("两边都为零 → 放行，写成 deprecated；上游读用的是这个产品的产品码", async () => {
    const { router, writes } = makeRouter("active");
    fetchGrants.mockResolvedValue(grants(0, 0));

    const result = await router.setState(makeReq(), PRODUCT_ID, {
      state: "deprecated",
    });

    expect(result.state).toBe("deprecated");
    expect(writes).toEqual(["deprecated"]);
    expect(fetchGrants).toHaveBeenCalledTimes(1);
    const [deps, , code] = fetchGrants.mock.calls[0]!;
    expect(code).toBe("karda");
    /* 基址去掉尾部斜杠——否则拼出 `//capability`。 */
    expect(deps.atlasApiUrl).toBe("http://atlas.test");
    expect(deps.runosApiUrl).toBe("http://runos.test");
  });

  it("上游读不到 → 502 UPSTREAM_UNAVAILABLE 原样出去（fail closed）；不开事务、不写库", async () => {
    const { router, connect, writes } = makeRouter("active");
    fetchGrants.mockRejectedValue(
      upstreamCheckUnavailable("runos", new Error("ECONNREFUSED")),
    );

    const { status, body } = await failure(
      router.setState(makeReq(), PRODUCT_ID, { state: "deprecated" }),
    );

    expect(status).toBe(502);
    expect(body["code"]).toBe("UPSTREAM_UNAVAILABLE");
    expect(body["upstream"]).toBe("runos");
    expect(connect).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("产品不存在 → 404，一次上游都不打", async () => {
    const { router } = makeRouter(null);
    const { status, body } = await failure(
      router.setState(makeReq(), PRODUCT_ID, { state: "deprecated" }),
    );
    expect(status).toBe(404);
    expect(body["code"]).toBe("CATALOG_PRODUCT_NOT_FOUND");
    expect(fetchGrants).not.toHaveBeenCalled();
  });

  it("已退役产品重放 deprecated：幂等空操作，不打上游", async () => {
    const { router, writes } = makeRouter("deprecated");
    const result = await router.setState(makeReq(), PRODUCT_ID, {
      state: "deprecated",
    });
    expect(result.state).toBe("deprecated");
    expect(fetchGrants).not.toHaveBeenCalled();
    /* 状态机那段原本就对 from === next 写一次同值 UPDATE（幂等），这里不改它。 */
    expect(writes).toEqual(["deprecated"]);
  });
});

describe("其它迁移不受影响", () => {
  it.each([
    ["active", "inactive"],
    ["inactive", "active"],
    ["draft", "active"],
  ])("%s → %s 不打上游，照常写库", async (from, to) => {
    const { router, writes } = makeRouter(from);
    const result = await router.setState(makeReq(), PRODUCT_ID, { state: to });
    expect(result.state).toBe(to);
    expect(writes).toEqual([to]);
    expect(fetchGrants).not.toHaveBeenCalled();
  });

  it("非法迁移（draft → inactive）仍是 409 CATALOG_INVALID_STATE_TRANSITION，与闸门无关", async () => {
    const { router, writes } = makeRouter("draft");
    const { status, body } = await failure(
      router.setState(makeReq(), PRODUCT_ID, { state: "inactive" }),
    );
    expect(status).toBe(409);
    expect(body["code"]).toBe("CATALOG_INVALID_STATE_TRANSITION");
    expect(writes).toEqual([]);
    expect(fetchGrants).not.toHaveBeenCalled();
  });

  it("没有 platform:product.manage → 403，闸门之前就停", async () => {
    const { router } = makeRouter("active");
    const req = {
      operator: { id: "op-1", displayName: null },
      capabilities: ["platform:product.read"],
    } as unknown as Request & RequestContext;
    const { status } = await failure(
      router.setState(req, PRODUCT_ID, { state: "deprecated" }),
    );
    expect(status).toBe(403);
    expect(fetchGrants).not.toHaveBeenCalled();
  });
});
