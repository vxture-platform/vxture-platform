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
