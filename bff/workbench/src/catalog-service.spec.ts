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
    const hasUserAccess = vi.fn().mockResolvedValue(true);
    const result = await new CatalogService(
      { query },
      { hasUserAccess },
    ).subscriptions("space-a", "org-a", "user-a");
    expect(result).toEqual(rows.map((row) => ({ ...row, access: "allowed" })));
    expect(hasUserAccess).toHaveBeenCalledExactlyOnceWith({
      subject: "usr_user-a",
      orgId: "org-a",
      workspaceId: "space-a",
      productCode: "knowledge",
    });
    expect(query.mock.calls[0]![0]).toContain("s.trial_end_at");
    const [sql, parameters] = query.mock.calls[0]!;
    expect(parameters).toEqual(["space-a", "org-a", "user-a"]);
    expect(sql).toContain("pc.component_role in ('primary', 'bundled')");
    expect(sql).toContain("w.id = $1 and w.tenant_id = $2");
    expect(sql).toContain("s.tenant_id = $2");
    expect(sql).toContain("f.product_id = p.id and f.user_id = $3");
    expect(sql).not.toContain("pc.tier is not null");
  });

  it.each([false, undefined, "error"])(
    "fails closed for a denied, missing or failed domain result: %s",
    async (outcome) => {
      const query = vi.fn().mockResolvedValue({
        rows: [{ productCode: "agent", status: "active" }],
      });
      const hasUserAccess =
        outcome === "error"
          ? vi.fn().mockRejectedValue(new Error("offline"))
          : vi.fn().mockResolvedValue(outcome);
      const result = await new CatalogService(
        { query },
        { hasUserAccess },
      ).subscriptions("w", "t", "u");
      expect(result[0]?.access).toBe(outcome === false ? "denied" : "unknown");
    },
  );

  it("does not reuse authorization across members or workspaces", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [{ productCode: "agent" }] });
    const hasUserAccess = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const catalog = new CatalogService({ query }, { hasUserAccess });
    expect((await catalog.subscriptions("w", "t", "alice"))[0]?.access).toBe(
      "allowed",
    );
    expect((await catalog.subscriptions("other", "t", "bob"))[0]?.access).toBe(
      "denied",
    );
    expect(hasUserAccess).toHaveBeenLastCalledWith({
      subject: "usr_bob",
      orgId: "t",
      workspaceId: "other",
      productCode: "agent",
    });
  });

  it("checks only the launch target and skips access reads for activity-only queries", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ productCode: "a" }, { productCode: "b" }],
    });
    const hasUserAccess = vi.fn().mockResolvedValue(true);
    const catalog = new CatalogService({ query }, { hasUserAccess });
    await catalog.subscriptions("w", "t", "u", false);
    expect(hasUserAccess).not.toHaveBeenCalled();
    await catalog.subscriptions("w", "t", "u", "b");
    expect(hasUserAccess).toHaveBeenCalledExactlyOnceWith({
      subject: "usr_u",
      orgId: "t",
      workspaceId: "w",
      productCode: "b",
    });
  });

  it("bounds concurrent product checks as the registry grows", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: Array.from({ length: 12 }, (_, i) => ({
        productCode: String(i),
      })),
    });
    let pending = 0;
    let peak = 0;
    const hasUserAccess = vi.fn(async () => {
      peak = Math.max(peak, ++pending);
      await new Promise((resolve) => setTimeout(resolve, 1));
      pending--;
      return true;
    });
    const result = await new CatalogService(
      { query },
      { hasUserAccess },
    ).subscriptions("w", "t", "u");
    expect(peak).toBeLessThanOrEqual(4);
    expect(result.every((row) => row.access === "allowed")).toBe(true);
    expect(hasUserAccess).toHaveBeenCalledTimes(12);
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
