/**
 * Narrow browser contracts; independent of other portal source trees.
 * @package @vxture/workbench
 * @layer Presentation
 * @category types
 * @author AI-Generated
 * @date 2026-11-05
 */
// ============================================================================
// Browser identity, workspace and application projections
// ============================================================================
export type LoadResult<T> =
  | { status: "ready"; data: T }
  | { status: "error"; message: string; code: number };
export interface WorkUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  picture: string | null;
}
export interface WorkScope {
  id: string;
  name: string;
  workspace: string;
  workspaceName: string;
  personal: boolean;
  identifier?: string | undefined;
}
export interface WorkApp {
  code: string;
  name: string;
  brand: string;
  description: string;
  category: "agent" | "platform";
  version: string | null;
  stage: string;
  tier: string | null;
  icon: string | null;
  href: string | null;
  available: boolean;
  availabilityLabel: string;
  favorite?: boolean;
}
export interface CatalogProduct {
  code: string;
  name: string;
  nick: string | null;
  type: string;
  description: string;
  version: string | null;
  stage: string;
  active: boolean;
  maintenance: boolean;
  icon: string | null;
}
export interface Subscription {
  code: string;
  status: string;
  tier: string | null;
  maintenance: boolean;
  bundled?: boolean;
  favorite?: boolean;
}
export interface ProductEntry {
  code: string;
  href: string | null;
}
export interface ScopeOption {
  id: string;
  name: string;
  personal: boolean;
  identifier?: string | undefined;
  workspaces?: WorkspaceOption[] | undefined;
}
export interface WorkspaceOption {
  id: string;
  name: string;
  isDefault: boolean;
}
// ============================================================================
// Aggregated data and public runtime flags
// ============================================================================
export interface ResourceUsage {
  storage: { used: number; limit: number };
  aiCredit: { used: number; limit: number };
}
export interface WorkData {
  user: WorkUser;
  scope: WorkScope;
  catalog: LoadResult<WorkApp[]>;
  scopeOptions: LoadResult<ScopeOption[]>;
  workspaces: LoadResult<WorkspaceOption[]>;
  availabilityIssue: string | null;
  resources: LoadResult<ResourceUsage>;
  balance: LoadResult<string>;
  monthlyBill: LoadResult<string>;
}
export interface WorkRuntime {
  authConfigured: boolean;
  catalogConfigured: boolean;
  websiteUrl: string;
  consoleUrl: string;
}

// ============================================================================
// Account-owned notifications, independent of product availability
// ============================================================================
export interface WorkNotification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
export interface WorkInbox {
  items: WorkNotification[];
  unreadCount: number;
}
