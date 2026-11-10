/**
 * Identity realm isolation regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-06
 */
import { describe, expect, it, vi } from "vitest";
import { OidcService } from "./oidc.service";
import { OidcRouter } from "../routers/oidc.router";
import type { Request, Response } from "express";

function build(
  realm: "customer" | "workforce",
  extra: Record<string, unknown> = {},
) {
  const challenge = {
    realm,
    clientId: "app",
    redirectUri: "https://app.example/callback",
    scope: "openid",
    codeChallenge: "pkce",
    ...extra,
  };
  const redis = {
    peekOidcLoginChallenge: vi.fn(async () => challenge),
    readOidcLoginChallenge: vi.fn(async () => challenge),
    consumeOidcLoginChallenge: vi.fn(async () => challenge),
    getOidcSession: vi.fn(async (sid: string) => ({
      authMethod: "password+totp",
      authenticationVersion: "auth-v1",
      absExpiresAt: Math.floor(Date.now() / 1000) + 300,
      realm: sid === "customer-sid" ? "customer" : "workforce",
      sub: sid === "customer-sid" ? "usr_1" : "opr_1",
    })),
  };
  const client = { clientId: "app", realm };
  const service = Object.create(OidcService.prototype) as OidcService;
  const issueAuthCode = vi.fn(async () => "code");
  const clients = { findEnabledByClientId: vi.fn(async () => client) };
  const operator = {
    id: "1",
    authenticationVersion: "auth-v1",
    mfaEnrolled: true,
    webauthnRequired: false,
  };
  Object.assign(service, {
    operators: { findById: vi.fn(async () => operator) },
    customerMfa: { enabled: async () => false },
    redis,
    clients,
    durableSession: { isRevoked: vi.fn(async () => false) },
    resolveActiveOrg: vi.fn(async () => null),
    issueAuthCode,
  });
  return { service, redis, clients, client, issueAuthCode, operator };
}
const sids = { tenant: "customer-sid", operator: "workforce-sid" };

