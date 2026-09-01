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

/**
 * 运营账号记录 —— 合规事件页的"指派处理人"下拉需要它列活跃运营者。
 * 完整的平台用户管理面(RBAC 写口)在 PR③(Batch 3)从 admin 迁入;此处只保留
 * 处理人选择器用到的字段形状。
 */
export interface PlatformAdminRecord {
  id: string;
  username: string;
  displayName: string;
  statusCode: "active" | "disabled" | "locked" | "pending" | "suspended";
}
