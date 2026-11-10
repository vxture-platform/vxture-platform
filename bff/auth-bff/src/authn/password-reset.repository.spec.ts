/**
 * Password reset storage contracts and optional real PostgreSQL state regressions.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  hashResetToken,
  PasswordResetRepository,
} from "./password-reset.repository";

// ============================================================================
// Boundary failures and secret handling (no database required)
// ============================================================================
it("stores only a digest and suppresses tokens when eligibility changed", async () => {
  const query = vi.fn(async () => ({ rowCount: 1, rows: [] }));
  const repository = new PasswordResetRepository({ query } as never);
  const raw = await repository.issue("user", 900, "owner@example.test");
  expect(raw).toMatch(/^[a-f0-9]{64}$/);
  expect(query.mock.calls[0]).toEqual([
    expect.any(String),
    ["user", hashResetToken(raw!), "900", "owner@example.test"],
  ]);
  expect(JSON.stringify(query.mock.calls)).not.toContain(raw);
  query.mockResolvedValue({ rowCount: 0, rows: [] });
  expect(await repository.issue("user", 900, "old@example.test")).toBeNull();
});
it("propagates storage failure without returning a reset token", async () => {
  const repository = new PasswordResetRepository({
    query: vi.fn(async () => {
      throw new Error("offline");
    }),
  } as never);
  await expect(
    repository.issue("user", 900, "owner@example.test"),
  ).rejects.toThrow("offline");
  await expect(repository.consume("a".repeat(64))).rejects.toThrow("offline");
});

// ============================================================================
// Isolated temporary tables: run with AUTH_ITEST=1 and DATABASE_URL.
// ============================================================================
describe.skipIf(process.env.AUTH_ITEST !== "1")(
  "reset token PostgreSQL state validity",
  () => {
    let pool: Pool;
    let client: PoolClient;
    let repository: PasswordResetRepository;
    beforeAll(async () => {
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
      client = await pool.connect();
      await client.query(
        "create temp table reset_users (id text primary key, email text, email_verified_at timestamptz, status text, deleted_at timestamptz)",
      );
      await client.query(
        "create temp table reset_credentials (user_id text primary key, password_changed_at timestamptz)",
      );
      await client.query(
        "create temp table reset_tokens (user_id text, token_hash text unique, expires_at timestamptz, created_at timestamptz, used_at timestamptz)",
      );
      repository = new PasswordResetRepository({
        query: (sql: string, params: unknown[]) =>
          client.query(
            sql
              .replaceAll(
                "session.password_reset_tokens",
                "pg_temp.reset_tokens",
              )
              .replaceAll("account.users", "pg_temp.reset_users")
              .replaceAll(
                "credential.user_credentials",
                "pg_temp.reset_credentials",
              ),
            params,
          ),
      } as never);
    });
    afterAll(async () => {
      client?.release();
      await pool?.end();
    });
    beforeEach(async () => {
      await client.query(
        "truncate reset_users, reset_credentials, reset_tokens",
      );
      await client.query(
        "insert into reset_users values ('user', 'owner@example.test', now() - interval '1 day', 'active', null)",
      );
    });
    it("consumes once under concurrent requests", async () => {
      const raw = await repository.issue("user", 900, "owner@example.test");
      const results = await Promise.all([
        repository.consume(raw!),
        repository.consume(raw!),
      ]);
      expect(results.filter(Boolean)).toEqual(["user"]);
    });
    it.each([
      "update reset_users set email_verified_at = null",
      "update reset_users set email = 'new@example.test', email_verified_at = clock_timestamp() + interval '1 second'",
      "insert into reset_credentials values ('user', clock_timestamp() + interval '1 second')",
      "update reset_users set status = 'disabled'",
      "update reset_users set deleted_at = clock_timestamp()",
      "update reset_tokens set expires_at = now() - interval '1 second'",
    ])("rejects a stale link after %s", async (change) => {
      const raw = await repository.issue("user", 900, "owner@example.test");
      await client.query(change);
      expect(await repository.consume(raw!)).toBeNull();
    });
    it("refuses issue after email eligibility changes", async () => {
      await client.query(
        "update reset_users set email = 'changed@example.test'",
      );
      expect(
        await repository.issue("user", 900, "owner@example.test"),
      ).toBeNull();
    });
  },
);
