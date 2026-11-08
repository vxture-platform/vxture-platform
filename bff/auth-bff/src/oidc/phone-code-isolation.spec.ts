/**
 * Aliyun phone-verification scheme isolation regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhoneCodeService, SmsService } from "@vxture/service-sms";

// ============================================================================
// Provider configuration and fixtures
// ============================================================================

afterEach(() => vi.unstubAllEnvs());

function provider() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ALIYUN_SMS_ACCESS_KEY_ID", "test-key");
  vi.stubEnv("ALIYUN_SMS_ACCESS_KEY_SECRET", "test-secret");
  vi.stubEnv("ALIYUN_SMS_SIGN_NAME", "test-sign");
  vi.stubEnv("ALIYUN_SMS_TEMPLATE_CODE", "test-template");
  vi.stubEnv("ALIYUN_SMS_SCHEME_NAME", "customer-auth");
  vi.stubEnv(
    "ALIYUN_SMS_WORKFORCE_PHONE_CHANGE_SCHEME_NAME",
    "workforce-contact",
  );
  const request = vi.fn(
    async (
      _action: string,
      _params: Record<string, unknown>,
      _options?: Record<string, unknown>,
    ) => ({
      Code: "OK",
      Model: { VerifyResult: "PASS" },
    }),
  );
  const sms = new SmsService();
  Object.assign(sms, { client: () => ({ request }) });
  return { sms, phone: new PhoneCodeService(sms), request };
}

// ============================================================================
// Scheme selection and fail-closed behavior
// ============================================================================

describe("Aliyun phone verification isolation", () => {
  it("uses the workforce scheme for both send and verify, and normalizes the phone", async () => {
    const { phone, request } = provider();
    const options = { scope: "workforce-phone-change" } as const;
    await phone.sendCode(" 138 0000 0000 ", options);
    expect(await phone.verifyCode("13800000000", "123456", options)).toBe(true);
    expect(request).toHaveBeenNthCalledWith(
      1,
      "SendSmsVerifyCode",
      expect.objectContaining({
        PhoneNumber: "13800000000",
        SchemeName: "workforce-contact",
      }),
      { method: "POST" },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "CheckSmsVerifyCode",
      expect.objectContaining({
        PhoneNumber: "13800000000",
        SchemeName: "workforce-contact",
        VerifyCode: "123456",
      }),
      { method: "POST" },
    );
  });

  it.each([undefined, "tenant-auth"] as const)(
    "keeps legacy/customer scope %s on its existing scheme",
    async (scope) => {
      const { phone, request } = provider();
      const options = scope ? { scope } : {};
      await phone.sendCode("13800000000", options);
      await phone.verifyCode("13800000000", "123456", options);
      for (const call of request.mock.calls) {
        expect(call[1]).toEqual(
          expect.objectContaining({ SchemeName: "customer-auth" }),
        );
      }
    },
  );

  it.each([
    ["", "workforce-contact"],
    ["customer-auth", ""],
    ["customer-auth", " customer-auth "],
  ])(
    "rejects missing/overlapping schemes (%s, %s) before contacting Aliyun",
    async (customer, workforce) => {
      const { phone, request } = provider();
      vi.stubEnv("ALIYUN_SMS_SCHEME_NAME", customer);
      vi.stubEnv("ALIYUN_SMS_WORKFORCE_PHONE_CHANGE_SCHEME_NAME", workforce);
      const options = { scope: "workforce-phone-change" } as const;
      await expect(phone.sendCode("13800000000", options)).rejects.toThrow(
        "scheme_not_isolated",
      );
      await expect(
        phone.verifyCode("13800000000", "888888", options),
      ).rejects.toThrow("scheme_not_isolated");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each(["production", "development"])(
    "never accepts the public dev code for workforce in %s",
    async (env) => {
      const { phone, request } = provider();
      vi.stubEnv("NODE_ENV", env);
      vi.stubEnv("ALIYUN_SMS_ACCESS_KEY_ID", "");
      const options = { scope: "workforce-phone-change" } as const;
      await expect(phone.sendCode("13800000000", options)).rejects.toThrow();
      expect(await phone.verifyCode("13800000000", "888888", options)).toBe(
        false,
      );
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each(["unknown", "__proto__", "constructor"])(
    "rejects unsupported runtime purpose %s",
    async (scope) => {
      const { sms, request } = provider();
      await expect(
        sms.sendVerifyCode("13800000000", scope as never),
      ).rejects.toThrow("invalid_sms_scope");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("propagates provider outages and rejects a non-PASS response", async () => {
    const { phone, request } = provider();
    request.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(
      phone.verifyCode("13800000000", "123456", {
        scope: "workforce-phone-change",
      }),
    ).rejects.toThrow("provider unavailable");
    request.mockResolvedValueOnce({
      Code: "OK",
      Model: { VerifyResult: "FAIL" },
    });
    expect(
      await phone.verifyCode("13800000000", "123456", {
        scope: "workforce-phone-change",
      }),
    ).toBe(false);
  });
});

// ============================================================================
// Customer purposes must never share provider schemes or development fallback
// ============================================================================
describe("customer SMS purposes", () => {
  it.each(["tenant-auth", "customer-login"] as const)(
    "rejects provider scheme names longer than 20 characters for %s",
    async (scope) => {
      const { phone, request } = provider();
      vi.stubEnv(
        scope === "tenant-auth"
          ? "ALIYUN_SMS_SCHEME_NAME"
          : "ALIYUN_SMS_CUSTOMER_LOGIN_SCHEME_NAME",
        "x".repeat(21),
      );
      await expect(phone.sendCode("13800000000", { scope })).rejects.toThrow(
        "sms_scheme_name_too_long",
      );
      await expect(
        phone.verifyCode("13800000000", "123456", { scope }),
      ).rejects.toThrow("sms_scheme_name_too_long");
      expect(request).not.toHaveBeenCalled();
    },
  );
  const purposes = [
    "customer-login",
    "customer-register",
    "customer-social-bind",
  ] as const;
  it.each(purposes)("uses an isolated scheme for %s", async (scope) => {
    const { phone, request } = provider();
    vi.stubEnv("ALIYUN_SMS_CUSTOMER_LOGIN_SCHEME_NAME", "login");
    vi.stubEnv("ALIYUN_SMS_CUSTOMER_REGISTER_SCHEME_NAME", "register");
    vi.stubEnv("ALIYUN_SMS_CUSTOMER_SOCIAL_BIND_SCHEME_NAME", "bind");
    await phone.sendCode("13800000000", { scope });
    await phone.verifyCode("13800000000", "123456", { scope });
    const scheme = {
      "customer-login": "login",
      "customer-register": "register",
      "customer-social-bind": "bind",
    }[scope];
    expect(
      request.mock.calls.every((call) => call[1].SchemeName === scheme),
    ).toBe(true);
  });
  it.each(["", "customer-auth", "workforce-contact", "bind"])(
    "rejects missing or overlapping login scheme %s",
    async (value) => {
      const { phone, request } = provider();
      vi.stubEnv("ALIYUN_SMS_CUSTOMER_LOGIN_SCHEME_NAME", value);
      vi.stubEnv("ALIYUN_SMS_CUSTOMER_SOCIAL_BIND_SCHEME_NAME", "bind");
      await expect(
        phone.sendCode("13800000000", { scope: "customer-login" }),
      ).rejects.toThrow("scheme_not_isolated");
      expect(request).not.toHaveBeenCalled();
    },
  );
  it.each(purposes)("rejects public development code for %s", async (scope) => {
    const { phone } = provider();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALIYUN_SMS_ACCESS_KEY_ID", "");
    vi.stubEnv(
      `ALIYUN_SMS_${scope.toUpperCase().replaceAll("-", "_")}_SCHEME_NAME`,
      "isolated",
    );
    expect(await phone.verifyCode("13800000000", "888888", { scope })).toBe(
      false,
    );
  });
});

// ============================================================================
// Account-center SMS purposes must never share a login or workforce scheme
// ============================================================================

describe("customer account-center provider purposes", () => {
  it.each([
    ["customer-security", "ALIYUN_SMS_CUSTOMER_SECURITY_SCHEME_NAME"],
    ["customer-phone-change", "ALIYUN_SMS_CUSTOMER_PHONE_CHANGE_SCHEME_NAME"],
  ] as const)("uses an explicit isolated scheme for %s", async (scope, key) => {
    const f = provider();
    vi.stubEnv(key, "isolated-security");
    await f.phone.sendCode("13800138000", { scope });
    await f.phone.verifyCode("13800138000", "123456", { scope });
    expect(f.request).toHaveBeenLastCalledWith(
      "CheckSmsVerifyCode",
      expect.objectContaining({ SchemeName: "isolated-security" }),
      { method: "POST" },
    );
  });
  it.each([
    ["customer-security", "ALIYUN_SMS_CUSTOMER_SECURITY_SCHEME_NAME"],
    ["customer-phone-change", "ALIYUN_SMS_CUSTOMER_PHONE_CHANGE_SCHEME_NAME"],
  ] as const)(
    "fails closed for missing or overlapping %s scheme",
    async (scope, key) => {
      const f = provider();
      vi.stubEnv(key, "");
      await expect(f.phone.sendCode("13800138000", { scope })).rejects.toThrow(
        "customer_sms_scheme_not_isolated",
      );
      vi.stubEnv(key, "customer-auth");
      await expect(
        f.phone.verifyCode("13800138000", "123456", { scope }),
      ).rejects.toThrow("customer_sms_scheme_not_isolated");
      expect(f.request).not.toHaveBeenCalled();
    },
  );
});
