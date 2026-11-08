/**
 * Customer MFA isolation, replay prevention and ownership regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-08
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateTotp, hashRecoveryCode } from "@vxture/service-iam";
import { CustomerMfaService } from "./customer-mfa.service";
import { OidcService } from "./oidc.service";

// ============================================================================
// Stateful fixtures preserve single-use and concurrent-consumption behavior.
// ============================================================================
function fixture() {
  const ceremonies = new Map<string, string>();
  let factor: { secret: string; version: string } | null = null;
  let lastCounter = -1;
  const hashes = new Set<string>();
  const repo = {
    read: vi.fn(async () => factor),
    activate: vi.fn(
      async (
        _id: string,
        secret: string,
        recovery: string[],
        counter: number,
      ) => {
        if (factor) return false;
        factor = { secret, version: "factor-version" };
        lastCounter = counter;
        recovery.forEach((hash) => hashes.add(hash));
        return true;
      },
    ),
    consumeCounter: vi.fn(
      async (_id: string, version: string, counter: number) => {
        if (version !== factor?.version || counter <= lastCounter) return false;
        lastCounter = counter;
        return true;
      },
    ),
    consumeRecovery: vi.fn(
      async (_id: string, version: string, hash: string) =>
        version === factor?.version && hashes.delete(hash),
    ),
  };
  const redis = {
    storeAccountsCeremony: vi.fn(async (token: string, value: unknown) => {
      ceremonies.set(token, JSON.stringify(value));
    }),
    attemptAccountsCeremony: vi.fn(
      async (token: string) => ceremonies.get(token) ?? null,
    ),
    consumeAccountsCeremony: vi.fn(async (token: string, raw: string) => {
      if (ceremonies.get(token) !== raw) return false;
      ceremonies.delete(token);
      return true;
    }),
    reserveCustomerSecurityBudget: vi.fn(async () => true),
  };
  const service = new CustomerMfaService(
    repo as never,
    redis as never,
    {
      auth: {
        OPERATOR_TOTP_ENC_KEY: "test-customer-encryption-key-0123456789",
      },
    } as never,
  );
  return { service, repo, redis, hashes, ceremonies };
}
afterEach(() => vi.useRealTimers());

// ============================================================================
// Enrollment and verification
// ============================================================================
describe("customer MFA ceremonies", () => {
  it("encrypts pending material and binds confirmation to account and session", async () => {
    const f = fixture();
    const setup = await f.service.beginEnrollment("customer", "sid", "alice");
    expect(f.ceremonies.get(setup.enrollmentToken)).not.toContain(setup.secret);
    expect(setup.otpauthUri).toContain("VXTURE");
    const code = generateTotp(setup.secret);
    await expect(
      f.service.confirmEnrollment("other", "sid", setup.enrollmentToken, code),
    ).rejects.toThrow("mfa_owner_mismatch");
    await expect(
      f.service.confirmEnrollment(
        "customer",
        "other",
        setup.enrollmentToken,
        code,
      ),
    ).rejects.toThrow("mfa_owner_mismatch");
    expect(f.repo.activate).not.toHaveBeenCalled();
    const result = await f.service.confirmEnrollment(
      "customer",
      "sid",
      setup.enrollmentToken,
      code,
    );
    expect(result.recoveryCodes.length).toBeGreaterThan(0);
    expect(f.hashes.has(hashRecoveryCode(result.recoveryCodes[0]!))).toBe(true);
    await expect(
      f.service.confirmEnrollment(
        "customer",
        "sid",
        setup.enrollmentToken,
        code,
      ),
    ).rejects.toThrow("mfa_session_expired");
    await expect(
      f.service.beginEnrollment("customer", "sid", "alice"),
    ).rejects.toThrow("mfa_already_enrolled");
  });
  it("rejects reuse of the enrollment time step, concurrent TOTP reuse and recovery reuse", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-08T00:00:00Z"));
    const f = fixture();
    const setup = await f.service.beginEnrollment("customer", "sid", "alice");
    const initial = generateTotp(setup.secret);
    const result = await f.service.confirmEnrollment(
      "customer",
      "sid",
      setup.enrollmentToken,
      initial,
    );
    expect(await f.service.verify("customer", "totp", initial)).toBe(false);
    vi.advanceTimersByTime(30000);
    const next = generateTotp(setup.secret);
    const attempts = await Promise.all([
      f.service.verify("customer", "totp", next),
      f.service.verify("customer", "totp", next),
    ]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(
      await f.service.verify("customer", "recovery", result.recoveryCodes[0]!),
    ).toBe(true);
    expect(
      await f.service.verify("customer", "recovery", result.recoveryCodes[0]!),
    ).toBe(false);
    expect(await f.service.verify("customer", "password", "123456")).toBe(
      false,
    );
  });
  it("fails closed on the shared account attempt budget", async () => {
    const f = fixture();
    f.redis.reserveCustomerSecurityBudget.mockResolvedValue(false);
    await expect(
      f.service.verify("customer", "totp", "123456"),
    ).rejects.toThrow("too_many_attempts");
    expect(f.repo.read).not.toHaveBeenCalled();
  });
  it("does not activate an invalid code or a ceremony from another purpose", async () => {
    const f = fixture();
    const setup = await f.service.beginEnrollment("customer", "sid", "alice");
    await expect(
      f.service.confirmEnrollment(
        "customer",
        "sid",
        setup.enrollmentToken,
        "abc",
      ),
    ).rejects.toThrow("invalid_code");
    f.ceremonies.set(
      setup.enrollmentToken,
      JSON.stringify({
        kind: "customer-login",
        userId: "customer",
        sid: "sid",
      }),
    );
    await expect(
      f.service.confirmEnrollment(
        "customer",
        "sid",
        setup.enrollmentToken,
        "123456",
      ),
    ).rejects.toThrow("mfa_owner_mismatch");
    expect(f.repo.activate).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Login continuation must not issue a session early or cross identity domains.
// ============================================================================
describe("customer MFA login boundary", () => {
  function login() {
    const pending = {
      kind: "customer-login",
      userId: "customer",
      challenge: { realm: "customer", clientId: "app" },
      authMethod: "phone",
      meta: {},
    };
    const redis = {
      attemptAccountsCeremony: vi.fn(async () => JSON.stringify(pending)),
      consumeAccountsCeremony: vi.fn(async () => true),
    };
    const mfa = {
      verify: vi.fn(async () => true),
      enabled: vi.fn(async () => true),
    };
    const finish = vi.fn(async () => ({ redirectTo: "/account" }));
    const service = Object.create(OidcService.prototype) as OidcService;
    Object.assign(service, {
      redis,
      customerMfa: mfa,
      account: { getUserById: async () => ({ status: "active" }) },
      loginClient: async () => ({ realm: "customer" }),
      finishTenantLogin: finish,
    });
    return { service, pending, redis, mfa, finish };
  }
  it("consumes both the factor and exact pending login before finishing", async () => {
    const f = login();
    await f.service.completeCustomerMfa("token", "totp", "123456");
    expect(f.finish).toHaveBeenCalledWith(
      "customer",
      expect.anything(),
      f.pending.challenge,
      "phone+totp",
      {},
      true,
    );
  });
  it.each(["workforce", "unknown"])(
    "rejects %s continuations",
    async (realm) => {
      const f = login();
      f.pending.challenge.realm = realm;
      await expect(
        f.service.completeCustomerMfa("token", "totp", "123456"),
      ).rejects.toThrow("invalid_mfa_context");
      expect(f.mfa.verify).not.toHaveBeenCalled();
      expect(f.finish).not.toHaveBeenCalled();
    },
  );
  it("does not create a session for a bad factor or lost consumption race", async () => {
    const f = login();
    f.mfa.verify.mockResolvedValueOnce(false);
    await expect(
      f.service.completeCustomerMfa("token", "totp", "123456"),
    ).rejects.toThrow("invalid_mfa_code");
    expect(f.redis.consumeAccountsCeremony).not.toHaveBeenCalled();
    f.redis.consumeAccountsCeremony.mockResolvedValue(false);
    await expect(
      f.service.completeCustomerMfa("token", "totp", "123456"),
    ).rejects.toThrow("mfa_session_expired");
    expect(f.finish).not.toHaveBeenCalled();
  });
});
