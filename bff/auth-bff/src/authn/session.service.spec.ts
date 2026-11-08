/**
 * Customer durable-session revocation regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { SessionService } from "./session.service";
import { OidcService } from "../oidc/oidc.service";

// ============================================================================
// Durable customer session checks
// ============================================================================

describe("customer durable-session validity", () => {
  it.each([
    [[], true],
    [[{ status: "active", realm: "customer", unexpired: true }], false],
    [[{ status: "revoked", realm: "customer", unexpired: true }], true],
    [[{ status: "active", realm: "customer", unexpired: false }], true],
    [[{ status: "active", realm: "workforce", unexpired: true }], true],
    [[{ status: "active", realm: "customer" }], true],
  ] as const)(
    "evaluates the durable record %j as revoked=%s",
    async (rows, revoked) => {
      const pool = { query: vi.fn(async () => ({ rows })) };
      const service = new SessionService(pool as never, {} as never);
      expect(await service.isRevoked("sid")).toBe(revoked);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("expires_at > now() as unexpired"),
        ["sid"],
      );
    },
  );

  it("propagates store outages rather than treating the session as valid", async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    };
    const service = new SessionService(pool as never, {} as never);
    await expect(service.isRevoked("sid")).rejects.toThrow(
      "database unavailable",
    );
  });
});

// ============================================================================
// Silent SSO must honor durable revocation
// ============================================================================

describe("revoked customer sessions cannot resume OIDC login", () => {
  it.each([
    { rows: [] },
    { rows: [{ status: "revoked", realm: "customer", unexpired: true }] },
  ])(
    "does not issue an authorization code for durable rows %j",
    async ({ rows }) => {
      const durable = new SessionService(
        { query: vi.fn(async () => ({ rows })) } as never,
        {} as never,
      );
      const redis = {
        peekOidcLoginChallenge: vi.fn(async () => ({
          realm: "customer",
          clientId: "website",
        })),
        getOidcSession: vi.fn(async () => ({
          realm: "customer",
          sub: "usr_customer-1",
        })),
        consumeOidcLoginChallenge: vi.fn(),
      };
      const issueAuthCode = vi.fn();
      const oidc = Object.create(OidcService.prototype) as OidcService;
      Object.assign(oidc, { redis, durableSession: durable, issueAuthCode });
      expect(
        await oidc.resumeWithExistingSession("challenge", {
          tenant: "old-sid",
        }),
      ).toBeNull();
      expect(redis.consumeOidcLoginChallenge).not.toHaveBeenCalled();
      expect(issueAuthCode).not.toHaveBeenCalled();
    },
  );
});
