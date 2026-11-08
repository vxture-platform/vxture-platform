/**
 * Workforce phone-change ceremony orchestration regression coverage.
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

const PHONE = "13800000000";
const SCOPE = { scope: "workforce-phone-change" };

function build() {
  const operators = { setOperatorContactVerified: vi.fn(async () => true) };
  const realm = { requireOperator: vi.fn(async () => "operator-1") };
  const redis = {
    beginOperatorPhoneChange: vi.fn(
      async (): Promise<string | null> => "sending-version",
    ),
    attemptOperatorPhoneChange: vi.fn(
      async (): Promise<string | null> => "checking-version",
    ),
    finishOperatorPhoneChange: vi.fn(async () => true),
  };
  const phone = {
    sendCode: vi.fn(async () => {}),
    verifyCode: vi.fn(async () => true),
  };
  const service = new OperatorSelfService(
    operators as never,
    redis as never,
    realm as never,
    {} as never,
    phone as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, operators, redis, realm, phone };
}

// ============================================================================
// Dispatch and verification boundaries
// ============================================================================

describe("workforce phone-change dispatch", () => {
  it("stages the account/session/target before dispatch, then activates only its own version", async () => {
    const { service, redis, phone } = build();
    await expect(
      service.startPhoneChange("sid-a", ` ${PHONE} `),
    ).resolves.toMatchObject({ ok: true });
    expect(redis.beginOperatorPhoneChange).toHaveBeenCalledWith(
      "operator-1",
      "sid-a",
      PHONE,
    );
    expect(phone.sendCode).toHaveBeenCalledWith(PHONE, SCOPE);
    expect(redis.finishOperatorPhoneChange).toHaveBeenCalledWith(
      "operator-1",
      "sending-version",
      false,
    );
    expect(
      redis.beginOperatorPhoneChange.mock.invocationCallOrder[0],
    ).toBeLessThan(phone.sendCode.mock.invocationCallOrder[0]!);
  });

  it("rejects send-budget exhaustion before contacting the provider", async () => {
    const { service, redis, phone } = build();
    redis.beginOperatorPhoneChange.mockResolvedValue(null);
    await expect(
      service.startPhoneChange("sid-a", PHONE),
    ).rejects.toMatchObject({ status: 429 });
    expect(phone.sendCode).not.toHaveBeenCalled();
  });

  it("invalidates its pending version when dispatch fails", async () => {
    const { service, redis, phone } = build();
    phone.sendCode.mockRejectedValue(new Error("SMS failed"));
    await expect(service.startPhoneChange("sid-a", PHONE)).rejects.toThrow(
      "SMS failed",
    );
    expect(redis.finishOperatorPhoneChange).toHaveBeenCalledWith(
      "operator-1",
      "sending-version",
      true,
    );
  });

  it("does not report a stale/expired dispatch as usable", async () => {
    const { service, redis } = build();
    redis.finishOperatorPhoneChange.mockResolvedValue(false);
    await expect(service.startPhoneChange("sid-a", PHONE)).rejects.toThrow(
      "invalid_or_expired_code",
    );
  });
});

describe("workforce phone-change verification", () => {
  it("consumes the exact version before writing verified contact data", async () => {
    const { service, redis, phone, operators, realm } = build();
    await expect(
      service.verifyPhoneChange("sid-a", PHONE, "123456"),
    ).resolves.toEqual({ ok: true, phone: PHONE });
    expect(redis.attemptOperatorPhoneChange).toHaveBeenCalledWith(
      "operator-1",
      "sid-a",
      PHONE,
    );
    expect(phone.verifyCode).toHaveBeenCalledWith(PHONE, "123456", SCOPE);
    expect(redis.finishOperatorPhoneChange).toHaveBeenCalledWith(
      "operator-1",
      "checking-version",
      true,
    );
    expect(
      redis.finishOperatorPhoneChange.mock.invocationCallOrder[0],
    ).toBeLessThan(
      operators.setOperatorContactVerified.mock.invocationCallOrder[0]!,
    );
    expect(realm.requireOperator).toHaveBeenCalledTimes(2);
    expect(operators.setOperatorContactVerified).toHaveBeenCalledWith(
      "operator-1",
      "phone",
      PHONE,
    );
  });

  it("rejects unauthenticated/customer sessions before sending or checking codes", async () => {
    const { service, realm, phone, redis } = build();
    realm.requireOperator.mockRejectedValue(
      new Error("operator_session_required"),
    );
    await expect(
      service.startPhoneChange("customer-sid", PHONE),
    ).rejects.toThrow("operator_session_required");
    await expect(
      service.verifyPhoneChange("customer-sid", PHONE, "123456"),
    ).rejects.toThrow("operator_session_required");
    expect(redis.beginOperatorPhoneChange).not.toHaveBeenCalled();
    expect(redis.attemptOperatorPhoneChange).not.toHaveBeenCalled();
    expect(phone.verifyCode).not.toHaveBeenCalled();
  });

  it("rejects missing, expired, mismatched, exhausted or busy records before provider I/O", async () => {
    const { service, redis, phone, operators } = build();
    redis.attemptOperatorPhoneChange.mockResolvedValue(null);
    await expect(
      service.verifyPhoneChange("other-sid", PHONE, "123456"),
    ).rejects.toThrow("invalid_or_expired_code");
    expect(phone.verifyCode).not.toHaveBeenCalled();
    expect(operators.setOperatorContactVerified).not.toHaveBeenCalled();
  });

  it("releases a wrong-code attempt without writing contact data", async () => {
    const { service, redis, phone, operators } = build();
    phone.verifyCode.mockResolvedValue(false);
    await expect(
      service.verifyPhoneChange("sid-a", PHONE, "123456"),
    ).rejects.toThrow("invalid_or_expired_code");
    expect(redis.finishOperatorPhoneChange).toHaveBeenCalledWith(
      "operator-1",
      "checking-version",
      false,
    );
    expect(operators.setOperatorContactVerified).not.toHaveBeenCalled();
  });

  it("releases a failed provider request while preserving its consumed attempt budget", async () => {
    const { service, redis, phone, operators } = build();
    phone.verifyCode.mockRejectedValue(new Error("provider unavailable"));
    await expect(
      service.verifyPhoneChange("sid-a", PHONE, "123456"),
    ).rejects.toThrow("provider unavailable");
    expect(redis.finishOperatorPhoneChange).toHaveBeenCalledWith(
      "operator-1",
      "checking-version",
      false,
    );
    expect(operators.setOperatorContactVerified).not.toHaveBeenCalled();
  });

  it("rejects a successful provider result invalidated by expiry/resend/concurrent consumption", async () => {
    const { service, redis, operators } = build();
    redis.finishOperatorPhoneChange.mockResolvedValue(false);
    await expect(
      service.verifyPhoneChange("sid-a", PHONE, "123456"),
    ).rejects.toThrow("invalid_or_expired_code");
    expect(operators.setOperatorContactVerified).not.toHaveBeenCalled();
  });

  it("rejects a session revoked while the provider request is in flight", async () => {
    const { service, realm, operators } = build();
    realm.requireOperator
      .mockResolvedValueOnce("operator-1")
      .mockRejectedValueOnce(new Error("operator_session_required"));
    await expect(
      service.verifyPhoneChange("sid-a", PHONE, "123456"),
    ).rejects.toThrow("operator_session_required");
    expect(operators.setOperatorContactVerified).not.toHaveBeenCalled();
  });

  it("fails closed if Redis fails after the provider accepts a code", async () => {
    const { service, redis, operators } = build();
    redis.finishOperatorPhoneChange.mockRejectedValue(
      new Error("Redis unavailable"),
    );
    await expect(
      service.verifyPhoneChange("sid-a", PHONE, "123456"),
    ).rejects.toThrow("Redis unavailable");
    expect(operators.setOperatorContactVerified).not.toHaveBeenCalled();
  });

  it.each(["", "1", "abcdef", "1234567"])(
    "rejects malformed code %s before reserving attempts",
    async (code) => {
      const { service, redis } = build();
      await expect(
        service.verifyPhoneChange("sid-a", PHONE, code),
      ).rejects.toThrow("invalid_request");
      expect(redis.attemptOperatorPhoneChange).not.toHaveBeenCalled();
    },
  );

  it("maps uniqueness conflicts to phone_in_use after consuming the proof", async () => {
    const { service, operators } = build();
    operators.setOperatorContactVerified.mockRejectedValue({ code: "23505" });
    await expect(
      service.verifyPhoneChange("sid-a", PHONE, "123456"),
    ).rejects.toThrow("phone_in_use");
  });
});
