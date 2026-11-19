/**
 * Workspace switching must validate and preserve the active organization.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { TenantSwitchRouter } from "./tenant-switch.router";

// ============================================================================
// Verified customer claims and organization-scoped switch preflight
// ============================================================================
const TENANT = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const TARGET = "33333333-3333-4333-8333-333333333333";
function fixture() {
  const client = {
    buildAuthorizeUrl: vi.fn(() => "https://accounts.example/oidc/authorize"),
  };
  const auth = {
    resolve: vi.fn(async () => ({
      status: "ok",
      claims: {
        sub: "usr_user",
        userType: "tenant_user",
        active_org: TENANT,
        active_workspace: WORKSPACE,
        roles: ["workspace:member"],
      },
    })),
  };
  const redis = {
    setex: vi.fn(async (_key: string, _ttl: number, _value: string) => "OK"),
  };
  const aggregator = {
    listWorkspacesForSwitch: vi.fn(async (_user: string, tenant?: string) =>
      tenant === TENANT ? [{ id: TARGET }] : [],
    ),
  };
  const router = new TenantSwitchRouter(
    client as never,
    auth as never,
    redis as never,
    {
      cookieSecure: true,
      config: {
        clientId: "console",
        redirectUri: "https://console.example/auth/callback",
      },
      allowedReturnOrigins: ["https://console.example"],
      defaultReturnTo: "https://console.example/",
      keyPrefix: "test:",
    } as never,
    aggregator as never,
  );
  const redirect = vi.fn();
  const req = {
    cookies: { "__Host-vx_rp_session_console": "session" },
  } as unknown as Request;
  return {
    router,
    client,
    auth,
    redis,
    aggregator,
    redirect,
    req,
    res: { redirect } as unknown as Response,
  };
}

// ============================================================================
// Organization workspace success and fail-closed preflight
// ============================================================================
describe("tenant/workspace switch", () => {
  it("switches an organization workspace rather than checking the personal tenant", async () => {
    const f = fixture();
    await f.router.switchWorkspace(
      TARGET,
      "https://console.example/billing",
      f.req,
      f.res,
    );
    expect(f.aggregator.listWorkspacesForSwitch).toHaveBeenCalledWith(
      "user",
      TENANT,
    );
    expect(f.client.buildAuthorizeUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantHint: TENANT,
        workspaceHint: TARGET,
        prompt: "none",
      }),
    );
    expect(f.redirect).toHaveBeenCalledWith(
      "https://accounts.example/oidc/authorize",
    );
    expect(JSON.parse(f.redis.setex.mock.calls[0]?.[2] ?? "{}")).toMatchObject({
      returnTo: "https://console.example/billing",
    });
  });

  it("does not authorize a workspace outside the current organization", async () => {
    const f = fixture();
    f.aggregator.listWorkspacesForSwitch.mockResolvedValue([]);
    await f.router.switchWorkspace(TARGET, undefined, f.req, f.res);
    expect(f.client.buildAuthorizeUrl).not.toHaveBeenCalled();
    expect(f.redis.setex).not.toHaveBeenCalled();
    expect(f.redirect).toHaveBeenCalledWith("https://console.example/");
  });
});
