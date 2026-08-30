import { describe, it, expect } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  ProductsRouter,
  loadProductReleases,
  loadProductSolutions,
  projectServicePlan,
  quotaSummary,
  type ReleaseRow,
  type ServicePlanRow,
  type SolutionRow,
  PRODUCT_SOLUTION_LINKS_SQL,
} from "./products.router";
import {
  MANAGE,
  makeReq,
  makeTxClient,
  noDbPool,
  readerOf,
} from "../testing/pool-mocks";

// 2026-08-31 TD-029 收口：solutions / service-plans / releases 接活库后的投影与
// 写路径守卫。SQL 本身在本地库跑冒烟（见 PR 记录）；这里锁的是"行 → 记录"的
// 形状、计数透传、价格标签口径，以及每条写路径"先鉴权再碰库、失败必回滚"。
// Pool / client doubles live in ../testing/pool-mocks (shared with the bundled
// components spec since 2026-08-31).

const SOLUTION_ROW: SolutionRow = {
  id: "sol-1",
  solution_code: "flood-regulation",
  solution_name: "洪涝灾害监管",
  description: "desc",
  industry: "水利",
  scenario: "洪涝监管",
  customer_segment: "水利局",
  owner_team: "行业交付",
  tags: ["water"],
  delivery_mode: "平台订阅 + 实施",
  delivery_boundaries: ["含巡检", "不含设备"],
  status: "active",
  is_public: false,
  created_at: "2026-08-31T00:00:00.000Z",
  updated_at: "2026-08-31T01:00:00.000Z",
  subscription_count: "3",
  active_tenant_count: "2",
  monthly_revenue: "1234.5",
  products: [
    {
      id: "p-arda",
      productCode: "arda",
      productName: "Arda",
      productType: "data_platform",
      origin: "self",
      status: "active",
      role: "数据沉淀",
      sort: 1,
    },
    {
      id: "p-drone",
      productCode: "drone-platform",
      productName: "Drone",
      productType: "agent",
      origin: "third_party",
      status: "inactive",
      role: null,
      sort: 0,
    },
  ],
  tiers: [
    {
      tier: "free",
      planId: "plan-free",
      planCode: "arda-free",
      planName: "Arda Free",
      description: "",
      status: "active",
      isPublic: true,
      price: "0",
      currency: "CNY",
      cycleUnit: "month",
      cycleCount: 1,
    },
    {
      tier: "pro",
      planId: "plan-pro",
      planCode: "arda-pro",
      planName: "Arda Pro",
      description: "专业",
      status: "draft",
      isPublic: false,
      price: 299,
      currency: "CNY",
      cycleUnit: "month",
      cycleCount: 1,
    },
    {
      tier: "enterprise",
      planId: "plan-ent",
      planCode: "arda-enterprise",
      planName: "Arda Enterprise",
      description: "",
      status: "active",
      isPublic: true,
      price: null,
      currency: null,
      cycleUnit: null,
      cycleCount: null,
    },
  ],
};

describe("solutions projection", () => {
  it("maps a DB row (jsonb products/tiers + string counts) onto ProductSolutionRecord", async () => {
    const [record] = await loadProductSolutions(readerOf([SOLUTION_ROW]));
    expect(record).toBeDefined();
    expect(record!.solutionCode).toBe("flood-regulation");
    expect(record!.status).toBe("active");
    expect(record!.visibility).toBe("internal");
    // counts come back from pg as strings — they must be numbers on the wire
    expect(record!.subscriptionCount).toBe(3);
    expect(record!.activeTenantCount).toBe(2);
    expect(record!.monthlyRevenue).toBe(1234.5);
    // products: origin → source, product_type → capability type, 4-state → 3-state
    const drone = record!.products.find(
      (p) => p.productCode === "drone-platform",
    );
    expect(drone).toMatchObject({
      source: "partner",
      productType: "agent",
      status: "archived",
      role: "",
      sort: 0,
    });
    // tiers: bound plan projected; price labels by the shared rule
    expect(record!.tiers.map((t) => t.tierCode)).toEqual([
      "free",
      "pro",
      "enterprise",
    ]);
    expect(record!.tiers.map((t) => t.priceLabel)).toEqual([
      "免费",
      "¥299.00 / 月",
      "合同报价",
    ]);
    expect(record!.tiers[1]).toMatchObject({
      tierName: "Arda Pro",
      planCode: "arda-pro",
      status: "draft",
      isPublic: false,
    });
  });

  it("treats missing counts as zero rather than NaN", async () => {
    const [record] = await loadProductSolutions(
      readerOf([
        {
          ...SOLUTION_ROW,
          subscription_count: "0",
          active_tenant_count: "0",
          monthly_revenue: null,
          products: [],
          tiers: [],
        },
      ]),
    );
    expect(record!.subscriptionCount).toBe(0);
    expect(record!.monthlyRevenue).toBe(0);
    expect(record!.products).toEqual([]);
    expect(record!.tiers).toEqual([]);
  });
});

