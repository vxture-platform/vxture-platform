/**
 * First-party entry and workforce phone isolation regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-08
 */
import { describe, expect, it, vi } from "vitest";
import { OidcService } from "./oidc.service";

describe("first-party Accounts intents", () => {
  it.each(["customer", "workforce"] as const)(
    "creates a fixed %s destination without an RP code",
    async (realm) => {
      const storeOidcLoginChallenge = vi.fn();
      const service = Object.create(OidcService.prototype) as OidcService;
      Object.assign(service, { redis: { storeOidcLoginChallenge } });
      const result = await service.beginAccountsLogin(realm);
      expect(result.loginChallenge).toMatch(/^[\da-f-]{36}$/);
      expect(storeOidcLoginChallenge).toHaveBeenCalledWith(
        result.loginChallenge,
        expect.objectContaining({
          clientId: `accounts-self:${realm}`,
          realm,
          redirectUri: realm === "customer" ? "/account" : "/workforce/account",
        }),
      );
      expect(Object.keys(result)).toEqual(["loginChallenge"]);
    },
  );
});

// ============================================================================
// The phone proof never resolves or creates a customer account.
// ============================================================================
function workforce() {
  const challenge = { realm: "workforce", clientId: "opera" };
  const operators = {
    findByVerifiedPhone: vi.fn(async () => ({ id: "opr_1" })),
  };
  const redis = { readOidcLoginChallenge: vi.fn(async () => challenge) };
  const secondFactor = vi.fn(async () => ({ status: "mfa_required" }));
  const claim = vi.fn();
  const service = Object.create(OidcService.prototype) as OidcService;
  const verifyCode = vi.fn(async () => true);
  Object.assign(service, {
    redis,
    operators,
    workforcePhone: { verifyCode },
    loginClient: async () => ({ realm: "workforce" }),
    claimLoginChallenge: claim,
    beginOperatorSecondFactor: secondFactor,
    operatorGuard: {
      assertWithinRateLimit: vi.fn(),
      recordFailure: vi.fn(),
      recordSuccess: vi.fn(),
    },
  });
  const input = {
    loginChallenge: "challenge",
    phone: "13800000000",
    code: "123456",
    clientIp: "127.0.0.1",
  };
  return {
    service,
    operators,
    challenge,
    verifyCode,
    secondFactor,
    claim,
    input,
  };
}

describe("workforce phone login", () => {
  it("uses the isolated SMS scope and continues into mandatory MFA", async () => {
    const f = workforce();
    expect(await f.service.completeWorkforcePhone(f.input)).toEqual({
      status: "mfa_required",
    });
    expect(f.verifyCode).toHaveBeenCalledWith(f.input.phone, f.input.code, {
      scope: "workforce-login",
    });
    expect(f.secondFactor).toHaveBeenCalledWith(
      { id: "opr_1" },
      expect.anything(),
      f.challenge,
      "phone",
      "127.0.0.1",
      undefined,
    );
    expect(f.claim).toHaveBeenCalledOnce();
  });
  it("rejects customer challenges before looking up a phone or verifying a code", async () => {
    const f = workforce();
    f.challenge.realm = "customer";
    await expect(f.service.completeWorkforcePhone(f.input)).rejects.toThrow(
      "invalid_login_challenge",
    );
    expect(f.verifyCode).not.toHaveBeenCalled();
    expect(f.operators.findByVerifiedPhone).not.toHaveBeenCalled();
  });
  it("never provisions an unknown workforce phone", async () => {
    const f = workforce();
    f.operators.findByVerifiedPhone.mockResolvedValueOnce(null as never);
    await expect(f.service.completeWorkforcePhone(f.input)).rejects.toThrow(
      "invalid_credentials",
    );
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.secondFactor).not.toHaveBeenCalled();
  });
  it("does not resolve an operator after a failed phone proof", async () => {
    const f = workforce();
    f.verifyCode.mockResolvedValueOnce(false);
    await expect(f.service.completeWorkforcePhone(f.input)).rejects.toThrow(
      "invalid_credentials",
    );
    expect(f.operators.findByVerifiedPhone).not.toHaveBeenCalled();
    expect(f.secondFactor).not.toHaveBeenCalled();
  });
});
