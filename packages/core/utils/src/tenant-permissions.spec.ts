import { describe, expect, it } from "vitest";
import {
  TENANT_MENU_BY_ROUTE,
  TENANT_MENU_CODES,
  TENANT_MENU_TREE,
  TENANT_PERMISSION_CODES,
  TENANT_PERMISSION_DEFS,
  TENANT_PERMISSION_PAGE,
  WORKSPACE_PERMISSION_CODES,
  capabilitySatisfies,
  hasAnyCapability,
  hasCapability,
  isGovernancePermissionCode,
  isTenantPermissionCode,
  type TenantMenuNode,
} from "./tenant-permissions";

function flatten(nodes: readonly TenantMenuNode[]): TenantMenuNode[] {
  return nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])]);
}

describe("tenant permission catalog", () => {
  it("codes are unique and well-formed", () => {
    const all = [...TENANT_PERMISSION_CODES, ...WORKSPACE_PERMISSION_CODES];
    expect(new Set(all).size).toBe(all.length);
    for (const code of all) {
      // `{scope}.{resource}.{action}`,或 `{scope}.{verb}`(tenant.delete)。
      expect(code).toMatch(/^(tenant|workspace)\.[a-z]+(\.[a-z]+)?$/);
    }
  });

  it("menu tree codes match TENANT_MENU_CODES exactly, and every page has a route", () => {
    const nodes = flatten(TENANT_MENU_TREE);
    expect(new Set(nodes.map((n) => n.code))).toEqual(
      new Set(TENANT_MENU_CODES),
    );
    expect(nodes.length).toBe(TENANT_MENU_CODES.length);
    for (const node of nodes) {
      if (node.children) expect(node.route).toBeUndefined();
      else expect(node.route).toMatch(/^\//);
    }
  });

  it("each operation code hangs under at most one page, and only tenant codes are in the tree", () => {
    const seen = new Map<string, string>();
    for (const node of flatten(TENANT_MENU_TREE)) {
      for (const perm of node.perms ?? []) {
        expect(seen.has(perm)).toBe(false);
        seen.set(perm, node.code);
        expect(isTenantPermissionCode(perm)).toBe(true);
      }
    }
    for (const [code, page] of Object.entries(TENANT_PERMISSION_PAGE)) {
      expect(page).toBe(seen.get(code) ?? null);
    }
    // workspace codes have no console page yet
    for (const code of WORKSPACE_PERMISSION_CODES) {
      expect(TENANT_PERMISSION_PAGE[code]).toBeNull();
    }
  });

  it("every tenant code has a category and a def", () => {
    expect(TENANT_PERMISSION_DEFS.map((d) => d.code)).toEqual([
      ...TENANT_PERMISSION_CODES,
      ...WORKSPACE_PERMISSION_CODES,
    ]);
    for (const def of TENANT_PERMISSION_DEFS) expect(def.category).toBeTruthy();
  });

  it("routes map back to their page code", () => {
    expect(TENANT_MENU_BY_ROUTE["/members"]).toBe("tenant.menu.members");
    expect(TENANT_MENU_BY_ROUTE["/"]).toBe("tenant.menu.overview");
    expect(TENANT_MENU_BY_ROUTE["/nope"]).toBeUndefined();
  });

  it("type guards", () => {
    expect(isTenantPermissionCode("tenant.billing.read")).toBe(true);
    expect(isTenantPermissionCode("workspace.role.assign")).toBe(false);
    expect(isGovernancePermissionCode("workspace.role.assign")).toBe(true);
    expect(isGovernancePermissionCode("tenant.user.manage")).toBe(false);
  });
});

describe("capability satisfaction", () => {
  it("exact match", () => {
    expect(capabilitySatisfies("tenant.audit.read", "tenant.audit.read")).toBe(
      true,
    );
    expect(capabilitySatisfies("tenant.audit.read", "tenant.quota.read")).toBe(
      false,
    );
  });

  it(".manage implies the same resource's .read, nothing else", () => {
    expect(
      capabilitySatisfies("tenant.billing.manage", "tenant.billing.read"),
    ).toBe(true);
    expect(
      capabilitySatisfies("tenant.billing.read", "tenant.billing.manage"),
    ).toBe(false);
    expect(
      capabilitySatisfies("tenant.member.manage", "tenant.role.assign"),
    ).toBe(false);
    expect(
      capabilitySatisfies("tenant.payment.manage", "tenant.billing.read"),
    ).toBe(false);
  });

  it("set helpers treat empty requirement as unrestricted", () => {
    expect(hasCapability([], undefined)).toBe(true);
    expect(hasCapability([], "tenant.quota.read")).toBe(false);
    expect(
      hasCapability(["tenant.billing.manage"], "tenant.billing.read"),
    ).toBe(true);
    expect(hasAnyCapability(["tenant.quota.read"], [])).toBe(true);
    expect(
      hasAnyCapability(
        ["tenant.quota.read"],
        ["tenant.billing.read", "tenant.quota.read"],
      ),
    ).toBe(true);
    expect(hasAnyCapability(["tenant.quota.read"], ["tenant.audit.read"])).toBe(
      false,
    );
  });
});
