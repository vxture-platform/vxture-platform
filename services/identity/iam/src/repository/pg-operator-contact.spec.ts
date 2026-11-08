/**
 * Workforce contact writes recheck account and role state at the write boundary.
 * @package @vxture/service-iam
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { PgOperatorRepository } from "./pg-operator.repository";

describe("verified workforce contact write", () => {
  it.each(["email", "phone"] as const)(
    "checks active account and role for %s",
    async (kind) => {
      const query = vi.fn(async (_sql: string, _params: unknown[]) => ({
        rowCount: 0,
        rows: [],
      }));
      const repo = new PgOperatorRepository({ query } as never);
      expect(
        await repo.setOperatorContactVerified("operator", kind, "target"),
      ).toBe(false);
      const [sql, params] = query.mock.calls[0]!;
      expect(sql).toContain("deleted_at is null and status = 'active'");
      expect(sql).toContain("r.status='active'");
      expect(params).toEqual(["operator", "target"]);
    },
  );
});
