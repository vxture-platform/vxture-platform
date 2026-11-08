/**
 * Customer factor activation transaction regression coverage.
 * @package @vxture/service-account
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-08
 */
import { describe, expect, it, vi } from "vitest";
import { CustomerMfaRepository } from "./customer-mfa.repository";

function fixture(failOn?: string, eligible = true) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (failOn && sql.includes(failOn)) throw new Error("write_failed");
    return {
      rows:
        sql.includes("returning user_id") && eligible
          ? [{ user_id: "customer" }]
          : [],
    };
  });
  const release = vi.fn();
  const repository = new CustomerMfaRepository({
    connect: async () => ({ query, release }),
  } as never);
  return { repository, query, release };
}

describe("customer MFA activation transaction", () => {
  it("requires an active customer session and commits factors, recovery hashes and revocation together", async () => {
    const f = fixture();
    expect(
      await f.repository.activate(
        "customer",
        "encrypted",
        ["hash"],
        123,
        "sid",
      ),
    ).toBe(true);
    const statements = f.query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe("begin");
    expect(statements[1]).toContain("for update");
    expect(statements[2]).toContain("credential.user_mfas");
    expect(statements[2]).toContain("sid=$4");
    expect(statements[2]).toContain("realm='customer'");
    expect(statements[2]).toContain("expires_at>now()");
    expect(statements[2]).toContain("credential.user_mfas.totp_enabled=false");
    expect(f.query.mock.calls[2]?.[1]).toEqual([
      "customer",
      "encrypted",
      123,
      "sid",
    ]);
    expect(statements[3]).toContain(
      "delete from credential.user_recovery_codes",
    );
    expect(f.query.mock.calls[4]?.[1]).toEqual(["customer", ["hash"]]);
    expect(statements[5]).toContain("realm='customer'");
    expect(statements[6]).toContain("session.refresh_tokens");
    expect(statements.at(-1)).toBe("commit");
    expect(statements.some((sql) => sql.includes("admin."))).toBe(false);
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("leaves recovery codes and sessions unchanged when activation loses eligibility", async () => {
    const f = fixture(undefined, false);
    expect(
      await f.repository.activate(
        "customer",
        "encrypted",
        ["hash"],
        123,
        "sid",
      ),
    ).toBe(false);
    expect(f.query.mock.calls.map(([sql]) => sql).at(-1)).toBe("rollback");
    expect(f.query.mock.calls).toHaveLength(4);
    expect(f.release).toHaveBeenCalledOnce();
  });

  it.each([
    "insert into credential.user_mfas",
    "insert into credential.user_recovery_codes",
    "update session.auth_sessions",
    "update session.refresh_tokens",
  ])("rolls back every write when %s fails", async (failOn) => {
    const f = fixture(failOn);
    await expect(
      f.repository.activate("customer", "encrypted", ["hash"], 123, "sid"),
    ).rejects.toThrow("write_failed");
    const statements = f.query.mock.calls.map(([sql]) => sql);
    expect(statements.at(-1)).toBe("rollback");
    expect(statements).not.toContain("commit");
    expect(f.release).toHaveBeenCalledOnce();
  });
});
