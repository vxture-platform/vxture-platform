/**
 * products-plan-lifecycle.spec.ts - 套餐生命周期写路径（删草稿 / 软删 / 退役）+ 两个读端点
 * @package  @vxture/bff-admin
 * @layer    Application
 * @category test
 * @description
 *   套餐发布页重做（批 A：后端先行）的写路径守卫。钉住三件最容易悄悄坏掉的事：
 *
 *   ① **所有删除都过 step-up**（owner 2026-09-18）。包括删草稿——它看着「发布前
 *      不可售、删了无害」，但闸门是给动作挂的，不按后果轻重分级。
 *   ② **软删的判据在事务内复核一遍**。预检（`GET plans/:id/deletable`）与执行之间
 *      新产生的订阅必须挡住（TOCTOU）；预检那次的结论在执行时不算数。
 *   ③ **删草稿只放行未锁的 draft**。已发布版本被 §7 三条触发器钉死，而
 *      `plan_versions` 根本没有 `deleted_at`——删就是真删，所以把 published /
 *      locked / 恰好是 current 三种情形都写成断言。
 *
 *   另钉一条改造：绑定候选**只收 L2**（L1 基础支撑不绑、L3 不能被绑、未分层一并挡）。
 *
 * @author AI-Generated
 * @date 2026-09-18
 */
import { describe, it, expect } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ProductsRouter } from "./products.router";
import { REQUIRE_STEP_UP } from "../auth/step-up.decorator";
import {
  MANAGE,
  makeReq,
  makeTxClient,
  noDbPool,
  readerOf,
  type Responder,
  insertParam,
} from "../testing/pool-mocks";

// ============================================================================
// Fixtures
// ============================================================================

const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";

/** 可删的草稿：未锁、非当前。 */
const DRAFT_ROW = {
  plan_id: PLAN_ID,
  plan_code: "karda-pro",
  version_no: 3,
  status: "draft",
  is_locked: false,
  is_current: false,
};

const PLAN_ROW = { id: PLAN_ID, plan_code: "karda-pro", status: "active" };

/** 三条判据全零 —— 从未售出，可删。 */
const CLEAN_IMPACT = {
  subscriptions: "0",
  orders: "0",
  solution_bindings: "0",
};

/**
 * 版本删除的 responder：默认给一个可删草稿。
 *
 * 分派靠 SQL 片段，所以片段必须跟实现里的文本对得上——对不上的话测试会走进
 * 别的分支、然后以「通过」的样子骗过去，那比红更糟。
 */
function versionResponder(overrides?: Responder): Responder {
  return (sql, params) => {
    const custom = overrides?.(sql, params);
    if (custom) return custom;
    if (sql.includes("for update of pv")) return [DRAFT_ROW];
    return [];
  };
}

/** 套餐删除/退役的 responder：默认一个 active 套餐 + 零足迹。 */
function planResponder(overrides?: Responder): Responder {
  return (sql, params) => {
    const custom = overrides?.(sql, params);
    if (custom) return custom;
    if (sql.includes("from product.plans") && sql.includes("for update"))
      return [PLAN_ROW];
    if (sql.includes("metering.subscriptions")) return [CLEAN_IMPACT];
    return [];
  };
}

// ============================================================================
// ① 所有删除都过 step-up（owner 2026-09-18）
// ============================================================================

describe("套餐生命周期 —— 删除一律 step-up", () => {
  it.each([
    ["deletePlanVersion", "删草稿也要过门：闸门给动作挂，不按后果轻重分级"],
    ["deletePlan", "软删套餐"],
    ["deprecatePlan", "退役：不是删除，但与 publish 同改「客户买得到什么」"],
  ] as const)("%s carries REQUIRE_STEP_UP metadata", (handler, _why) => {
    const fn = (ProductsRouter.prototype as unknown as Record<string, unknown>)[
      handler
    ];
    expect(typeof fn).toBe("function");
    expect(Reflect.getMetadata(REQUIRE_STEP_UP, fn as object)).toBe(true);
  });

  it("预检是只读路由，不挂 step-up（改不了任何东西）", () => {
    const fn = (ProductsRouter.prototype as unknown as Record<string, unknown>)[
      "planDeletable"
    ];
    expect(typeof fn).toBe("function");
    expect(Reflect.getMetadata(REQUIRE_STEP_UP, fn as object)).toBeUndefined();
  });
});

