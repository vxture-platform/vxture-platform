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
