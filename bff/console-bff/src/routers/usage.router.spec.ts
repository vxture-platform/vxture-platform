/**
 * usage.router.spec.ts - Analytics window and authenticated workspace boundaries.
 * @package @vxture/bff-console
 * @layer Application
 * @category Test
 * @author AI-Generated
 * @date 2026-11-15
 */
import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { MeteringReadService } from "@vxture/service-subscription";
import type { RequestContext } from "../types/console.types";
import { UsageRouter } from "./usage.router";

// ============================================================================
// Authenticated scope
// ============================================================================

const request = (workspace = "selected-workspace") =>
  ({
    user: { id: "user", timezone: "Asia/Shanghai" },
    tenant: { id: "tenant", mode: "tenant", workspace },
    activeWorkspaceId: "selected-workspace",
    query: { workspaceId: "attacker-workspace", tenantId: "attacker-tenant" },
  }) as unknown as Request & RequestContext;

function setup() {
  const metering = { getUsageAnalytics: vi.fn(async () => ({ buckets: [] })) };
  const router = new UsageRouter(metering as unknown as MeteringReadService);
  return { metering, router };
}

// ============================================================================
// Window and access policy
// ============================================================================

describe("UsageRouter analytics", () => {
  it.each(["hour", "day", "week", "month"])(
    "accepts %s and uses the selected workspace, never query overrides",
    async (window) => {
      const { router, metering } = setup();
      await router.getAnalytics(request(), window);
      expect(metering.getUsageAnalytics).toHaveBeenCalledWith({
        workspaceId: "selected-workspace",
        tenantId: "tenant",
        metric: "ai.credit",
        window,
        zone: "Asia/Shanghai",
      });
    },
  );

  it.each(["year", "5years", "", "invalid"])(
    "rejects unsupported window %s",
    async (window) => {
      const { router, metering } = setup();
      await expect(router.getAnalytics(request(), window)).rejects.toThrow(
        "Unsupported usage window",
      );
      expect(metering.getUsageAnalytics).not.toHaveBeenCalled();
    },
  );

  it("rejects a mismatch between tenant context and verified access claims", async () => {
    const { router, metering } = setup();
    await expect(
      router.getAnalytics(request("other-workspace"), "day"),
    ).rejects.toThrow("accessible active workspace");
    expect(metering.getUsageAnalytics).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const { router } = setup();
    const req = request();
    delete req.user;
    await expect(router.getAnalytics(req, "day")).rejects.toThrow(
      "No active tenant session",
    );
  });
});
