/**
 * products-plan-publishing.spec.ts - the plan publishing desk endpoints
 * @package  @vxture/bff-admin
 * @layer    Application
 * @category test
 * @description
 *   Locks the publishing-desk contract (90-plan-publishing.md): the matrix
 *   read model groups plans onto each sellable product's five-tier ladder;
 *   plan creation authorizes and validates before DB, refuses an occupied
 *   tier slot with 409 and maps a plan_code unique violation to 409; opening
 *   a draft version refuses a second in-flight draft and clones components +
 *   prices from the current version; publish refuses a tier slot whose
 *   current-published position is held by another plan. Every transactional
 *   failure must roll back and release its client.
 *
 * @author AI-Generated
 * @date 2026-09-01
 */
import { describe, it, expect } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ProductsRouter } from "./products.router";
import {
  MANAGE,
  makeReq,
  makeTxClient,
  noDbPool,
  readerOf,
  type Responder,
} from "../testing/pool-mocks";

// ============================================================================
// Fixtures
// ============================================================================

const PLAN_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

const PRODUCT_ROW = {
  id: "p-karda",
  product_code: "karda",
  standalone_subscribable: true,
};

const CREATE_BODY = {
  planCode: "karda-starter",
  planName: "Karda Starter",
  productCode: "karda",
  tier: "starter",
};

/** RO row for loadPlanVersionDetail after a committed write. */
const DETAIL_ROW = {
  id: VERSION_ID,
  plan_id: PLAN_ID,
  version_no: 1,
  status: "draft",
  is_locked: false,
  is_current: false,
  created_at: "2026-09-01T00:00:00Z",
  plan_code: "karda-starter",
  plan_name: "Karda Starter",
  prices: [],
  components: [
    {
      productCode: "karda",
      productName: "Karda",
      componentRole: "primary",
      tier: "starter",
      quota: {},
      features: [],
      priority: 100,
    },
  ],
};

/** Happy-path responder for createPlan's transaction. */
function createPlanResponder(overrides?: Responder): Responder {
  return (sql, params) => {
    const custom = overrides?.(sql, params);
    if (custom) return custom;
    if (sql.includes("standalone_subscribable") && sql.includes("for update"))
      return [PRODUCT_ROW];
    if (sql.includes("axis.tier = $2")) return [];
    if (sql.includes("insert into product.plans")) return [{ id: PLAN_ID }];
    if (sql.includes("insert into product.plan_versions"))
      return [{ id: VERSION_ID }];
    return [];
  };
}

/** Happy-path responder for createDraftVersion's transaction. */
function draftVersionResponder(overrides?: Responder): Responder {
  return (sql, params) => {
    const custom = overrides?.(sql, params);
    if (custom) return custom;
    if (sql.includes("current_version_id") && sql.includes("for update"))
      return [
        { id: PLAN_ID, plan_code: "karda-starter", current_version_id: "v1" },
      ];
    if (sql.includes("status = 'draft' and not is_locked")) return [];
    if (sql.includes("max(version_no)"))
      return [
        {
          id: "v1",
          version_no: 1,
          trial_cycle_unit: null,
          trial_cycle_count: null,
          max_no: 3,
        },
      ];
    if (sql.includes("insert into product.plan_versions"))
      return [{ id: VERSION_ID }];
    return [];
  };
}

// ============================================================================
// Matrix read model
// ============================================================================

