/**
 * Customer self-service security regression coverage.
 * @package @vxture/service-account
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { AccountService } from "./account.service";
import { MockUserRepository } from "../repository/mock-user.repository";
import type { CustomerSecuritySnapshot } from "../types/account.types";

// ============================================================================
// Domain validation and atomic mock behavior
// ============================================================================

const snapshot: CustomerSecuritySnapshot = {
  phone: "+8613800138000",
  email: "old@example.com",
  phoneVerified: true,
  emailVerified: true,
  account: "account",
  accountLoginDisabled: false,
  hasPassword: true,
};
function build() {
  const users = {
    findCredentialById: vi.fn(async () => ({
      status: "active",
      passwordHash: "old-hash",
    })),
    applySelfSecurity: vi.fn(async () => {}),
  };
  const hasher = {
    hash: vi.fn(async () => "new-hash"),
    verify: vi.fn(async (p: string) => p === "old-password"),
  };
  return {
    users,
    hasher,
    service: new AccountService(users as never, hasher as never),
  };
}
describe("customer security domain policy", () => {
  it("requires the existing password as well as the external ownership proof", async () => {
    const f = build();
    await expect(
      f.service.applySelfSecurity(
        "123",
        { operation: "password", target: "", snapshot },
        { password: "new-password", currentPassword: "wrong" },
      ),
    ).rejects.toThrow("invalid_current_password");
    expect(f.users.applySelfSecurity).not.toHaveBeenCalled();
  });
  it("passes a hash comparison to the atomic repository mutation", async () => {
    const f = build();
    await f.service.applySelfSecurity(
      "123",
      { operation: "password", target: "", snapshot },
      { password: "new-password", currentPassword: "old-password" },
    );
    expect(f.users.applySelfSecurity).toHaveBeenCalledWith(
      "123",
      expect.objectContaining({
        passwordHash: "new-hash",
        expectedPasswordHash: "old-hash",
      }),
    );
  });
  it("allows first-time setup only with the captured empty credential state", async () => {
    const f = build();
    f.users.findCredentialById.mockResolvedValueOnce({
      status: "active",
      passwordHash: null,
    } as never);
    await f.service.applySelfSecurity(
      "123",
      {
        operation: "password",
        target: "",
        snapshot: { ...snapshot, hasPassword: false },
      },
      { password: "new-password" },
    );
    expect(f.users.applySelfSecurity).toHaveBeenCalledWith(
      "123",
      expect.objectContaining({ expectedPasswordHash: null }),
    );
  });
  it.each(["short", "x".repeat(129)])(
    "rejects invalid new password length",
    async (password) => {
      const f = build();
      await expect(
        f.service.applySelfSecurity(
          "123",
          { operation: "password", target: "", snapshot },
          { password, currentPassword: "old-password" },
        ),
      ).rejects.toThrow("invalid_password");
    },
  );
  it("does not mark a different address verified", async () => {
    const f = build();
    await expect(
      f.service.applySelfSecurity("123", {
        operation: "email-verify",
        target: "other@example.com",
        snapshot,
      }),
    ).rejects.toThrow("security_proof_stale");
    expect(f.users.applySelfSecurity).not.toHaveBeenCalled();
  });
  it("verifies an authenticated account by id even when username login is disabled", async () => {
    const f = build();
    f.users.findCredentialById.mockResolvedValue({
      status: "active",
      passwordHash: "old-hash",
      accountLoginDisabled: true,
    } as never);
    expect(await f.service.verifySelfPassword("123", "old-password")).toBe(
      true,
    );
    expect(await f.service.verifySelfPassword("123", "wrong")).toBe(false);
    expect(f.users.findCredentialById).toHaveBeenCalledWith("123");
  });
  it("rejects a changed opaque credential version before any write", async () => {
    const f = build();
    const version = await f.service.selfSecurityVersion("123");
    f.users.findCredentialById.mockResolvedValue({
      status: "active",
      passwordHash: "changed-hash",
    });
    await expect(
      f.service.applySelfSecurity("123", {
        operation: "username",
        target: "changed",
        snapshot: { ...snapshot, credentialVersion: version },
      }),
    ).rejects.toThrow("security_proof_stale");
    expect(f.users.applySelfSecurity).not.toHaveBeenCalled();
  });
});

describe("mock repository proof enforcement", () => {
  async function fixture() {
    const repo = new MockUserRepository();
    const user = await repo.createUser({
      account: "account",
      phone: "+8613800138000",
      phoneVerified: true,
      email: "old@example.com",
      emailVerified: true,
      name: null,
      passwordHash: null,
    });
    const proof = { ...snapshot, hasPassword: false };
    return { repo, user, proof };
  }
  it("rejects a stale contact snapshot without changing the account", async () => {
    const { repo, user, proof } = await fixture();
    await expect(
      repo.applySelfSecurity(user.id, {
        operation: "phone-change",
        target: "13900139000",
        snapshot: { ...proof, email: "stale@example.com" },
        expectedPasswordHash: null,
      }),
    ).rejects.toThrow("security_proof_stale");
    expect((await repo.getUserById(user.id))!.phone).toBe(proof.phone);
  });
  it("normalizes the new verified phone", async () => {
    const { repo, user, proof } = await fixture();
    await repo.applySelfSecurity(user.id, {
      operation: "phone-change",
      target: "13900139000",
      snapshot: proof,
      expectedPasswordHash: null,
    });
    expect((await repo.getUserById(user.id))!.phone).toBe("+8613900139000");
  });
  it("rejects concurrent initial password proof reuse", async () => {
    const { repo, user, proof } = await fixture();
    const m = {
      operation: "password" as const,
      target: "",
      snapshot: proof,
      expectedPasswordHash: null,
      passwordHash: "hash",
    };
    await repo.applySelfSecurity(user.id, m);
    await expect(repo.applySelfSecurity(user.id, m)).rejects.toThrow(
      "security_proof_stale",
    );
  });
  it("will not enable password login without a password", async () => {
    const { repo, user, proof } = await fixture();
    await expect(
      repo.applySelfSecurity(user.id, {
        operation: "account-login",
        target: "true",
        snapshot: proof,
        expectedPasswordHash: null,
      }),
    ).rejects.toThrow("password_required");
  });
  it("will not unlink the last usable login identity", async () => {
    const { repo, user } = await fixture();
    await repo.bindIdentity({
      userId: user.id,
      provider: "google",
      providerSubject: "subject",
    });
    const record = await repo.findCredentialById(user.id);
    record!.phoneVerified = false;
    record!.emailVerified = false;
    await expect(
      repo.applySelfSecurity(user.id, {
        operation: "identity-unlink",
        target: "google",
        snapshot: {
          ...snapshot,
          hasPassword: false,
          phoneVerified: false,
          emailVerified: false,
        },
        expectedPasswordHash: null,
      }),
    ).rejects.toThrow("cannot_remove_last_login_method");
    expect(await repo.listIdentitiesByUser(user.id)).toHaveLength(1);
  });
  it("rejects an unlink proof issued for a different provider subject", async () => {
    const { repo, user, proof } = await fixture();
    await repo.bindIdentity({
      userId: user.id,
      provider: "google",
      providerSubject: "new-subject",
    });
    await expect(
      repo.applySelfSecurity(user.id, {
        operation: "identity-unlink",
        target: "google",
        snapshot: { ...proof, identitySubjects: ["old-subject"] },
        expectedPasswordHash: null,
      }),
    ).rejects.toThrow("security_proof_stale");
    expect(await repo.listIdentitiesByUser(user.id)).toHaveLength(1);
  });
  it("unlinks only the exact verified provider binding", async () => {
    const { repo, user, proof } = await fixture();
    await repo.bindIdentity({
      userId: user.id,
      provider: "google",
      providerSubject: "subject",
    });
    await repo.applySelfSecurity(user.id, {
      operation: "identity-unlink",
      target: "google",
      snapshot: { ...proof, identitySubjects: ["subject"] },
      expectedPasswordHash: null,
    });
    expect(await repo.listIdentitiesByUser(user.id)).toHaveLength(0);
  });
  it("keeps sessions for usernames but revokes them for contact credentials", async () => {
    const { repo, user, proof } = await fixture();
    const sessions = vi.spyOn(repo, "revokeAllSessions");
    const tokens = vi.spyOn(repo, "revokeAllRefreshTokens");
    await repo.applySelfSecurity(user.id, {
      operation: "username",
      target: "new_account",
      snapshot: proof,
      expectedPasswordHash: null,
    });
    expect(sessions).not.toHaveBeenCalled();
    expect(tokens).not.toHaveBeenCalled();
    await repo.applySelfSecurity(user.id, {
      operation: "email-change",
      target: "new@example.com",
      snapshot: { ...proof, account: "new_account" },
      expectedPasswordHash: null,
    });
    expect(sessions).toHaveBeenCalledOnce();
    expect(tokens).toHaveBeenCalledOnce();
  });
});