describe("service plan projection", () => {
  const PLAN_ROW: ServicePlanRow = {
    plan_id: "plan-pro",
    plan_code: "arda-pro",
    plan_name: "Arda Pro",
    description: "专业",
    status: "active",
    is_public: true,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-02T00:00:00.000Z",
    version_no: 2,
    version_status: "published",
    price: "2990",
    currency: "CNY",
    cycle_unit: "year",
    cycle_count: 1,
    components: [
      {
        productCode: "arda",
        productName: "Arda",
        productType: "data_platform",
        origin: "self",
        tier: "pro",
        componentRole: "primary",
        features: ["export", "share"],
        quota: { "dataset.max": 500, "storage.bytes": -1 },
      },
    ],
    subscription_count: "5",
    active_tenant_count: "4",
    monthly_revenue: "1245.83",
  };

  it("includes plan components with rendered quota and marks solution products outside the plan as excluded", () => {
    const detail = projectServicePlan(SOLUTION_ROW, "pro", PLAN_ROW);
    expect(detail.id).toBe("flood-regulation:pro");
    expect(detail.planCode).toBe("arda-pro");
    expect(detail.versionNo).toBe(2);
    expect(detail.versionStatus).toBe("published");
    expect(detail.price).toMatchObject({
      priceLabel: "¥2,990.00 / 年",
      price: 2990,
      originalPrice: null,
      periodType: "yearly",
      periodValue: 1,
    });
    expect(detail.subscriptionCount).toBe(5);
    expect(detail.monthlyRevenue).toBe(1245.83);
    expect(detail.entitlements).toHaveLength(2);
    expect(detail.entitlements[0]).toMatchObject({
      productCode: "arda",
      included: true,
      role: "数据沉淀",
      quotaSummary: "dataset.max 500 · storage.bytes 不限",
      note: "export、share",
    });
    expect(detail.entitlements[1]).toMatchObject({
      productCode: "drone-platform",
      included: false,
      quotaSummary: "",
    });
    expect(detail.includedProductCount).toBe(1);
    expect(detail.excludedProductCount).toBe(1);
  });

  it("falls back to contract pricing when the version has no price row", () => {
    const detail = projectServicePlan(SOLUTION_ROW, "pro", {
      ...PLAN_ROW,
      price: null,
      currency: null,
      cycle_unit: null,
      cycle_count: null,
      version_no: null,
      version_status: null,
      components: [],
    });
    expect(detail.price.periodType).toBe("contract");
    expect(detail.price.priceLabel).toBe("合同报价");
    expect(detail.versionNo).toBeNull();
  });

  it("renders quota json compactly", () => {
    expect(quotaSummary(null)).toBe("");
    expect(quotaSummary({ "ai.credit": 100000, beta: true, off: false })).toBe(
      "ai.credit 100,000 · beta",
    );
  });
});

