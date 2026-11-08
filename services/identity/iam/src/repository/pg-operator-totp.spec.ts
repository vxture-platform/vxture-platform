/**
 * Workforce TOTP activation transaction regression coverage.
 * @package @vxture/service-iam
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { PgOperatorRepository } from "./pg-operator.repository";

// ============================================================================
// Fixtures
// ============================================================================

function build(
  options: {
    active?: boolean;
    secret?: string | null;
    enabled?: boolean;
    passkeyRequired?: boolean;
    passkeys?: number;
    failRecoveryInsert?: boolean;
  } = {},
) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.includes("select id from admin.operator_account")) {
      return { rowCount: options.active === false ? 0 : 1, rows: [] };
    }
    if (sql.includes("select totp_secret")) {
      return {
        rowCount: 1,
        rows: [
          {
            totp_secret:
              options.secret === undefined ? "old-ciphertext" : options.secret,
            totp_enabled: options.enabled ?? true,
            webauthn_required: options.passkeyRequired ?? false,
          },
        ],
      };
    }
    if (sql.includes("select id from admin.operator_webauthn_credential")) {
      return { rowCount: options.passkeys ?? 0, rows: [] };
    }
    if (
      sql.includes("insert into admin.operator_recovery_code") &&
      options.failRecoveryInsert
    ) {
      throw new Error("recovery insert failed");
    }
    return { rowCount: 1, rows: [] };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) };
  return {
    repository: new PgOperatorRepository(pool as never),
    query,
    release,
  };
}

const INPUT = {
  secret: "new-ciphertext",
  previousSecret: "old-ciphertext",
  previousEnabled: true,
  initialOnly: false,
  recoveryHashes: ["hash-1", "hash-2"],
};

// ============================================================================
// Transaction guarantees
// ============================================================================

describe("operator TOTP activation", () => {
  it("commits the factor and replacement recovery codes in one transaction", async () => {
    const { repository, query, release } = build();
    expect(await repository.activateTotpEnrollment("operator-1", INPUT)).toBe(
      true,
    );
    const sql = query.mock.calls.map(([statement]) => statement);
    expect(sql[0]).toBe("begin");
    expect(sql.at(-1)).toBe("commit");
    expect(sql.some((statement) => statement.includes("for update"))).toBe(
      true,
    );
    const update = sql.findIndex((statement) =>
      statement.includes("set totp_secret"),
    );
    const replace = sql.findIndex((statement) =>
      statement.includes("delete from admin.operator_recovery_code"),
    );
    expect(update).toBeGreaterThan(0);
    expect(replace).toBeGreaterThan(update);
    const insertions = query.mock.calls.filter(([statement]) =>
      statement.includes("insert into admin.operator_recovery_code"),
    );
    expect(insertions.map(([, values]) => values)).toEqual([
      ["operator-1", "hash-1"],
      ["operator-1", "hash-2"],
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    { active: false },
    { secret: "changed-by-another-ceremony" },
    { enabled: false },
    { passkeyRequired: true },
  ])(
    "rejects a changed or inactive account without switching its factor: %j",
    async (options) => {
      const { repository, query, release } = build(options);
      expect(await repository.activateTotpEnrollment("operator-1", INPUT)).toBe(
        false,
      );
      const sql = query.mock.calls.map(([statement]) => statement);
      expect(sql).toContain("rollback");
      expect(sql).not.toContain("commit");
      expect(
        sql.some((statement) => statement.includes("set totp_secret")),
      ).toBe(false);
      expect(
        sql.some((statement) =>
          statement.includes("delete from admin.operator_recovery_code"),
        ),
      ).toBe(false);
      expect(release).toHaveBeenCalledOnce();
    },
  );

  it("does not use initial enrollment to replace an existing passkey", async () => {
    const { repository, query } = build({
      secret: null,
      enabled: false,
      passkeys: 1,
    });
    expect(
      await repository.activateTotpEnrollment("operator-1", {
        ...INPUT,
        previousSecret: null,
        previousEnabled: false,
        initialOnly: true,
      }),
    ).toBe(false);
    expect(query.mock.calls.map(([statement]) => statement)).not.toContain(
      "commit",
    );
  });

  it("rolls back the factor update if recovery-code persistence fails", async () => {
    const { repository, query, release } = build({ failRecoveryInsert: true });
    await expect(
      repository.activateTotpEnrollment("operator-1", INPUT),
    ).rejects.toThrow("recovery insert failed");
    const sql = query.mock.calls.map(([statement]) => statement);
    expect(sql.some((statement) => statement.includes("set totp_secret"))).toBe(
      true,
    );
    expect(sql.at(-1)).toBe("rollback");
    expect(sql).not.toContain("commit");
    expect(release).toHaveBeenCalledOnce();
  });
});
