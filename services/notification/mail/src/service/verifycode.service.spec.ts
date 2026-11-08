/**
 * Purpose isolation, delivery failure and atomic consumption regression coverage.
 * @package @vxture/service-mail
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { VerifyCodeService } from "./verifycode.service";

// ============================================================================
// Delivery and trust boundaries (Lua atomicity is covered by live Redis tests)
// ============================================================================
function fixture() {
  const redis = { eval: vi.fn(async (..._args: unknown[]) => 1) };
  const mail = {
    sendVerifyCode: vi.fn(async (_address: string, _code: string) => {}),
  };
  return {
    redis,
    mail,
    service: new VerifyCodeService(redis as never, mail as never),
  };
}
describe("purpose-scoped email verification", () => {
  it("reserves before delivery and activates only after delivery", async () => {
    const f = fixture();
    await f.service.sendCode(" ALICE@example.com ", "customer-login");
    expect(f.mail.sendVerifyCode).toHaveBeenCalledWith(
      "alice@example.com",
      expect.stringMatching(/^\d{6}$/),
    );
    expect(f.redis.eval.mock.invocationCallOrder[0]).toBeLessThan(
      f.mail.sendVerifyCode.mock.invocationCallOrder[0]!,
    );
    expect(f.mail.sendVerifyCode.mock.invocationCallOrder[0]).toBeLessThan(
      f.redis.eval.mock.invocationCallOrder[1]!,
    );
    expect(f.redis.eval.mock.calls[0]?.[5]).toMatch(
      /^vc:v2:code:customer-login:/,
    );
    expect(f.redis.eval.mock.calls[1]?.at(-1)).toBe("ready");
  });
  it("never delivers when the send budget cannot be reserved", async () => {
    const f = fixture();
    f.redis.eval.mockResolvedValue(0);
    await expect(
      f.service.sendCode("alice@example.com", "customer-login"),
    ).rejects.toThrow();
    expect(f.mail.sendVerifyCode).not.toHaveBeenCalled();
  });
  it("invalidates a failed delivery and preserves the send reservation", async () => {
    const f = fixture();
    f.mail.sendVerifyCode.mockRejectedValue(new Error("SMTP offline"));
    await expect(
      f.service.sendCode("alice@example.com", "customer-login"),
    ).rejects.toThrow("SMTP offline");
    expect(f.redis.eval.mock.calls[1]?.at(-1)).toBe("failed");
  });
  it("rejects unsupported purposes without Redis access", async () => {
    const f = fixture();
    await expect(
      f.service.sendCode("alice@example.com", "workforce-login" as never),
    ).rejects.toThrow("invalid_email_code_purpose");
    await expect(
      f.service.verifyCode("alice@example.com", "123456", "change" as never),
    ).rejects.toThrow("invalid_email_code_purpose");
    expect(f.redis.eval).not.toHaveBeenCalled();
  });
  it("normalizes addresses and delegates verification to one atomic Redis operation", async () => {
    const f = fixture();
    expect(
      await f.service.verifyCode(
        " ALICE@example.com ",
        "123456",
        "customer-login",
      ),
    ).toBe(true);
    expect(f.redis.eval).toHaveBeenCalledOnce();
    expect(f.redis.eval.mock.calls[0]?.[2]).toMatch(
      /^vc:v2:code:customer-login:/,
    );
    f.redis.eval.mockResolvedValue(0);
    expect(
      await f.service.verifyCode(
        "alice@example.com",
        "123456",
        "customer-login",
      ),
    ).toBe(false);
  });
});
