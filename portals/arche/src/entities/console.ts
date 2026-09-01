/**
 * console.ts — arche 治理台的领域类型(切片)。
 * @package @vxture/arche
 * @layer Domain
 *
 * 只收本门户页面真正用到的类型子集,不照抄 admin 的 `entities/console.ts`(1796L,
 * 全 admin 共用)。每迁一批页面按需追加,保持这份文件是"arche 用得到的那部分"。
 */

/** 操作审计流水的一行(support.audit_logs,只读)。 */
export interface AuditLogRecord {
  id: string;
  operatorId: string;
  operatorName: string;
  operatorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  module: string;
  ip: string | null;
  result: "success" | "failure";
  errorMessage: string | null;
  createdAt: string;
}

/** 通知投递台账的一行(support.notification_logs,只读)。 */
export interface NotificationLogRecord {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  accountId: string | null;
  channel: string;
  templateCode: string;
  status: string;
  referenceType: string | null;
  referenceId: string | null;
  recipient: string;
  subject: string | null;
  provider: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
  retryCount: number;
  deliveredAt: string | null;
  openedAt: string | null;
  createdAt: string;
}

// ── 治理写页(风险 / 合规 / 参数 / 开关)—— 与 arche-bff governance.types 同形 ──

export interface RiskRecordItem {
  id: string;
  tenantId: string;
  tenantName: string | null;
  tenantNo: string | null;
  riskLevel: "normal" | "follow_up" | "high";
  riskScore: number | null;
  scope: string | null;
  reason: string;
  reviewerId: string | null;
  reviewerName: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceEventItem {
  id: string;
  /** null = 平台级事件。 */
  tenantId: string | null;
  tenantName: string | null;
  eventType: string;
  status: "open" | "in_review" | "resolved" | "dismissed";
  regulationCode: string | null;
  evidenceUrl: string | null;
  handlerId: string | null;
  handlerName: string | null;
  detail: unknown;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlatformSettingRecord {
  id: string;
  configGroup: string;
  configKey: string;
  valueType: "string" | "int" | "bool" | "json";
  /** 敏感/加密时脱敏为 '••••••'。 */
  configValue: string;
  isSensitive: boolean;
  isEncrypted: boolean;
  isReadonly: boolean;
  isMasked: boolean;
  isEditable: boolean;
  validationRule: string | null;
  description: string | null;
  updatedAt: string;
}

export interface FeatureFlagRecord {
  id: string;
  flagKey: string;
  category: string;
  environment: string;
  description: string | null;
  isGloballyEnabled: boolean;
  isArchived: boolean;
  rolloutPercentage: number;
  /** {tenancy.tenants.id: boolean} — 逐租户覆盖,优先于 rollout。 */
  tenantOverrides: Record<string, boolean>;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── RBAC 域(Batch 3:平台用户/角色/权限)前端类型 ───────────────────────
// 与 bff/arche-bff governance.types 同形。合规事件页的"指派处理人"下拉用
// PlatformAdminRecord 的 id/username/displayName/statusCode 子集(此处为超集,兼容)。

// 前端用小写(与 admin 前端 entities 一致;后端 governance.types 用大写,同 admin
// 的前后端分裂——两侧各自独立,运行时值以后端返回为准)。
export type PlatformPermissionType = "menu" | "button" | "api";

export interface PlatformAdminRecord {
  id: string;
  sort: number;
  username: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  roleId: string;
  roleCode: string;
  roleNameI18nKey: string;
  roleNameEn: string;
  roleRank: number;
  canManage?: boolean;
  roleStatusCode: "active" | "disabled" | "archived";
  roleStatus: boolean;
  statusCode: "active" | "disabled" | "locked" | "pending" | "suspended";
  status: boolean;
  isSystem: boolean;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformRolePermissionRecord {
  id: string;
  parentId: string | null;
  permCode: string;
  permName: string;
  permType: PlatformPermissionType;
  status: boolean;
  description: string;
  routePath: string | null;
}

export interface PlatformRoleRecord {
  id: string;
  roleCode: string;
  rank: number;
  nameI18nKey: string;
  nameEn: string;
  descriptionI18nKey: string | null;
  description: string;
  isSystem: boolean;
  statusCode: "active" | "disabled" | "archived";
  status: boolean;
  sort: number;
  adminCount: number;
  activeAdminCount: number;
  permissionCount: number;
  menuPermissionCount: number;
  buttonPermissionCount: number;
  apiPermissionCount: number;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  permissions: PlatformRolePermissionRecord[];
}

export interface PlatformAdminPermissionRecord extends PlatformRolePermissionRecord {
  isSystem: boolean;
  icon: string | null;
  sort: number;
  component: string | null;
  roleCount: number;
  activeRoleCount: number;
  createdAt: string;
  updatedAt: string;
}