describe("plan matrix — read model", () => {
  it("rejects a caller without platform.product.manage before DB", async () => {
    const ro = noDbPool();
    const router = new ProductsRouter(ro.pool, noDbPool().pool);
    await expect(
      router.listPlanMatrix(makeReq(["platform.product.read"])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("groups plans under their product and keeps planless products with an empty ladder", async () => {
    const rows = [
      // Product with no plans: single row, plan columns NULL.
      {
        product_code: "arda",
        product_name: "Arda",
        product_status: "active",
        plan_id: null,
        plan_code: null,
        plan_name: null,
        plan_status: null,
        tier: null,
        current_version_id: null,
        current_version_no: null,
        current_prices: null,
        draft_version_id: null,
        draft_version_no: null,
        version_count: null,
      },
      // Product with a published plan carrying an in-flight draft.
      {
        product_code: "karda",
        product_name: "Karda",
        product_status: "active",
        plan_id: PLAN_ID,
        plan_code: "karda-pro",
        plan_name: "Karda Pro",
        plan_status: "active",
        tier: "pro",
        current_version_id: "cv-1",
        current_version_no: 3,
        current_prices: [{ cycleUnit: "month", price: "199.00" }],
        draft_version_id: "d-1",
        draft_version_no: 4,
        version_count: 4,
      },
    ];
    const router = new ProductsRouter(readerOf(rows), noDbPool().pool);
    const matrix = await router.listPlanMatrix(makeReq(MANAGE));

    expect(matrix).toHaveLength(2);
    const arda = matrix.find((p) => p.productCode === "arda");
    expect(arda?.plans).toEqual([]);

    const karda = matrix.find((p) => p.productCode === "karda");
    expect(karda?.plans).toHaveLength(1);
    expect(karda?.plans[0]).toMatchObject({
      planCode: "karda-pro",
      tier: "pro",
      currentVersion: {
        id: "cv-1",
        versionNo: 3,
        prices: [{ cycleUnit: "month", price: "199.00" }],
      },
      draftVersion: { id: "d-1", versionNo: 4 },
      versionCount: 4,
    });
  });
});

// ============================================================================
// Plan creation
// ============================================================================

describe("plan creation — pre-DB guards", () => {
  it("rejects a caller without platform.product.manage", async () => {
    const rw = noDbPool();
    const router = new ProductsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.createPlan(makeReq([]), CREATE_BODY),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rw.connect).not.toHaveBeenCalled();
  });

  it.each([
    ["bad plan code", { ...CREATE_BODY, planCode: "Karda Starter!" }],
    ["missing name", { ...CREATE_BODY, planName: "" }],
    ["unknown tier", { ...CREATE_BODY, tier: "platinum" }],
    ["missing product", { ...CREATE_BODY, productCode: "" }],
  ])("400 on %s, before any DB access", async (_, body) => {
    const rw = noDbPool();
    const router = new ProductsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.createPlan(makeReq(MANAGE), body),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rw.connect).not.toHaveBeenCalled();
  });
});

describe("plan creation — transactional rules", () => {
  it("404 with `field` + rollback on an unknown product", async () => {
    const tx = makeTxClient(() => []);
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.createPlan(makeReq(MANAGE), CREATE_BODY),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.outcome()).toEqual({
      committed: false,
      rolledBack: true,
      released: true,
    });
  });

  it("400 + rollback on a product that is not standalone-subscribable", async () => {
    const tx = makeTxClient(
      createPlanResponder((sql) =>
        sql.includes("standalone_subscribable") && sql.includes("for update")
          ? [{ ...PRODUCT_ROW, standalone_subscribable: false }]
          : undefined,
      ),
    );
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.createPlan(makeReq(MANAGE), CREATE_BODY),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.outcome().rolledBack).toBe(true);
  });

  it("409 + rollback when the tier slot is already occupied, nothing inserted", async () => {
    const tx = makeTxClient(
      createPlanResponder((sql) =>
        sql.includes("axis.tier = $2")
          ? [{ plan_code: "karda-starter-old" }]
          : undefined,
      ),
    );
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.createPlan(makeReq(MANAGE), CREATE_BODY),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.outcome().rolledBack).toBe(true);
    expect(tx.calls.some((c) => c.includes("INSERT INTO"))).toBe(false);
  });

  it("creates plan + v1 draft + primary component + audit in one committed unit", async () => {
    const tx = makeTxClient(createPlanResponder());
    const router = new ProductsRouter(readerOf([DETAIL_ROW]), tx.pool);
    const detail = await router.createPlan(makeReq(MANAGE), CREATE_BODY);

    expect(tx.outcome()).toEqual({
      committed: true,
      rolledBack: false,
      released: true,
    });
    expect(
      tx.calls.filter((c) => c.includes("INSERT INTO product.plans")),
    ).toHaveLength(1);
    expect(
      tx.calls.filter((c) => c.includes("INSERT INTO product.plan_versions")),
    ).toHaveLength(1);
    const componentInsert = tx.calls.find((c) =>
      c.includes("INSERT INTO product.plan_components"),
    );
    expect(componentInsert).toContain("'primary'");
    expect(
      tx.calls.some((c) =>
        c.toLowerCase().includes("insert into support.audit_logs"),
      ),
    ).toBe(true);
    expect(detail.planCode).toBe("karda-starter");
  });

  it("maps a plan_code unique violation to 409", async () => {
    const tx = makeTxClient((sql, params) => {
      if (sql.includes("insert into product.plans")) {
        const err = new Error("duplicate key") as Error & { code: string };
        err.code = "23505";
        throw err;
      }
      return createPlanResponder()(sql, params);
    });
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.createPlan(makeReq(MANAGE), CREATE_BODY),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.outcome().rolledBack).toBe(true);
  });
});

