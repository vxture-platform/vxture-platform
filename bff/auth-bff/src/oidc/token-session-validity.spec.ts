/**
 * Token grants must not revive ended or invalid identity sessions.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import type { OperatorView } from "@vxture/service-iam";
import type { UserView } from "@vxture/service-account";
import type { SessionRecord } from "../authn/session.service";
import type { OidcCentralSession } from "../redis/redis.service";
import { OidcService } from "./oidc.service";

// ============================================================================
// Public grant fixtures
// ============================================================================

const NOW = 1_794_276_000_000;
const VERIFIER = "token-session-validity-proof-key-verifier-123456789012345";
const REDIRECT = "https://client.example/callback";
type Realm = "customer" | "workforce";
type Grant = "authorization_code" | "refresh_token";

function build(realm: Realm, grant: Grant) {
  const userId = "identity-1";
  const sid = `${realm}-sid`;
  const sub = `${realm === "workforce" ? "opr_" : "usr_"}${userId}`;
  const client = {
    clientId: `${realm}-client`,
    realm,
    tokenEndpointAuthMethod: "none",
    accessTokenTtl: 300,
    allowedScopes: ["openid", "profile"],
  };
  const session: OidcCentralSession = {
    authenticationVersion: "auth-v1",
    sub,
    realm,
    authMethod: realm === "workforce" ? "password+totp" : "password",
    createdAt: NOW / 1000 - 60,
    lastActiveAt: NOW / 1000 - 10,
    absExpiresAt: NOW / 1000 + 300,
  };
  const payload = {
    clientId: client.clientId,
    realm,
    sub,
    sid,
    scope: "openid profile",
    redirectUri: REDIRECT,
    codeChallenge: createHash("sha256").update(VERIFIER).digest("base64url"),
    authTime: NOW / 1000 - 60,
  };
  const durable: SessionRecord = {
    sid,
    realm,
    userId,
    expiresAt: new Date(NOW + 300_000),
  };
  const record = { clientId: client.clientId, sessionId: sid, userId };
  const redis = {
    consumeOidcAuthCode: vi.fn(async () => payload),
    getOidcSession: vi.fn(
      async (): Promise<OidcCentralSession | null> => session,
    ),
    getOidcActiveOrg: vi.fn(async () => null),
    getOidcActiveWorkspace: vi.fn(async () => null),
    deleteOidcSession: vi.fn(),
  };
  const durableSession = {
    get: vi.fn(async (): Promise<SessionRecord | null> => durable),
    isRevoked: vi.fn(async () => false),
  };
  const account = {
    getUserById: vi.fn(
      async (): Promise<Partial<UserView> | null> => ({
        id: userId,
        account: "customer",
        status: "active",
      }),
    ),
  };
  const operators = {
    findById: vi.fn(
      async (): Promise<OperatorView | null> => ({
        id: userId,
        username: "Operator",
        status: "active",
        roleCode: "operator",
        authenticationVersion: "auth-v1",
        mfaEnrolled: true,
        webauthnRequired: false,
        email: null,
        emailVerified: false,
      }),
    ),
  };
  const customerMfa = { enabled: vi.fn(async () => false) };
  const token = {
    issueAccessToken: vi.fn(() => "access-token"),
    issueRefreshToken: vi.fn(async () => "new-refresh-token"),
    inspectRefreshToken: vi.fn(async () => ({ rec: record })),
    consumeRefreshToken: vi.fn(async () => ({
      ...record,
      refreshToken: "rotated-refresh-token",
    })),
    revokeSession: vi.fn(),
  };
  const keys = { isReady: () => true, sign: vi.fn(() => "id-token") };
  const service = Object.create(OidcService.prototype) as OidcService;
  Object.assign(service, {
    keys,
    clients: { findEnabledByClientId: vi.fn(async () => client) },
    redis,
    durableSession,
    account,
    operators,
    customerMfa,
    token,
    activeContext: { resolveActiveContext: vi.fn(async () => null) },
    config: { auth: { OIDC_ISSUER: "https://accounts.example" } },
  });
  const exchange = () =>
    grant === "authorization_code"
      ? service.tokenWithAuthCode(
          { clientId: client.clientId },
          { code: "code", redirectUri: REDIRECT, codeVerifier: VERIFIER },
        )
      : service.tokenWithRefresh(
          { clientId: client.clientId },
          { refreshToken: "refresh" },
        );
  const expectNoIssuance = () => {
    expect(token.issueAccessToken).not.toHaveBeenCalled();
    expect(keys.sign).not.toHaveBeenCalled();
    expect(token.issueRefreshToken).not.toHaveBeenCalled();
    expect(token.consumeRefreshToken).not.toHaveBeenCalled();
    expect(token.revokeSession).not.toHaveBeenCalled();
    expect(redis.deleteOidcSession).not.toHaveBeenCalled();
  };
  return {
    exchange,
    expectNoIssuance,
    session,
    payload,
    durable,
    record,
    redis,
    durableSession,
    account,
    operators,
    customerMfa,
    token,
  };
}

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

// ============================================================================
// Both identity domains must remain live at exchange time
// ============================================================================

describe.each(["authorization_code", "refresh_token"] as const)(
  "%s session validity",
  (grant) => {
    describe.each(["customer", "workforce"] as const)("%s", (realm) => {
      it("issues tokens for a live identity using only its own account authority", async () => {
        const f = build(realm, grant);
        await expect(f.exchange()).resolves.toMatchObject({
          access_token: "access-token",
        });
        expect(f.redis.getOidcSession).toHaveBeenCalledWith(f.payload.sid);
        if (realm === "workforce") {
          expect(f.operators.findById).toHaveBeenCalledWith("identity-1");
          expect(f.account.getUserById).not.toHaveBeenCalled();
          expect(f.durableSession.get).not.toHaveBeenCalled();
          expect(f.customerMfa.enabled).not.toHaveBeenCalled();
        } else {
          expect(f.durableSession.get).toHaveBeenCalledWith(f.payload.sid);
          expect(f.operators.findById).not.toHaveBeenCalled();
        }
      });

      it("rejects a session removed by logout without reviving it", async () => {
        const f = build(realm, grant);
        f.redis.getOidcSession.mockResolvedValue(null);
        await expect(f.exchange()).rejects.toThrow("invalid_grant");
        f.expectNoIssuance();
      });

      it.each([
        { absExpiresAt: NOW / 1000 - 1 },
        { absExpiresAt: NOW / 1000 },
        { absExpiresAt: Number.NaN },
        { absExpiresAt: Number.POSITIVE_INFINITY },
        { realm: "unknown" },
        { sub: "usr_other-identity" },
        { sub: "opr_other-identity" },
      ])(
        "rejects stale or inconsistent central authority %j",
        async (patch) => {
          const f = build(realm, grant);
          Object.assign(f.session, patch);
          await expect(f.exchange()).rejects.toThrow("invalid_grant");
          f.expectNoIssuance();
        },
      );

      it("rejects a disabled identity before issuing or rotating tokens", async () => {
        const f = build(realm, grant);
        if (realm === "workforce") f.operators.findById.mockResolvedValue(null);
        else f.account.getUserById.mockResolvedValue(null);
        await expect(f.exchange()).rejects.toThrow("invalid_grant");
        f.expectNoIssuance();
      });

      it("fails closed when session storage is unavailable", async () => {
        const f = build(realm, grant);
        f.redis.getOidcSession.mockRejectedValue(
          new ServiceUnavailableException("unavailable"),
        );
        await expect(f.exchange()).rejects.toThrow("unavailable");
        f.expectNoIssuance();
      });

      it("does not rotate tokens through an account authority failure", async () => {
        const f = build(realm, grant);
        const authority =
          realm === "workforce" ? f.operators.findById : f.account.getUserById;
        authority.mockRejectedValue(
          new ServiceUnavailableException("authority unavailable"),
        );
        await expect(f.exchange()).rejects.toThrow("authority unavailable");
        f.expectNoIssuance();
      });

      it("rejects a different client before reading the session", async () => {
        const f = build(realm, grant);
        f.payload.clientId = "other-client";
        f.record.clientId = "other-client";
        await expect(f.exchange()).rejects.toThrow("invalid_grant");
        expect(f.redis.getOidcSession).not.toHaveBeenCalled();
        f.expectNoIssuance();
      });
    });

    it("rejects customer sessions revoked by password reset while Redis remains live", async () => {
      const f = build("customer", grant);
      f.durableSession.get.mockResolvedValue(null);
      f.durableSession.isRevoked.mockResolvedValue(true);
      await expect(f.exchange()).rejects.toThrow("invalid_grant");
      f.expectNoIssuance();
    });

    it.each([{ userId: "different-customer" }, { realm: "workforce" }])(
      "rejects a mismatched customer durable session %j",
      async (patch) => {
        const f = build("customer", grant);
        Object.assign(f.durable, patch);
        await expect(f.exchange()).rejects.toThrow("invalid_grant");
        f.expectNoIssuance();
      },
    );

    it("rejects customer sessions that no longer satisfy current MFA policy", async () => {
      const f = build("customer", grant);
      f.customerMfa.enabled.mockResolvedValue(true);
      await expect(f.exchange()).rejects.toThrow("invalid_grant");
      f.expectNoIssuance();
    });

    it.each(["password", "phone", "password+unknown"])(
      "rejects workforce sessions without a valid second factor: %s",
      async (method) => {
        const f = build("workforce", grant);
        f.session.authMethod = method;
        await expect(f.exchange()).rejects.toThrow("invalid_grant");
        f.expectNoIssuance();
      },
    );

    it.each(["totp", "recovery", "webauthn"])(
      "retains workforce second-factor support: %s",
      async (method) => {
        const f = build("workforce", grant);
        f.session.authMethod = `password+${method}`;
        await expect(f.exchange()).resolves.toHaveProperty("access_token");
      },
    );

    it.each(["totp", "recovery"])(
      "accepts current customer MFA: %s",
      async (method) => {
        const f = build("customer", grant);
        f.customerMfa.enabled.mockResolvedValue(true);
        f.session.authMethod = `password+${method}`;
        await expect(f.exchange()).resolves.toHaveProperty("access_token");
      },
    );
  },
);

// ============================================================================
// The grant owner must match the central-session subject exactly
// ============================================================================

it.each(["customer", "workforce"] as const)(
  "does not refresh a %s record bound to another identity",
  async (realm) => {
    const f = build(realm, "refresh_token");
    f.record.userId = "other-identity";
    await expect(f.exchange()).rejects.toThrow("invalid_grant");
    f.expectNoIssuance();
  },
);

it.each(["customer", "workforce"] as const)(
  "does not exchange a %s code under another identity realm",
  async (realm) => {
    const f = build(realm, "authorization_code");
    f.payload.realm = realm === "customer" ? "workforce" : "customer";
    await expect(f.exchange()).rejects.toThrow("invalid_grant");
    f.expectNoIssuance();
  },
);
