/**
 * Workforce recovery and credential transaction regressions.
 * @package @vxture/service-iam
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { describe, expect, it, vi } from "vitest";
import { PgOperatorRepository } from "./pg-operator.repository";
vi.mock("hash-wasm", () => ({
  argon2id: vi.fn(async () => "fresh-hash"),
  argon2Verify: vi.fn(async () => true),
}));

// ============================================================================
// Real repository, mocked database boundary
// ============================================================================
function fixture() {
  const row = {
    id: "operator-1",
    username: "operator",
    status: "active",
    password_hash: "old-hash",
    password_changed_at: "2026-11-01 00:00:00+00",
    role_code: "operator",
    email: "old@example.test",
    email_verified: true,
    phone: "13800000000",
    phone_verified: true,
    totp_enabled: true,
    webauthn_required: false,
    mfa_updated_at: "2026-11-01",
    passkey_ids: [] as string[],
  };
  const query = vi.fn(
    async (
      _sql: string,
      _params?: unknown[],
    ): Promise<{ rows: (typeof row)[]; rowCount: number }> => ({
      rows: [{ ...row }],
      rowCount: 1,
    }),
  );
  const release = vi.fn();
  const repo = new PgOperatorRepository({
    query,
    connect: async () => ({ query, release }),
  } as never);
  return { row, query, release, repo };
}

describe("workforce recovery bindings", () => {
  it("binds the normalized delivery contact and does not expose credential material", async () => {
    const f = fixture();
    const proof = await f.repo.passwordResetProof(
      f.row.id,
      " OLD@example.test ",
    );
    expect(proof).toEqual({
      operatorId: f.row.id,
      email: f.row.email,
      credentialVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(proof)).not.toContain("old-hash");
  });
  it("rejects changed email, unverified reset delivery and existing-password setup", async () => {
    const f = fixture();
    expect(
      await f.repo.passwordResetProof(f.row.id, "other@example.test"),
    ).toBeNull();
    f.row.email_verified = false;
    expect(await f.repo.passwordResetProof(f.row.id, f.row.email)).toBeNull();
    expect(
      await f.repo.passwordResetProof(f.row.id, f.row.email, true),
    ).toBeNull();
    Object.assign(f.row, { password_hash: null });
    expect(
      await f.repo.passwordResetProof(f.row.id, f.row.email, true),
    ).not.toBeNull();
  });
  it.each([
    "password_hash",
    "password_changed_at",
    "email",
    "phone",
    "role_code",
  ] as const)("rejects a stale proof after %s changes", async (key) => {
    const f = fixture();
    const proof = (await f.repo.passwordResetProof(f.row.id, f.row.email))!;
    f.row[key] = "changed";
    f.query.mockClear();
    expect(
      await f.repo.setOperatorPassword(f.row.id, "NewPassword123", {
        expectedCredentialVersion: proof.credentialVersion,
        verifyEmail: proof.email,
      }),
    ).toBe(false);
    expect(
      f.query.mock.calls.some(([sql]) =>
        sql.includes("insert into admin.operator_credential"),
      ),
    ).toBe(false);
    expect(f.query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });
  it("changes the password, verifies only the proved email and revokes refresh families before commit", async () => {
    const f = fixture();
    const proof = (await f.repo.passwordResetProof(f.row.id, f.row.email))!;
    f.query.mockClear();
    expect(
      await f.repo.setOperatorPassword(f.row.id, "NewPassword123", {
        expectedCredentialVersion: proof.credentialVersion,
        verifyEmail: proof.email,
      }),
    ).toBe(true);
    const sql = f.query.mock.calls.map(([sql]) => sql);
    expect(sql[0]).toBe("begin");
    expect(sql[1]).toContain("for update");
    expect(
      sql.findIndex((s) => s.includes("set email_verified=true")),
    ).toBeGreaterThan(
      sql.findIndex((s) => s.includes("insert into admin.operator_credential")),
    );
    expect(sql.at(-2)).toContain("admin.operator_refresh_token");
    expect(sql.at(-1)).toBe("commit");
    expect(sql.join(" ")).not.toMatch(/account\.users|session\.refresh_tokens/);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("rolls back instead of committing the credential when refresh revocation fails", async () => {
    const f = fixture();
    const proof = (await f.repo.passwordResetProof(f.row.id, f.row.email))!;
    f.query.mockImplementation(async (sql) => {
      if (sql.includes("admin.operator_refresh_token"))
        throw new Error("revocation failed");
      return { rows: [f.row], rowCount: 1 };
    });
    await expect(
      f.repo.setOperatorPassword(f.row.id, "NewPassword123", {
        expectedCredentialVersion: proof.credentialVersion,
      }),
    ).rejects.toThrow("revocation failed");
    expect(f.query.mock.calls.at(-1)?.[0]).toBe("rollback");
    expect(f.query.mock.calls.some(([sql]) => sql === "commit")).toBe(false);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("changes authentication binding after factor reset without changing credentials", async () => {
    const f = fixture();
    const before = (await f.repo.findById(f.row.id))!;
    f.row.mfa_updated_at = "2026-11-10";
    f.row.totp_enabled = false;
    const after = (await f.repo.findById(f.row.id))!;
    expect(after.credentialVersion).toBe(before.credentialVersion);
    expect(after.authenticationVersion).not.toBe(before.authenticationVersion);
    expect(after.mfaEnrolled).toBe(false);
  });
});