describe("login resume realm selection", () => {
  it("rejects a workforce session without a current authentication snapshot", async () => {
    const { service, redis, operator, issueAuthCode } = build("workforce");
    operator.authenticationVersion = "";
    await expect(
      service.resumeWithExistingSession("challenge", sids),
    ).resolves.toBeNull();
    expect(redis.consumeOidcLoginChallenge).not.toHaveBeenCalled();
    expect(issueAuthCode).not.toHaveBeenCalled();
  });

  it.each(["customer", "workforce"] as const)(
    "selects only the %s cookie when both exist",
    async (realm) => {
      const { service, redis, issueAuthCode } = build(realm);
      await expect(
        service.resumeWithExistingSession("challenge", sids),
      ).resolves.toContain("code=code");
      expect(redis.getOidcSession).toHaveBeenCalledWith(
        realm === "customer" ? sids.tenant : sids.operator,
      );
      expect(issueAuthCode).toHaveBeenCalledWith(
        expect.objectContaining({
          realm,
          sub: realm === "customer" ? "usr_1" : "opr_1",
        }),
      );
    },
  );

  it("never falls back to the other realm cookie", async () => {
    const { service, redis } = build("customer");
    await expect(
      service.resumeWithExistingSession("challenge", {
        operator: sids.operator,
      }),
    ).resolves.toBeNull();
    expect(redis.consumeOidcLoginChallenge).not.toHaveBeenCalled();
  });

  it("cannot bypass forced reauthentication through a focus event", async () => {
    const { service, redis } = build("workforce", {
      requiresReauthentication: true,
    });
    await expect(
      service.resumeWithExistingSession("challenge", sids),
    ).resolves.toBeNull();
    expect(redis.consumeOidcLoginChallenge).not.toHaveBeenCalled();
  });

  it("rejects a client moved to another realm without consuming the challenge", async () => {
    const { service, redis, client } = build("customer");
    client.realm = "workforce";
    await expect(
      service.resumeWithExistingSession("challenge", sids),
    ).resolves.toBeNull();
    expect(redis.consumeOidcLoginChallenge).not.toHaveBeenCalled();
    await expect(service.loginContext("challenge")).rejects.toThrow(
      "invalid_client_realm",
    );
  });

  it("rejects a crossed subject namespace", async () => {
    const { service, redis } = build("customer");
    redis.getOidcSession.mockResolvedValueOnce({
      authMethod: "password+totp",
      authenticationVersion: "auth-v1",
      absExpiresAt: Math.floor(Date.now() / 1000) + 300,
      realm: "customer",
      sub: "opr_1",
    });
    await expect(
      service.resumeWithExistingSession("challenge", sids),
    ).resolves.toBeNull();
    expect(redis.consumeOidcLoginChallenge).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Server-owned presentation and minting boundaries
// ============================================================================

describe("login metadata and authorization code boundaries", () => {
  it("resolves presentation from the challenge and client", async () => {
    const { service } = build("workforce");
    await expect(service.loginContext("challenge")).resolves.toEqual({
      realm: "workforce",
    });
  });

  it("rejects realm mismatch before credential verification", async () => {
    const { service, client, redis } = build("customer");
    client.realm = "workforce";
    await expect(
      service.completeLoginWithPassword({
        loginChallenge: "challenge",
        identifier: "user",
        password: "password",
      }),
    ).rejects.toThrow("invalid_client_realm");
    expect(redis.consumeOidcLoginChallenge).not.toHaveBeenCalled();
  });

  it("rejects a crossed subject before storing an authorization code", async () => {
    const service = Object.create(OidcService.prototype) as OidcService;
    const storeOidcAuthCode = vi.fn();
    Object.assign(service, { redis: { storeOidcAuthCode } });
    await expect(
      service.issueAuthCode({
        client: { realm: "customer" } as never,
        realm: "customer",
        sub: "opr_1",
        sid: "sid",
        redirectUri: "https://app.example/callback",
        scope: "openid",
        codeChallenge: "pkce",
        activeOrg: null,
      }),
    ).rejects.toThrow("invalid_grant");
    expect(storeOidcAuthCode).not.toHaveBeenCalled();
  });

  it.each(["customer", "workforce"] as const)(
    "redirects %s to its canonical login entry",
    async (realm) => {
      const oidc = {
        authorize: vi.fn(async () => ({
          kind: "login",
          realm,
          loginChallenge: "challenge",
        })),
      };
      const router = new OidcRouter(
        oidc as never,
        {
          platform: { LOGIN_UI_BASE_URL: "https://accounts.example" },
        } as never,
      );
      const res = { redirect: vi.fn() };
      await router.authorize(
        {
          client_id: "app",
          redirect_uri: "https://app.example/callback",
          scope: "openid",
          code_challenge: "pkce",
        },
        { cookies: {} } as Request,
        res as unknown as Response,
      );
      const url = new URL(res.redirect.mock.calls[0]![0] as string);
      expect(url.pathname).toBe(
        realm === "customer" ? "/login" : "/workforce/login",
      );
      expect(url.searchParams.has("realm")).toBe(false);
    },
  );
});

// ============================================================================
// Refresh and account center boundaries
// ============================================================================

describe("refresh realm binding", () => {
  it("refuses a changed client realm before rotating the refresh token", async () => {
    const service = Object.create(OidcService.prototype) as OidcService;
    const consumeRefreshToken = vi.fn();
    Object.assign(service, {
      keys: { isReady: () => true },
      authClient: vi.fn(async () => ({ clientId: "app", realm: "workforce" })),
      token: {
        inspectRefreshToken: vi.fn(async () => ({
          rec: { clientId: "app", sessionId: "sid" },
        })),
        consumeRefreshToken,
      },
      redis: {
        getOidcSession: vi.fn(async () => ({
          realm: "customer",
          sub: "usr_1",
        })),
      },
    });
    await expect(
      service.tokenWithRefresh(
        { clientId: "app" },
        { refreshToken: "refresh" },
      ),
    ).rejects.toThrow("invalid_grant");
    expect(consumeRefreshToken).not.toHaveBeenCalled();
  });

  it("rejects workforce sessions presented to customer onboarding", async () => {
    const { service, redis } = build("workforce");
    redis.getOidcSession.mockResolvedValueOnce({
      authMethod: "password+totp",
      authenticationVersion: "auth-v1",
      absExpiresAt: Math.floor(Date.now() / 1000) + 300,
      realm: "workforce",
      sub: "usr_1",
    });
    await expect(service.getOnboardingState("sid")).rejects.toThrow(
      "invalid_session",
    );
  });
});

// ============================================================================
// Explicit reauthentication survives the browser focus/resume lifecycle
// ============================================================================

describe("interactive prompt persistence", () => {
  it.each(["login", "select_account"])(
    "records %s on the parked challenge",
    async (prompt) => {
      const { service, redis, client } = build("customer");
      const storeOidcLoginChallenge = vi.fn();
      Object.assign(client, {
        redirectUris: ["https://app.example/callback"],
        allowedScopes: ["openid"],
      });
      Object.assign(redis, { storeOidcLoginChallenge });
      await expect(
        service.authorize(
          {
            clientId: "app",
            redirectUri: "https://app.example/callback",
            responseType: "code",
            codeChallengeMethod: "S256",
            codeChallenge: "pkce",
            scope: "openid",
            prompt,
          },
          sids,
        ),
      ).resolves.toMatchObject({ kind: "login", realm: "customer" });
      expect(storeOidcLoginChallenge).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ requiresReauthentication: true }),
      );
    },
  );
});
