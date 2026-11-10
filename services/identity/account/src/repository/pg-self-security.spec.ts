/**
 * Customer self-service security regression coverage.
 * @package @vxture/service-account
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { PgUserRepository } from "./pg-user.repository";
import type { CustomerSecurityMutation } from "../types/account.types";

// ============================================================================
// Row lock, compare-and-swap, transaction and anti-lockout contracts
// ============================================================================

const mutation: CustomerSecurityMutation = {
  operation: "email-change",
  target: "new@example.com",
  expectedPasswordHash: null,
  snapshot: {
    phone: "+8613800138000",
    email: "old@example.com",
    account: "account",
    phoneVerified: true,
    emailVerified: true,
    hasPassword: false,
    accountLoginDisabled: false,
  },
};
function build(patch: Record<string, unknown> = {}, fail = "") {
  const row = {
    phone: mutation.snapshot.phone,
    email: mutation.snapshot.email,
    account: "account",
    phone_verified: true,
    email_verified: true,
    account_login_disabled: false,
    password_hash: null,
    account_changed_at: null,
    ...patch,
  };
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (fail && sql.includes(fail)) throw new Error("write failed");
    return {
      rows: sql.includes("from account.users u") ? [row] : [],
      rowCount: 1,
    };
  });
  const release = vi.fn();
  return {
    query,
    release,
    repo: new PgUserRepository({
      connect: async () => ({ query, release }),
    } as never),
  };
}
describe("atomic customer security mutation", () => {
  it("locks and compares the owner before changing the email and revoking customer state", async () => {
    const f = build();
    await f.repo.applySelfSecurity("123", mutation);
    const sql = f.query.mock.calls.map((c) => c[0]);
    expect(sql[1]).toContain("for update of u");
    expect(sql[1]).toContain("u.status = 'active'");
    expect(
      sql.find((s) => s.includes("update session.auth_sessions")),
    ).toContain("realm='customer'");
    expect(sql.some((s) => s.includes("update session.refresh_tokens"))).toBe(
      true,
    );
    expect(sql.at(-1)).toBe("commit");
    expect(f.release).toHaveBeenCalledOnce();
  });
  it.each([
    { phone: "different" },
    { email: "different" },
    { phone_verified: false },
    { email_verified: false },
    { account_login_disabled: true },
    { password_hash: "new-hash" },
  ])("rejects changed facts %j before any write", async (patch) => {
    const f = build(patch);
    await expect(f.repo.applySelfSecurity("123", mutation)).rejects.toThrow(
      "security_proof_stale",
    );
    expect(
      f.query.mock.calls
        .map((c) => c[0])
        .filter((s) => s.startsWith("update ")),
    ).toHaveLength(0);
    expect(f.query.mock.calls.at(-1)![0]).toBe("rollback");
  });
  it.each([
    "update account.users",
    "update session.auth_sessions",
    "update session.refresh_tokens",
  ])("rolls back a failed %s", async (fail) => {
    const f = build({}, fail);
    await expect(f.repo.applySelfSecurity("123", mutation)).rejects.toThrow(
      "write failed",
    );
    expect(f.query.mock.calls.at(-1)![0]).toBe("rollback");
    expect(f.query.mock.calls.map((c) => c[0])).not.toContain("commit");
  });
  it("compares the credential hash again during upsert", async () => {
    const f = build();
    await f.repo.applySelfSecurity("123", {
      ...mutation,
      operation: "password",
      target: "",
      passwordHash: "hash",
    });
    expect(
      f.query.mock.calls.find((c) =>
        c[0].includes("insert into credential"),
      )![0],
    ).toContain("password_hash is not distinct from $3");
  });
  it("checks remaining methods under the account lock before unlinking", async () => {
    const f = build({ phone_verified: false, email_verified: false });
    await expect(
      f.repo.applySelfSecurity("123", {
        ...mutation,
        operation: "identity-unlink",
        target: "google",
        snapshot: {
          ...mutation.snapshot,
          phoneVerified: false,
          emailVerified: false,
        },
      }),
    ).rejects.toThrow("cannot_remove_last_login_method");
    expect(f.query.mock.calls.map((c) => c[0])).toContain(
      "select provider, provider_subject from identity.identities where user_id=$1 for update",
    );
  });
  it("changes a username under the same cooldown lock without revoking sessions or tokens", async () => {
    const f = build();
    await f.repo.applySelfSecurity("123", {
      ...mutation,
      operation: "username",
      target: "new_account",
    });
    const sql = f.query.mock.calls.map((call) => call[0]);
    expect(sql[1]).toContain("for update of u");
    expect(
      sql.some((value) => value.includes("account_changed_at=now()")),
    ).toBe(true);
    expect(sql.some((value) => value.includes("update session."))).toBe(false);
    expect(sql.at(-1)).toBe("commit");
  });

  it("binds a fresh proof to its durable session and current factor under the account lock", async () => {
    const f = build({ mfa_version: "factor-v2" });
    await expect(
      f.repo.applySelfSecurity("123", {
        ...mutation,
        snapshot: {
          ...mutation.snapshot,
          sessionId: "sid",
          mfaVersion: "factor-v1",
        },
      }),
    ).rejects.toThrow("security_proof_stale");
    const [sql, params] = f.query.mock.calls[1]!;
    expect(sql).toContain("s.status='active'");
    expect(sql).toContain("s.expires_at>now()");
    expect(sql).toContain("s.realm='customer'");
    expect(params).toEqual(["123", "sid"]);
    expect(
      f.query.mock.calls.some((call) => call[0].startsWith("update")),
    ).toBe(false);
  });
});
