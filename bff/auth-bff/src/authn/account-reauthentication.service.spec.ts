/**
 * Fresh ownership proof policy, binding, expiry and replay regressions.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountReauthenticationService } from "./account-reauthentication.service";

// ============================================================================
// Deterministic CAS store and current identity authorities
// ============================================================================
function build() {
  const values = new Map<string, string>();
  const redis = {
    reserveCustomerSecurityBudget: vi.fn(async () => true),
    createAccountReauthentication: vi.fn(async (id: string, raw: string) => {
      if (values.has(id)) return false;
      values.set(id, raw);
      return true;
    }),
    readAccountReauthentication: vi.fn(
      async (id: string) => values.get(id) ?? null,
    ),
    swapAccountReauthentication: vi.fn(
      async (id: string, raw: string, next: string | null) => {
        if (values.get(id) !== raw) return false;
        if (next === null) values.delete(id);
        else values.set(id, next);
        return true;
      },
    ),
  };
  const user = {
    status: "active",
    hasPassword: true,
    phone: "+8613800138000",
    phoneVerified: true,
    email: "owner@example.test",
    emailVerified: true,
  };
  const realms = {
    requireCustomer: vi.fn(async (sid: string) => ({
      sid,
      userId: "u1",
      user,
    })),
    requireOperator: vi.fn(async () => "o1"),
  };
  const accounts = {
    selfSecurityVersion: vi.fn(async () => "credentials-v1"),
    verifySelfPassword: vi.fn(
      async (_id: string, value: string) => value === "password",
    ),
  };
  const factors = {
    read: vi.fn(async (): Promise<{ version: string } | null> => null),
  };
  const operators = {
    findById: vi.fn(async () => ({ authenticationVersion: "operator-v1" })),
  };
  const customerMfa = {
    verify: vi.fn(
      async (_id: string, _method: string, code: string) => code === "123456",
    ),
  };
  const operatorMfa = {
    resolveLoginMfa: vi.fn(async () => ({ methods: ["totp", "webauthn"] })),
    verifySecondFactor: vi.fn(async () => true),
  };
  const webauthn = {
    createAuthenticationOptions: vi.fn(async () => ({
      challenge: "stepup-only",
    })),
    verifyAuthentication: vi.fn(async () => true),
  };
  const sms = {
    sendCode: vi.fn(async () => {}),
    verifyCode: vi.fn(async () => true),
  };
  const mail = { sendVerifyCode: vi.fn(async () => {}) };
  const service = new AccountReauthenticationService(
    redis as never,
    realms as never,
    accounts as never,
    factors as never,
    operators as never,
    customerMfa as never,
    operatorMfa as never,
    webauthn as never,
    sms as never,
    mail as never,
  );
  async function passwordProof(operation = "account-login", target = "false") {
    const ticket = await service.start("customer", "sid", {
      operation,
      target,
      method: "password",
    });
    return service.verify("customer", "sid", ticket.verificationId, {
      password: "password",
    });
  }
  return {
    service,
    redis,
    realms,
    accounts,
    factors,
    operators,
    customerMfa,
    operatorMfa,
    webauthn,
    sms,
    mail,
    values,
    user,
    passwordProof,
  };
}
afterEach(() => vi.restoreAllMocks());

// ============================================================================
// Risk policy and methods
// ============================================================================
describe("account ownership policy", () => {
  it("offers password/contact without MFA, but only the existing second factor with MFA", async () => {
    const f = build();
    expect(
      (await f.service.options("customer", "sid", "password", "")).methods,
    ).toEqual(["password", "phone", "email"]);
    f.factors.read.mockResolvedValue({ version: "mfa-v1" });
    expect(
      (await f.service.options("customer", "sid", "password", "")).methods,
    ).toEqual(["totp", "recovery"]);
    for (const method of ["password", "phone", "email"])
      await expect(
        f.service.start("customer", "sid", {
          operation: "password",
          target: "",
          method,
        }),
      ).rejects.toThrow("invalid_verification_method");
    expect(f.sms.sendCode).not.toHaveBeenCalled();
  });
  it("does not authorize lifecycle operations or create a generic login grace period", async () => {
    const f = build();
    for (const operation of [
      "username",
      "account-deletion",
      "account-recovery",
      "unknown",
    ])
      await expect(
        f.service.options("customer", "sid", operation, ""),
      ).rejects.toThrow("invalid_security_request");
    expect(f.values.size).toBe(0);
  });
  it("does not offer unverified contacts or a nonexistent initial password", async () => {
    const f = build();
    Object.assign(f.user, { hasPassword: false, phoneVerified: false });
    expect(
      (await f.service.options("customer", "sid", "password", "")).methods,
    ).toEqual(["email"]);
  });
  it("preserves workforce passkey-only policy", async () => {
    const f = build();
    f.operatorMfa.resolveLoginMfa.mockResolvedValue({ methods: ["webauthn"] });
    expect(
      (await f.service.options("workforce", "op-sid", "password", "")).methods,
    ).toEqual(["webauthn"]);
    await expect(
      f.service.start("workforce", "op-sid", {
        operation: "password",
        target: "",
        method: "recovery",
      }),
    ).rejects.toThrow();
  });
  it("rejects password guesses without authorizing any operation", async () => {
    const f = build();
    const ticket = await f.service.start("customer", "sid", {
      operation: "password",
      target: "",
      method: "password",
    });
    await expect(
      f.service.verify("customer", "sid", ticket.verificationId, {
        password: "wrong",
      }),
    ).rejects.toThrow();
    await expect(
      f.service.require(
        "customer",
        "sid",
        ticket.verificationId,
        "password",
        "",
      ),
    ).rejects.toThrow("security_proof_required");
  });
  it("requires current MFA and verifies recovery codes through the realm-owned factor store", async () => {
    const f = build();
    f.factors.read.mockResolvedValue({ version: "mfa-v1" });
    const ticket = await f.service.start("customer", "sid", {
      operation: "email-change",
      target: "new@example.test",
      method: "recovery",
    });
    await f.service.verify("customer", "sid", ticket.verificationId, {
      code: "123456",
    });
    expect(f.customerMfa.verify).toHaveBeenCalledWith(
      "u1",
      "recovery",
      "123456",
    );
    expect(f.operatorMfa.verifySecondFactor).not.toHaveBeenCalled();
  });
  it("blocks exhausted budgets before sending or checking factors", async () => {
    const f = build();
    f.redis.reserveCustomerSecurityBudget.mockResolvedValue(false);
    await expect(
      f.service.start("customer", "sid", {
        operation: "password",
        target: "",
        method: "phone",
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(f.sms.sendCode).not.toHaveBeenCalled();
  });
});

// ============================================================================
// One-use proof and immutable binding
// ============================================================================
describe("operation proof lifecycle", () => {
  it("binds realm, session, operation and target; only one concurrent consumer succeeds", async () => {
    const f = build();
    const { proofToken } = await f.passwordProof();
    await expect(
      f.service.require("workforce", "sid", proofToken, "password", ""),
    ).rejects.toThrow();
    await expect(
      f.service.require(
        "customer",
        "other-sid",
        proofToken,
        "account-login",
        "false",
      ),
    ).rejects.toThrow();
    await expect(
      f.service.require("customer", "sid", proofToken, "email-login", "false"),
    ).rejects.toThrow();
    await expect(
      f.service.require("customer", "sid", proofToken, "account-login", "true"),
    ).rejects.toThrow();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        f.service.require(
          "customer",
          "sid",
          proofToken,
          "account-login",
          "false",
          true,
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
  });
  it("expires at the original deadline and reads never extend freshness", async () => {
    const f = build();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const { proofToken } = await f.passwordProof();
    clock.mockReturnValue(now + 299999);
    await f.service.require(
      "customer",
      "sid",
      proofToken,
      "account-login",
      "false",
    );
    clock.mockReturnValue(now + 300000);
    await expect(
      f.service.require(
        "customer",
        "sid",
        proofToken,
        "account-login",
        "false",
      ),
    ).rejects.toThrow("security_proof_stale");
  });
  it("invalidates a credential or factor replacement, including changes during verification", async () => {
    const f = build();
    const { proofToken } = await f.passwordProof();
    f.accounts.selfSecurityVersion.mockResolvedValue("credentials-v2");
    await expect(
      f.service.require(
        "customer",
        "sid",
        proofToken,
        "account-login",
        "false",
      ),
    ).rejects.toThrow("security_proof_stale");
    f.accounts.selfSecurityVersion.mockResolvedValue("credentials-v1");
    f.factors.read.mockResolvedValue({ version: "mfa-new" });
    await expect(
      f.service.require(
        "customer",
        "sid",
        proofToken,
        "account-login",
        "false",
      ),
    ).rejects.toThrow("security_proof_stale");
    f.factors.read.mockResolvedValue(null);
    const ticket = await f.service.start("customer", "sid", {
      operation: "password",
      target: "",
      method: "password",
    });
    f.accounts.verifySelfPassword.mockImplementation(async () => {
      f.accounts.selfSecurityVersion.mockResolvedValue("credentials-v3");
      return true;
    });
    await expect(
      f.service.verify("customer", "sid", ticket.verificationId, {
        password: "password",
      }),
    ).rejects.toThrow();
  });
  it("rejects logout before consuming a proof", async () => {
    const f = build();
    const { proofToken } = await f.passwordProof();
    f.realms.requireCustomer.mockRejectedValue(
      new Error("customer_session_required"),
    );
    await expect(
      f.service.require(
        "customer",
        "sid",
        proofToken,
        "account-login",
        "false",
      ),
    ).rejects.toThrow("customer_session_required");
  });
  it("deletes a ticket after five wrong attempts and serializes competing checks", async () => {
    const f = build();
    const ticket = await f.service.start("customer", "sid", {
      operation: "password",
      target: "",
      method: "password",
    });
    for (let i = 0; i < 5; i++)
      await expect(
        f.service.verify("customer", "sid", ticket.verificationId, {
          password: "wrong",
        }),
      ).rejects.toThrow();
    expect(f.values.has(ticket.verificationId)).toBe(false);
    const next = await f.service.start("customer", "sid", {
      operation: "password",
      target: "",
      method: "password",
    });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        f.service.verify("customer", "sid", next.verificationId, {
          password: "password",
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
  });
  it("uses a separate bound passkey challenge without overwriting the login challenge", async () => {
    const f = build();
    const ticket = await f.service.start("workforce", "op-sid", {
      operation: "passkey-add",
      target: "",
      method: "webauthn",
    });
    expect(f.webauthn.createAuthenticationOptions).toHaveBeenCalledWith(
      "o1",
      false,
    );
    await f.service.verify("workforce", "op-sid", ticket.verificationId, {
      response: { id: "key" },
    });
    expect(f.webauthn.verifyAuthentication).toHaveBeenCalledWith(
      "o1",
      { id: "key" },
      "stepup-only",
    );
    f.operators.findById.mockResolvedValue({
      authenticationVersion: "operator-v2",
    });
    await expect(
      f.service.require(
        "workforce",
        "op-sid",
        ticket.verificationId,
        "passkey-add",
        "",
      ),
    ).rejects.toThrow("security_proof_stale");
  });
  it("removes a failed delivery ticket instead of allowing an undelivered code to verify", async () => {
    const f = build();
    f.mail.sendVerifyCode.mockRejectedValue(new Error("mail unavailable"));
    await expect(
      f.service.start("customer", "sid", {
        operation: "password",
        target: "",
        method: "email",
      }),
    ).rejects.toThrow("mail unavailable");
    expect(f.values.size).toBe(0);
  });
});
