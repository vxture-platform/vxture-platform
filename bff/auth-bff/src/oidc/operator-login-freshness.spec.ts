/**
 * Workforce MFA and central sessions bind current authentication state.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { describe, expect, it, vi } from "vitest";
import { OidcService } from "./oidc.service";
import { operatorSessionCurrent } from "./realm-session.service";

// ============================================================================
// Public login methods, real orchestration with isolated injected boundaries.
// ============================================================================
function fixture(enrollRequired = false) {
  const pending = {
    operatorId: "op-1",
    clientId: "accounts-self:workforce",
    credentialVersion: "credential-v1",
    authenticationVersion: "auth-v1",
    expiresAt: Date.now() / 1000 + 300,
    factor1Method: "password",
    attempts: 0,
    enrollRequired,
    webauthnRequired: false,
  };
  const operator = {
    id: "op-1",
    username: "operator",
    status: "active",
    roleCode: "operator",
    email: null,
    emailVerified: false,
    credentialVersion: "credential-v1",
    authenticationVersion: "auth-v1",
    mfaEnrolled: !enrollRequired,
    webauthnRequired: false,
  };
  const decision = {
    mfaRequired: true,
    enrollRequired,
    webauthnRequired: false,
  };
  const verifySecondFactor = vi.fn(async () => true);
  const redis = {
    getOperatorMfaPending: vi.fn(async () => pending),
    deleteOperatorMfaPending: vi.fn(),
    createOidcSession: vi.fn(),
  };
  const operatorMfa = {
    resolveLoginMfa: vi.fn(async () => ({ decision, methods: ["totp"] })),
    verifySecondFactor,
    beginTotpEnrollment: vi.fn(async () => ({
      secret: "secret",
      otpauthUri: "uri",
    })),
    confirmTotpEnrollment: vi.fn(async () => {
      operator.authenticationVersion = "auth-v2";
      operator.mfaEnrolled = true;
      decision.enrollRequired = false;
      return { ok: true, recoveryCodes: ["code"] };
    }),
  };
  const operatorWebauthn = {
    createAuthenticationOptionsForOperator: vi.fn(),
    verifyAuthentication: vi.fn(async () => true),
    createRegistrationOptionsForOperator: vi.fn(),
    verifyRegistrationForOperator: vi.fn(async () => {
      operator.authenticationVersion = "auth-v2";
      operator.mfaEnrolled = true;
      decision.enrollRequired = false;
    }),
  };
  const service = Object.create(OidcService.prototype) as OidcService;
  Object.assign(service, {
    redis,
    operators: { findById: vi.fn(async () => operator) },
    operatorMfa,
    operatorWebauthn,
    config: { auth: { OPERATOR_SESSION_ABS_TTL: 3600 } },
    loginClient: async () => ({
      clientId: pending.clientId,
      realm: "workforce",
    }),
    operatorAnomaly: { evaluateLogin: vi.fn() },
    recordOperatorAttempt: vi.fn(),
    recordOperatorAudit: vi.fn(),
  });
  return {
    pending,
    operator,
    decision,
    redis,
    operatorMfa,
    operatorWebauthn,
    service,
  };
}
const paths = [
  "totp",
  "webauthn",
  "totp-begin",
  "totp-confirm",
  "passkey-begin",
  "passkey-confirm",
] as const;
function invoke(f: ReturnType<typeof fixture>, path: (typeof paths)[number]) {
  switch (path) {
    case "totp":
      return f.service.completeOperatorMfa({
        mfaToken: "pending",
        method: "totp",
        code: "123456",
      });
    case "webauthn":
      return f.service.completeOperatorWebauthn({
        mfaToken: "pending",
        response: {} as never,
      });
    case "totp-begin":
      return f.service.beginOperatorTotpEnrollment("pending");
    case "totp-confirm":
      return f.service.confirmOperatorTotpEnrollment({
        mfaToken: "pending",
        code: "123456",
      });
    case "passkey-begin":
      return f.service.beginOperatorWebauthnEnrollment("pending");
    case "passkey-confirm":
      return f.service.confirmOperatorWebauthnEnrollment({
        mfaToken: "pending",
        response: {} as never,
      });
  }
}
describe("workforce stale first factors", () => {
  it.each(paths)(
    "rejects credential changes before %s has side effects",
    async (path) => {
      const f = fixture(path.includes("begin") || path.includes("confirm"));
      f.operator.credentialVersion = "new-password";
      await expect(invoke(f, path)).rejects.toThrow("mfa_session_expired");
      expect(f.operatorMfa.verifySecondFactor).not.toHaveBeenCalled();
      expect(f.operatorMfa.confirmTotpEnrollment).not.toHaveBeenCalled();
      expect(f.operatorWebauthn.verifyAuthentication).not.toHaveBeenCalled();
      expect(
        f.operatorWebauthn.verifyRegistrationForOperator,
      ).not.toHaveBeenCalled();
      expect(f.redis.createOidcSession).not.toHaveBeenCalled();
    },
  );
  it("rejects a changed current passkey policy before spending a TOTP proof", async () => {
    const f = fixture();
    f.decision.webauthnRequired = true;
    await expect(invoke(f, "totp")).rejects.toThrow("mfa_session_expired");
    expect(f.operatorMfa.verifySecondFactor).not.toHaveBeenCalled();
  });
  it("rejects legacy first-factor records without a state binding", async () => {
    const f = fixture();
    Object.assign(f.pending, { credentialVersion: undefined });
    await expect(invoke(f, "totp")).rejects.toThrow("mfa_session_expired");
  });
  it.each(["passkey-begin", "passkey-confirm"] as const)(
    "prevents %s from bypassing an existing second factor",
    async (path) => {
      const f = fixture();
      await expect(invoke(f, path)).rejects.toThrow("mfa_already_enrolled");
    },
  );
  it("establishes a version-bound session after a current TOTP proof", async () => {
    const f = fixture();
    await expect(invoke(f, "totp")).resolves.toMatchObject({
      realm: "workforce",
      redirectTo: "/workforce/account",
    });
    expect(f.redis.createOidcSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ authenticationVersion: "auth-v1" }),
      3600,
    );
  });
  it.each(["totp-confirm", "passkey-confirm"] as const)(
    "retains legitimate initial enrollment through %s",
    async (path) => {
      const f = fixture(true);
      await expect(invoke(f, path)).resolves.toMatchObject({
        realm: "workforce",
      });
      expect(f.redis.createOidcSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ authenticationVersion: "auth-v2" }),
        3600,
      );
    },
  );
  it("rejects a password change that races a successful second-factor verification", async () => {
    const f = fixture();
    f.operatorMfa.verifySecondFactor.mockImplementation(async () => {
      f.operator.credentialVersion = "changed";
      return true;
    });
    await expect(invoke(f, "totp")).rejects.toThrow("mfa_session_expired");
    expect(f.redis.createOidcSession).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Redis cleanup is not the authority for credential freshness.
// ============================================================================
describe("workforce retained central sessions", () => {
  it.each(["password", "factor", "legacy", "policy"])(
    "rejects %s change even when the old Redis entry remains",
    (change) => {
      const f = fixture();
      const session = {
        realm: "workforce",
        sub: "opr_op-1",
        authenticationVersion: "auth-v1",
        authMethod: "password+totp",
        createdAt: 1,
        lastActiveAt: 1,
        absExpiresAt: Date.now() / 1000 + 300,
      };
      if (change === "legacy")
        Object.assign(session, { authenticationVersion: undefined });
      else if (change === "policy") f.operator.webauthnRequired = true;
      else f.operator.authenticationVersion = "changed";
      expect(operatorSessionCurrent(session, f.operator)).toBe(false);
    },
  );
  it("retains valid passkey sessions under a mandatory passkey policy", () => {
    const f = fixture();
    f.operator.webauthnRequired = true;
    expect(
      operatorSessionCurrent(
        {
          realm: "workforce",
          sub: "opr_op-1",
          authenticationVersion: "auth-v1",
          authMethod: "password+webauthn",
          createdAt: 1,
          lastActiveAt: 1,
          absExpiresAt: Date.now() / 1000 + 300,
        },
        f.operator,
      ),
    ).toBe(true);
  });
});