describe("releases projection", () => {
  const RELEASE_ROW: ReleaseRow = {
    id: "ver-2",
    version_no: 2,
    version_created_at: "2026-08-10T00:00:00.000Z",
    plan_code: "acme-pro",
    plan_name: "Acme Pro",
    description: "",
    is_public: true,
    plan_status: "active",
    plan_updated_at: "2026-08-11T00:00:00.000Z",
    is_current: true,
    product_code: "acme",
    product_name: "Acme",
    product_status: "active",
    origin: "third_party",
    prices: [
      {
        id: "pp-m",
        currency: "CNY",
        price: "120",
        cycleUnit: "month",
        cycleCount: 1,
      },
      {
        id: "pp-y",
        currency: "CNY",
        price: "1200",
        cycleUnit: "year",
        cycleCount: 1,
      },
    ],
    components: [
      {
        productCode: "acme",
        productName: "Acme",
        productType: "agent",
        origin: "third_party",
        tier: "pro",
        componentRole: "primary",
        features: [],
        quota: { "ai.calls": -1 },
      },
      {
        productCode: "arda",
        productName: "Arda",
        productType: "data_platform",
        origin: "self",
        tier: null,
        componentRole: "bundled",
        features: ["export"],
        quota: null,
      },
    ],
  };

  it("projects a published plan version as a product release", async () => {
    const [release] = await loadProductReleases(readerOf([RELEASE_ROW]));
    expect(release).toMatchObject({
      productCode: "acme",
      productStatus: "active",
      releaseCode: "acme-pro@v2",
      releaseName: "Acme Pro",
      releaseType: "custom",
      versionLabels: ["pro"],
      isFree: false,
      isPublic: true,
      isActive: true,
      isCurrent: true,
    });
    expect(
      release!.prices.map((p) => [p.periodType, p.price, p.isDefault]),
    ).toEqual([
      ["monthly", 120, true],
      ["yearly", 1200, false],
    ]);
    expect(release!.prices[0]!.originalPrice).toBeNull();
    expect(release!.features).toHaveLength(2);
    expect(release!.features[0]).toMatchObject({
      code: "acme",
      type: "quota",
      isUnlimited: true,
      quotaValue: null,
      config: { "ai.calls": -1 },
    });
    expect(release!.features[1]).toMatchObject({
      code: "arda",
      type: "function",
      isUnlimited: false,
      config: null,
    });
    expect(release).not.toHaveProperty("productRegion");
    expect(release).not.toHaveProperty("allowedAgents");
  });

  it("is free only when there are prices and all of them are zero; inactive plan → inactive release", async () => {
    const [free] = await loadProductReleases(
      readerOf([
        {
          ...RELEASE_ROW,
          origin: "self",
          plan_status: "inactive",
          prices: [
            {
              id: "pp",
              currency: "CNY",
              price: "0",
              cycleUnit: "month",
              cycleCount: 1,
            },
          ],
        },
      ]),
    );
    expect(free).toMatchObject({
      isFree: true,
      isActive: false,
      releaseType: "standard",
    });
    const [unpriced] = await loadProductReleases(
      readerOf([{ ...RELEASE_ROW, prices: [] }]),
    );
    expect(unpriced!.isFree).toBe(false);
  });
});

