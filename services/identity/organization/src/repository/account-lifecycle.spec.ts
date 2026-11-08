/**
 * Ownership discovery and membership cleanup race protection.
 * @package @vxture/service-organization
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, it, expect, vi } from "vitest";
import { PgOrganizationRepository } from "./pg-organization.repository";
import { MockOrganizationRepository } from "./mock-organization.repository";

// ============================================================================
// The tenant row, not membership.role, is the ownership authority
// ============================================================================
function build(owner = "other", fail = "") {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (fail && sql.includes(fail)) throw new Error("DB failure");
    return {
      rows: sql.includes("select t.id")
        ? [{ id: "org", owner_user_id: owner }]
        : [],
      rowCount: 1,
    };
  });
  const release = vi.fn();
  const poolQuery = vi.fn(async (_sql: string, _params?: unknown[]) => ({
    rows: [],
  }));
  return {
    query,
    poolQuery,
    release,
    repo: new PgOrganizationRepository({
      query: poolQuery,
      connect: async () => ({ query, release }),
    } as never),
  };
}
describe("account lifecycle organization adapter", () => {
  it("discovers owned tenants without a membership join", async () => {
    const f = build();
    await f.repo.listOwnedOrganizations("user");
    expect(f.poolQuery.mock.calls[0]![0]).toContain("owner_user_id=$1");
    expect(f.poolQuery.mock.calls[0]![0]).not.toContain("tenant_memberships");
  });
  it("locks tenant ownership before removing either membership level", async () => {
    const f = build();
    expect(await f.repo.cleanupAccountMemberships("user")).toBe(1);
    expect(f.query.mock.calls[1]![0]).toContain("for update of t");
    expect(f.query.mock.calls[1]![0]).not.toContain("m.status");
    expect(f.query.mock.calls[2]![0]).toContain("workspace_memberships");
    expect(f.query.mock.calls[3]![0]).toContain("tenant_memberships");
    expect(f.query.mock.calls.at(-1)![0]).toBe("commit");
  });
  it("rejects a concurrent owner change before deleting anything", async () => {
    const f = build("user");
    await expect(f.repo.cleanupAccountMemberships("user")).rejects.toThrow(
      "org_owner",
    );
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith("delete"))).toBe(
      false,
    );
    expect(f.query.mock.calls.at(-1)![0]).toBe("rollback");
  });
  it("rolls back both membership levels when the second delete fails", async () => {
    const f = build("other", "delete from tenancy.tenant_memberships");
    await expect(f.repo.cleanupAccountMemberships("user")).rejects.toThrow(
      "DB failure",
    );
    expect(f.query.mock.calls.at(-1)![0]).toBe("rollback");
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("mirrors owner protection in offline mode", async () => {
    const repo = new MockOrganizationRepository();
    await repo.createTeamOrg("user", "Org");
    expect(await repo.listOwnedOrganizations("user")).toHaveLength(1);
    await expect(repo.cleanupAccountMemberships("user")).rejects.toThrow(
      "org_owner",
    );
    expect(await repo.listOrgMembershipsForUser("user")).toHaveLength(1);
  });
});