// ============================================================================
// Draft version creation
// ============================================================================

describe("draft version creation", () => {
  it("404 + rollback on an unknown plan", async () => {
    const tx = makeTxClient(() => []);
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.createDraftVersion(makeReq(MANAGE), PLAN_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.outcome().rolledBack).toBe(true);
  });

  it("409 when a draft is already in flight — one draft per plan", async () => {
    const tx = makeTxClient(
      draftVersionResponder((sql) =>
        sql.includes("status = 'draft' and not is_locked")
          ? [{ version_no: 4 }]
          : undefined,
      ),
    );
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.createDraftVersion(makeReq(MANAGE), PLAN_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.outcome().rolledBack).toBe(true);
  });

  it("clones components + prices from the source and numbers the draft max+1", async () => {
    const tx = makeTxClient(draftVersionResponder());
    const router = new ProductsRouter(readerOf([DETAIL_ROW]), tx.pool);
    await router.createDraftVersion(makeReq(MANAGE), PLAN_ID);

    expect(tx.outcome().committed).toBe(true);
    const versionInsert = tx.calls.findIndex((c) =>
      c.includes("INSERT INTO product.plan_versions"),
    );
    expect(versionInsert).toBeGreaterThan(-1);
    // version_no parameter = max(3) + 1
    expect(tx.params[versionInsert]).toContain(4);
    expect(
      tx.calls.some(
        (c) =>
          c.includes("INSERT INTO product.plan_components") &&
          c.includes("SELECT"),
      ),
    ).toBe(true);
    expect(
      tx.calls.some(
        (c) =>
          c.includes("INSERT INTO product.plan_prices") && c.includes("SELECT"),
      ),
    ).toBe(true);
    expect(
      tx.calls.some((c) =>
        c.toLowerCase().includes("insert into support.audit_logs"),
      ),
    ).toBe(true);
  });
});

// ============================================================================
// Publish tier-occupancy guard
// ============================================================================

describe("publish — tier occupancy guard", () => {
  it("409 + rollback when another plan's current published version holds the slot", async () => {
    const tx = makeTxClient((sql) => {
      if (sql.includes("from product.plan_versions where id = $1 for update"))
        return [{ plan_id: "plan-a", status: "draft" }];
      // Order matters: the clash query also mentions component_role='primary'.
      if (sql.includes("cv2.status = 'published'"))
        return [{ plan_code: "karda-pro-old" }];
      if (sql.includes("component_role = 'primary'") && sql.includes("limit 1"))
        return [{ product_id: "p-karda", tier: "pro" }];
      return [];
    });
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.publishPlanVersion(makeReq(MANAGE), VERSION_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.outcome().rolledBack).toBe(true);
    expect(tx.calls.some((c) => c.includes("SET status = 'published'"))).toBe(
      false,
    );
  });

  it("publishes when the slot is free: freeze + current pointer + commit", async () => {
    const tx = makeTxClient((sql) => {
      if (sql.includes("from product.plan_versions where id = $1 for update"))
        return [{ plan_id: "plan-a", status: "draft" }];
      // Order matters: the clash query also mentions component_role='primary'.
      if (sql.includes("cv2.status = 'published'")) return [];
      if (sql.includes("component_role = 'primary'") && sql.includes("limit 1"))
        return [{ product_id: "p-karda", tier: "pro" }];
      return [];
    });
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    const result = await router.publishPlanVersion(makeReq(MANAGE), VERSION_ID);

    expect(result).toEqual({ published: true, versionId: VERSION_ID });
    expect(tx.outcome().committed).toBe(true);
    expect(tx.calls.some((c) => c.includes("SET status = 'published'"))).toBe(
      true,
    );
    expect(tx.calls.some((c) => c.includes("SET current_version_id"))).toBe(
      true,
    );
  });
});
