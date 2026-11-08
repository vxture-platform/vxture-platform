/**
 * Customer credential/session transaction regression coverage.
 * @package @vxture/service-account
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { PgUserRepository } from "./pg-user.repository";

// ============================================================================
// Fixtures
// ============================================================================

function build(failOn?: string, alreadySet = false) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (failOn && sql.includes(failOn)) throw new Error("write failed");
    return {
      rowCount: alreadySet && sql.includes("returning user_id") ? 0 : 1,
      rows: [],
    };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) };
  return { repository: new PgUserRepository(pool as never), query, release };
}

// ============================================================================
// Atomic writes and realm isolation
// ============================================================================

describe("customer password transaction", () => {
  it("commits password, session revocation and refresh revocation together", async () => {
    const { repository, query, release } = build();
    await repository.setPassword("customer-1", "argon-hash");
    const calls = query.mock.calls;
    expect(calls[0]?.[0]).toBe("begin");
    expect(calls.at(-1)?.[0]).toBe("commit");
    expect(calls[1]?.[1]).toEqual(["customer-1", "argon-hash", true]);
    expect(calls[2]?.[0]).toContain("update session.auth_sessions");
    expect(calls[2]?.[0]).toContain("realm = 'customer'");
    expect(calls[3]?.[0]).toContain("update session.refresh_tokens");
    expect(calls[2]?.[1]).toEqual(["customer-1"]);
    expect(calls[3]?.[1]).toEqual(["customer-1"]);
    expect(calls.some(([sql]) => sql.includes("admin."))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not revoke sessions during first-time password setup", async () => {
    const { repository, query } = build();
    await repository.setPassword("customer-1", "argon-hash", false);
    expect(
      query.mock.calls
        .map(([sql]) => sql)
        .some((sql) => sql.includes("session.")),
    ).toBe(false);
    expect(query.mock.calls[1]?.[0]).toContain(
      "credential.user_credentials.password_hash is null",
    );
    expect(query.mock.calls[1]?.[1]).toEqual([
      "customer-1",
      "argon-hash",
      false,
    ]);
    expect(query.mock.calls.at(-1)?.[0]).toBe("commit");
  });

  it.each([
    "insert into credential.user_credentials",
    "update session.auth_sessions",
    "update session.refresh_tokens",
  ])("rolls back all writes when %s fails", async (failOn) => {
    const { repository, query, release } = build(failOn);
    await expect(
      repository.setPassword("customer-1", "argon-hash"),
    ).rejects.toThrow("write failed");
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements.at(-1)).toBe("rollback");
    expect(statements).not.toContain("commit");
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not let a concurrent initial setup overwrite an existing password", async () => {
    const { repository, query } = build(undefined, true);
    await expect(
      repository.setPassword("customer-1", "argon-hash", false),
    ).rejects.toThrow("password_already_set");
    expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
    expect(query.mock.calls.map(([sql]) => sql)).not.toContain("commit");
  });
});
