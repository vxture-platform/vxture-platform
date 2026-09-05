import type { ReactNode } from "react";

export type TenantType = "personal" | "organization";
export type TenantRole = "owner" | "admin" | "member";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  avatar?: string;
  type: TenantType;
  ownerId: string;
  createdAt: string;
}

export interface TenantMembership {
  userId: string;
  tenantId: string;
  role: TenantRole;
  status: "active" | "pending" | "disabled";
}

export interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  avatar?: string;
  type: TenantType;
  role: TenantRole;
  isCurrent: boolean;
  /** 登录后默认进入的租户(账号信息页「设为默认」)。 */
  isDefault: boolean;
  /** 租户标识内容哈希;null = 无自定义标识。 */
  logoHash: string | null;
  source?: "session";
}

export interface CreateTenantPayload {
  name: string;
  slug: string;
  type: TenantType;
}

export interface TenantContextState {
  currentTenantId: string | null;
  currentTenant: TenantListItem | null;
  tenantList: TenantListItem[];
  hasPersonalTenant: boolean;
  /**
   * 切换活跃租户(顶层导航,页面整体重载;见 ConsoleSessionProvider.switchTenant)。
   * 切完要落到别的页面就传 `returnTo`;不传则回到当前地址。
   */
  switchTenantContext: (tenantId: string, returnTo?: string) => Promise<void>;
  createTenant: (payload: CreateTenantPayload) => Promise<void>;
}

export interface TenantProviderProps {
  children: ReactNode;
}
