/**
 * Offline lifecycle behavior and retention boundary regression coverage.
 * @package @vxture/service-account
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockUserRepository } from "./mock-user.repository";

// ============================================================================
// Fixtures
// ============================================================================

const START = Date.parse("2026-10-08T03:00:00.000Z");
const DEADLINE = START + 30 * 86400000;
const OWNER = "00000000-0000-4000-a000-000000000100";
afterEach(() => vi.useRealTimers());
function build() {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  return new MockUserRepository();
}

// ============================================================================
// State transitions and deadline behavior
// ============================================================================

describe("offline customer lifecycle", () => {
  it("records retention and removes only the requesting user's identities", async () => {
    const repo = build();
    await repo.bindIdentity({
      userId: OWNER,
      provider: "feishu",
      providerSubject: "self",
    });
    await repo.bindIdentity({
      userId: "other",
      provider: "feishu",
      providerSubject: "other",
    });
    expect(await repo.requestDeletion(OWNER)).toEqual({
      deletionRequestedAt: new Date(START).toISOString(),
      revokedSessions: 0,
      unboundIdentities: 1,
    });
    expect(await repo.listIdentitiesByUser(OWNER)).toEqual([]);
    expect(await repo.listIdentitiesByUser("other")).toHaveLength(1);
    expect(await repo.getUserById(OWNER)).toMatchObject({
      status: "deleting",
      deletionRequestedAt: new Date(START).toISOString(),
    });
    expect(await repo.findCredentialById(OWNER)).not.toBeNull();
    expect(await repo.requestDeletion(OWNER)).toBeNull();
    expect(await repo.requestDeletion("absent")).toBeNull();
  });
  it("restores immediately before the deadline without resurrecting identities", async () => {
    const repo = build();
    await repo.bindIdentity({
      userId: OWNER,
      provider: "feishu",
      providerSubject: "self",
    });
    await repo.requestDeletion(OWNER);
    vi.setSystemTime(DEADLINE - 1);
    expect(await repo.cancelDeletion(OWNER)).toMatchObject({
      status: "active",
      deletionRequestedAt: null,
    });
    expect(await repo.listIdentitiesByUser(OWNER)).toEqual([]);
    expect(await repo.purgeUser(OWNER)).toBe(false);
    expect(await repo.listDeletionDue(30, 50)).toEqual([]);
    vi.setSystemTime(DEADLINE + 1000);
    expect(await repo.purgeUser(OWNER)).toBe(false);
  });
  it.each([DEADLINE, DEADLINE + 1])(
    "rejects recovery and permits purge at %s",
    async (now) => {
      const repo = build();
      await repo.requestDeletion(OWNER);
      vi.setSystemTime(now);
      expect(await repo.cancelDeletion(OWNER)).toBeNull();
      expect(await repo.listDeletionDue(30, 50)).toEqual([OWNER]);
      expect(await repo.purgeUser(OWNER)).toBe(true);
      expect(await repo.purgeUser(OWNER)).toBe(false);
      expect(await repo.cancelDeletion(OWNER)).toBeNull();
      expect(await repo.getUserById(OWNER)).toBeNull();
      expect(await repo.findCredentialById(OWNER)).toBeNull();
      expect(await repo.findUserByIdentifier("zhangsan")).toBeNull();
      expect(await repo.findUserForAdmin(OWNER)).toBeNull();
      expect(await repo.adminSetAccountStatus(OWNER, "active")).toBeNull();
      expect(await repo.listDeletionDue(30, 50)).toEqual([]);
    },
  );
  it("does not purge early or recover an active account", async () => {
    const repo = build();
    expect(await repo.cancelDeletion(OWNER)).toBeNull();
    expect(await repo.purgeUser(OWNER)).toBe(false);
    await repo.requestDeletion(OWNER);
    vi.setSystemTime(DEADLINE - 1);
    expect(await repo.listDeletionDue(30, 50)).toEqual([]);
    expect(await repo.purgeUser(OWNER)).toBe(false);
  });
  it("does not allow either operation with a missing deletion timestamp", async () => {
    const repo = build();
    await repo.requestDeletion(OWNER);
    const credential = await repo.findCredentialById(OWNER);
    credential!.deletionRequestedAt = null;
    vi.setSystemTime(DEADLINE);
    expect(await repo.cancelDeletion(OWNER)).toBeNull();
    expect(await repo.purgeUser(OWNER)).toBe(false);
    expect(await repo.listDeletionDue(30, 50)).toEqual([]);
  });
  it("only one competing recovery/purge transition succeeds at the deadline", async () => {
    const repo = build();
    await repo.requestDeletion(OWNER);
    vi.setSystemTime(DEADLINE);
    expect(
      await Promise.all([repo.cancelDeletion(OWNER), repo.purgeUser(OWNER)]),
    ).toEqual([null, true]);
  });
  it("cleans avatars and credentials while preserving unrelated accounts", async () => {
    const repo = build();
    const other = await repo.createUser({
      account: "other",
      phone: "+8613900000001",
      phoneVerified: true,
      email: null,
      emailVerified: false,
      name: null,
      passwordHash: null,
    });
    await repo.setAvatar(OWNER, {
      data: Buffer.from("avatar"),
      contentType: "image/png",
      hash: "hash",
      source: "upload",
    });
    await repo.requestDeletion(OWNER);
    vi.setSystemTime(DEADLINE);
    await repo.purgeUser(OWNER);
    expect(await repo.getAvatar(OWNER)).toBeNull();
    expect(await repo.getUserById(other.id)).toMatchObject({
      status: "active",
    });
  });
  it("lists due users oldest first with a bounded limit", async () => {
    const repo = build();
    await repo.requestDeletion(OWNER);
    vi.setSystemTime(START + 1000);
    const other = await repo.createUser({
      account: "other",
      phone: "+8613900000001",
      phoneVerified: true,
      email: null,
      emailVerified: false,
      name: null,
      passwordHash: null,
    });
    await repo.requestDeletion(other.id);
    vi.setSystemTime(DEADLINE + 1000);
    expect(await repo.listDeletionDue(30, 50)).toEqual([OWNER, other.id]);
    expect(await repo.listDeletionDue(30, 1)).toEqual([OWNER]);
  });
});
