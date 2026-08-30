/**
 * products-bundled-components.spec.ts - PUT /plan-versions/:id/bundled-components
 * @package  @vxture/bff-admin
 * @layer    Application
 * @category test
 * @description
 *   Write-path guard for the bundled component replace endpoint (owner decision
 *   2026-08-30: infrastructure quota reaches a workspace only via bundled
 *   components inside a subscription product's plan version). Locks the same
 *   contract as the solution write specs: authorize before DB, validate before
 *   DB, 409 on a frozen version, 404 (with `field`) on an unknown product, 400
 *   on primary-as-bundled / duplicates, full replace = delete + insert + audit
 *   in one committed unit, and step-up metadata on the handler.
 *
 * @author AI-Generated
 * @date 2026-08-31
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
} from "../testing/pool-mocks";

// ============================================================================
// Fixtures
// ============================================================================

const VERSION_ID = "22222222-2222-4222-8222-222222222222";

const DRAFT_VERSION = {
  id: VERSION_ID,
  plan_code: "karda-pro",
  version_no: 2,
  status: "draft",
  is_locked: false,
};

const PRIMARY = { product_code: "karda", priority: 100 };

const CATALOG = [
  { id: "p-atlas", product_code: "atlas" },
  { id: "p-runos", product_code: "runos" },
];

const ATLAS_QUOTA = { "ai.credit": 100000 };
const RUNOS_QUOTA = { "compute.minutes": 3000 };

/** Default responder: an editable draft with a karda primary and a live catalog. */
function draftResponder(overrides?: Partial<Responder>): Responder {
  return (sql, params) => {
    const custom = overrides?.(sql, params);
    if (custom) return custom;
    if (sql.includes("for update of pv")) return [DRAFT_VERSION];
    if (sql.includes("component_role = 'primary'") && sql.includes("limit 1"))
      return [PRIMARY];
    if (sql.includes("from product.products") && sql.includes("= any("))
      return CATALOG;
    return [];
  };
}

const DETAIL_ROW = {
  id: VERSION_ID,
  plan_id: "plan-karda-pro",
  version_no: 2,
  status: "draft",
  is_locked: false,
  is_current: false,
  plan_code: "karda-pro",
  plan_name: "Karda Pro",
  prices: [],
  components: [
    {
      productCode: "karda",
      productName: "Karda",
      componentRole: "primary",
      tier: "pro",
      quota: { "doc.words": 1000000 },
      features: [],
      priority: 100,
    },
    {
      productCode: "atlas",
      productName: "Atlas",
      componentRole: "bundled",
      tier: null,
      quota: ATLAS_QUOTA,
      features: ["embedding"],
      priority: 50,
    },
  ],
};

function insertsOf(calls: string[]): string[] {
  return calls.filter((c) => c.includes("INSERT INTO product.plan_components"));
}

// ============================================================================
// Guards that must fire before any DB access
// ============================================================================

