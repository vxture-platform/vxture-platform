import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { RequestContext } from "../types/console.types";
import { AuthMiddleware, isDeletionAllowedRoute } from "./auth.middleware";

/**
 * 删除保留期的路由放行表(050-account §7):会话恢复的四条读 + 删除相关三条,
 * 其余一律 403。这张表决定保留期用户"还能碰什么",漏一条就是给保留期账号开门。
 */
describe("isDeletionAllowedRoute", () => {
  const req = (method: string, url: string) => ({
    method,
    originalUrl: url,
    url,
  });

  it("allows the session-restore reads (GET only)", () => {
    for (const path of [
      "/api/me",
      "/api/tenant-context",
      "/api/tenant-context/options",
      "/api/capabilities",
    ]) {
      expect(isDeletionAllowedRoute(req("GET", path))).toBe(true);
      expect(isDeletionAllowedRoute(req("POST", path))).toBe(false);
    }
  });

  it("allows the deletion endpoints with any method", () => {
    expect(isDeletionAllowedRoute(req("GET", "/api/me/deletion"))).toBe(true);
    expect(isDeletionAllowedRoute(req("POST", "/api/me/deletion"))).toBe(true);
    expect(isDeletionAllowedRoute(req("POST", "/api/me/deletion/cancel"))).toBe(
      true,
    );
  });

  it("ignores query strings and trailing slashes", () => {
    expect(isDeletionAllowedRoute(req("GET", "/api/me?x=1"))).toBe(true);
    expect(isDeletionAllowedRoute(req("POST", "/api/me/deletion/?y=2"))).toBe(
      true,
    );
  });

  it("blocks everything else the workspace exposes", () => {
    for (const path of [
      "/api/me/profile",
      "/api/me/sessions",
      "/api/me/avatar",
      "/api/billing/bills",
      "/api/subscription/orders",
      "/api/iam/members",
      "/api/me/deletion/other",
    ]) {
      expect(isDeletionAllowedRoute(req("GET", path))).toBe(false);
      expect(isDeletionAllowedRoute(req("DELETE", path))).toBe(false);
    }
  });
});

// ============================================================================
// Verified RP scope propagation
// ============================================================================

describe("AuthMiddleware workspace claims", () => {
  it.each(["workspace-2", null])(
    "uses verified active_workspace %s instead of query hints",
    async (workspace) => {
      const resolve = vi.fn(async () => ({
        status: "ok",
        claims: {
          sub: "user",
          active_org: "tenant",
          active_workspace: workspace,
          roles: ["org:member"],
        },
      }));
      const middleware = new AuthMiddleware(
        {
          getCurrentUser: vi.fn(async () => ({ id: "user", timezone: null })),
        } as never,
        { resolve } as never,
        { cookieSecure: false, config: { clientId: "console" } } as never,
      );
      const req = {
        headers: { "x-vxture-session": "native" },
        cookies: {},
        query: { workspaceId: "attacker-workspace" },
        activeWorkspaceId: "stale",
        method: "GET",
        url: "/api/tenant-context",
      } as unknown as Request & RequestContext;
      const next = vi.fn();
      await middleware.use(req, {} as Response, next);
      expect(req.auth?.tenantId).toBe("tenant");
      expect(req.activeWorkspaceId).toBe(workspace ?? undefined);
      expect(resolve).toHaveBeenCalledWith("native");
      expect(next).toHaveBeenCalledOnce();
    },
  );
});
