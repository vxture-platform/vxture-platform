/**
 * Purpose isolation, delivery failure and atomic consumption regression coverage.
 * @package @vxture/service-account
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { MockUserRepository } from "./mock-user.repository";
import { PgUserRepository } from "./pg-user.repository";

// ============================================================================
// Stored verification evidence
// ============================================================================
async function fixture() {
  const repo = new MockUserRepository();
  const user = await repo.createUser({
    account: "alice",
    email: "alice@example.com",
    emailVerified: true,
    phone: "+8613800138000",
    phoneVerified: true,
    name: null,
    passwordHash: null,
  });
  return { repo, user };
}
describe("email verification follows the address", () => {
  it("maps database verification timestamps into credential views", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: "user",
          account: "alice",
          email: "alice@example.com",
          phone: "13800138000",
          email_verified_at: "2026-11-07",
          phone_verified_at: "2026-11-07",
          password_hash: null,
        },
      ],
    }));
    const repo = new PgUserRepository({ query } as never);
    expect(await repo.findUserByIdentifier("alice@example.com")).toMatchObject({
      emailVerified: true,
      phoneVerified: true,
    });
  });

  it("preserves explicit verification on create and same-address profile updates", async () => {
    const { repo, user } = await fixture();
    expect(user.emailVerified).toBe(true);
    expect(
      (await repo.updateProfile(user.id, { email: " ALICE@example.com " }))
        ?.emailVerified,
    ).toBe(true);
  });
  it("clears verification for a different profile address", async () => {
    const { repo, user } = await fixture();
    expect(
      await repo.updateProfile(user.id, { email: "other@example.com" }),
    ).toMatchObject({ emailVerified: false, email: "other@example.com" });
    expect(
      await repo.markEmailVerified(user.id, "alice@example.com"),
    ).toBeNull();
    expect((await repo.getUserById(user.id))?.emailVerified).toBe(false);
    expect(
      (await repo.markEmailVerified(user.id, "other@example.com"))
        ?.emailVerified,
    ).toBe(true);
  });
  it("does not use a provider's different email to verify an existing address", async () => {
    const { repo, user } = await fixture();
    await repo.updateProfile(user.id, { email: "other@example.com" });
    await repo.backfillProfile(user.id, {
      email: "alice@example.com",
      emailVerified: true,
    });
    expect((await repo.getUserById(user.id))?.emailVerified).toBe(false);
  });
  it("does not issue a verification update for a stale address in PostgreSQL", async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({
      rowCount: 0,
      rows: [],
    }));
    const repo = new PgUserRepository({ query } as never);
    expect(
      await repo.markEmailVerified("user", " OLD@example.com "),
    ).toBeNull();
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("email = $2");
    expect(query.mock.calls[0]?.[1]).toEqual(["user", "old@example.com"]);
  });
});