describe("bundled components — pre-DB guards", () => {
  it("rejects a caller without platform.product.manage", async () => {
    const rw = noDbPool();
    const router = new ProductsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.replaceBundledComponents(
        makeReq(["platform.product.read"]),
        VERSION_ID,
        { components: [] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rw.connect).not.toHaveBeenCalled();
  });

  it("400 on a malformed body: missing array, non-object quota, duplicate productCode", async () => {
    const rw = noDbPool();
    const router = new ProductsRouter(noDbPool().pool, rw.pool);
    const req = makeReq(MANAGE);
    await expect(
      router.replaceBundledComponents(req, VERSION_ID, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      router.replaceBundledComponents(req, VERSION_ID, {
        components: [{ productCode: "atlas", quota: [1] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      router.replaceBundledComponents(req, VERSION_ID, {
        components: [
          { productCode: "atlas", quota: ATLAS_QUOTA },
          { productCode: "atlas", quota: { "ai.credit": 1 } },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rw.connect).not.toHaveBeenCalled();
  });
});

// ============================================================================
// In-transaction rules (each failure must roll back and release)
// ============================================================================

describe("bundled components — transactional rules", () => {
  const body = { components: [{ productCode: "atlas", quota: ATLAS_QUOTA }] };

  it("404 + rollback when the version does not exist", async () => {
    const tx = makeTxClient(() => []);
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.replaceBundledComponents(makeReq(MANAGE), VERSION_ID, body),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.outcome()).toEqual({
      committed: false,
      rolledBack: true,
      released: true,
    });
  });

  it.each([
    ["published", { status: "published", is_locked: true }],
    ["locked draft", { status: "draft", is_locked: true }],
  ])("409 + rollback on a %s version, nothing deleted", async (_, state) => {
    const tx = makeTxClient(
      draftResponder((sql) =>
        sql.includes("for update of pv")
          ? [{ ...DRAFT_VERSION, ...state }]
          : [],
      ),
    );
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.replaceBundledComponents(makeReq(MANAGE), VERSION_ID, body),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.outcome()).toEqual({
      committed: false,
      rolledBack: true,
      released: true,
    });
    expect(
      tx.calls.some((c) => c.includes("DELETE FROM product.plan_components")),
    ).toBe(false);
  });

  it("404 with `field` when a product is unknown or soft-deleted", async () => {
    const tx = makeTxClient(draftResponder());
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    const error = await router
      .replaceBundledComponents(makeReq(MANAGE), VERSION_ID, {
        components: [
          { productCode: "atlas", quota: ATLAS_QUOTA },
          { productCode: "ghost", quota: {} },
        ],
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      field: "components[1].productCode",
    });
    expect(tx.outcome().rolledBack).toBe(true);
    expect(insertsOf(tx.calls)).toHaveLength(0);
  });

  it("400 when the version's primary product is listed as bundled", async () => {
    const tx = makeTxClient(draftResponder());
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.replaceBundledComponents(makeReq(MANAGE), VERSION_ID, {
        components: [{ productCode: "karda", quota: {} }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.outcome().rolledBack).toBe(true);
  });

  it("400 when a bundled priority is not below the primary's (§7 burn order)", async () => {
    const tx = makeTxClient(draftResponder());
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.replaceBundledComponents(makeReq(MANAGE), VERSION_ID, {
        components: [
          { productCode: "atlas", quota: ATLAS_QUOTA, priority: 100 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.outcome().rolledBack).toBe(true);
  });

  it("maps a trigger RAISE (P0001) to 409 instead of a 500", async () => {
    const tx = makeTxClient(
      draftResponder((sql) => {
        if (sql.includes("insert into product.plan_components")) {
          throw Object.assign(new Error("plan_version is locked"), {
            code: "P0001",
          });
        }
        return undefined;
      }),
    );
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.replaceBundledComponents(makeReq(MANAGE), VERSION_ID, body),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.outcome().rolledBack).toBe(true);
  });
});

// ============================================================================
// Full replace
// ============================================================================

describe("bundled components — full replace", () => {
  it("deletes the old bundled set, inserts the new one in order, audits, commits, reads back", async () => {
    const tx = makeTxClient(
      draftResponder((sql) =>
        sql.includes("component_role = 'bundled'") &&
        sql.includes("order by pc.sort_order")
          ? [
              {
                productCode: "runos",
                quota: { "compute.minutes": 1 },
                features: [],
                priority: 50,
              },
            ]
          : undefined,
      ),
    );
    const router = new ProductsRouter(readerOf([DETAIL_ROW]), tx.pool);
    const detail = await router.replaceBundledComponents(
      makeReq(MANAGE),
      VERSION_ID,
      {
        components: [
          {
            productCode: "atlas",
            quota: ATLAS_QUOTA,
            features: ["embedding"],
          },
          { productCode: "runos", quota: RUNOS_QUOTA, priority: 20 },
        ],
      },
    );

    expect(tx.outcome()).toEqual({
      committed: true,
      rolledBack: false,
      released: true,
    });
    // delete before insert — full replace, not upsert
    const deleteAt = tx.calls.findIndex((c) =>
      c.includes("DELETE FROM product.plan_components"),
    );
    const insertAt = tx.calls.findIndex((c) =>
      c.includes("INSERT INTO product.plan_components"),
    );
    expect(deleteAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(deleteAt);

    // rows: tier NULL / role bundled are literals in the statement; the rest are params
    const inserts = insertsOf(tx.calls);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toContain("NULL, 'bundled'");
    const insertParams = tx.params.filter((_, i) =>
      tx.calls[i]!.includes("INSERT INTO product.plan_components"),
    );
    expect(insertParams[0]).toEqual([
      VERSION_ID,
      "p-atlas",
      50,
      ["embedding"],
      JSON.stringify(ATLAS_QUOTA),
      0,
    ]);
    expect(insertParams[1]).toEqual([
      VERSION_ID,
      "p-runos",
      20,
      [],
      JSON.stringify(RUNOS_QUOTA),
      1,
    ]);

    // audit row: visible code as resource id, before = old set, after = new set
    const auditAt = tx.calls.findIndex((c) =>
      c.includes("insert into support.audit_logs"),
    );
    expect(auditAt).toBeGreaterThan(insertAt);
    const audit = tx.params[auditAt]!;
    expect(audit[1]).toBe("product.plan_version.bundled.replace");
    expect(audit[3]).toBe("product_plan_version");
    expect(audit[4]).toBe("karda-pro@v2");
    expect(JSON.parse(audit[5] as string)).toEqual([
      {
        productCode: "runos",
        quota: { "compute.minutes": 1 },
        features: [],
        priority: 50,
      },
    ]);
    expect(JSON.parse(audit[6] as string)).toEqual([
      {
        productCode: "atlas",
        quota: ATLAS_QUOTA,
        features: ["embedding"],
        priority: 50,
      },
      { productCode: "runos", quota: RUNOS_QUOTA, features: [], priority: 20 },
    ]);

    // response = the GET detail shape, bundled rows included
    expect(detail.productCode).toBe("karda");
    expect(detail.quota).toEqual({ "doc.words": 1000000 });
    expect(
      detail.components.map((c) => [c.productCode, c.componentRole]),
    ).toEqual([
      ["karda", "primary"],
      ["atlas", "bundled"],
    ]);
    expect(detail.components[1]).toMatchObject({
      productName: "Atlas",
      tier: null,
      quota: ATLAS_QUOTA,
      features: ["embedding"],
      priority: 50,
    });
  });

  it("an empty list clears every bundled component (PUT = full replace)", async () => {
    const tx = makeTxClient(draftResponder());
    const router = new ProductsRouter(readerOf([DETAIL_ROW]), tx.pool);
    await router.replaceBundledComponents(makeReq(MANAGE), VERSION_ID, {
      components: [],
    });
    expect(tx.outcome().committed).toBe(true);
    expect(
      tx.calls.some((c) => c.includes("DELETE FROM product.plan_components")),
    ).toBe(true);
    expect(insertsOf(tx.calls)).toHaveLength(0);
  });
});

// ============================================================================
// Step-up gate
// ============================================================================

describe("bundled components — step-up gated", () => {
  it("replaceBundledComponents carries REQUIRE_STEP_UP metadata", () => {
    const fn = (ProductsRouter.prototype as unknown as Record<string, unknown>)[
      "replaceBundledComponents"
    ];
    expect(typeof fn).toBe("function");
    expect(Reflect.getMetadata(REQUIRE_STEP_UP, fn as object)).toBe(true);
  });
});
