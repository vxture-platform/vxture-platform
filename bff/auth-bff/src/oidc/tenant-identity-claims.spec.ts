/**
 * Customer identity and organization presentation contracts.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { describe, it, expect, vi } from "vitest";
import type { UserView } from "@vxture/service-account";
import type { ActiveOrgContext } from "@vxture/service-organization";
import { createHash } from "node:crypto";
import { buildTenantIdentityClaims, OidcService } from "./oidc.service";
import { AuthnService } from "../authn/authn.service";
import { TokenService, type IssueAccessInput } from "../token/token.service";

// ============================================================================
// Account profile claims
// ============================================================================

const user: UserView = {
  id: "u1",
  account: "alice",
  email: "alice@example.com",
  phone: "+8613800000000",
  name: "Alice",
  status: "active",
  avatarHash: null,
};

describe("buildTenantIdentityClaims", () => {
  it("returns no claims when the user is missing", () => {
    expect(
      buildTenantIdentityClaims(null, "openid profile email phone"),
    ).toEqual({});
  });

  it("always releases account_status, and email/phone when present", () => {
    const c = buildTenantIdentityClaims(user, "openid umbra");
    expect(c).toMatchObject({
      account_status: "active",
      email: "alice@example.com",
      email_verified: false,
      phone: "+8613800000000",
      phone_verified: true,
    });
    // display fields stay gated behind the profile scope
    expect(c.name).toBeUndefined();
    expect(c.preferred_username).toBeUndefined();
  });

  it("releases name + preferred_username only with the profile scope", () => {
    const c = buildTenantIdentityClaims(user, "openid profile umbra");
    expect(c.name).toBe("Alice");
    expect(c.preferred_username).toBe("alice");
  });

  it("omits picture when there is no custom avatar", () => {
    const c = buildTenantIdentityClaims(
      user,
      "openid profile",
      "https://accounts.vxture.com",
    );
    expect("picture" in c).toBe(false);
  });

  it("emits a versioned picture URL when a custom avatar exists (profile scope)", () => {
    const c = buildTenantIdentityClaims(
      { ...user, avatarHash: "abc123" },
      "openid profile",
      "https://accounts.vxture.com",
    );
    expect(c.picture).toBe(
      "https://accounts.vxture.com/avatar/usr_u1?v=abc123",
    );
  });

  it("withholds picture without the profile scope even if avatar exists", () => {
    const c = buildTenantIdentityClaims(
      { ...user, avatarHash: "abc123" },
      "openid email",
      "https://accounts.vxture.com",
    );
    expect("picture" in c).toBe(false);
  });

  it("falls back to the account handle when name is null", () => {
    const c = buildTenantIdentityClaims({ ...user, name: null }, "profile");
    expect(c.name).toBe("alice");
  });

  it("omits email/phone claims when the user has none", () => {
    const c = buildTenantIdentityClaims(
      { ...user, email: null, phone: "" },
      "openid profile",
    );
    expect("email" in c).toBe(false);
    expect("email_verified" in c).toBe(false);
    expect("phone" in c).toBe(false);
    expect("phone_verified" in c).toBe(false);
  });
  it("releases durable email verification evidence and defaults missing evidence to false", () => {
    expect(
      buildTenantIdentityClaims({ ...user, emailVerified: true }, "openid")
        .email_verified,
    ).toBe(true);
    expect(
      buildTenantIdentityClaims({ ...user, emailVerified: false }, "openid")
        .email_verified,
    ).toBe(false);
  });
});

// ============================================================================
// Organization context through the public code, refresh and login paths
// ============================================================================

function presentationFixture() {
  const now = Math.floor(Date.now() / 1000);
  const verifier = "organization-presentation-verifier-12345678901234567890";
  const client = {
    clientId: "product-client",
    realm: "customer",
    tokenEndpointAuthMethod: "none",
    accessTokenTtl: 300,
    allowedScopes: ["openid", "profile"],
  };
  const context: ActiveOrgContext = {
    activeOrg: "00000000-0000-4000-8000-000000000001",
    activeOrgType: "organization",
    activeOrgName: "First Organization Limited",
    activeOrgDisplayName: "First",
    activeOrgLogoHash: "a".repeat(64),
    activeWorkspace: "ws-1",
    activeWorkspaceName: "Default",
    roles: ["org:member"],
  };
  const authority = Object.create(TokenService.prototype) as TokenService;
  Object.assign(authority, {
    config: {
      auth: { OIDC_ISSUER: "https://accounts.example", OIDC_ACCESS_TTL: 300 },
    },
    keys: { sign: (claims: Record<string, unknown>) => JSON.stringify(claims) },
  });
  const token = {
    issueAccessToken: vi.fn((input: IssueAccessInput) =>
      authority.issueAccessToken(input),
    ),
    issueRefreshToken: vi.fn(async () => "refresh"),
    inspectRefreshToken: vi.fn(async () => ({
      rec: {
        userId: user.id,
        sessionId: "sid-1",
        clientId: client.clientId,
      },
    })),
    consumeRefreshToken: vi.fn(async () => ({
      userId: user.id,
      sessionId: "sid-1",
      clientId: client.clientId,
      refreshToken: "rotated",
    })),
  };
  const activeContext = {
    resolveActiveContext: vi.fn(async () => ({ ...context })),
  };
  const keys = {
    isReady: () => true,
    sign: vi.fn((_claims: Record<string, unknown>) => "id-token"),
  };
  const oidc = Object.create(OidcService.prototype) as OidcService;
  Object.assign(oidc, {
    config: { auth: { OIDC_ISSUER: "https://accounts.example" } },
    clients: { findEnabledByClientId: vi.fn(async () => client) },
    keys,
    token,
    activeContext,
    account: { getUserById: vi.fn(async () => user) },
    customerMfa: { enabled: vi.fn(async () => false) },
    durableSession: {
      get: vi.fn(async () => ({
        sid: "sid-1",
        realm: "customer",
        userId: user.id,
        expiresAt: new Date((now + 300) * 1000),
      })),
      isRevoked: vi.fn(async () => false),
    },
    appScope: { resolveClaims: vi.fn(async () => ({})) },
    redis: {
      consumeOidcAuthCode: vi.fn(async () => ({
        clientId: client.clientId,
        realm: "customer",
        sub: `usr_${user.id}`,
        sid: "sid-1",
        scope: "openid profile",
        redirectUri: "https://product.example/callback",
        codeChallenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        authTime: now - 60,
        activeOrg: context.activeOrg,
      })),
      getOidcSession: vi.fn(async () => ({
        sub: `usr_${user.id}`,
        realm: "customer",
        authMethod: "password",
        createdAt: now - 60,
        lastActiveAt: now,
        absExpiresAt: now + 300,
      })),
      getOidcActiveOrg: vi.fn(async () => context.activeOrg),
      getOidcActiveWorkspace: vi.fn(async () => context.activeWorkspace),
    },
  });
  const exchange = (grant: "code" | "refresh") =>
    grant === "code"
      ? oidc.tokenWithAuthCode(
          { clientId: client.clientId },
          {
            code: "code",
            redirectUri: "https://product.example/callback",
            codeVerifier: verifier,
          },
        )
      : oidc.tokenWithRefresh(
          { clientId: client.clientId },
          { refreshToken: "refresh" },
        );
  return { oidc, exchange, context, token, keys, activeContext };
}

describe("organization presentation", () => {
  it.each(["code", "refresh"] as const)(
    "releases separate full and short names through the %s grant and reloads changes",
    async (grant) => {
      const f = presentationFixture();
      const first = await f.exchange(grant);
      expect(JSON.parse(first.access_token)).toMatchObject({
        active_org: "00000000-0000-4000-8000-000000000001",
        active_org_logo_url: `https://accounts.example/avatar/organization/00000000-0000-4000-8000-000000000001/${"a".repeat(64)}`,
        active_org_name: "First Organization Limited",
        active_org_display_name: "First",
        roles: ["org:member"],
      });
      f.context.activeOrg = "00000000-0000-4000-8000-000000000002";
      f.context.activeOrgLogoHash = "b".repeat(64);
      f.context.activeOrgName = "Second Organization Limited";
      f.context.activeOrgDisplayName = "Second";
      const second = await f.exchange(grant);
      expect(JSON.parse(second.access_token)).toMatchObject({
        active_org: "00000000-0000-4000-8000-000000000002",
        active_org_logo_url: `https://accounts.example/avatar/organization/00000000-0000-4000-8000-000000000002/${"b".repeat(64)}`,
        active_org_name: "Second Organization Limited",
        active_org_display_name: "Second",
        roles: ["org:member"],
      });
      f.context.activeOrgDisplayName = "";
      f.context.activeOrgLogoHash = null;
      expect(
        JSON.parse((await f.exchange(grant)).access_token),
      ).not.toHaveProperty("active_org_logo_url");
      expect(
        JSON.parse((await f.exchange(grant)).access_token),
      ).not.toHaveProperty("active_org_display_name");
      for (const [claims] of f.keys.sign.mock.calls) {
        expect(claims).not.toHaveProperty("active_org_display_name");
        expect(claims).not.toHaveProperty("active_org_logo_url");
      }
    },
  );

  it.each([
    {
      userType: "operator",
      activeOrg: "00000000-0000-4000-8000-000000000001",
      activeOrgLogoHash: "a".repeat(64),
    },
    {
      userType: "tenant_user",
      activeOrg: "untrusted/path",
      activeOrgLogoHash: "a".repeat(64),
    },
    {
      userType: "tenant_user",
      activeOrg: "00000000-0000-4000-8000-000000000001",
      activeOrgLogoHash: "invalid",
    },
  ])("omits logo URLs outside a valid customer context (%j)", (context) => {
    const authority = Object.create(TokenService.prototype) as TokenService;
    const sign = vi.fn((_claims: Record<string, unknown>) => "token");
    Object.assign(authority, { keys: { sign } });
    authority.issueAccessToken({
      sub: "usr_u1",
      audience: "product",
      ttlSeconds: 300,
      ...context,
    });
    expect(sign.mock.calls[0]?.[0]).not.toHaveProperty("active_org_logo_url");
  });

  it("advertises optional organization presentation claims in discovery", () => {
    expect(
      presentationFixture().oidc.buildDiscoveryDocument().claims_supported,
    ).toContain("active_org_logo_url");
    expect(
      presentationFixture().oidc.buildDiscoveryDocument().claims_supported,
    ).toContain("active_org_display_name");
  });

  it("passes the short name through direct login and the real token authority", async () => {
    const f = presentationFixture();
    const login = Object.create(AuthnService.prototype) as AuthnService;
    Object.assign(login, {
      activeContext: f.activeContext,
      token: f.token,
      session: { create: vi.fn(async () => ({ sid: "sid-1" })) },
    });
    await login.completeLogin(user, {
      clientId: "product-client",
      authMethod: "password",
    });
    const input = f.token.issueAccessToken.mock.calls[0]![0];
    const authority = Object.create(TokenService.prototype) as TokenService;
    const sign = vi.fn(() => "signed-token");
    Object.assign(authority, {
      keys: { sign },
      config: { auth: { OIDC_ISSUER: "https://accounts.example" } },
    });
    authority.issueAccessToken({ ...input, ttlSeconds: 300 });
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        active_org_name: "First Organization Limited",
        active_org_display_name: "First",
        active_org_logo_url: `https://accounts.example/avatar/organization/00000000-0000-4000-8000-000000000001/${"a".repeat(64)}`,
      }),
      expect.objectContaining({
        audience: "product-client",
        subject: "usr_u1",
      }),
    );
  });
});
