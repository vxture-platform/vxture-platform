import { describe, expect, it } from "vitest";
import { isDeletionAllowedRoute } from "./auth.middleware";

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
