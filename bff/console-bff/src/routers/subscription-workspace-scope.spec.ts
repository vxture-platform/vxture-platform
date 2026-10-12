/**
 * subscription-workspace-scope.spec.ts - Reads and purchases follow verified scope.
 * @package @vxture/bff-console
 * @layer Application
 * @category Test
 * @author AI-Generated
 * @date 2026-10-12
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../types/console.types";
import { SubscriptionRouter } from "./subscription.router";

// ============================================================================
// Two workspaces within one billing tenant
// ============================================================================

const TENANT = "11111111-1111-4111-8111-111111111111";
const DEFAULT = "22222222-2222-4222-8222-222222222222";
const SELECTED = "33333333-3333-4333-8333-333333333333";
const BODY = {
  productCode: "vxtpl",
  planVersionId: "pv-1",
  cycleUnit: "month",
  intent: "new",
};
function req(workspace = SELECTED): Request & RequestContext {
  return {
    user: { id: "user" },
    tenant: {
      id: TENANT,
      name: "Team",
      mode: "tenant",
      workspace,
      tenantType: "organization",
    },
  } as unknown as Request & RequestContext;
}

function setup(
  options: {
    inaccessible?: boolean;
    privatePlan?: boolean;
    targetWorkspace?: string;
  } = {},
) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("select id from tenancy.workspaces")) {
      if (options.inaccessible) return { rows: [] };
      return { rows: [{ id: params[1] ?? DEFAULT }] };
    }
    if (sql.includes("as product_status"))
      return {
        rows: [
          {
            product_code: "vxtpl",
            product_status: "active",
            release_stage: "stable",
            plan_is_public: !options.privatePlan,
            plan_code: "starter",
          },
        ],
      };
    if (sql.includes("product.plan_prices") && !sql.includes("as prices"))
      return {
        rows: [
          {
            price: "10.00",
            currency: "CNY",
            plan_code: "starter",
            plan_name: "Starter",
          },
        ],
      };
    if (
      sql.includes("from product.products") &&
      sql.includes("product_name") &&
      !sql.includes("join")
    )
      return { rows: [{ product_code: "vxtpl", product_name: "Template" }] };
    if (sql.includes("select 1 as one")) {
      // Only DEFAULT owns this private plan. An unscoped query wrongly grants renewal.
      return { rows: params.includes(SELECTED) ? [] : [{ one: 1 }] };
    }
    if (sql.includes("select ts.id, ts.status, ts.plan_version_id")) {
      const selected = params.includes(SELECTED);
      return {
        rows: [
          {
            id: selected ? "selected-subscription" : "default-subscription",
            status: "active",
            plan_version_id: "pv-1",
            end_at: null,
            trial_end_at: null,
            plan_code: "starter",
            tier: "starter",
            auto_renew: false,
          },
        ],
      };
    }
    if (sql.includes("select distinct prod.product_code"))
      return { rows: [{ product_code: "vxtpl" }] };
    return { rows: [] };
  });
  const orderService = {
    findOpenOrderForProduct: vi.fn(async () => null),
    createOrder: vi.fn(async () => ({
      order: { id: "order", orderNo: "OD-1" },
      billNo: "BL-1",
    })),
  };
  const subscriptionService = {
    getSubscription: vi.fn(async () => ({
      id: "selected-subscription",
      tenantId: TENANT,
      workspaceId: options.targetWorkspace ?? SELECTED,
    })),
  };
  const resolveWorkspaceEntitlements = vi.fn(async () => ({
    vxtpl: {
      tier: "starter",
      status: "active",
      bundled: false,
      limits: {},
      quota_pools: [],
    },
  }));
  const none = undefined as never;
  const router = new SubscriptionRouter(
    subscriptionService as never,
    orderService as never,
    none,
    none,
    none,
    { query } as unknown as Pool,
    { resolveWorkspaceEntitlements } as never,
    { listProductIds: async () => [] } as never,
  );
  return {
    router,
    query,
    orderService,
    subscriptionService,
    resolveWorkspaceEntitlements,
  };
}

// ============================================================================
// API reads, renewal selection, and purchase isolation
// ============================================================================

describe("subscription workspace scope", () => {
  it.each(["getQuotaUsage", "getEntitlements"] as const)(
    "%s resolves C2 for the selected workspace",
    async (method) => {
      const { router, query, resolveWorkspaceEntitlements } = setup();
      await router[method](req());
      expect(query.mock.calls[0]?.[1]).toEqual([TENANT, SELECTED]);
      expect(resolveWorkspaceEntitlements).toHaveBeenCalledWith(SELECTED, [
        "vxtpl",
      ]);
    },
  );

  it("reads product cards and subscription rows from the selected workspace", async () => {
    const { router, query } = setup();
    await router.getSubscribedProducts(req());
    await router.getMySubscriptions(req());
    const cards = query.mock.calls.find(([sql]) =>
      sql.includes("as subscription_id"),
    );
    expect(cards?.[1]).toEqual([SELECTED]);
    const subscriptions = query.mock.calls.find(([sql]) =>
      sql.includes("select ts.id, ts.tenant_id"),
    );
    expect(subscriptions?.[0]).toContain("ts.workspace_id = $2");
    expect(subscriptions?.[1]).toEqual([TENANT, SELECTED]);
  });

  it("scopes the purchase landing's current subscription and pending order", async () => {
    const { router, query } = setup();
    const result = await router.getSubscribeContext(req(), {
      product: "vxtpl",
      intent: "renew",
    });
    expect(result.current?.subscriptionId).toBe("selected-subscription");
    const current = query.mock.calls.find(([sql]) =>
      sql.includes("select ts.id, ts.status"),
    );
    expect(current?.[0]).toContain("ts.workspace_id = $4");
    expect(current?.[1]?.[3]).toBe(SELECTED);
    const pending = query.mock.calls.find(([sql]) =>
      sql.includes("o.status in ('pending_payment', 'pending_verify', 'paid')"),
    );
    expect(pending?.[0]).toContain("o.workspace_id = $3");
    expect(pending?.[1]).toEqual([TENANT, "vxtpl", SELECTED]);
  });

  it("places orders in verified scope and ignores a body workspace override", async () => {
    const { router, orderService } = setup();
    const body = { ...BODY, workspaceId: DEFAULT };
    await router.createOrder(req(), body);
    expect(orderService.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, workspaceId: SELECTED }),
    );
  });

  it("automatically renews the selected workspace's subscription", async () => {
    const { router, orderService } = setup();
    await router.createOrder(req(), { ...BODY, intent: "renew" });
    expect(orderService.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: SELECTED,
        fromSubscriptionId: "selected-subscription",
        intent: "renew",
      }),
    );
  });

  it("rejects an upgrade target belonging to another workspace in the same tenant", async () => {
    const { router, orderService } = setup({ targetWorkspace: DEFAULT });
    await expect(
      router.createOrder(req(), {
        ...BODY,
        intent: "upgrade",
        upgradeOfSubscriptionId: "default-subscription",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(orderService.createOrder).not.toHaveBeenCalled();
  });

  it("does not inherit a private-plan renewal exception from another workspace", async () => {
    const { router, query, orderService } = setup({ privatePlan: true });
    await expect(
      router.createOrder(req(), { ...BODY, intent: "renew" }),
    ).rejects.toBeInstanceOf(ConflictException);
    const held = query.mock.calls.find(([sql]) =>
      sql.includes("select 1 as one"),
    );
    expect(held?.[0]).toContain("ts.workspace_id = $3");
    expect(held?.[1]).toEqual([TENANT, "pv-1", SELECTED]);
    expect(orderService.createOrder).not.toHaveBeenCalled();
  });

  it.each([
    "getQuotaUsage",
    "getEntitlements",
    "getSubscribedProducts",
    "getMySubscriptions",
  ] as const)(
    "%s rejects a removed or foreign workspace without reading defaults",
    async (method) => {
      const { router, query, resolveWorkspaceEntitlements } = setup({
        inaccessible: true,
      });
      await expect(router[method](req())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0]?.[0]).not.toContain("is_default");
      expect(resolveWorkspaceEntitlements).not.toHaveBeenCalled();
    },
  );

  it("rejects revoked workspace before consuming an invite or creating an order", async () => {
    const { router, query, orderService } = setup({
      inaccessible: true,
      privatePlan: true,
    });
    await expect(router.createOrder(req(), BODY)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("update promotion.vouchers"),
      ),
    ).toBe(false);
    expect(orderService.createOrder).not.toHaveBeenCalled();
  });

  it("retains default resolution only for the legacy default sentinel", async () => {
    const { router, query, resolveWorkspaceEntitlements } = setup();
    await router.getEntitlements(req("default"));
    expect(query.mock.calls[0]?.[0]).toContain("is_default");
    expect(query.mock.calls[0]?.[1]).toEqual([TENANT]);
    expect(resolveWorkspaceEntitlements).toHaveBeenCalledWith(DEFAULT, [
      "vxtpl",
    ]);
  });
});
