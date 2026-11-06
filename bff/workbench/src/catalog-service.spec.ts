/**
 * Protect complete workspace subscription coverage and authenticated favorite scope.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-06
 */
import "reflect-metadata";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { CatalogService } from "./catalog-service";
import { ApiRouter } from "./api-router";

// ============================================================================
// Query scope and product coverage
// ============================================================================
describe("subscribed workspace products", () => {
  it("keeps bundled rows without a commercial tier and reads only this user's favorites", async () => {
    const rows = [
      {
        productCode: "knowledge",
        status: "active",
        tier: null,
        bundled: true,
        favorite: true,
        maintenance: null,
      },
      {
        productCode: "knowledge",
        status: "expired",
        tier: "free",
        bundled: false,
        favorite: true,
        maintenance: null,
      },
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    const result = await new CatalogService({ query }).subscriptions(
      "space-a",
      "org-a",
      "user-a",
    );
    expect(result).toEqual(rows);
    const [sql, parameters] = query.mock.calls[0]!;
    expect(parameters).toEqual(["space-a", "org-a", "user-a"]);
    expect(sql).toContain("pc.component_role in ('primary', 'bundled')");
    expect(sql).toContain("w.id = $1 and w.tenant_id = $2");
    expect(sql).toContain("s.tenant_id = $2");
    expect(sql).toContain("f.product_id = p.id and f.user_id = $3");
    expect(sql).not.toContain("pc.tier is not null");
  });

  it("does not replace a successfully empty workspace with public catalog products", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    expect(
      await new CatalogService({ query }).subscriptions("empty", "org", "user"),
    ).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed read distinct from an empty subscription list", async () => {
    const query = vi.fn().mockRejectedValue(new Error("read unavailable"));
    await expect(
      new CatalogService({ query }).subscriptions("space", "org", "user"),
    ).rejects.toThrow("read unavailable");
  });
});

// ============================================================================
// API authorization owns all three scope identifiers
// ============================================================================
describe("subscription route identity", () => {
  const request = {} as Request;
  function setup() {
    const user = {
      userId: "signed-in-user",
      activeOrg: "org",
      activeWorkspace: "space-a",
    };
    const authenticate = vi.fn().mockResolvedValue({ user });
    const assertCurrent = vi.fn().mockResolvedValue(undefined);
    const subscriptions = vi.fn().mockResolvedValue([]);
    const router = new ApiRouter(
      { authenticate } as never,
      { assertCurrent } as never,
      { subscriptions } as never,
      undefined as never,
    );
    return { router, user, authenticate, assertCurrent, subscriptions };
  }

  it("rechecks the current workspace on every request and forwards the verified user", async () => {
    const { router, user, assertCurrent, subscriptions } = setup();
    await router.subscriptions(request);
    user.activeWorkspace = "space-b";
    await router.subscriptions(request);
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(subscriptions.mock.calls).toEqual([
      ["space-a", "org", "signed-in-user"],
      ["space-b", "org", "signed-in-user"],
    ]);
  });

  it("does not read product or favorite data after scope authorization fails", async () => {
    const { router, assertCurrent, subscriptions } = setup();
    assertCurrent.mockRejectedValue(new Error("workspace forbidden"));
    await expect(router.subscriptions(request)).rejects.toThrow(
      "workspace forbidden",
    );
    expect(subscriptions).not.toHaveBeenCalled();
  });
});
