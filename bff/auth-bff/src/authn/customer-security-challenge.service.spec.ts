/**
 * Customer self-service security regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { CustomerSecurityChallengeService } from "./customer-security-challenge.service";
import type { CustomerSessionContext } from "../oidc/realm-session.service";

// ============================================================================
// Deterministic authority and delivery fixtures
// ============================================================================

const context: CustomerSessionContext = {
  sid: "sid",
  userId: "123",
  user: {
    id: "123",
    status: "active",
    account: "account",
    phone: "+8613800138000",
    phoneVerified: true,
    email: "old@example.com",
    emailVerified: true,
    name: null,
    avatarHash: null,
  },
};
function fixture() {
  const values = new Map<string, string>();
  const redis = {
    reserveCustomerSecurityBudget: vi.fn(async () => true),
    createCustomerSecurity: vi.fn(async (id: string, value: string) => {
      values.set(id, value);
      return true;
    }),
    readCustomerSecurity: vi.fn(async (id: string) => values.get(id) ?? null),
    swapCustomerSecurity: vi.fn(
      async (id: string, expected: string, next: string | null) => {
        if (values.get(id) !== expected) return false;
        if (next === null) values.delete(id);
        else values.set(id, next);
        return true;
      },
    ),
  };
  const sms = {
    sendCode: vi.fn(async () => {}),
    verifyCode: vi.fn(
      async (_phone: string, code: string) => code === "123456",
    ),
  };
  const mail = {
    sendVerifyCode: vi.fn(async (_to: string, _code: string) => {}),
  };
  return {
    service: new CustomerSecurityChallengeService(
      redis as never,
      sms as never,
      mail as never,
    ),
    redis,
    sms,
    mail,
    values,
  };
}

describe("customer sensitive-operation proofs", () => {
  it("requires old anchor and new target ownership before change authorization", async () => {
    const f = fixture();
    const { challengeId: id } = await f.service.start(
      context,
      "phone-change",
      "13900139000",
      "email",
    );
    await expect(f.service.sendTarget(context, id)).rejects.toThrow(
      "security_challenge_stage",
    );
    await expect(f.service.consume(context, id)).rejects.toThrow(
      "security_proof_required",
    );
    const code = f.mail.sendVerifyCode.mock.calls[0]![1];
    await f.service.verify(context, id, code);
    await expect(f.service.consume(context, id)).rejects.toThrow(
      "security_proof_required",
    );
    await f.service.sendTarget(context, id);
    expect(f.sms.sendCode).toHaveBeenCalledWith("13900139000", {
      scope: "customer-phone-change",
      context: id,
    });
    await f.service.verify(context, id, "123456", true);
    const proof = await f.service.consume(context, id);
    expect(proof.target).toBe("13900139000");
    await expect(f.service.consume(context, id)).rejects.toThrow(
      "security_challenge_expired",
    );
  });
  it("checks the old phone and new email in separate stages", async () => {
    const f = fixture();
    const { challengeId: id } = await f.service.start(
      context,
      "email-change",
      "new@example.com",
      "phone",
    );
    expect(f.sms.sendCode).toHaveBeenCalledWith("13800138000", {
      scope: "customer-security",
      context: id,
    });
    await f.service.verify(context, id, "123456");
    await f.service.sendTarget(context, id);
    const code = f.mail.sendVerifyCode.mock.calls[0]![1];
    expect(f.mail.sendVerifyCode.mock.calls[0]![0]).toBe("new@example.com");
    await f.service.verify(context, id, code, true);
    expect((await f.service.consume(context, id)).target).toBe(
      "new@example.com",
    );
  });
  it.each([{ sid: "other" }, { userId: "other" }])(
    "rejects a different ceremony owner %j",
    async (patch) => {
      const f = fixture();
      const { challengeId: id } = await f.service.start(
        context,
        "password",
        "",
        "phone",
      );
      await expect(
        f.service.verify({ ...context, ...patch }, id, "123456"),
      ).rejects.toThrow("security_challenge_owner");
      expect(f.sms.verifyCode).not.toHaveBeenCalled();
    },
  );
  it("locks out after five incorrect codes", async () => {
    const f = fixture();
    const { challengeId: id } = await f.service.start(
      context,
      "password",
      "",
      "phone",
    );
    for (let i = 0; i < 5; i++)
      await expect(f.service.verify(context, id, "999999")).rejects.toThrow(
        "invalid_code",
      );
    await expect(f.service.verify(context, id, "123456")).rejects.toThrow(
      "security_challenge_expired",
    );
    expect(f.sms.verifyCode).toHaveBeenCalledTimes(5);
  });
  it("allows only one concurrent proof consumer", async () => {
    const f = fixture();
    const { challengeId: id } = await f.service.start(
      context,
      "password",
      "",
      "phone",
    );
    await f.service.verify(context, id, "123456");
    const results = await Promise.allSettled([
      f.service.consume(context, id),
      f.service.consume(context, id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("allows only one concurrent provider verifier", async () => {
    const f = fixture();
    const { challengeId: id } = await f.service.start(
      context,
      "password",
      "",
      "phone",
    );
    const results = await Promise.allSettled([
      f.service.verify(context, id, "123456"),
      f.service.verify(context, id, "123456"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.sms.verifyCode).toHaveBeenCalledTimes(1);
  });
  it("burns failed deliveries without activating a ceremony", async () => {
    const f = fixture();
    f.mail.sendVerifyCode.mockRejectedValueOnce(new Error("smtp unavailable"));
    await expect(
      f.service.start(context, "password", "", "email"),
    ).rejects.toThrow("smtp unavailable");
    expect(f.values.size).toBe(0);
  });
  it("does not activate a challenge that expires during delivery", async () => {
    const f = fixture();
    f.mail.sendVerifyCode.mockImplementationOnce(async () => {
      f.values.clear();
    });
    await expect(
      f.service.start(context, "password", "", "email"),
    ).rejects.toThrow("security_delivery_expired");
  });
  it("reserves send budgets before any provider work", async () => {
    const f = fixture();
    f.redis.reserveCustomerSecurityBudget.mockResolvedValueOnce(false);
    await expect(
      f.service.start(context, "password", "", "phone"),
    ).rejects.toThrow("too_many_attempts");
    expect(f.sms.sendCode).not.toHaveBeenCalled();
  });
  it("will not use unverified contact as authority for another operation", async () => {
    const f = fixture();
    const unverified = {
      ...context,
      user: { ...context.user, emailVerified: false },
    };
    await expect(
      f.service.start(unverified, "password", "", "email"),
    ).rejects.toThrow("verified_anchor_required");
    const { challengeId: id } = await f.service.start(
      unverified,
      "email-verify",
      unverified.user.email!,
      "email",
    );
    await f.service.verify(
      unverified,
      id,
      f.mail.sendVerifyCode.mock.calls[0]![1],
    );
    expect((await f.service.consume(unverified, id)).operation).toBe(
      "email-verify",
    );
  });
  it("does not let email proof mark a phone verified", async () => {
    const f = fixture();
    await expect(
      f.service.start(context, "phone-verify", context.user.phone, "email"),
    ).rejects.toThrow("invalid_verification_method");
  });
  it("does not expose a plaintext email code in persisted facts", async () => {
    const f = fixture();
    const { challengeId: id } = await f.service.start(
      context,
      "password",
      "",
      "email",
    );
    const data = JSON.parse(f.values.get(id)!);
    expect(data.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(data.code).toBeUndefined();
  });
});

describe("lifecycle proof isolation", () => {
  it("does not consume a valid password proof through the deletion endpoint", async () => {
    const f = fixture();
    const { challengeId } = await f.service.start(
      context,
      "password",
      "",
      "email",
    );
    await f.service.verify(
      context,
      challengeId,
      f.mail.sendVerifyCode.mock.calls[0]![1],
    );
    await expect(
      f.service.consume(context, challengeId, "account-deletion"),
    ).rejects.toThrow("security_proof_required");
    expect((await f.service.consume(context, challengeId)).operation).toBe(
      "password",
    );
  });
  it("binds recovery to the existing email and consumes it only once", async () => {
    const f = fixture();
    const { challengeId } = await f.service.start(
      context,
      "account-recovery",
      "request-time",
      "email",
    );
    await f.service.verify(
      context,
      challengeId,
      f.mail.sendVerifyCode.mock.calls[0]![1],
    );
    const proof = await f.service.consume(
      context,
      challengeId,
      "account-recovery",
    );
    expect(proof.target).toBe("request-time");
    await expect(
      f.service.consume(context, challengeId, "account-recovery"),
    ).rejects.toThrow();
  });
});
