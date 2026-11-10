/**
 * Workforce sensitive changes require existing identity proof; renaming stays low risk.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { describe, expect, it, vi } from "vitest";
import { OperatorSelfService } from "./operator-self.service";
import { OperatorWebauthnRouter } from "../routers/operator-webauthn.router";

// ============================================================================
// Contacts and password: exact operation proof before credential writes
// ============================================================================
function fixture() {
  const contact = {
    email: "old@example.test",
    emailVerified: true,
    phone: "13900139000",
    phoneVerified: true,
  };
  const operators = {
    getOperatorAdminView: vi.fn(async () => contact),
    findById: vi.fn(async () => ({
      credentialVersion: "credentials-v1",
      authenticationVersion: "auth-v1",
    })),
    verifyOperatorPassword: vi.fn(async () => true),
    setOperatorPassword: vi.fn(async () => true),
    setOperatorContactVerified: vi.fn(async () => true),
  };
  const redis = {
    beginOperatorEmailChange: vi.fn(async () => "version"),
    finishOperatorEmailChange: vi.fn(async () => true),
    consumeOperatorEmailChange: vi.fn(async () => "new@example.test"),
    beginOperatorPhoneChange: vi.fn(async () => "version"),
    finishOperatorPhoneChange: vi.fn(async () => true),
    attemptOperatorPhoneChange: vi.fn(async () => "version"),
  };
  const realms = { requireOperator: vi.fn(async () => "operator") };
  const mail = { sendVerifyCode: vi.fn(async () => {}) };
  const sms = {
    sendCode: vi.fn(async () => {}),
    verifyCode: vi.fn(async () => true),
  };
  const refresh = { revokeAllForOperator: vi.fn(async () => 1) };
  const oidc = { endOperatorSessions: vi.fn(async () => {}) };
  const proof = {
    require: vi.fn(
      async (
        _realm: string,
        _sid: string,
        token: unknown,
        _operation: string,
        _target: string,
        _consume = false,
      ) => {
        if (token !== "fresh") throw new Error("security_proof_required");
      },
    ),
  };
  const service = new OperatorSelfService(
    operators as never,
    redis as never,
    realms as never,
    mail as never,
    sms as never,
    refresh as never,
    {} as never,
    oidc as never,
    proof as never,
  );
  return {
    service,
    contact,
    operators,
    redis,
    realms,
    mail,
    sms,
    refresh,
    oidc,
    proof,
  };
}
describe("workforce sensitive-operation ownership", () => {
  it("rejects contact replacement before dispatch without fresh MFA", async () => {
    const f = fixture();
    await expect(
      f.service.startEmailChange("sid", "new@example.test"),
    ).rejects.toThrow("security_proof_required");
    await expect(
      f.service.startPhoneChange("sid", "13800138000"),
    ).rejects.toThrow("security_proof_required");
    expect(f.mail.sendVerifyCode).not.toHaveBeenCalled();
    expect(f.sms.sendCode).not.toHaveBeenCalled();
  });
  it("keeps new-contact ownership verification even with a valid existing proof", async () => {
    const f = fixture();
    await f.service.startEmailChange("sid", " NEW@example.test ", "fresh");
    expect(f.proof.require).toHaveBeenCalledWith(
      "workforce",
      "sid",
      "fresh",
      "email-change",
      "new@example.test",
      false,
    );
    expect(f.mail.sendVerifyCode).toHaveBeenCalledWith(
      "new@example.test",
      expect.stringMatching(/^\d{6}$/),
    );
    await expect(
      f.service.verifyEmailChange(
        "sid",
        "123456",
        "fresh",
        "other@example.test",
      ),
    ).rejects.toThrow("invalid_or_expired_code");
    expect(f.operators.setOperatorContactVerified).not.toHaveBeenCalled();
    await f.service.verifyEmailChange(
      "sid",
      "123456",
      "fresh",
      "new@example.test",
    );
    expect(f.proof.require).toHaveBeenLastCalledWith(
      "workforce",
      "sid",
      "fresh",
      "email-change",
      "new@example.test",
      true,
    );
    expect(f.operators.setOperatorContactVerified).toHaveBeenCalledWith(
      "operator",
      "email",
      "new@example.test",
      "auth-v1",
    );
    expect(f.oidc.endOperatorSessions).toHaveBeenCalledWith("operator");
  });
  it("allows verifying the current unverified email using only the delivered code", async () => {
    const f = fixture();
    f.contact.emailVerified = false;
    f.redis.consumeOperatorEmailChange.mockResolvedValue("old@example.test");
    await f.service.startEmailChange("sid", "old@example.test");
    await f.service.verifyEmailChange(
      "sid",
      "123456",
      undefined,
      "old@example.test",
    );
    expect(f.proof.require).not.toHaveBeenCalled();
    expect(f.operators.setOperatorContactVerified).toHaveBeenCalledWith(
      "operator",
      "email",
      "old@example.test",
      "auth-v1",
    );
  });
  it("rejects expired identity proof after new-phone verification and before writing", async () => {
    const f = fixture();
    await f.service.startPhoneChange("sid", "13800138000", "fresh");
    f.proof.require.mockRejectedValue(new Error("security_proof_expired"));
    await expect(
      f.service.verifyPhoneChange("sid", "13800138000", "123456", "fresh"),
    ).rejects.toThrow("security_proof_expired");
    expect(f.sms.verifyCode).toHaveBeenCalled();
    expect(f.operators.setOperatorContactVerified).not.toHaveBeenCalled();
  });
  it("requires current password AND fresh MFA before changing workforce credentials", async () => {
    const f = fixture();
    await expect(
      f.service.changePassword("sid", "old", "new-password-1234"),
    ).rejects.toThrow("security_proof_required");
    expect(f.operators.setOperatorPassword).not.toHaveBeenCalled();
    f.operators.verifyOperatorPassword.mockResolvedValue(false);
    await expect(
      f.service.changePassword("sid", "wrong", "new-password-1234", "fresh"),
    ).rejects.toThrow("invalid_current_password");
    f.operators.verifyOperatorPassword.mockResolvedValue(true);
    await f.service.changePassword("sid", "old", "new-password-1234", "fresh");
    expect(f.operators.setOperatorPassword).toHaveBeenCalledWith(
      "operator",
      "new-password-1234",
      {
        forceChange: false,
        expectedCredentialVersion: "credentials-v1",
        expectedAuthenticationVersion: "auth-v1",
      },
    );
    expect(f.proof.require).toHaveBeenLastCalledWith(
      "workforce",
      "sid",
      "fresh",
      "password",
      "",
      true,
    );
  });
});

// ============================================================================
// Passkeys: proof at both boundaries and exact deletion target
// ============================================================================
describe("workforce passkey management ownership", () => {
  function build() {
    const webauthn = {
      createRegistrationOptions: vi.fn(async () => ({})),
      verifyRegistration: vi.fn(async () => ({ credentialId: "key" })),
      revokeCredential: vi.fn(async () => {}),
      renameCredential: vi.fn(async () => {}),
    };
    const proof = fixture().proof;
    return {
      router: new OperatorWebauthnRouter(webauthn as never, proof as never),
      webauthn,
      proof,
      req: { cookies: { vx_sid: "customer", vx_sid_op: "operator" } },
    };
  }
  it("requires an existing factor before adding or removing keys", async () => {
    const f = build();
    await expect(f.router.options(f.req as never, {})).rejects.toThrow(
      "security_proof_required",
    );
    await expect(f.router.revoke("key", f.req as never, {})).rejects.toThrow(
      "security_proof_required",
    );
    expect(f.webauthn.createRegistrationOptions).not.toHaveBeenCalled();
    expect(f.webauthn.revokeCredential).not.toHaveBeenCalled();
    await f.router.options(f.req as never, { proofToken: "fresh" });
    expect(f.proof.require).toHaveBeenLastCalledWith(
      "workforce",
      "operator",
      "fresh",
      "passkey-add",
      "",
    );
    await f.router.verify(
      { response: { id: "new-key" } as never, proofToken: "fresh" },
      f.req as never,
    );
    expect(f.proof.require).toHaveBeenLastCalledWith(
      "workforce",
      "operator",
      "fresh",
      "passkey-add",
      "",
      true,
    );
    await f.router.revoke("target-key", f.req as never, {
      proofToken: "fresh",
    });
    expect(f.proof.require).toHaveBeenLastCalledWith(
      "workforce",
      "operator",
      "fresh",
      "passkey-remove",
      "target-key",
      true,
    );
  });
  it("renames an owned key without another identity check", async () => {
    const f = build();
    await f.router.rename("key", { label: "Laptop" }, f.req as never);
    expect(f.proof.require).not.toHaveBeenCalled();
    expect(f.webauthn.renameCredential).toHaveBeenCalledWith(
      "operator",
      "key",
      "Laptop",
    );
  });
});
