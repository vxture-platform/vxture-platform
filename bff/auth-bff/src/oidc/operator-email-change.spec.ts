/**
 * Workforce email ceremony and legacy write retirement regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { OperatorSelfService } from "./operator-self.service";
import { OperatorAdminInternalRouter } from "../routers/operator-admin-internal.router";

// ============================================================================
// Session and delivery boundaries
// ============================================================================
function fixture() {
  const operators = {
    findById: vi.fn(async () => ({ authenticationVersion: "v1" })),
    getOperatorAdminView: vi.fn(async () => ({
      email: "old@example.com",
      emailVerified: true,
      phone: "13900139000",
      phoneVerified: true,
    })),
    setOperatorContactVerified: vi.fn(async () => true),
  };
  const redis = {
    beginOperatorEmailChange: vi.fn(
      async (): Promise<string | null> => "version",
    ),
    finishOperatorEmailChange: vi.fn(async () => true),
    consumeOperatorEmailChange: vi.fn(
      async (): Promise<string | null> => "new@example.com",
    ),
  };
  const realms = { requireOperator: vi.fn(async () => "operator") };
  const mail = { sendVerifyCode: vi.fn(async () => ({})) };
  const service = new OperatorSelfService(
    operators as never,
    redis as never,
    realms as never,
    mail as never,
    {} as never,
    {} as never,
    {} as never,
    { endOperatorSessions: vi.fn(async () => {}) } as never,
    { require: vi.fn(async () => {}) } as never,
  );
  return { service, operators, redis, realms, mail };
}

describe("workforce email change", () => {
  it("stages the session and target before sending, then activates the exact version", async () => {
    const f = fixture();
    await f.service.startEmailChange("sid", " NEW@example.com ");
    expect(f.redis.beginOperatorEmailChange).toHaveBeenCalledWith(
      "operator",
      "sid",
      "new@example.com",
      expect.stringMatching(/^\d{6}$/),
    );
    expect(
      f.redis.beginOperatorEmailChange.mock.invocationCallOrder[0],
    ).toBeLessThan(f.mail.sendVerifyCode.mock.invocationCallOrder[0]!);
    expect(f.redis.finishOperatorEmailChange).toHaveBeenCalledWith(
      "operator",
      "version",
      false,
    );
  });
  it("does not send when the account budget is exhausted", async () => {
    const f = fixture();
    f.redis.beginOperatorEmailChange.mockResolvedValue(null);
    await expect(
      f.service.startEmailChange("sid", "new@example.com"),
    ).rejects.toMatchObject({ status: 429 });
    expect(f.mail.sendVerifyCode).not.toHaveBeenCalled();
  });
  it("discards only its own proof on delivery failure", async () => {
    const f = fixture();
    f.mail.sendVerifyCode.mockRejectedValue(new Error("delivery failed"));
    await expect(
      f.service.startEmailChange("sid", "new@example.com"),
    ).rejects.toThrow("delivery failed");
    expect(f.redis.finishOperatorEmailChange).toHaveBeenCalledWith(
      "operator",
      "version",
      true,
    );
  });
  it("rejects a dispatch invalidated by expiry or a resend", async () => {
    const f = fixture();
    f.redis.finishOperatorEmailChange.mockResolvedValue(false);
    await expect(
      f.service.startEmailChange("sid", "new@example.com"),
    ).rejects.toThrow("invalid_or_expired_code");
  });
  it("consumes the session proof before rechecking authorization and writing", async () => {
    const f = fixture();
    await f.service.verifyEmailChange("sid", "123456");
    expect(f.redis.consumeOperatorEmailChange).toHaveBeenCalledWith(
      "operator",
      "sid",
      "123456",
    );
    expect(f.realms.requireOperator).toHaveBeenCalledTimes(2);
    expect(f.operators.setOperatorContactVerified).toHaveBeenCalledWith(
      "operator",
      "email",
      "new@example.com",
      "v1",
    );
  });
  it("rejects missing or replayed proof without writing", async () => {
    const f = fixture();
    f.redis.consumeOperatorEmailChange.mockResolvedValue(null);
    await expect(f.service.verifyEmailChange("sid", "123456")).rejects.toThrow(
      "invalid_or_expired_code",
    );
    expect(f.operators.setOperatorContactVerified).not.toHaveBeenCalled();
  });
  it("rejects logout during proof consumption", async () => {
    const f = fixture();
    f.realms.requireOperator
      .mockResolvedValueOnce("operator")
      .mockRejectedValueOnce(new Error("revoked"));
    await expect(f.service.verifyEmailChange("sid", "123456")).rejects.toThrow(
      "revoked",
    );
    expect(f.operators.setOperatorContactVerified).not.toHaveBeenCalled();
  });
  it("handles unknown JSON values and malformed codes without a server error", async () => {
    const f = fixture();
    await expect(
      f.service.startEmailChange("sid", {} as never),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.service.verifyEmailChange("sid", {} as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.redis.consumeOperatorEmailChange).not.toHaveBeenCalled();
  });
  it("maps a contact collision to conflict and a disabled account to unauthorized", async () => {
    const f = fixture();
    f.operators.setOperatorContactVerified
      .mockRejectedValueOnce({ code: "23505" })
      .mockResolvedValueOnce(false);
    await expect(
      f.service.verifyEmailChange("sid", "123456"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.service.verifyEmailChange("sid", "123456"),
    ).rejects.toMatchObject({ status: 401 });
  });
});

// ============================================================================
// Old internal self-service cannot issue or consume an account-center proof
// ============================================================================
describe("legacy operator email entry", () => {
  it("returns 410 without touching contact, mail or Redis services", async () => {
    const f = fixture();
    const router = new OperatorAdminInternalRouter(
      f.operators as never,
      {} as never,
      f.redis as never,
      {} as never,
      f.mail as never,
      {} as never,
    );
    await expect(
      router.startEmailChange("operator", {
        actorOperatorId: "operator",
        newEmail: "new@example.com",
      }),
    ).rejects.toMatchObject({ status: 410 });
    await expect(
      router.verifyEmailChange("operator", {
        actorOperatorId: "operator",
        code: "123456",
      }),
    ).rejects.toMatchObject({ status: 410 });
    expect(f.mail.sendVerifyCode).not.toHaveBeenCalled();
    expect(f.operators.setOperatorContactVerified).not.toHaveBeenCalled();
    expect(f.redis.beginOperatorEmailChange).not.toHaveBeenCalled();
  });
});
