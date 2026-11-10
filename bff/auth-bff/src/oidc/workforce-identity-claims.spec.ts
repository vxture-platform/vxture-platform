/**
 * Workforce OIDC claims preserve the account's email verification evidence.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { OidcService } from "./oidc.service";

// ============================================================================
// Public grant fixtures
// ============================================================================

const VERIFIER = "workforce-identity-claims-proof-key-verifier-123456789";
const REDIRECT = "https://operator.example/callback";

function build(email: string | null, emailVerified: boolean | undefined) {
  const operator = {
    id: "operator-1",
    username: "Operator",
    status: "active",
    roleCode: "operator",
    authenticationVersion: "auth-v1",
    mfaEnrolled: true,
    webauthnRequired: false,
    email,
    emailVerified,
  };
  const client = {
    clientId: "operator-app",
    realm: "workforce",
    tokenEndpointAuthMethod: "none",
    accessTokenTtl: 300,
    allowedScopes: ["openid", "profile", "email"],
  };
  const payload = {
    clientId: client.clientId,
    redirectUri: REDIRECT,
    sub: "opr_operator-1",
    sid: "operator-sid",
    realm: "workforce",
    scope: "openid profile email",
    authTime: 123,
    codeChallenge: createHash("sha256").update(VERIFIER).digest("base64url"),
  };
  const issueAccessToken = vi.fn(
    (_claims: { extra: Record<string, unknown> }) => "access-token",
  );
  const sign = vi.fn((_claims: Record<string, unknown>) => "id-token");
  const customers = { getUserById: vi.fn() };
  const service = Object.create(OidcService.prototype) as OidcService;
  Object.assign(service, {
    keys: {
      isReady: () => true,
      verify: () => ({
        sub: payload.sub,
        aud: client.clientId,
        sid: payload.sid,
        jti: "jti",
        userType: "operator",
        roles: [],
        scope: "openid profile email",
      }),
      sign,
    },
    clients: { findEnabledByClientId: vi.fn(async () => client) },
    operators: { findById: vi.fn(async () => operator) },
    account: customers,
    redis: {
      isBlacklisted: vi.fn(async () => false),
      consumeOidcAuthCode: vi.fn(async () => payload),
      getOidcSession: vi.fn(async () => ({
        ...payload,
        authenticationVersion: "auth-v1",
        authMethod: "password+totp",
        absExpiresAt: Math.floor(Date.now() / 1000) + 300,
      })),
      getOidcActiveOrg: vi.fn(async () => null),
    },
    token: {
      issueAccessToken,
      issueRefreshToken: vi.fn(async () => "refresh-token"),
      inspectRefreshToken: vi.fn(async () => ({
        rec: {
          clientId: client.clientId,
          sessionId: payload.sid,
          userId: operator.id,
        },
      })),
      consumeRefreshToken: vi.fn(async () => ({
        sessionId: payload.sid,
        refreshToken: "rotated-refresh",
      })),
    },
  });
  return { service, issueAccessToken, sign, customers };
}

// ============================================================================
// UserInfo, authorization-code issuance and refresh issuance
// ============================================================================

describe("workforce email verification claims", () => {
  describe.each([true, false, undefined])(
    "verification evidence %s",
    (verified) => {
      it.each(["userinfo", "authorization_code", "refresh_token"] as const)(
        "preserves evidence independently on %s",
        async (surface) => {
          const email = "operator@example.com";
          const f = build(email, verified);
          const expected = { email, email_verified: verified === true };
          if (surface === "userinfo") {
            expect(await f.service.userinfo("access")).toMatchObject(expected);
          } else if (surface === "authorization_code") {
            await f.service.tokenWithAuthCode(
              { clientId: "operator-app" },
              { code: "code", redirectUri: REDIRECT, codeVerifier: VERIFIER },
            );
          } else {
            await f.service.tokenWithRefresh(
              { clientId: "operator-app" },
              { refreshToken: "refresh" },
            );
          }
          expect(f.issueAccessToken).toHaveBeenCalledTimes(
            surface === "userinfo" ? 0 : 1,
          );
          expect(f.sign).toHaveBeenCalledTimes(surface === "userinfo" ? 0 : 1);
          for (const [claims] of f.issueAccessToken.mock.calls) {
            expect(claims.extra).toMatchObject(expected);
          }
          for (const [claims] of f.sign.mock.calls) {
            expect(claims).toMatchObject(expected);
          }
          expect(f.customers.getUserById).not.toHaveBeenCalled();
        },
      );
    },
  );

  it("omits both email claims when no email exists", async () => {
    const f = build(null, true);
    const info = await f.service.userinfo("access");
    expect(info).not.toHaveProperty("email");
    expect(info).not.toHaveProperty("email_verified");
    await f.service.tokenWithAuthCode(
      { clientId: "operator-app" },
      { code: "code", redirectUri: REDIRECT, codeVerifier: VERIFIER },
    );
    await f.service.tokenWithRefresh(
      { clientId: "operator-app" },
      { refreshToken: "refresh" },
    );
    for (const [claims] of f.issueAccessToken.mock.calls) {
      expect(claims.extra).not.toHaveProperty("email");
      expect(claims.extra).not.toHaveProperty("email_verified");
    }
    for (const [claims] of f.sign.mock.calls) {
      expect(claims).not.toHaveProperty("email");
      expect(claims).not.toHaveProperty("email_verified");
    }
  });
});
