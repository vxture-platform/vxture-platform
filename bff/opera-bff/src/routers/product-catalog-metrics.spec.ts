/**
 * product-catalog-metrics.spec.ts —— 产品计量指标的两道闸门（2026-09-11，批 2）。
 *
 * 这两道在库里都有强制，但**冒上来都是 500**，运营者只看到「保存失败 / 删除失败」：
 *
 *   · 登记：L0 平台共享键不许被产品级重新定义（95 的
 *     `trg_product_metrics_no_platform_shadow`，抛 check_violation + 一句英文内部
 *     消息，还点名一份运营者没见过的文档编号）。
 *   · 退掉：`product_metrics` 上**没有任何外键指向它**（实测 pg_constraint 零行），
 *     套餐组件按 `quota` jsonb 的**键名**引用指标。没有 FK 不是更安全而是更危险
 *     ——删掉定义之后组件上那个键还在，只是再也解析不出池的形状，**不报错、不回滚、
 *     什么都不会发生**，直到某个客户的额度对不上。
 *
 * 三条判据各自的失败方式都是静默的，所以钉在这里：
 *
 *   1. 平台键 → 409 `CATALOG_METRIC_KEY_IS_PLATFORM_OWNED`，一行都没写。
 *   2. `reserved` 的平台键**同样拦**——判据里不带 status 过滤，与触发器逐字一致。
 *   3. 被套餐引用的指标 → 409 `CATALOG_METRIC_IN_USE`，点名是哪几档，DELETE 没执行。
 */
import { HttpException } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { VxConfigService } from "@vxture/core-config";
import type { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { RequestContext } from "../types/request-context";

vi.mock("@vxture/core-config", () => ({
  VxConfigService: class VxConfigService {},
}));

import { ProductCatalogRouter } from "./product-catalog.router";

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-00000000000a";

function makeReq(): Request & RequestContext {
  return {
    operator: { id: "op-1", displayName: null },
    capabilities: ["platform:product.manage"],
    operatorAccessToken: "operator-access-token",
    headers: {},
  } as unknown as Request & RequestContext;
}

interface PoolOpts {
  /** `product.platform_metrics` 里命中的行（空 = 这个键不是平台键）。 */
  readonly platformRows?: ReadonlyArray<{ status: string | null }>;
  /** 引用该指标的套餐档位。 */
  readonly inUseRows?: ReadonlyArray<{ plan_name: string; tier: string }>;
}

function makePool({ platformRows = [], inUseRows = [] }: PoolOpts = {}) {
  /** 记下真的执行过哪些写——「拦住了」等于写没发生，只看状态码会漏掉「报了也写了」。 */
  const writes: string[] = [];
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (/FROM product\.products WHERE id/.test(sql)) {
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      }
      if (/FROM product\.platform_metrics/.test(sql)) {
        return { rows: platformRows, rowCount: platformRows.length };
      }
      if (/FROM product\.plan_components/.test(sql)) {
        return { rows: inUseRows, rowCount: inUseRows.length };
      }
      if (/INSERT INTO product\.product_metrics/.test(sql)) {
        writes.push("insert");
        return {
          rows: [
            {
              metric_key: "doc.words",
              merge_strategy: "pool",
              consume_mode: "divisible",
              metric_unit: "words",
              reset_period: "month",
            },
          ],
          rowCount: 1,
        };
      }
      if (/DELETE FROM product\.product_metrics/.test(sql)) {
        writes.push("delete");
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }),
  };
  return { pool: pool as unknown as Pool, writes };
}

function makeRouter(opts: PoolOpts = {}) {
  const { pool, writes } = makePool(opts);
  const router = new ProductCatalogRouter(
    pool,
    {
      platform: {
        ATLAS_API_URL: "http://atlas.test/",
        RUNOS_API_URL: "http://runos.test/",
      },
    } as unknown as VxConfigService,
    {
      getToken: vi.fn(async () => "obo"),
    } as unknown as OperatorExchangeService,
  );
  return { router, writes };
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

/** PUT 的 body——指标键在路径上，不在这里。 */
const POOL_BODY = {
  mergeStrategy: "pool",
  consumeMode: "divisible",
  metricUnit: "words",
  resetPeriod: "month",
};

describe("登记指标：L0 平台共享键不许被重新定义", () => {
  it("命中平台键 → 409，且一行都没写", async () => {
    const { router, writes } = makeRouter({
      platformRows: [{ status: "active" }],
    });
    const { status, body } = await failure(
      router.putMetric(makeReq(), PRODUCT_ID, "ai.credit", POOL_BODY),
    );
    expect(status).toBe(409);
    expect(body["code"]).toBe("CATALOG_METRIC_KEY_IS_PLATFORM_OWNED");
    expect(writes).toEqual([]);
  });

  /**
   * **这一条是整份 spec 最要紧的。** 触发器的条件是「按 metric_key 存在即拦」，
   * 不带 status 过滤；库里六个平台键有四个是 `reserved`。前置校验若按直觉写成
   * `status = 'active'`，这四个仍会 500——而那是最难查的形态：界面看起来做了校验，
   * 偏偏对一半的键失效。
   */
  it("reserved 的平台键同样拦——判据里没有 status 过滤", async () => {
    const { router, writes } = makeRouter({
      platformRows: [{ status: "reserved" }],
    });
    const { status, body } = await failure(
      router.putMetric(makeReq(), PRODUCT_ID, "compute.cpu", POOL_BODY),
    );
    expect(status).toBe(409);
    expect(body["code"]).toBe("CATALOG_METRIC_KEY_IS_PLATFORM_OWNED");
    expect(String(body["message"])).toContain("已保留");
    expect(writes).toEqual([]);
  });

  it("不是平台键 → 照常登记（否则这道闸是「全拦」不是「拦对」）", async () => {
    const { router, writes } = makeRouter({ platformRows: [] });
    const result = await router.putMetric(
      makeReq(),
      PRODUCT_ID,
      "doc.words",
      POOL_BODY,
    );
    expect(result.metricKey).toBe("doc.words");
    expect(writes).toEqual(["insert"]);
  });
});

describe("退掉指标：还被套餐引用时不许退", () => {
  it("有引用 → 409 并点名是哪几档，DELETE 没执行", async () => {
    const { router, writes } = makeRouter({
      inUseRows: [
        { plan_name: "Arda Pro", tier: "pro" },
        { plan_name: "Arda Free", tier: "free" },
      ],
    });
    const { status, body } = await failure(
      router.deleteMetric(makeReq(), PRODUCT_ID, "doc.words"),
    );
    expect(status).toBe(409);
    expect(body["code"]).toBe("CATALOG_METRIC_IN_USE");
    /* 「还被 2 个套餐引用」说不出去哪儿解开——要的是档位名。 */
    expect(String(body["message"])).toContain("Arda Pro");
    expect(String(body["message"])).toContain("Arda Free");
    /* 已发布的套餐版本不可变，所以补救办法是开新版本不是改现有的。 */
    expect(String(body["message"])).toContain("新的套餐版本");
    expect(writes).toEqual([]);
  });

  it("没有引用 → 照常退掉", async () => {
    const { router, writes } = makeRouter({ inUseRows: [] });
    const result = await router.deleteMetric(
      makeReq(),
      PRODUCT_ID,
      "doc.words",
    );
    expect(result.deleted).toBe(true);
    expect(writes).toEqual(["delete"]);
  });
});
