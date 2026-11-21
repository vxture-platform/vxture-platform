/**
 * operator-stepup.spec.ts - Bounded and replay-protected operator proof issuance.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { randomBytes } from "node:crypto";
import { HttpException, ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { RedisService } from "../redis/redis.service";
import { OidcService } from "./oidc.service";

// ===========================================================================
// Only issuance dependencies are supplied; no configured endpoint is used.
// ===========================================================================
const OPERATOR = "aaaaaaaa-1111-4111-8111-111111111111";
const KEY = randomBytes(32).toString("hex");
const input = { operatorId: OPERATOR, method: "totp" as const, code: "123456" };

function fixture() {
  const config = { auth: { OPERATOR_TOTP_ENC_KEY: KEY as string | undefined } };
  const redis = {
    reserveOperatorStepUpAttempt: vi
      .fn<RedisService["reserveOperatorStepUpAttempt"]>()
      .mockResolvedValue({ attemptId: "reservation", retryAfter: 0 }),
    finishOperatorStepUpAttempt: vi
      .fn<RedisService["finishOperatorStepUpAttempt"]>()
      .mockResolvedValue(true),
    storeOperatorStepUpAction: vi
      .fn<RedisService["storeOperatorStepUpAction"]>()
      .mockResolvedValue(undefined),
    consumeOperatorStepUpAction: vi
      .fn<RedisService["consumeOperatorStepUpAction"]>()
      .mockResolvedValue("execute"),
    consumeOperatorStepUpTotp: vi
      .fn<RedisService["consumeOperatorStepUpTotp"]>()
      .mockResolvedValue(true),
  };
  const keys = {
    isReady: vi.fn(() => true),
    sign: vi.fn(
      (_payload: Record<string, unknown>, _options: { jwtid?: string }) =>
        "signed-proof",
    ),
    verify: vi.fn<(token: string) => Record<string, unknown>>(),
  };
  const mfa = {
    verifySecondFactor: vi.fn(async () => true),
    resolveLoginMfa: vi.fn(async () => ({
      decision: { webauthnRequired: false },
      methods: ["totp"],
    })),
  };
  const audit = {
    recordLoginAttempt: vi.fn(async () => {}),
    recordAuditEvent: vi.fn(async () => {}),
  };
  const service = Object.create(OidcService.prototype) as OidcService;
  Object.assign(service, {
    config,
    redis,
    keys,
    operatorMfa: mfa,
    operatorAudit: audit,
    logger: { warn: vi.fn() },
  });
  return { service, config, redis, keys, mfa, audit };
}

// ===========================================================================
// Reserve -> verify -> consume code -> finish reservation -> sign.
// ===========================================================================
describe("operator step-up issuance", () => {
  it("retains the five-minute operator proof contract", async () => {
    const f = fixture();
    expect(await f.service.issueOperatorStepUp(input)).toEqual({
      stepUpToken: "signed-proof",
      expiresIn: 300,
    });
    expect(f.keys.sign).toHaveBeenCalledWith(
      { stepup: true, userType: "operator", amr: ["otp"] },
      { audience: "admin", subject: `opr_${OPERATOR}`, expiresInSec: 300 },
    );
    expect(f.redis.finishOperatorStepUpAttempt).toHaveBeenCalledWith(
      OPERATOR,
      "reservation",
      true,
    );
    expect(
      f.redis.reserveOperatorStepUpAttempt.mock.invocationCallOrder[0],
    ).toBeLessThan(f.mfa.verifySecondFactor.mock.invocationCallOrder[0]!);
    expect(
      f.redis.finishOperatorStepUpAttempt.mock.invocationCallOrder[0],
    ).toBeLessThan(f.keys.sign.mock.invocationCallOrder[0]!);
  });

  it("canonicalizes UUID case and OTP spacing before budget and replay checks", async () => {
    const f = fixture();
    await f.service.issueOperatorStepUp({
      ...input,
      operatorId: OPERATOR.toUpperCase(),
      code: " 123 456 ",
    });
    expect(f.redis.reserveOperatorStepUpAttempt).toHaveBeenCalledWith(OPERATOR);
    expect(f.mfa.verifySecondFactor).toHaveBeenCalledWith(input);
  });

  it.each([
    { operatorId: "invalid" },
    { code: "12345" },
    { code: "1234567" },
    { code: "abcdef" },
    { code: 123456 },
    { method: "recovery" },
    { audience: {} },
    { audience: "" },
  ])(
    "rejects malformed runtime input %j before verification",
    async (override) => {
      const f = fixture();
      await expect(
        f.service.issueOperatorStepUp({ ...input, ...override } as never),
      ).rejects.toThrow("invalid_request");
      expect(f.redis.reserveOperatorStepUpAttempt).not.toHaveBeenCalled();
      expect(f.mfa.verifySecondFactor).not.toHaveBeenCalled();
      expect(f.keys.sign).not.toHaveBeenCalled();
    },
  );

  it("returns the shared lockout without checking a factor or signing", async () => {
    const f = fixture();
    f.redis.reserveOperatorStepUpAttempt.mockResolvedValue({
      attemptId: null,
      retryAfter: 42,
    });
    const error = await f.service
      .issueOperatorStepUp(input)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toEqual({
      message: "too_many_attempts; retry after 42s",
      retryAfter: 42,
    });
    expect(f.mfa.verifySecondFactor).not.toHaveBeenCalled();
    expect(f.keys.sign).not.toHaveBeenCalled();
  });

  it("retains a failed slot and never stores an incorrect code fingerprint", async () => {
    const f = fixture();
    f.mfa.verifySecondFactor.mockResolvedValue(false);
    expect(await f.service.issueOperatorStepUp(input)).toBeNull();
    expect(f.redis.finishOperatorStepUpAttempt).toHaveBeenCalledWith(
      OPERATOR,
      "reservation",
      false,
    );
    expect(f.redis.consumeOperatorStepUpTotp).not.toHaveBeenCalled();
    expect(f.keys.sign).not.toHaveBeenCalled();
    expect(f.audit.recordLoginAttempt).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.audit.recordAuditEvent.mock.calls)).not.toContain(
      input.code,
    );
  });

  it("rejects an already exchanged code without signing another proof", async () => {
    const f = fixture();
    f.redis.consumeOperatorStepUpTotp.mockResolvedValue(false);
    expect(await f.service.issueOperatorStepUp(input)).toBeNull();
    expect(f.redis.finishOperatorStepUpAttempt).toHaveBeenCalledWith(
      OPERATOR,
      "reservation",
      false,
    );
    expect(f.keys.sign).not.toHaveBeenCalled();
  });

  it("keys replay protection by operator and code, independently of audience", async () => {
    const f = fixture();
    await f.service.issueOperatorStepUp(input);
    await f.service.issueOperatorStepUp({ ...input, audience: "opera" });
    const digests = f.redis.consumeOperatorStepUpTotp.mock.calls.map(
      ([digest]) => digest,
    );
    expect(digests[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(digests[0]).toBe(digests[1]);
    expect(digests[0]).not.toContain(KEY);
  });

  it("does not sign without configured replay key material", async () => {
    const f = fixture();
    f.config.auth.OPERATOR_TOTP_ENC_KEY = undefined;
    await expect(f.service.issueOperatorStepUp(input)).rejects.toThrow(
      "operator_stepup_unavailable",
    );
    expect(f.redis.reserveOperatorStepUpAttempt).not.toHaveBeenCalled();
    expect(f.keys.sign).not.toHaveBeenCalled();
  });

  it("does not spend a budget when the signer is unavailable", async () => {
    const f = fixture();
    f.keys.isReady.mockReturnValue(false);
    await expect(f.service.issueOperatorStepUp(input)).rejects.toThrow(
      "temporarily_unavailable",
    );
    expect(f.redis.reserveOperatorStepUpAttempt).not.toHaveBeenCalled();
  });

  it("fails closed when the reservation store is unavailable", async () => {
    const f = fixture();
    f.redis.reserveOperatorStepUpAttempt.mockRejectedValue(
      new ServiceUnavailableException("unavailable"),
    );
    await expect(f.service.issueOperatorStepUp(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(f.mfa.verifySecondFactor).not.toHaveBeenCalled();
    expect(f.keys.sign).not.toHaveBeenCalled();
  });

  it("keeps an in-flight slot spent when factor verification fails unexpectedly", async () => {
    const f = fixture();
    f.mfa.verifySecondFactor.mockRejectedValue(new Error("factor unavailable"));
    await expect(f.service.issueOperatorStepUp(input)).rejects.toThrow(
      "factor unavailable",
    );
    expect(f.redis.finishOperatorStepUpAttempt).toHaveBeenCalledWith(
      OPERATOR,
      "reservation",
      false,
    );
    expect(f.keys.sign).not.toHaveBeenCalled();
  });

  it("does not sign if the replay store fails after successful factor verification", async () => {
    const f = fixture();
    f.redis.consumeOperatorStepUpTotp.mockRejectedValue(
      new ServiceUnavailableException("unavailable"),
    );
    await expect(f.service.issueOperatorStepUp(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(f.redis.finishOperatorStepUpAttempt).toHaveBeenCalledWith(
      OPERATOR,
      "reservation",
      false,
    );
    expect(f.keys.sign).not.toHaveBeenCalled();
  });

  it.each(["expired", "unavailable"])(
    "does not sign after an %s reservation completion",
    async (state) => {
      const f = fixture();
      if (state === "expired")
        f.redis.finishOperatorStepUpAttempt.mockResolvedValue(false);
      else
        f.redis.finishOperatorStepUpAttempt.mockRejectedValue(
          new ServiceUnavailableException("unavailable"),
        );
      await expect(f.service.issueOperatorStepUp(input)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(f.keys.sign).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// Action tickets require positive shared state; TOTP never overrides MFA policy.
// ===========================================================================
const action = { sessionHash: "a".repeat(64), requestHash: "b".repeat(64) };
const actionClaims = () => ({
  sub: `opr_${OPERATOR}`,
  aud: "admin",
  userType: "operator",
  stepup: true,
  jti: "11111111-1111-4111-8111-111111111111",
  exp: Math.floor(Date.now() / 1000) + 300,
  stepup_action: action,
});
const consumeInput = {
  operatorId: OPERATOR,
  stepUpToken: "signed-proof",
  action,
  audience: "admin",
};
describe("single voucher action issuance and consumption", () => {
  it("signs the exact binding and registers it before returning", async () => {
    const f = fixture();
    await f.service.issueOperatorStepUp({ ...input, action });
    expect(f.keys.sign).toHaveBeenCalledWith(
      expect.objectContaining({ stepup_action: action }),
      expect.objectContaining({ jwtid: expect.any(String) }),
    );
    expect(f.redis.storeOperatorStepUpAction).toHaveBeenCalledWith(
      f.keys.sign.mock.calls[0]![1].jwtid,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(
      f.redis.storeOperatorStepUpAction.mock.invocationCallOrder[0],
    ).toBeGreaterThan(f.keys.sign.mock.invocationCallOrder[0]!);
  });
  it("does not return a ticket if registration fails", async () => {
    const f = fixture();
    f.redis.storeOperatorStepUpAction.mockRejectedValue(
      new ServiceUnavailableException(),
    );
    await expect(
      f.service.issueOperatorStepUp({ ...input, action }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it("rejects TOTP when the current account requires WebAuthn", async () => {
    const f = fixture();
    f.mfa.resolveLoginMfa.mockResolvedValue({
      decision: { webauthnRequired: true },
      methods: ["webauthn"],
    });
    await expect(
      f.service.issueOperatorStepUp({ ...input, action }),
    ).rejects.toThrow("webauthn_required");
    expect(f.mfa.verifySecondFactor).not.toHaveBeenCalled();
    expect(f.keys.sign).not.toHaveBeenCalled();
  });
  it("does not issue when the account has no usable TOTP enrollment", async () => {
    const f = fixture();
    f.mfa.resolveLoginMfa.mockResolvedValue({
      decision: { webauthnRequired: false },
      methods: [],
    });
    await expect(f.service.issueOperatorStepUp(input)).rejects.toThrow(
      "operator_totp_required",
    );
    expect(f.keys.sign).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { ...action, requestHash: "invalid" },
    { ...action, sessionHash: 42 },
  ])("rejects malformed action %j", async (bad) => {
    const f = fixture();
    await expect(
      f.service.issueOperatorStepUp({ ...input, action: bad } as never),
    ).rejects.toThrow("invalid_request");
    expect(f.redis.reserveOperatorStepUpAttempt).not.toHaveBeenCalled();
  });
  it.each(["execute", "replay"] as const)(
    "accepts only confirmed %s mode",
    async (mode) => {
      const f = fixture();
      f.keys.verify.mockReturnValue(actionClaims());
      f.redis.consumeOperatorStepUpAction.mockResolvedValue(mode);
      expect(await f.service.consumeOperatorStepUp(consumeInput)).toEqual({
        mode,
      });
    },
  );
  it("rejects loss of the positive grant instead of treating it as unused", async () => {
    const f = fixture();
    f.keys.verify.mockReturnValue(actionClaims());
    f.redis.consumeOperatorStepUpAction.mockResolvedValue(null);
    await expect(f.service.consumeOperatorStepUp(consumeInput)).rejects.toThrow(
      "step_up_required",
    );
  });
  it.each([
    { sub: "opr_other" },
    { aud: "opera" },
    { userType: "tenant_user" },
    { stepup: false },
    { jti: undefined },
    { exp: undefined },
    { exp: 0 },
    { exp: 9999999999.5 },
    { stepup_action: { ...action, requestHash: "c".repeat(64) } },
    { stepup_action: { ...action, sessionHash: "c".repeat(64) } },
  ])(
    "rejects mismatched verified claims %j before shared state",
    async (overrides) => {
      const f = fixture();
      f.keys.verify.mockReturnValue({ ...actionClaims(), ...overrides });
      await expect(
        f.service.consumeOperatorStepUp(consumeInput),
      ).rejects.toThrow("step_up_required");
      expect(f.redis.consumeOperatorStepUpAction).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid signatures before accessing shared grants", async () => {
    const f = fixture();
    f.keys.verify.mockImplementation(() => {
      throw new Error("signature");
    });
    await expect(f.service.consumeOperatorStepUp(consumeInput)).rejects.toThrow(
      "step_up_required",
    );
    expect(f.redis.consumeOperatorStepUpAction).not.toHaveBeenCalled();
  });
  it("does not grant execution or replay when shared consumption is unavailable", async () => {
    const f = fixture();
    f.keys.verify.mockReturnValue(actionClaims());
    f.redis.consumeOperatorStepUpAction.mockRejectedValue(
      new ServiceUnavailableException(),
    );
    await expect(
      f.service.consumeOperatorStepUp(consumeInput),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it.each([
    { operatorId: undefined },
    { operatorId: "invalid" },
    { audience: "" },
    { audience: ["admin"] },
    { stepUpToken: 42 },
    { action: null },
    { action: [] },
  ])(
    "rejects malformed consumption context %j before signature or shared state",
    async (override) => {
      const f = fixture();
      await expect(
        f.service.consumeOperatorStepUp({
          ...consumeInput,
          ...override,
        } as never),
      ).rejects.toThrow("step_up_required");
      expect(f.keys.verify).not.toHaveBeenCalled();
      expect(f.redis.consumeOperatorStepUpAction).not.toHaveBeenCalled();
    },
  );
});
