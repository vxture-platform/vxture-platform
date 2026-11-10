/**
 * Enrollment-on-login must preserve the workforce MFA boundary.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { OidcService } from "./oidc.service";

// ============================================================================
// Fixtures
// ============================================================================

function build(enrollRequired: boolean, webauthnRequired = false) {
  const pending = {
    operatorId: "operator-1",
    credentialVersion: "credential-v1",
    authenticationVersion: "auth-v1",
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    enrollRequired,
    webauthnRequired,
    attempts: 4,
  };
  const redis = {
    getOperatorMfaPending: vi.fn(async () => pending),
    deleteOperatorMfaPending: vi.fn(async () => {}),
  };
  const operatorMfa = {
    resolveLoginMfa: vi.fn(async () => ({
      decision: { mfaRequired: true, enrollRequired, webauthnRequired },
    })),
    beginTotpEnrollment: vi.fn(async () => ({
      secret: "new",
      otpauthUri: "otpauth://new",
    })),
    confirmTotpEnrollment: vi.fn(async () => ({ ok: false })),
  };
  const service = Object.create(OidcService.prototype) as OidcService;
  Object.assign(service, {
    redis,
    operators: {
      findById: vi.fn(async () => ({
        id: "operator-1",
        credentialVersion: "credential-v1",
        authenticationVersion: "auth-v1",
      })),
    },
    operatorMfa,
    recordOperatorAttempt: vi.fn(async () => {}),
    recordOperatorAudit: vi.fn(async () => {}),
  });
  return { service, operatorMfa, pending };
}

// ============================================================================
// Login context boundary
// ============================================================================

describe("workforce enrollment-on-login context", () => {
  it("rejects an enrollment context without a credential snapshot", async () => {
    const { service, operatorMfa, pending } = build(true);
    pending.credentialVersion = "";
    await expect(service.beginOperatorTotpEnrollment("token")).rejects.toThrow(
      "mfa_session_expired",
    );
    expect(operatorMfa.beginTotpEnrollment).not.toHaveBeenCalled();
  });

  it("binds first-time setup to its pending login token", async () => {
    const { service, operatorMfa } = build(true);
    await service.beginOperatorTotpEnrollment("pending-token");
    expect(operatorMfa.beginTotpEnrollment).toHaveBeenCalledWith(
      "operator-1",
      "login:pending-token",
      true,
    );
    await expect(
      service.confirmOperatorTotpEnrollment({
        mfaToken: "pending-token",
        code: "123456",
      }),
    ).rejects.toThrow("mfa_locked");
    expect(operatorMfa.confirmTotpEnrollment).toHaveBeenCalledWith(
      "operator-1",
      "123456",
      "login:pending-token",
    );
  });

  it("does not turn an existing-factor challenge into new enrollment", async () => {
    const { service, operatorMfa } = build(false);
    await expect(service.beginOperatorTotpEnrollment("token")).rejects.toThrow(
      "mfa_already_enrolled",
    );
    await expect(
      service.confirmOperatorTotpEnrollment({
        mfaToken: "token",
        code: "123456",
      }),
    ).rejects.toThrow("mfa_already_enrolled");
    expect(operatorMfa.beginTotpEnrollment).not.toHaveBeenCalled();
    expect(operatorMfa.confirmTotpEnrollment).not.toHaveBeenCalled();
  });

  it("preserves mandatory passkey policy at both endpoints", async () => {
    const { service, operatorMfa } = build(true, true);
    await expect(service.beginOperatorTotpEnrollment("token")).rejects.toThrow(
      "webauthn_required",
    );
    await expect(
      service.confirmOperatorTotpEnrollment({
        mfaToken: "token",
        code: "123456",
      }),
    ).rejects.toThrow("webauthn_required");
    expect(operatorMfa.beginTotpEnrollment).not.toHaveBeenCalled();
    expect(operatorMfa.confirmTotpEnrollment).not.toHaveBeenCalled();
  });
});
