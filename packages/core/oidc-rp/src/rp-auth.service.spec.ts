/**
 * RP authorization outcomes independent of the Redis implementation.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { describe, it, expect, vi } from "vitest";
import { RpAuthService, type RpAuthStore } from "./rp-auth.service";
import { OidcTokenRequestError, rpAuthFailure } from "./rp-auth.failure";
import type { OidcRpClient, RpSession } from "./types";

// ============================================================================
// Orchestration fixture; storage atomicity is tested against real Redis.
// ============================================================================
const now = () => Math.floor(Date.now() / 1000);
function fixture(expires = now() + 3600) {
  const session: RpSession = {
    sid: "central",
    sub: "usr_test",
    idToken: "id",
    accessToken: "access",
    refreshToken: "refresh",
    accessExpiresAt: expires,
  };
  let current: RpSession | null = session;
  const store = {
    get: vi.fn(async () => current),
    update: vi.fn(async (_id: string, updated: RpSession) => {
      current = updated;
      return true;
    }),
    lockRefresh: vi.fn(async () => true),
    unlockRefresh: vi.fn(async () => {}),
  } satisfies RpAuthStore;
  const client = {
    buildAuthorizeUrl: () => "",
    buildEndSessionUrl: () => "",
    exchangeCode: vi.fn(async () => session),
    refresh: vi.fn(async () => ({
      ...session,
      accessToken: "rotated",
      accessExpiresAt: now() + 3600,
    })),
    verifyAccessToken: vi.fn(async () => ({
      sub: "usr_test",
      sid: "central",
      active_org: "org",
    })),
    verifyIdToken: vi.fn(async () => ({
      sub: "usr_test",
      sid: "central",
      iss: "issuer",
      aud: "console",
      exp: now() + 3600,
    })),
    verifyLogoutToken: vi.fn(async () => ({ sid: "central" })),
  } satisfies OidcRpClient;
  return {
    store,
    client,
    session,
    revoke: () => {
      current = null;
    },
    auth: new RpAuthService(store, client, 3600),
  };
}

// ============================================================================
// Outcome and identity guarantees
// ============================================================================
describe("RP authentication", () => {
  it("returns expired only for missing local identity", async () => {
    const f = fixture();
    expect(await f.auth.resolve(undefined)).toEqual({ status: "expired" });
    f.revoke();
    expect(await f.auth.resolve("a")).toEqual({ status: "expired" });
  });
  it("verifies a usable token without refreshing", async () => {
    const f = fixture();
    expect(await f.auth.resolve("a")).toMatchObject({
      status: "ok",
      refreshed: false,
    });
    expect(f.client.refresh).not.toHaveBeenCalled();
  });
  it("shares one refresh and updates context from verified claims", async () => {
    const f = fixture(now() - 1);
    const outcomes = await Promise.all([
      f.auth.resolve("a"),
      f.auth.resolve("a"),
      f.auth.resolve("a"),
    ]);
    expect(f.client.refresh).toHaveBeenCalledTimes(1);
    expect(outcomes.every((outcome) => outcome.status === "ok")).toBe(true);
    expect(await f.store.get()).toMatchObject({
      accessToken: "rotated",
      activeOrg: "org",
    });
  });
  it.each([
    new Error("timeout"),
    new OidcTokenRequestError(false),
    new OidcTokenRequestError(true),
  ])(
    "retains identity and rejects expired authorization on refresh error %s",
    async (error) => {
      const f = fixture(now() - 1);
      f.client.refresh.mockRejectedValue(error);
      const result = await f.auth.resolve("a");
      expect(result).toEqual({
        status: "unavailable",
        reauthorizationRequired:
          error instanceof OidcTokenRequestError &&
          error.reauthorizationRequired,
      });
      expect(await f.store.get()).toEqual(f.session);
      expect(f.store.update).not.toHaveBeenCalled();
    },
  );
  it("can still use a valid verified access token during a proactive refresh outage", async () => {
    const f = fixture(now() + 20);
    f.client.refresh.mockRejectedValue(new Error("network"));
    expect(await f.auth.resolve("a")).toMatchObject({
      status: "ok",
      accessToken: "access",
      refreshed: false,
    });
  });
  it("does not publish tokens bound to another identity", async () => {
    const f = fixture(now() - 1);
    f.client.verifyIdToken.mockResolvedValue({
      sub: "usr_other",
      sid: "central",
      iss: "issuer",
      aud: "console",
      exp: now() + 3600,
    });
    expect(await f.auth.resolve("a")).toEqual({
      status: "unavailable",
      reauthorizationRequired: true,
    });
    expect(f.store.update).not.toHaveBeenCalled();
  });
  it("does not authorize when logout arrives during verification", async () => {
    const f = fixture();
    f.client.verifyAccessToken.mockImplementation(async () => {
      f.revoke();
      return { sub: "usr_test", sid: "central", active_org: "org" };
    });
    expect(await f.auth.resolve("a")).toEqual({ status: "expired" });
  });
  it("reports storage and JWKS failures as availability, with no write", async () => {
    const f = fixture();
    f.store.get.mockRejectedValueOnce(new Error("Redis unavailable"));
    expect((await f.auth.resolve("a")).status).toBe("unavailable");
    f.client.verifyAccessToken.mockRejectedValue(new Error("JWKS unavailable"));
    expect((await f.auth.resolve("a")).status).toBe("unavailable");
    expect(f.store.update).not.toHaveBeenCalled();
  });
  it("does not return uncommitted refresh results after a failed CAS", async () => {
    const f = fixture(now() - 1);
    f.store.update.mockResolvedValue(false);
    expect((await f.auth.resolve("a")).status).toBe("unavailable");
    expect(await f.store.get()).toEqual(f.session);
  });
  it("bounds lock contention and never makes a competing refresh", async () => {
    const f = fixture(now() - 1);
    f.store.lockRefresh.mockResolvedValue(false);
    expect((await f.auth.resolve("a")).status).toBe("unavailable");
    expect(f.client.refresh).not.toHaveBeenCalled();
  });
  it("maps upstream failure separately from missing-session responses", () => {
    expect(
      rpAuthFailure({ status: "unavailable", reauthorizationRequired: false }),
    ).toMatchObject({ statusCode: 503, retryable: true });
    expect(
      rpAuthFailure({ status: "unavailable", reauthorizationRequired: true }),
    ).toMatchObject({ statusCode: 503, retryable: false });
  });
});
