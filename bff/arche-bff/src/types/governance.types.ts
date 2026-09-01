/**
 * governance.types.ts — arche-bff 治理域只读记录类型(切片)。
 * @package @vxture/bff-arche
 * @layer BFF
 *
 * 与前端 `portals/arche/src/entities/console.ts` 的同名类型形状一致,但两边各自
 * 独立定义、不共享导入(BFF 与门户不互相依赖)。每迁一批治理页按需追加。
 */

/** 操作审计流水的一行(support.audit_logs)。 */
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

/** 通知投递台账的一行(support.notification_logs)。 */
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

/** 租户风险评估记录的一行(admin.risk_records)。 */
export interface RiskRecordItem {
  id: string;
  tenantId: string;
  /** 展示用,LEFT JOIN tenancy.tenants(租户清除后为 null)。 */
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

/** 合规事件的一行(admin.compliance_events)。 */
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

/** 平台运行时配置的一行(admin.settings)。 */
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

/** 功能开关的一行(admin.feature_flags)。 */
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