// ============================================================================
// 鉴权先于 DB
// ============================================================================

describe("套餐生命周期 —— 守卫先于 DB", () => {
  it.each([
    [
      "deletePlanVersion",
      (r: ProductsRouter) =>
        r.deletePlanVersion(makeReq(["platform.product.read"]), VERSION_ID),
    ],
    [
      "deletePlan",
      (r: ProductsRouter) =>
        r.deletePlan(makeReq(["platform.product.read"]), PLAN_ID, {
          confirm: true,
        }),
    ],
    [
      "deprecatePlan",
      (r: ProductsRouter) =>
        r.deprecatePlan(makeReq(["platform.product.read"]), PLAN_ID),
    ],
  ] as const)(
    "%s：无 platform.product.manage → 403 且没碰库",
    async (_n, call) => {
      const rw = noDbPool();
      const router = new ProductsRouter(noDbPool().pool, rw.pool);
      await expect(call(router)).rejects.toBeInstanceOf(ForbiddenException);
      expect(rw.connect).not.toHaveBeenCalled();
    },
  );

  it("deletePlan 漏了 confirm → 400，且没碰库（两步删除的第二步不该被顶穿）", async () => {
    const rw = noDbPool();
    const router = new ProductsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.deletePlan(makeReq(MANAGE), PLAN_ID, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rw.connect).not.toHaveBeenCalled();
  });
});

// ============================================================================
// ③ 删草稿：只放行未锁的 draft
// ============================================================================

describe("删草稿 —— plan_versions 没有 deleted_at，删就是真删", () => {
  it("未锁草稿：物理删 + 审计 + 提交", async () => {
    const tx = makeTxClient(versionResponder());
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    const res = await router.deletePlanVersion(makeReq(MANAGE), VERSION_ID);

    expect(res).toEqual({ deleted: true, versionId: VERSION_ID });
    expect(tx.outcome()).toEqual({
      committed: true,
      rolledBack: false,
      released: true,
    });
    const delAt = tx.calls.findIndex((c) =>
      c.includes("DELETE FROM product.plan_versions"),
    );
    expect(delAt).toBeGreaterThan(-1);
    const auditAt = tx.calls.findIndex((c) =>
      c.includes("insert into support.audit_logs"),
    );
    expect(auditAt).toBeGreaterThan(delAt);
    /* 按**列名**取，不按位置：审计表加一列就会把后面的占位符整体右移，
       而移位后 `audit[4]` 会从 resource_id 变成 resource_type，只要值凑巧相近就会
       带着错的含义继续通过（2026-09-21 实摘）。 */
    const auditSql = tx.calls[auditAt]!;
    const audit = tx.params[auditAt]!;
    expect(insertParam(auditSql, audit, "action")).toBe(
      "product.plan_version.delete",
    );
    expect(insertParam(auditSql, audit, "resource_type")).toBe(
      "product_plan_version",
    );
    /* 可视码而不是 UUID —— 审计给人看。 */
    expect(insertParam(auditSql, audit, "resource_id")).toBe("karda-pro@v3");
  });

  it.each([
    ["已发布", { status: "published", is_locked: true }],
    ["已锁的草稿", { status: "draft", is_locked: true }],
  ] as const)("%s → 409 且回滚，一行都不删", async (_n, patch) => {
    const tx = makeTxClient(
      versionResponder((sql) =>
        sql.includes("for update of pv")
          ? [{ ...DRAFT_ROW, ...patch }]
          : undefined,
      ),
    );
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.deletePlanVersion(makeReq(MANAGE), VERSION_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.outcome().rolledBack).toBe(true);
    expect(
      tx.calls.some((c) => c.includes("DELETE FROM product.plan_versions")),
    ).toBe(false);
  });

  it("恰好是套餐的当前版本 → 409（并发下指针可能刚被挪过来，不假定草稿不会是 current）", async () => {
    const tx = makeTxClient(
      versionResponder((sql) =>
        sql.includes("for update of pv")
          ? [{ ...DRAFT_ROW, is_current: true }]
          : undefined,
      ),
    );
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.deletePlanVersion(makeReq(MANAGE), VERSION_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.outcome().rolledBack).toBe(true);
  });

  it("版本不存在 → 404 且回滚", async () => {
    const tx = makeTxClient(() => []);
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.deletePlanVersion(makeReq(MANAGE), VERSION_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.outcome().rolledBack).toBe(true);
  });
});

