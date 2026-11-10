/**
 * Customer verification-purpose and state regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { AuthnController } from "./authn.controller";
import { OidcService } from "../oidc/oidc.service";
import { AuthnService } from "./authn.service";
import { CustomerPhoneCodeService } from "./customer-phone-code.service";
import { SocialAuthService } from "../oauth/social-auth.service";

// ============================================================================
// Dispatch and provider completion boundaries
// ============================================================================
function fixture() {
  const phone = {
    sendCode: vi.fn(async () => {}),
    verifyCode: vi.fn(async () => true),
  };
  const redis = {
    beginCustomerCode: vi.fn(async () => true),
    finishCustomerCodeSend: vi.fn(async () => true),
    acquireCustomerCode: vi.fn(async (): Promise<string | null> => "owner"),
    finishCustomerCodeCheck: vi.fn(async () => true),
  };
  return {
    phone,
    redis,
    service: new CustomerPhoneCodeService(phone as never, redis as never),
  };
}
const OPTIONS = { scope: "customer-login" } as const;
describe("customer phone ceremonies", () => {
  it("reserves before provider dispatch and activates only after success", async () => {
    const f = fixture();
    await f.service.sendCode("138 0013 8000", OPTIONS);
    expect(f.redis.beginCustomerCode.mock.invocationCallOrder[0]).toBeLessThan(
      f.phone.sendCode.mock.invocationCallOrder[0]!,
    );
    expect(f.phone.sendCode.mock.invocationCallOrder[0]).toBeLessThan(
      f.redis.finishCustomerCodeSend.mock.invocationCallOrder[0]!,
    );
    expect(f.phone.sendCode).toHaveBeenCalledWith("13800138000", OPTIONS);
  });
  it("never sends when the aggregate budget is exhausted", async () => {
    const f = fixture();
    f.redis.beginCustomerCode.mockResolvedValue(false);
    await expect(f.service.sendCode("13800138000", OPTIONS)).rejects.toThrow(
      "too_many_attempts",
    );
    expect(f.phone.sendCode).not.toHaveBeenCalled();
  });
  it("does not contact the provider for absent, spent, wrong-purpose or wrong-owner ceremonies", async () => {
    const f = fixture();
    f.redis.acquireCustomerCode.mockResolvedValue(null);
    expect(await f.service.verifyCode("13800138000", "123456", OPTIONS)).toBe(
      false,
    );
    expect(f.phone.verifyCode).not.toHaveBeenCalled();
  });
  it("rejects a positive provider result when the ceremony expired or was superseded", async () => {
    const f = fixture();
    f.redis.finishCustomerCodeCheck.mockResolvedValue(false);
    expect(await f.service.verifyCode("13800138000", "123456", OPTIONS)).toBe(
      false,
    );
  });
  it("spends an attempt on provider errors without granting verification", async () => {
    const f = fixture();
    f.phone.verifyCode.mockRejectedValue(new Error("offline"));
    await expect(
      f.service.verifyCode("13800138000", "123456", OPTIONS),
    ).rejects.toThrow("offline");
    expect(f.redis.finishCustomerCodeCheck).toHaveBeenCalledWith(
      OPTIONS.scope,
      "13800138000",
      "",
      "owner",
      false,
    );
  });
  it("invalidates failed delivery and refuses a social purpose without a binding owner", async () => {
    const f = fixture();
    f.phone.sendCode.mockRejectedValue(new Error("offline"));
    await expect(f.service.sendCode("13800138000", OPTIONS)).rejects.toThrow(
      "offline",
    );
    expect(f.redis.finishCustomerCodeSend).toHaveBeenCalledWith(
      OPTIONS.scope,
      "13800138000",
      "",
      expect.any(String),
      false,
    );
    await expect(
      f.service.sendCode("13800138000", { scope: "customer-social-bind" }),
    ).rejects.toThrow("invalid_binding_token");
  });
  it("does not send or verify a social code for an expired binding token", async () => {
    const f = fixture();
    const redis = { readOauthBind: vi.fn(async () => null) };
    const social = new SocialAuthService(
      {} as never,
      {} as never,
      f.service,
      redis as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      social.sendBindPhoneCode("expired", "13800138000"),
    ).rejects.toThrow("invalid_binding_token");
    await expect(
      social.completeBind("expired", "13800138000", "123456"),
    ).rejects.toThrow("invalid_binding_token");
    expect(f.phone.sendCode).not.toHaveBeenCalled();
    expect(f.phone.verifyCode).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Exact-address email verification and trusted purpose selection
// ============================================================================
function authFixture() {
  const record = { id: "user", email: "alice@example.com" };
  const account = {
    findUserByIdentifier: vi.fn(async () => record),
    markEmailVerified: vi.fn(async () => ({ ...record, emailVerified: true })),
  };
  const email = {
    sendCode: vi.fn(async () => {}),
    verifyCode: vi.fn(async () => true),
  };
  const service = new AuthnService(
    account as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    email as never,
    {} as never,
  );
  return { account, email, service };
}
describe("customer email-code login", () => {
  it("uses only the login purpose and persists the exact proven address", async () => {
    const f = authFixture();
    await f.service.sendEmailCode("alice@example.com");
    expect(f.email.sendCode).toHaveBeenCalledWith(
      "alice@example.com",
      "customer-login",
    );
    expect(
      await f.service.loginWithEmailCode(" ALICE@example.com ", "123456"),
    ).toMatchObject({ emailVerified: true });
    expect(f.email.verifyCode).toHaveBeenCalledWith(
      "alice@example.com",
      "123456",
      "customer-login",
    );
    expect(f.account.markEmailVerified).toHaveBeenCalledWith(
      "user",
      "alice@example.com",
    );
  });
  it("never marks verification after a rejected code or an identifier-only match", async () => {
    const f = authFixture();
    f.email.verifyCode.mockResolvedValue(false);
    await expect(
      f.service.loginWithEmailCode("alice@example.com", "123456"),
    ).rejects.toThrow("invalid_email_code");
    expect(f.account.markEmailVerified).not.toHaveBeenCalled();
    f.email.verifyCode.mockResolvedValue(true);
    f.account.findUserByIdentifier.mockResolvedValue({
      id: "user",
      email: "other@example.com",
    });
    expect(
      await f.service.loginWithEmailCode("alice@example.com", "123456"),
    ).toBeNull();
    expect(f.account.markEmailVerified).not.toHaveBeenCalled();
  });
  it("fails closed when the email changes before the conditional database update", async () => {
    const f = authFixture();
    f.account.markEmailVerified.mockResolvedValue(null as never);
    expect(
      await f.service.loginWithEmailCode("alice@example.com", "123456"),
    ).toBeNull();
  });
});

// ============================================================================
// HTTP purpose selection and userinfo evidence
// ============================================================================
describe("trusted entry points", () => {
  it("selects login vs registration on the server regardless of submitted purpose", async () => {
    const phone = { sendCode: vi.fn(async () => {}) };
    const human = { verifyHuman: vi.fn(async () => {}) };
    const controller = new AuthnController(
      {} as never,
      phone as never,
      human as never,
    );
    const req = { headers: {}, ip: "127.0.0.1" } as never;
    const body = {
      phone: "13800138000",
      captcha_token: "proof",
      scope: "workforce-phone-change",
    };
    await controller.sendPhoneCode(body, req);
    await controller.sendRegistrationCode(body, req);
    expect(phone.sendCode.mock.calls).toEqual([
      ["13800138000", { scope: "customer-login" }],
      ["13800138000", { scope: "customer-register" }],
    ]);
  });
  it.each([true, false, undefined])(
    "returns durable email verification in userinfo (%s)",
    async (emailVerified) => {
      const service = Object.assign(Object.create(OidcService.prototype), {
        keys: {
          verify: () => ({
            sub: "usr_user",
            aud: "customer-client",
            sid: "sid",
            jti: "jti",
            userType: "tenant_user",
            roles: [],
            scope: "openid email",
          }),
        },
        clients: {
          findEnabledByClientId: async () => ({
            clientId: "customer-client",
            realm: "customer",
          }),
        },
        redis: {
          isBlacklisted: async () => false,
          getOidcSession: async () => ({
            sub: "usr_user",
            realm: "customer",
            authMethod: "phone",
            absExpiresAt: Math.floor(Date.now() / 1000) + 60,
          }),
        },
        durableSession: {
          get: async () => ({ realm: "customer", userId: "user" }),
        },
        customerMfa: { enabled: async () => false },
        account: {
          getUserById: async () => ({
            id: "user",
            account: "alice",
            email: "alice@example.com",
            phone: "13800138000",
            emailVerified,
            status: "active",
          }),
        },
      }) as OidcService;
      expect((await service.userinfo("token")).email_verified).toBe(
        emailVerified ?? false,
      );
    },
  );
});
