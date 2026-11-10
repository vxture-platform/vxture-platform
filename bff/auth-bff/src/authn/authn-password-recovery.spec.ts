/**
 * Verified customer recovery and runtime request validation regressions.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { describe, expect, it, vi } from "vitest";
import { AuthnController } from "./authn.controller";
import { AuthnService } from "./authn.service";

// ============================================================================
// Service boundaries: customer account, token storage and delivery
// ============================================================================
function fixture() {
  const user = {
    id: "customer-id",
    email: "owner@example.test",
    emailVerified: true,
    status: "active",
  };
  const account = {
    findUserByIdentifier: vi.fn(async (): Promise<typeof user | null> => user),
    setPassword: vi.fn(async () => {}),
  };
  const passwordReset = {
    issue: vi.fn(async (): Promise<string | null> => "a".repeat(64)),
    consume: vi.fn(async (): Promise<string | null> => user.id),
  };
  const mail = { sendPasswordReset: vi.fn(async () => {}) };
  const service = Object.create(AuthnService.prototype) as AuthnService;
  Object.assign(service, {
    account,
    passwordReset,
    mail,
    config: {
      platform: { LOGIN_UI_BASE_URL: "https://accounts.example.test/" },
    },
  });
  const controller = new AuthnController(service, {} as never, {} as never);
  return { user, account, passwordReset, mail, service, controller };
}
describe("customer email recovery", () => {
  it("sends only to the normalized verified matching email", async () => {
    const f = fixture();
    await expect(
      f.controller.forgotPassword({ email: " Owner@Example.Test " }),
    ).resolves.toEqual({ ok: true });
    expect(f.account.findUserByIdentifier).toHaveBeenCalledWith(
      "owner@example.test",
    );
    expect(f.passwordReset.issue).toHaveBeenCalledWith(
      "customer-id",
      900,
      "owner@example.test",
    );
    expect(f.mail.sendPasswordReset).toHaveBeenCalledWith(
      "owner@example.test",
      `https://accounts.example.test/reset-password?token=${"a".repeat(64)}`,
    );
  });
  it.each([
    { emailVerified: false },
    { email: "different@example.test" },
    { status: "disabled" },
    { status: "pending" },
  ])("does not issue to ineligible identity %j", async (patch) => {
    const f = fixture();
    Object.assign(f.user, patch);
    await expect(
      f.controller.forgotPassword({ email: "owner@example.test" }),
    ).resolves.toEqual({ ok: true });
    expect(f.passwordReset.issue).not.toHaveBeenCalled();
    expect(f.mail.sendPasswordReset).not.toHaveBeenCalled();
  });
  it("returns the same response for an absent customer", async () => {
    const f = fixture();
    f.account.findUserByIdentifier.mockResolvedValue(null);
    await expect(
      f.controller.forgotPassword({ email: "owner@example.test" }),
    ).resolves.toEqual({ ok: true });
    expect(f.passwordReset.issue).not.toHaveBeenCalled();
  });
  it.each(["handle", "13800138000", "wrong@", "a".repeat(129) + "@x.test"])(
    "never resolves a non-email recovery identifier %s",
    async (email) => {
      const f = fixture();
      await f.service.requestPasswordReset(email);
      expect(f.account.findUserByIdentifier).not.toHaveBeenCalled();
    },
  );
  it("does not dispatch when storage rejects a changed email or account", async () => {
    const f = fixture();
    f.passwordReset.issue.mockResolvedValue(null);
    await f.service.requestPasswordReset("owner@example.test");
    expect(f.mail.sendPasswordReset).not.toHaveBeenCalled();
  });
  it("keeps the anti-enumeration response on delivery failure", async () => {
    const f = fixture();
    f.mail.sendPasswordReset.mockRejectedValue(new Error("offline"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        f.controller.forgotPassword({ email: "owner@example.test" }),
      ).resolves.toEqual({ ok: true });
    } finally {
      log.mockRestore();
    }
  });
  it.each([{}, { email: 3 }, { email: [] }, { email: "" }, null])(
    "rejects malformed request %j without lookup",
    async (body) => {
      const f = fixture();
      await expect(f.controller.forgotPassword(body as never)).rejects.toThrow(
        "a valid email is required",
      );
      expect(f.account.findUserByIdentifier).not.toHaveBeenCalled();
    },
  );
});

// ============================================================================
// Password policy precedes one-time token consumption
// ============================================================================
describe("password reset completion", () => {
  it.each([
    { token: 3, password: "Abc123456" },
    { token: [], password: "Abc123456" },
    { token: "a".repeat(64), password: [] },
    { token: "a".repeat(64), password: "weak" },
    null,
  ])("rejects malformed/weak completion %j before consuming", async (body) => {
    const f = fixture();
    await expect(f.controller.resetPassword(body as never)).rejects.toThrow();
    expect(f.passwordReset.consume).not.toHaveBeenCalled();
    expect(f.account.setPassword).not.toHaveBeenCalled();
  });
  it("rejects revoked, expired or stale links without password mutation", async () => {
    const f = fixture();
    f.passwordReset.consume.mockResolvedValue(null);
    await expect(
      f.controller.resetPassword({
        token: "a".repeat(64),
        password: "Abc123456",
      }),
    ).rejects.toThrow("invalid or expired token");
    expect(f.account.setPassword).not.toHaveBeenCalled();
  });
  it("uses the customer write path for a valid one-time token", async () => {
    const f = fixture();
    await expect(
      f.controller.resetPassword({
        token: "a".repeat(64),
        password: "Abc123456",
      }),
    ).resolves.toEqual({ ok: true });
    expect(f.account.setPassword).toHaveBeenCalledWith(
      "customer-id",
      "Abc123456",
      { cause: "reset_by_email" },
    );
  });
});