// ============================================================================
// ② 软删套餐：卖过就不能删，且判据要在事务内复核
// ============================================================================

describe("软删套餐 —— 卖过只能退役", () => {
  it("零足迹：软删（写 deleted_at，不是物理删）+ 审计 + 提交", async () => {
    const tx = makeTxClient(planResponder());
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    const res = await router.deletePlan(makeReq(MANAGE), PLAN_ID, {
      confirm: true,
    });

    expect(res).toEqual({ deleted: true, planCode: "karda-pro" });
    expect(tx.outcome().committed).toBe(true);
    const upd = tx.calls.find((c) => c.includes("UPDATE product.plans"));
    expect(upd).toContain("deleted_at = now()");
    /* 物理删会让历史订单指向不存在的行，所以这里只能是软删。 */
    expect(tx.calls.some((c) => c.includes("DELETE FROM product.plans"))).toBe(
      false,
    );
    const auditAt = tx.calls.findIndex((c) =>
      c.includes("insert into support.audit_logs"),
    );
    expect(insertParam(tx.calls[auditAt]!, tx.params[auditAt]!, "action")).toBe(
      "product.plan.delete",
    );
    expect(
      insertParam(tx.calls[auditAt]!, tx.params[auditAt]!, "resource_id"),
    ).toBe("karda-pro");
  });

  it.each([
    ["在订阅", { subscriptions: "2" }, "HAS_SUBSCRIPTIONS"],
    ["订单历史", { orders: "5" }, "HAS_ORDERS"],
    ["方案绑定", { solution_bindings: "1" }, "HAS_SOLUTION_BINDING"],
  ] as const)(
    "有%s → 409，点名原因码且回滚（TOCTOU：预检那次放行不算数）",
    async (_n, patch, code) => {
      const tx = makeTxClient(
        planResponder((sql) =>
          sql.includes("metering.subscriptions")
            ? [{ ...CLEAN_IMPACT, ...patch }]
            : undefined,
        ),
      );
      const router = new ProductsRouter(noDbPool().pool, tx.pool);
      const error = await router
        .deletePlan(makeReq(MANAGE), PLAN_ID, { confirm: true })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toContain(code);
      expect(tx.outcome().rolledBack).toBe(true);
      expect(tx.calls.some((c) => c.includes("UPDATE product.plans"))).toBe(
        false,
      );
    },
  );

  it("套餐不存在（或已软删）→ 404 且回滚", async () => {
    const tx = makeTxClient(() => []);
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.deletePlan(makeReq(MANAGE), PLAN_ID, { confirm: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.outcome().rolledBack).toBe(true);
  });
});

// ============================================================================
// 退役：不要求无足迹 —— 卖过的套餐只有这一条路
// ============================================================================

describe("退役 —— 与软删的分工", () => {
  it("有订阅也照样退役成功（软删会 409 的那种情形，退役放行）", async () => {
    const tx = makeTxClient(
      planResponder((sql) =>
        sql.includes("metering.subscriptions")
          ? [{ ...CLEAN_IMPACT, subscriptions: "11" }]
          : undefined,
      ),
    );
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    const res = await router.deprecatePlan(makeReq(MANAGE), PLAN_ID);

    expect(res).toEqual({ deprecated: true, planCode: "karda-pro" });
    expect(tx.outcome().committed).toBe(true);
    const upd = tx.calls.find((c) => c.includes("UPDATE product.plans"));
    expect(upd).toContain("status = 'deprecated'");
    const auditAt = tx.calls.findIndex((c) =>
      c.includes("insert into support.audit_logs"),
    );
    expect(insertParam(tx.calls[auditAt]!, tx.params[auditAt]!, "action")).toBe(
      "product.plan.deprecate",
    );
  });

  it("已经退役了 → 400（同态重放不算成功）", async () => {
    const tx = makeTxClient(
      planResponder((sql) =>
        sql.includes("from product.plans") && sql.includes("for update")
          ? [{ ...PLAN_ROW, status: "deprecated" }]
          : undefined,
      ),
    );
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.deprecatePlan(makeReq(MANAGE), PLAN_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.outcome().rolledBack).toBe(true);
  });
});

// ============================================================================
// 两个读端点
// ============================================================================

describe("读端点 —— 预检与配额候选", () => {
  it("预检把判据摊开：deletable + blockers + 三个计数", async () => {
    const pool = {
      query: async (sql: string) =>
        String(sql).toLowerCase().includes("metering.subscriptions")
          ? { rows: [{ ...CLEAN_IMPACT, orders: "3" }] }
          : { rows: [{ plan_code: "karda-pro" }] },
    } as never;
    const router = new ProductsRouter(pool, noDbPool().pool);
    const impact = await router.planDeletable(makeReq(MANAGE), PLAN_ID);

    expect(impact.deletable).toBe(false);
    expect(impact.blockers).toEqual(["HAS_ORDERS"]);
    expect(impact.orders).toBe(3);
    expect(impact.subscriptions).toBe(0);
  });

  it("预检：套餐不存在 → 404", async () => {
    const router = new ProductsRouter(readerOf([]), noDbPool().pool);
    await expect(
      router.planDeletable(makeReq(MANAGE), PLAN_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("配额候选：平台键与产品键归一成一份清单，reserved 照回但标出来", async () => {
    const pool = {
      query: async (sql: string) =>
        String(sql).toLowerCase().includes("from product.products")
          ? { rows: [{ id: "p-karda" }] }
          : {
              rows: [
                {
                  metric_key: "ai.credit",
                  scope: "platform",
                  kind: "counter",
                  merge_strategy: null,
                  consume_mode: "atomic",
                  metric_unit: "credits",
                  reset_period: "month",
                  reserved: false,
                },
                {
                  metric_key: "compute.gpu",
                  scope: "platform",
                  kind: null,
                  merge_strategy: null,
                  consume_mode: null,
                  metric_unit: null,
                  reset_period: "none",
                  reserved: true,
                },
                {
                  metric_key: "karda.ingest",
                  scope: "product",
                  kind: null,
                  merge_strategy: "pool",
                  consume_mode: "divisible",
                  metric_unit: "docs",
                  reset_period: "month",
                  reserved: false,
                },
              ],
            },
    } as never;
    const router = new ProductsRouter(pool, noDbPool().pool);
    const options = await router.listMetricOptions(makeReq(MANAGE), "karda");

    expect(options.map((o) => [o.metricKey, o.scope, o.reserved])).toEqual([
      ["ai.credit", "platform", false],
      ["compute.gpu", "platform", true],
      ["karda.ingest", "product", false],
    ]);
    /* 平台键带 kind 不带 merge_strategy，产品键反之——两张表形状不同，归一时不能互串。 */
    expect(options[0]!.kind).toBe("counter");
    expect(options[0]!.mergeStrategy).toBeNull();
    expect(options[2]!.kind).toBeNull();
    expect(options[2]!.mergeStrategy).toBe("pool");
  });

  it("配额候选：产品不存在 → 404 带 field", async () => {
    const router = new ProductsRouter(readerOf([]), noDbPool().pool);
    const error = await router
      .listMetricOptions(makeReq(MANAGE), "ghost")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      field: "productCode",
    });
  });
});
