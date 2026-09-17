/**
 * products-release-stage.spec.ts —— 成熟度只向前走（2026-09-17）。
 *
 * 此前 `PATCH capabilities/:code/content` 只校 `isValidReleaseStage`（枚举合法），于是
 * `ga → developing` 这种倒退照写。它**没有任何外在症状**：接口回 200，而官网当场把
 * 一个已发布产品的订阅入口换成「敬请期待」——要等到客户问「为什么买不了了」才有人发现。
 *
 * 钉三件：
 *  1. 倒退 → 409，且**一行都没写**（只看状态码会漏掉「报了也写了」），连审计行也不该有。
 *  2. 同态重放放行——反复保存同一张表单是常事，把它当非法迁移会把编辑框卡死。
 *  3. 向前（含跨级）照写。
 *
 * 判据本体在 `@vxture/core-utils` 的 `isForwardReleaseStageMove`（那边另有单测）；
 * 这里钉的是「路由真的调了它，且拒绝发生在写之前」。
 */
import { describe, it, expect } from "vitest";
import { ConflictException } from "@nestjs/common";

import { ProductsRouter } from "./products.router";
import { MANAGE, makeReq, makeTxClient, noDbPool } from "../testing/pool-mocks";

/** `SELECT ... FOR UPDATE` 读回的改前行。 */
function lockRow(stage: string) {
  return {
    id: "p-1",
    release_stage: stage,
    is_customer_visible: true,
    marketing: null,
  };
}

/** 只读侧：放行路径末尾会走 `loadProductCapabilities`。 */
function catalogReader() {
  return {
    query: async () => ({
      rows: [
        {
          id: "p-1",
          product_code: "vxtpl",
          product_type: "general_agent",
          origin: "self",
          release_stage: "ga",
          marketing: null,
          product_name: "专注训练智能体",
          description: null,
          status: "active",
          is_customer_visible: true,
          is_workforce_visible: true,
          tags: [],
          category_code: null,
          plan_count: 0,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
        },
      ],
    }),
  } as never;
}

describe("PATCH capabilities/:code/content · 成熟度状态机", () => {
  it("ga → developing 倒退：409，且一行都没写", async () => {
    const tx = makeTxClient((sql) =>
      sql.includes("for update") ? [lockRow("ga")] : [],
    );
    const router = new ProductsRouter(noDbPool().pool, tx.pool);

    await expect(
      router.updateProductContent(makeReq(MANAGE), "vxtpl", {
        releaseStage: "developing",
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.outcome()).toEqual({
      committed: false,
      rolledBack: true,
      released: true,
    });
    /* 「拒绝了」等于写没发生——连审计行都不该有。 */
    expect(tx.calls.some((c) => /UPDATE product\.products/i.test(c))).toBe(
      false,
    );
    expect(tx.calls.some((c) => /audit_logs/i.test(c))).toBe(false);
  });

  it("beta → developing 也是倒退：同样 409", async () => {
    const tx = makeTxClient((sql) =>
      sql.includes("for update") ? [lockRow("beta")] : [],
    );
    const router = new ProductsRouter(noDbPool().pool, tx.pool);

    await expect(
      router.updateProductContent(makeReq(MANAGE), "vxtpl", {
        releaseStage: "developing",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.calls.some((c) => /UPDATE product\.products/i.test(c))).toBe(
      false,
    );
  });

  it("同态重放（ga → ga）：放行并提交", async () => {
    const tx = makeTxClient((sql) =>
      sql.includes("for update") ? [lockRow("ga")] : [],
    );
    const router = new ProductsRouter(catalogReader(), tx.pool);

    await router.updateProductContent(makeReq(MANAGE), "vxtpl", {
      releaseStage: "ga",
    });

    expect(tx.outcome().committed).toBe(true);
    expect(tx.calls.some((c) => /UPDATE product\.products/i.test(c))).toBe(
      true,
    );
  });

  it("developing → ga 跨级向前：放行", async () => {
    const tx = makeTxClient((sql) =>
      sql.includes("for update") ? [lockRow("developing")] : [],
    );
    const router = new ProductsRouter(catalogReader(), tx.pool);

    await router.updateProductContent(makeReq(MANAGE), "vxtpl", {
      releaseStage: "ga",
    });

    expect(tx.outcome().committed).toBe(true);
  });

  it("不送成熟度（只改可见性）：状态机不介入", async () => {
    const tx = makeTxClient((sql) =>
      sql.includes("for update") ? [lockRow("ga")] : [],
    );
    const router = new ProductsRouter(catalogReader(), tx.pool);

    await router.updateProductContent(makeReq(MANAGE), "vxtpl", {
      isCustomerVisible: false,
    });

    expect(tx.outcome().committed).toBe(true);
  });
});
