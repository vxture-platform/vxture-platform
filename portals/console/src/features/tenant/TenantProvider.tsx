"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import type { TenantContext } from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import type {
  CreateTenantPayload,
  TenantContextState,
  TenantListItem,
  TenantProviderProps,
  TenantRole,
} from "./types";

const TenantUiContext = createContext<TenantContextState | null>(null);
const tenantRolePriority: Record<TenantRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

function slugify(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "tenant";
}

function inferRole(tenant: TenantContext): TenantRole {
  if (tenant.tenantType === "personal") {
    return "owner";
  }

  return tenant.status === "active" ? "admin" : "member";
}

function mapTenantContextToItem(
  tenant: TenantContext,
  currentTenantId?: string | null,
): TenantListItem {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: slugify(tenant.tenantCode ?? tenant.workspace ?? tenant.name),
    type: tenant.tenantType ?? "organization",
    role: inferRole(tenant),
    isCurrent: tenant.id === currentTenantId,
    isDefault: tenant.isDefault === true,
    logoHash: tenant.logoHash ?? null,
    source: "session",
  };
}

function sortTenants(items: TenantListItem[]) {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "personal" ? -1 : 1;
    }

    return (
      tenantRolePriority[a.role] - tenantRolePriority[b.role] ||
      a.name.localeCompare(b.name)
    );
  });
}

export function TenantProvider({ children }: TenantProviderProps) {
  const { session, switchTenant } = useConsoleSession();

  const baseTenants = useMemo(() => {
    const tenantMap = new Map<string, TenantContext>();
    for (const tenant of session.tenantOptions ?? []) {
      tenantMap.set(tenant.id, tenant);
    }

    if (session.tenant) {
      tenantMap.set(session.tenant.id, session.tenant);
    }

    return Array.from(tenantMap.values());
  }, [session.tenant, session.tenantOptions]);

  const currentTenantId = session.tenant?.id ?? null;
  const tenantList = useMemo(() => {
    const sessionItems = baseTenants.map((tenant) =>
      mapTenantContextToItem(tenant, currentTenantId),
    );

    return sortTenants(sessionItems);
  }, [baseTenants, currentTenantId]);

  const currentTenant =
    tenantList.find((tenant) => tenant.isCurrent) ?? tenantList[0] ?? null;
  const hasPersonalTenant = tenantList.some(
    (tenant) => tenant.type === "personal",
  );

  const switchTenantContext = useCallback(
    async (tenantId: string, returnTo?: string) => {
      const tenant = tenantList.find((item) => item.id === tenantId);
      if (!tenant || tenant.id === currentTenant?.id) {
        return;
      }

      // 顶层导航、页面整体重载(identity/080 §2.8);此前这里还接着 router.replace
      // + refresh 想就地换上下文,那是给一条从未生效的 XHR 切换配的。
      await switchTenant(tenant.id, returnTo);
    },
    [tenantList, currentTenant?.id, switchTenant],
  );

  const createTenant = useCallback(
    async (payload: CreateTenantPayload) => {
      if (payload.type === "personal" && hasPersonalTenant) {
        throw new Error("Only one personal workspace is allowed.");
      }

      throw new Error("Tenant creation BFF endpoint is not available.");
    },
    [hasPersonalTenant],
  );

  const contextValue = useMemo<TenantContextState>(
    () => ({
      currentTenantId,
      currentTenant,
      tenantList,
      hasPersonalTenant,
      switchTenantContext,
      createTenant,
    }),
    [
      currentTenantId,
      currentTenant,
      tenantList,
      hasPersonalTenant,
      switchTenantContext,
      createTenant,
    ],
  );

  return (
    <TenantUiContext.Provider value={contextValue}>
      {children}
    </TenantUiContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantUiContext);
  if (!context) {
    throw new Error("useTenant must be used within TenantProvider.");
  }

  return context;
}
