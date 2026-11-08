/**
 * Customer password-write revocation policy regression coverage.
 * @package @vxture/service-account
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { AccountService, type PasswordWriteCause } from "./account.service";

// ============================================================================
// Fixtures
// ============================================================================

function build() {
  const users = {
    setPassword: vi.fn(async () => {}),
    findCredentialById: vi.fn(async () => ({
      passwordHash: "hash:old-password",
    })),
  };
  const hasher = {
    hash: vi.fn(async (password: string) => `hash:${password}`),
    verify: vi.fn(
      async (password: string, hash: string) => hash === `hash:${password}`,
    ),
  };
  return {
    service: new AccountService(users as never, hasher as never),
    users,
    hasher,
  };
}

// ============================================================================
// Password-write policy
// ============================================================================

describe("customer credential revocation policy", () => {
  it.each<PasswordWriteCause>([
    "self_change",
    "reset_by_email",
    "reset_by_admin",
  ])("%s requires atomic session and token revocation", async (cause) => {
    const { service, users } = build();
    await service.setPassword("customer-1", "new-password", { cause });
    expect(users.setPassword).toHaveBeenCalledExactlyOnceWith(
      "customer-1",
      "hash:new-password",
      true,
    );
  });

  it("preserves sessions only for first-time password setup", async () => {
    const { service, users } = build();
    await service.setPassword("customer-1", "first-password", {
      cause: "initial_set",
    });
    expect(users.setPassword).toHaveBeenCalledExactlyOnceWith(
      "customer-1",
      "hash:first-password",
      false,
    );
  });

  it("uses the same revocation write for self-service password changes", async () => {
    const { service, users } = build();
    expect(
      await service.changePassword(
        "customer-1",
        "old-password",
        "new-password",
      ),
    ).toBe(true);
    expect(users.setPassword).toHaveBeenCalledWith(
      "customer-1",
      "hash:new-password",
      true,
    );
  });

  it("does not change credentials or sessions when the old password is wrong", async () => {
    const { service, users } = build();
    expect(
      await service.changePassword("customer-1", "wrong", "new-password"),
    ).toBe(false);
    expect(users.setPassword).not.toHaveBeenCalled();
  });

  it("does not write credentials when hashing fails", async () => {
    const { service, users, hasher } = build();
    hasher.hash.mockRejectedValue(new Error("hash failure"));
    await expect(
      service.setPassword("customer-1", "new-password", {
        cause: "reset_by_email",
      }),
    ).rejects.toThrow("hash failure");
    expect(users.setPassword).not.toHaveBeenCalled();
  });

  it("propagates persistence failures rather than reporting a completed reset", async () => {
    const { service, users } = build();
    users.setPassword.mockRejectedValue(new Error("transaction rolled back"));
    await expect(
      service.setPassword("customer-1", "new-password", {
        cause: "reset_by_email",
      }),
    ).rejects.toThrow("transaction rolled back");
  });
});
