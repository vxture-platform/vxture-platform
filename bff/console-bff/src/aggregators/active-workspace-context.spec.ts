/**
 * active-workspace-context.spec.ts - Explicit workspace isolation and revocation.
 * @package @vxture/bff-console
 * @layer Application
 * @category Test
 * @author AI-Generated
 * @date 2026-10-12
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
// ⚠️ 跨层引用: Exercise the domain's login fallback through the BFF boundary.
import {
  ActiveContextService,
  type OrganizationReadRepository,
} from "@vxture/service-organization";
import { SessionAggregator } from "./session.aggregator";

// ============================================================================
// Domain fallback and BFF fixtures
// ============================================================================

const TENANT = "11111111-1111-4111-8111-111111111111";
const FIRST = "22222222-2222-4222-8222-222222222222";
const SECOND = "33333333-3333-4333-8333-333333333333";

function setup() {
  const repo = {
    listOrgMembershipsForUser: vi.fn(async () => [
      {
        organizationId: TENANT,
        role: "member",
        isDefault: true,
        organization: { type: "organization", name: "Team" },
      },
    ]),
    resolveWorkspaceForSession: vi.fn(
      async (_tenant: string, _user: string, hint?: string | null) => ({
        workspace: {
          id: hint === SECOND ? SECOND : FIRST,
          name: hint === SECOND ? "Second" : "First",
        },
        membershipRole: "member" as string | null,
      }),
    ),
  };
  const active = new ActiveContextService(
    repo as unknown as OrganizationReadRepository,
  );
  const org = {
    getOrgById: vi.fn(async () => ({
      id: TENANT,
      name: "Team",
      type: "organization",
      status: "active",
      ownerUserId: "owner",
    })),
    removeOrgMember: vi.fn(async () => true),
  };
  const gov = {
    getEffectivePermissions: vi.fn(
      async (_user: string, scope: { workspaceId?: string }) =>
        scope.workspaceId === SECOND
          ? ["tenant.billing.manage"]
          : ["tenant.quota.read"],
    ),
    assertCan: vi.fn(async () => undefined),
  };
  const query = vi.fn(async (_sql: string, params: unknown[]) => ({
    rows:
      params[1] === SECOND
        ? [{ name: "Second", workspace_no: "100000000000002" }]
        : [],
  }));
  const none = undefined as never;
  const aggregator = new SessionAggregator(
    org as never,
    gov as never,
    active,
    none,
    none,
    { query } as unknown as Pool,
    none,
  );
  return { aggregator, repo, org, gov, query };
}

// ============================================================================
// Explicit scope, metadata, and workspace permission caching
// ============================================================================

describe("active workspace context", () => {
  it("passes the verified workspace to the domain and displays that workspace", async () => {
    const { aggregator, repo, query } = setup();
    const tenant = await aggregator.getTenantContext("user", TENANT, SECOND);
    expect(tenant).toMatchObject({
      id: TENANT,
      workspace: SECOND,
      mode: "tenant",
    });
    expect(repo.resolveWorkspaceForSession).toHaveBeenCalledWith(
      TENANT,
      "user",
      SECOND,
    );
    expect(await aggregator.withWorkspaceMeta(tenant)).toMatchObject({
      workspaceName: "Second",
      workspaceNo: "100000000000002",
    });
    expect(query.mock.calls[0]?.[1]).toEqual([TENANT, SECOND]);
    expect(query.mock.calls[0]?.[0]).toContain("id = $2");
  });

  it("rejects an explicit tenant that the domain silently replaces", async () => {
    const { aggregator, org } = setup();
    expect(
      await aggregator.getTenantContext("user", "removed-tenant", SECOND),
    ).toMatchObject({ mode: "platform" });
    expect(org.getOrgById).not.toHaveBeenCalled();
  });

  it("rejects an explicit workspace that falls back to default", async () => {
    const { aggregator, repo, gov } = setup();
    repo.resolveWorkspaceForSession.mockResolvedValue({
      workspace: { id: FIRST, name: "First" },
      membershipRole: "member",
    });
    expect(
      await aggregator.getTenantContext("user", TENANT, SECOND),
    ).toMatchObject({ mode: "platform" });
    expect(await aggregator.getCapabilities("user", TENANT, SECOND)).toEqual(
      [],
    );
    expect(gov.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it("rejects lost membership even when fallback returns the same default UUID", async () => {
    const { aggregator, repo } = setup();
    repo.resolveWorkspaceForSession.mockResolvedValue({
      workspace: { id: FIRST, name: "First" },
      membershipRole: null,
    });
    expect(
      await aggregator.getTenantContext("user", TENANT, FIRST),
    ).toMatchObject({ mode: "platform" });
  });

  it("keeps login default selection when no explicit scope was supplied", async () => {
    const { aggregator } = setup();
    expect(await aggregator.getTenantContext("user")).toMatchObject({
      id: TENANT,
      workspace: FIRST,
      mode: "tenant",
    });
  });

  it("does not display default metadata for an absent explicit workspace", async () => {
    const { aggregator, query } = setup();
    expect(
      await aggregator.withWorkspaceMeta({
        id: TENANT,
        name: "Team",
        mode: "tenant",
        workspace: FIRST,
      }),
    ).toMatchObject({ workspaceName: null, workspaceNo: null });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).not.toContain("is_default");
  });

  it("isolates permission queries and cached results per workspace", async () => {
    const { aggregator, gov } = setup();
    const second = await aggregator.capabilitiesFor("user", TENANT, SECOND);
    expect(second).toEqual(["tenant.billing.manage"]);
    second.length = 0;
    expect(await aggregator.capabilitiesFor("user", TENANT, FIRST)).toEqual([
      "tenant.quota.read",
    ]);
    expect(await aggregator.capabilitiesFor("user", TENANT, SECOND)).toEqual([
      "tenant.billing.manage",
    ]);
    expect(gov.getEffectivePermissions).toHaveBeenCalledTimes(2);
    expect(gov.getEffectivePermissions).toHaveBeenCalledWith("user", {
      orgId: TENANT,
      workspaceId: SECOND,
    });
  });

  it("invalidates every workspace cache when a tenant membership is removed", async () => {
    const { aggregator, gov } = setup();
    await aggregator.capabilitiesFor("user", TENANT, FIRST);
    await aggregator.capabilitiesFor("user", TENANT, SECOND);
    expect(await aggregator.removeMember("owner", TENANT, "user")).toBe(true);
    gov.getEffectivePermissions.mockResolvedValue(["tenant.quota.read"]);
    expect(await aggregator.capabilitiesFor("user", TENANT, SECOND)).toEqual([
      "tenant.quota.read",
    ]);
    await aggregator.capabilitiesFor("user", TENANT, FIRST);
    expect(gov.getEffectivePermissions).toHaveBeenCalledTimes(4);
  });
});
