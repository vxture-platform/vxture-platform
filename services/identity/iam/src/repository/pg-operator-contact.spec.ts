/**
 * Workforce contact writes atomically compare authority and revoke refresh families.
 * @package @vxture/service-iam
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { describe, expect, it, vi } from "vitest";
import { PgOperatorRepository } from "./pg-operator.repository";

// ============================================================================
// Transactional contact mutation and rollback
// ============================================================================
function fixture(active = true, fail = "") {
  const row = {
    id: "operator",
    username: "name",
    password_hash: "hash",
    status: "active",
    role_code: "operator",
    email: "owner@example.test",
    email_verified: true,
  };
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (fail && sql.includes(fail)) throw new Error("database unavailable");
    return {
      rowCount: active ? 1 : 0,
      rows: sql.includes("select a.id") && active ? [row] : [],
    };
  });
  const release = vi.fn();
  const repo = new PgOperatorRepository({
    query,
    connect: async () => ({ query, release }),
  } as never);
  return { repo, query, release, row };
}
describe("verified workforce contact write", () => {
  it.each(["email", "phone"] as const)(
    "checks active account and role for %s before writing",
    async (kind) => {
      const f = fixture(false);
      expect(
        await f.repo.setOperatorContactVerified("operator", kind, "target"),
      ).toBe(false);
      const sql = f.query.mock.calls.map((call) => call[0]);
      expect(sql[1]).toContain("for update");
      expect(sql[2]).toContain("a.deleted_at is null");
      expect(sql[2]).toContain("a.status = 'active'");
      expect(sql[2]).toContain("r.status = 'active'");
      expect(sql.at(-1)).toBe("rollback");
      expect(sql.some((value) => value.startsWith("update"))).toBe(false);
    },
  );
  it.each(["email", "phone"] as const)(
    "commits %s with only workforce revocation",
    async (kind) => {
      const f = fixture();
      const version = (await f.repo.findById("operator"))!
        .authenticationVersion!;
      f.query.mockClear();
      expect(
        await f.repo.setOperatorContactVerified(
          "operator",
          kind,
          "target",
          version,
        ),
      ).toBe(true);
      const sql = f.query.mock.calls.map((call) => call[0]);
      expect(sql.some((value) => value.includes(`set ${kind}=$2`))).toBe(true);
      expect(
        sql.some((value) =>
          value.includes("update admin.operator_refresh_token"),
        ),
      ).toBe(true);
      expect(
        sql.some(
          (value) =>
            value.includes("session.refresh_tokens") ||
            value.includes("account.users"),
        ),
      ).toBe(false);
      expect(sql.at(-1)).toBe("commit");
      expect(f.release).toHaveBeenCalledOnce();
    },
  );
  it("rejects an ownership version replaced before the account lock", async () => {
    const f = fixture();
    expect(
      await f.repo.setOperatorContactVerified(
        "operator",
        "email",
        "target",
        "stale",
      ),
    ).toBe(false);
    expect(
      f.query.mock.calls.some((call) => call[0].startsWith("update")),
    ).toBe(false);
  });
  it.each([
    "update admin.operator_account",
    "update admin.operator_refresh_token",
  ])("rolls back a failure in %s", async (fail) => {
    const f = fixture(true, fail);
    await expect(
      f.repo.setOperatorContactVerified("operator", "email", "target"),
    ).rejects.toThrow("database unavailable");
    const sql = f.query.mock.calls.map((call) => call[0]);
    expect(sql).not.toContain("commit");
    expect(sql.at(-1)).toBe("rollback");
    expect(f.release).toHaveBeenCalledOnce();
  });
});
