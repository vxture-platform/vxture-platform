"use client";

import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
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
  const router = useRouter();
  // Read pathname through a ref so switchTenantContext can stay referentially
  // stable — subscribing to usePathname re-renders this provider on every
  // navigation, but the memoized context value below keeps consumers from
  // re-rendering unless the tenant data itself changed.
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

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
    async (tenantId: string) => {
      const tenant = tenantList.find((item) => item.id === tenantId);
      if (!tenant || tenant.id === currentTenant?.id) {
        return;
      }

      await switchTenant(tenant.id);
      // usePathname 不含查询串：裸 replace 会把 /subscribe?product=… 之类的
      // 深链上下文清掉，切租户后页面失去订单参数。保留 search 原样回放。
      const search =
        typeof window !== "undefined" ? window.location.search : "";
      router.replace(`${pathnameRef.current}${search}`);
      router.refresh();
    },
    [tenantList, currentTenant?.id, switchTenant, router],
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
