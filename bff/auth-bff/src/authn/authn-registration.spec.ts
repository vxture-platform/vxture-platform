/**
 * Customer registration phone-ownership regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-06
 */
import { describe, expect, it, vi } from "vitest";
import { AuthnController } from "./authn.controller";
import { AuthnService, type RegisterInput } from "./authn.service";

// ============================================================================
// Fixtures
// ============================================================================

function build() {
  const user = { id: "customer-1", account: "customer" };
  const provisioned = {
    org: { id: "org-1" },
    workspace: { id: "workspace-1" },
  };
  const account = { createUser: vi.fn(async () => user) };
  const onboarding = { onboardNewUser: vi.fn(async () => provisioned) };
  const phoneCode = { verifyCode: vi.fn(async () => true) };
  const service = new AuthnService(
    account as never,
    onboarding as never,
    {} as never,
    {} as never,
    {} as never,
    phoneCode as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const controller = new AuthnController(
    service,
    phoneCode as never,
    {} as never,
  );
  return {
    service,
    controller,
    account,
    onboarding,
    phoneCode,
    user,
    provisioned,
  };
}

const INPUT = {
  phone: "13800138000",
  code: "123456",
  account: "customer",
  name: "Customer",
  password: "Customer-password1",
} satisfies RegisterInput;

// ============================================================================
// Registration boundary
// ============================================================================

describe("customer registration requires phone ownership", () => {
  it.each([
    {},
    { phone: INPUT.phone },
    { phone: INPUT.phone, code: " " },
    { phone: INPUT.phone, code: 123456 },
    { phone: 13800138000, code: INPUT.code },
    { phone: " ", code: INPUT.code },
  ])("rejects missing or malformed HTTP proof: %j", async (body) => {
    const { controller, phoneCode, account, onboarding } = build();
    await expect(controller.register(body as never)).rejects.toThrow();
    expect(phoneCode.verifyCode).not.toHaveBeenCalled();
    expect(account.createUser).not.toHaveBeenCalled();
    expect(onboarding.onboardNewUser).not.toHaveBeenCalled();
  });

  it("also rejects missing proof when HTTP validation is bypassed", async () => {
    const { service, account, phoneCode } = build();
    await expect(
      service.register({ phone: INPUT.phone } as RegisterInput),
    ).rejects.toThrow("phone and verification code are required");
    expect(phoneCode.verifyCode).not.toHaveBeenCalled();
    expect(account.createUser).not.toHaveBeenCalled();
  });

  it.each(["customer-password", "Short1!", "a".repeat(129)])(
    "rejects a weak new password before consuming phone proof",
    async (password) => {
      const { controller, phoneCode, account, onboarding } = build();
      await expect(controller.register({ ...INPUT, password })).rejects.toThrow(
        "weak_password",
      );
      expect(phoneCode.verifyCode).not.toHaveBeenCalled();
      expect(account.createUser).not.toHaveBeenCalled();
      expect(onboarding.onboardNewUser).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid or expired proof without creating any resources", async () => {
    const { controller, phoneCode, account, onboarding } = build();
    phoneCode.verifyCode.mockResolvedValue(false);
    await expect(controller.register(INPUT)).rejects.toThrow(
      "invalid_phone_code",
    );
    expect(account.createUser).not.toHaveBeenCalled();
    expect(onboarding.onboardNewUser).not.toHaveBeenCalled();
  });

  it("fails closed when the verification provider is unavailable", async () => {
    const { service, phoneCode, account, onboarding } = build();
    phoneCode.verifyCode.mockRejectedValue(new Error("provider unavailable"));
    await expect(service.register(INPUT)).rejects.toThrow(
      "provider unavailable",
    );
    expect(account.createUser).not.toHaveBeenCalled();
    expect(onboarding.onboardNewUser).not.toHaveBeenCalled();
  });

  it("waits for verification before creating the customer", async () => {
    const { service, phoneCode, account } = build();
    let resolveVerification: (value: boolean) => void = () => {};
    phoneCode.verifyCode.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveVerification = resolve;
        }),
    );
    const registration = service.register(INPUT);
    expect(account.createUser).not.toHaveBeenCalled();
    resolveVerification(true);
    await registration;
    expect(account.createUser).toHaveBeenCalledOnce();
  });

  it("verifies the supplied phone and provisions the customer after success", async () => {
    const { controller, phoneCode, account, onboarding, user } = build();
    await expect(
      controller.register({
        ...INPUT,
        phone: ` ${INPUT.phone} `,
        code: " 123456 ",
      }),
    ).resolves.toEqual({
      userId: user.id,
      account: user.account,
      orgId: "org-1",
      workspaceId: "workspace-1",
    });
    expect(phoneCode.verifyCode).toHaveBeenCalledExactlyOnceWith(
      INPUT.phone,
      INPUT.code,
      { scope: "customer-register" },
    );
    expect(account.createUser).toHaveBeenCalledExactlyOnceWith({
      account: INPUT.account,
      email: null,
      phone: INPUT.phone,
      password: INPUT.password,
      name: INPUT.name,
      phoneVerified: true,
    });
    expect(onboarding.onboardNewUser).toHaveBeenCalledExactlyOnceWith(
      user,
      INPUT.name,
    );
  });
});
