/**
 * Lifecycle SQL transaction and retention guard regression tests.
 * @package @vxture/service-account
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { PgUserRepository } from "./pg-user.repository";

// ============================================================================
// Transaction fixtures
// ============================================================================

function build(fail = "", eligible = true) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (fail && sql.includes(fail)) throw new Error("database failed");
    if (sql.includes("update account.users"))
      return {
        rows: eligible
          ? [
              {
                id: "customer",
                deletion_requested_at: "2026-11-07T03:00:00.000Z",
              },
            ]
          : [],
        rowCount: eligible ? 1 : 0,
      };
    return {
      rows: [],
      rowCount: sql.includes("session.auth_sessions") ? 3 : 2,
    };
  });
  const release = vi.fn();
  const poolQuery = vi.fn(async (_sql: string, _params?: unknown[]) => ({
    rows: [],
    rowCount: 0,
  }));
  return {
    query,
    release,
    poolQuery,
    repo: new PgUserRepository({
      query: poolQuery,
      connect: async () => ({ query, release }),
    } as never),
  };
}

// ============================================================================
// Atomic identity cleanup
// ============================================================================

describe("customer deletion transaction", () => {
  it("commits state, customer sessions, refresh tokens and identities on the same connection", async () => {
    const f = build();
    expect(await f.repo.requestDeletion("customer")).toEqual({
      deletionRequestedAt: "2026-11-07T03:00:00.000Z",
      revokedSessions: 3,
      unboundIdentities: 2,
    });
    const sql = f.query.mock.calls.map(([s]) => s);
    expect(sql).toHaveLength(7);
    expect(sql[0]).toBe("begin");
    expect(sql[1]).toContain("status = 'active'");
    expect(sql[1]).toContain("deleted_at is null");
    expect(sql[2]).toContain("realm = 'customer'");
    expect(sql[3]).toContain("session.refresh_tokens");
    expect(sql[4]).toContain("delete from identity.identities");
    expect(sql[5]).toContain("insert into account.lifecycle_operations");
    expect(sql[6]).toBe("commit");
    for (const [, params] of f.query.mock.calls.slice(2, 5))
      expect(params).toEqual(["customer"]);
    expect(f.poolQuery).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });
  it.each([
    "update account.users",
    "update session.auth_sessions",
    "update session.refresh_tokens",
    "delete from identity.identities",
    "insert into account.lifecycle_operations",
    "commit",
  ])(
    "rolls back on failure in %s and releases the connection",
    async (fail) => {
      const f = build(fail);
      await expect(f.repo.requestDeletion("customer")).rejects.toThrow(
        "database failed",
      );
      const sql = f.query.mock.calls.map(([s]) => s);
      expect(sql.at(-1)).toBe("rollback");
      if (fail !== "commit") expect(sql).not.toContain("commit");
      expect(f.release).toHaveBeenCalledOnce();
    },
  );
  it("does no cleanup when a duplicate or concurrent request loses the account transition", async () => {
    const f = build("", false);
    expect(await f.repo.requestDeletion("customer")).toBeNull();
    expect(f.query.mock.calls.map(([s]) => s).at(-1)).toBe("rollback");
    expect(f.query.mock.calls).toHaveLength(3);
  });
});

// ============================================================================
// Recovery/purge predicates are evaluated in the competing row updates
// ============================================================================

describe("retention guards", () => {
  it("bounds recovery in the update itself and preserves no-op conflicts", async () => {
    const f = build();
    expect(await f.repo.cancelDeletion("customer")).toBeNull();
    const [sql, params] = f.poolQuery.mock.calls[0]!;
    expect(sql).toContain("status = 'deleting'");
    expect(sql).toContain("deleted_at is null");
    expect(sql).toContain("deletion_requested_at is not null");
    expect(sql).toContain("+ $2 * interval '24 hours' > clock_timestamp()");
    expect(params).toEqual(["customer", 30, null]);
    expect(f.poolQuery).toHaveBeenCalledOnce();
  });
  it("does not purge or remove credentials when the final row predicate fails", async () => {
    const f = build("", false);
    expect(await f.repo.purgeUser("customer")).toBe(false);
    const [sql, params] = f.query.mock.calls[1]!;
    expect(sql).toContain("deletion_requested_at is not null");
    expect(sql).toContain("+ $2 * interval '24 hours' <= clock_timestamp()");
    expect(params).toEqual(["customer", 30]);
    expect(f.query.mock.calls).toHaveLength(3);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("includes the exact deadline when listing candidates", async () => {
    const f = build();
    await f.repo.listDeletionDue(30, 1000);
    const [sql, params] = f.poolQuery.mock.calls[0]!;
    expect(sql).toContain("+ $1 * interval '24 hours' <= clock_timestamp()");
    expect(params).toEqual([30, 500]);
  });
  it.each([
    "delete from account.user_avatars",
    "delete from credential.user_credentials",
    "delete from identity.identities",
    "update session.auth_sessions",
    "update session.refresh_tokens",
  ])("rolls back purge when %s fails", async (fail) => {
    const f = build(fail);
    await expect(f.repo.purgeUser("customer")).rejects.toThrow(
      "database failed",
    );
    expect(f.query.mock.calls.map(([s]) => s).at(-1)).toBe("rollback");
    expect(f.query.mock.calls.map(([s]) => s)).not.toContain("commit");
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("keeps workforce sessions outside customer purge", async () => {
    const f = build();
    expect(await f.repo.purgeUser("customer")).toBe(true);
    expect(
      f.query.mock.calls.find(([s]) =>
        s.includes("update session.auth_sessions"),
      )![0],
    ).toContain("realm = 'customer'");
    expect(f.query.mock.calls.at(-1)![0]).toBe("commit");
  });
});
