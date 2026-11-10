/**
 * Workforce identity reads preserve durable email verification evidence.
 * @package @vxture/service-iam
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { describe, expect, it, vi } from "vitest";
import { PgOperatorRepository } from "./pg-operator.repository";

vi.mock("hash-wasm", () => ({
  argon2Verify: vi.fn(async () => true),
  argon2id: vi.fn(),
}));

describe("workforce identity verification evidence", () => {
  it.each([true, false])(
    "preserves email_verified=%s on all identity reads",
    async (verified) => {
      const row = {
        id: "operator-1",
        username: "operator",
        status: "active",
        password_hash: "fixture-hash",
        role_code: "operator",
        email: "operator@example.com",
        email_verified: verified,
      };
      const query = vi.fn(async (_sql: string, _params: unknown[]) => ({
        rows: [row],
      }));
      const repository = new PgOperatorRepository({ query } as never);
      const reads = [
        await repository.findById(row.id),
        await repository.findByVerifiedPhone("13800138000"),
        await repository.authenticateOperator(row.username, "fixture-password"),
      ];
      for (const view of reads) {
        expect(view).toMatchObject({
          email: row.email,
          emailVerified: verified,
        });
      }
      for (const [sql] of query.mock.calls.filter(([sql]) =>
        sql.includes("select a.id"),
      )) {
        expect(sql).toContain("a.email_verified");
        expect(sql).toContain("a.status = 'active'");
        expect(sql).not.toContain("account.users");
      }
    },
  );

  it("returns no identity when the active-operator query finds no row", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new PgOperatorRepository({ query } as never);
    expect(await repository.findById("absent")).toBeNull();
    expect(await repository.findByVerifiedPhone("13800138000")).toBeNull();
    expect(
      await repository.authenticateOperator("absent", "password"),
    ).toBeNull();
  });
});

// ============================================================================
// Passkey writes serialize with credential changes and revoke only workforce tokens.
// ============================================================================
describe("workforce passkey credential transactions", () => {
  function fixture(passkeys = ["key1", "key2"], fail = "") {
    const row = {
      id: "operator",
      username: "name",
      status: "active",
      role_code: "admin",
      password_hash: "hash",
      email: null,
      email_verified: false,
      webauthn_required: true,
      passkey_ids: passkeys,
    };
    const query = vi.fn(async (sql: string, _args?: unknown[]) => {
      if (fail && sql.includes(fail)) throw new Error("database unavailable");
      return { rows: sql.includes("select a.id") ? [row] : [], rowCount: 1 };
    });
    const release = vi.fn();
    return {
      repo: new PgOperatorRepository({
        query,
        connect: async () => ({ query, release }),
      } as never),
      query,
      release,
    };
  }
  it("protects the last required passkey under the account lock", async () => {
    const f = fixture(["last"]);
    expect(await f.repo.deleteWebauthnCredential("operator", "last")).toBe(
      false,
    );
    const sql = f.query.mock.calls.map((call) => call[0]);
    expect(sql[1]).toContain("for update");
    expect(sql.some((value) => value.startsWith("delete"))).toBe(false);
    expect(sql.at(-1)).toBe("rollback");
  });
  it("rejects stale credential state before deleting or adding a key", async () => {
    const f = fixture();
    expect(
      await f.repo.deleteWebauthnCredential("operator", "key1", "stale"),
    ).toBe(false);
    await expect(
      f.repo.insertWebauthnCredential({
        operatorId: "operator",
        credentialId: "key3",
        publicKey: Buffer.from("key"),
        signCount: 0,
        transports: [],
        expectedAuthenticationVersion: "stale",
      }),
    ).rejects.toThrow("security_proof_stale");
    expect(
      f.query.mock.calls.some(
        (call) =>
          call[0].startsWith("delete") ||
          call[0].includes("insert into admin.operator_webauthn"),
      ),
    ).toBe(false);
  });
  it("commits key deletion with refresh-family revocation", async () => {
    const f = fixture();
    expect(await f.repo.deleteWebauthnCredential("operator", "key1")).toBe(
      true,
    );
    const sql = f.query.mock.calls.map((call) => call[0]);
    expect(
      sql.some((value) =>
        value.includes("update admin.operator_refresh_token"),
      ),
    ).toBe(true);
    expect(sql.some((value) => value.includes("session.refresh_tokens"))).toBe(
      false,
    );
    expect(sql.at(-1)).toBe("commit");
  });
  it("rolls back registration if refresh revocation fails", async () => {
    const f = fixture(["key1"], "update admin.operator_refresh_token");
    await expect(
      f.repo.insertWebauthnCredential({
        operatorId: "operator",
        credentialId: "key3",
        publicKey: Buffer.from("key"),
        signCount: 0,
        transports: [],
      }),
    ).rejects.toThrow("database unavailable");
    const sql = f.query.mock.calls.map((call) => call[0]);
    expect(sql).not.toContain("commit");
    expect(sql.at(-1)).toBe("rollback");
    expect(f.release).toHaveBeenCalledOnce();
  });
});