describe("solution write paths", () => {
  const SOLUTION_LOCK_ROW = {
    id: "sol-1",
    solution_code: "flood-regulation",
    solution_name: "洪涝",
    description: null,
    industry: null,
    scenario: null,
    customer_segment: null,
    owner_team: null,
    tags: [],
    delivery_mode: null,
    delivery_boundaries: [],
    status: "deprecated",
    is_public: true,
  };

  it("rejects a caller without platform.product.manage before any DB access", async () => {
    const rw = noDbPool();
    const router = new ProductsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.createSolution(makeReq(["platform.product.read"]), {
        solutionCode: "x",
        solutionName: "X",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rw.connect).not.toHaveBeenCalled();
  });

  it("validates the solution code / state / tier before touching the pool", async () => {
    const rw = noDbPool();
    const router = new ProductsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.createSolution(makeReq(MANAGE), {
        solutionCode: "Not Kebab",
        solutionName: "X",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      router.setSolutionState(makeReq(MANAGE), "flood-regulation", {
        state: "archived",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      router.bindSolutionPlan(makeReq(MANAGE), "flood-regulation", "custom", {
        planCode: "arda-pro",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      router.updateSolution(makeReq(MANAGE), "flood-regulation", {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rw.connect).not.toHaveBeenCalled();
  });

  it("409 + rollback + release when leaving the terminal deprecated state", async () => {
    const tx = makeTxClient((sql) =>
      sql.includes("for update") ? [SOLUTION_LOCK_ROW] : [],
    );
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.setSolutionState(makeReq(MANAGE), "flood-regulation", {
        state: "active",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.outcome()).toEqual({
      committed: false,
      rolledBack: true,
      released: true,
    });
    expect(tx.calls.some((c) => c.includes("UPDATE product.solutions"))).toBe(
      false,
    );
  });

  it("404 + rollback when the solution does not exist", async () => {
    const tx = makeTxClient(() => []);
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.replaceSolutionProducts(makeReq(MANAGE), "missing", [
        { productCode: "arda" },
      ]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.outcome().rolledBack).toBe(true);
    expect(tx.outcome().released).toBe(true);
  });

  it("409 + rollback when binding a plan that is already bound to another solution tier", async () => {
    const tx = makeTxClient((sql) => {
      if (sql.includes("for update"))
        return [{ ...SOLUTION_LOCK_ROW, status: "draft" }];
      if (sql.includes("from product.plans"))
        return [{ id: "plan-1", plan_code: "arda-pro" }];
      if (sql.includes("select s.solution_code, sp.tier"))
        return [{ solution_code: "smart-legal", tier: "pro" }];
      return [];
    });
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.bindSolutionPlan(makeReq(MANAGE), "flood-regulation", "pro", {
        planCode: "arda-pro",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.outcome()).toEqual({
      committed: false,
      rolledBack: true,
      released: true,
    });
    expect(
      tx.calls.some((c) => c.includes("INSERT INTO product.solution_plans")),
    ).toBe(false);
  });

  it("draft → active: writes the state, the audit row, commits, then reads back via the RO pool", async () => {
    const tx = makeTxClient((sql) =>
      sql.includes("for update")
        ? [{ ...SOLUTION_LOCK_ROW, status: "draft" }]
        : [],
    );
    const ro = readerOf([SOLUTION_ROW]);
    const router = new ProductsRouter(ro, tx.pool);
    const detail = await router.setSolutionState(
      makeReq(MANAGE),
      "flood-regulation",
      { state: "active" },
    );
    expect(tx.outcome()).toEqual({
      committed: true,
      rolledBack: false,
      released: true,
    });
    expect(
      tx.calls.some((c) => c.includes("UPDATE product.solutions SET status")),
    ).toBe(true);
    expect(
      tx.calls.some((c) => c.includes("insert into support.audit_logs")),
    ).toBe(true);
    expect(detail.solutionCode).toBe("flood-regulation");
    expect(detail.relatedServicePlans).toHaveLength(3);
  });
});

// ── step-up 门（owner 2026-08-31）：六个写端点都必须带 @RequireStepUp 元数据；漏一个就是
// 一条能绕过二次验证改售卖内容的路——所以钉在测试里，不靠代码审查记得。
import { REQUIRE_STEP_UP } from "../auth/step-up.decorator";

describe("solution write handlers are step-up gated", () => {
  it.each([
    "createSolution",
    "updateSolution",
    "setSolutionState",
    "replaceSolutionProducts",
    "bindSolutionPlan",
    "unbindSolutionPlan",
  ] as const)("%s carries REQUIRE_STEP_UP metadata", (handler) => {
    const fn = (ProductsRouter.prototype as unknown as Record<string, unknown>)[
      handler
    ];
    expect(typeof fn).toBe("function");
    expect(Reflect.getMetadata(REQUIRE_STEP_UP, fn as object)).toBe(true);
  });

  it("read handlers stay ungated", () => {
    const fn = (ProductsRouter.prototype as unknown as Record<string, unknown>)[
      "listSolutions"
    ];
    expect(Reflect.getMetadata(REQUIRE_STEP_UP, fn as object)).toBeUndefined();
  });
});

describe("PRODUCT_SOLUTION_LINKS_SQL", () => {
  it("has no bare `{}` — an empty array literal must be typed (ARRAY[]::text[])", () => {
    // Production 2026-08-31: `COALESCE(ARRAY_AGG(...), {})` is a PostgreSQL
    // syntax error (42601); the mocked pool in these specs never parses SQL,
    // so pin the shape here and let the live-DB smoke (itest) run the query.
    expect(PRODUCT_SOLUTION_LINKS_SQL).not.toMatch(/(^|[^'"\w])\{\}/);
    expect(PRODUCT_SOLUTION_LINKS_SQL).toContain("ARRAY[]::text[]");
  });
});
