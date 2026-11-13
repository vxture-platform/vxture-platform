/**
 * Workbench launches bind the same verified scope as its catalog reads.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-13
 */
import { describe, it, expect, vi } from "vitest";
import type { Request } from "express";
import { ApiRouter } from "./api-router";
import type { SessionService } from "./auth/session-service";
import type { ScopeService } from "./scope-service";
import type { CatalogService } from "./catalog-service";
import type { ResourceOverview } from "./resource-overview";
describe("product launch scope", () => {
  it("uses verified scope and preserves other product destinations", async () => {
    const user = {
      userId: "member",
      activeOrg: "org",
      activeWorkspace: "workspace",
    };
    const scopes = { assertCurrent: vi.fn(async () => {}) };
    const router = new ApiRouter(
      { authenticate: async () => ({ user }) } as unknown as SessionService,
      scopes as unknown as ScopeService,
      {
        entries: async () => [
          { code: "cospace", homeUrl: "https://cospace.example/services" },
          { code: "other", homeUrl: "https://other.example/path" },
        ],
      } as unknown as CatalogService,
      {} as ResourceOverview,
    );
    const entries = await router.applications({
      query: { tenant_hint: "attacker" },
    } as unknown as Request);
    const destination = new URL(entries[0]!.homeUrl!);
    expect(Object.fromEntries(destination.searchParams)).toEqual({
      returnTo: "/services",
      tenant_hint: "org",
      workspace_hint: "workspace",
    });
    expect(entries[1]!.homeUrl).toBe("https://other.example/path");
    expect(scopes.assertCurrent).toHaveBeenCalledWith(user);
  });
});
