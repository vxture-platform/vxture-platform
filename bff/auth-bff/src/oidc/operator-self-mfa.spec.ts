/**
 * Workforce self-service MFA step-up regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { OperatorSelfService } from "./operator-self.service";

// ============================================================================
// Fixtures
// ============================================================================

function build(enabled = true) {
  const operators = {
    getMfaContext: vi.fn(async () => ({
      totpEnabled: enabled,
      webauthnRequired: false,
      webauthnCredentialCount: 0,
    })),
    getTotpEnrollment: vi.fn(async () =>
      enabled ? { secret: "encrypted-old", enabled: true } : null,
    ),
    verifyOperatorPassword: vi.fn(async () => true),
  };
  const redis = { reserveOperatorMfaStepUp: vi.fn(async () => true) };
  const realmSession = { requireOperator: vi.fn(async () => "operator-1") };
  const mfa = {
    verifySecondFactor: vi.fn(async () => true),
    beginTotpEnrollment: vi.fn(async () => ({
      secret: "new-secret",
      otpauthUri: "otpauth://new",
    })),
    confirmTotpEnrollment: vi.fn(async () => ({
      ok: true,
      recoveryCodes: ["recovery"],
    })),
  };
  const service = new OperatorSelfService(
    operators as never,
    redis as never,
    realmSession as never,
    {} as never,
    {} as never,
    {} as never,
    mfa as never,
    {} as never,
    {} as never,
  );
  return { service, operators, redis, realmSession, mfa };
}

// ============================================================================
// Step-up and confirmation
// ============================================================================

describe("workforce self-service MFA", () => {
  it("requires a valid workforce session before any credential check", async () => {
    const { service, realmSession, operators, mfa } = build();
    realmSession.requireOperator.mockRejectedValue(
      new Error("operator_session_required"),
    );
    await expect(
      service.startMfaTotp("customer-sid", "password", "123456"),
    ).rejects.toThrow("operator_session_required");
    expect(operators.verifyOperatorPassword).not.toHaveBeenCalled();
    expect(mfa.beginTotpEnrollment).not.toHaveBeenCalled();
  });

  it("requires the current password and existing authenticator before rebinding", async () => {
    const { service, operators, mfa } = build();
    const result = await service.startMfaTotp("sid-a", "password", "123456");
    expect(operators.verifyOperatorPassword).toHaveBeenCalledWith(
      "operator-1",
      "password",
    );
    expect(mfa.verifySecondFactor).toHaveBeenCalledWith({
      operatorId: "operator-1",
      method: "totp",
      code: "123456",
    });
    expect(mfa.beginTotpEnrollment).toHaveBeenCalledWith(
      "operator-1",
      `self:sid-a:${result.enrollmentToken}`,
      false,
      { secret: "encrypted-old", enabled: true },
    );
    await service.confirmMfaTotp("sid-a", "234567", result.enrollmentToken);
    expect(mfa.confirmTotpEnrollment).toHaveBeenCalledWith(
      "operator-1",
      "234567",
      `self:sid-a:${result.enrollmentToken}`,
    );
  });

  it("rejects an incorrect password before revealing any new secret", async () => {
    const { service, operators, mfa } = build();
    operators.verifyOperatorPassword.mockResolvedValue(false);
    await expect(
      service.startMfaTotp("sid", "wrong", "123456"),
    ).rejects.toThrow("invalid_current_password");
    expect(mfa.beginTotpEnrollment).not.toHaveBeenCalled();
  });

  it("rejects an incorrect existing factor", async () => {
    const { service, mfa } = build();
    mfa.verifySecondFactor.mockResolvedValue(false);
    await expect(
      service.startMfaTotp("sid", "password", "wrong"),
    ).rejects.toThrow("invalid_current_mfa_code");
    expect(mfa.beginTotpEnrollment).not.toHaveBeenCalled();
  });

  it("requires the password for first-time self-service setup too", async () => {
    const { service, mfa } = build(false);
    await expect(
      service.startMfaTotp("sid", undefined, undefined),
    ).rejects.toThrow("invalid_current_password");
    expect(mfa.beginTotpEnrollment).not.toHaveBeenCalled();
    await service.startMfaTotp("sid", "password", undefined);
    expect(mfa.verifySecondFactor).not.toHaveBeenCalled();
  });

  it("enforces the shared attempt budget before testing credentials", async () => {
    const { service, redis, operators } = build();
    redis.reserveOperatorMfaStepUp.mockResolvedValue(false);
    await expect(
      service.startMfaTotp("sid", "password", "123456"),
    ).rejects.toThrow("too_many_attempts");
    expect(operators.verifyOperatorPassword).not.toHaveBeenCalled();
  });

  it("does not substitute TOTP for a required passkey", async () => {
    const { service, operators, mfa } = build();
    operators.getMfaContext.mockResolvedValue({
      totpEnabled: true,
      webauthnRequired: true,
      webauthnCredentialCount: 1,
    });
    await expect(
      service.startMfaTotp("sid", "password", "123456"),
    ).rejects.toThrow("webauthn_required");
    expect(mfa.beginTotpEnrollment).not.toHaveBeenCalled();
  });

  it("rejects confirmation without its ceremony token", async () => {
    const { service, mfa } = build();
    await expect(
      service.confirmMfaTotp("sid", "123456", undefined),
    ).rejects.toThrow("invalid_or_expired_code");
    expect(mfa.confirmTotpEnrollment).not.toHaveBeenCalled();
  });
});
