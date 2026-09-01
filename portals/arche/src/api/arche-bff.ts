/**
 * arche-bff.ts — 治理台前端 → arche-bff 的读接口(切片)。
 * @package @vxture/arche
 * @layer Data Access
 *
 * 只收本门户页面用到的 fetch 函数,不照抄 admin 的 `api/admin-bff.ts`(2828L)。
 * 一律走**同源相对路径**(`/api/...`):生产由 nginx 同 vhost 路由到 arche-bff,
 * 开发由 next.config 的 rewrite 缝到 arche-bff:3051——两处都不需要绝对 origin,
 * 真实域名也就不必入仓(加固:占位符政策)。
 */

import type {
  AuditLogRecord,
  ComplianceEventItem,
  FeatureFlagRecord,
  NotificationLogRecord,
  PlatformAdminRecord,
  PlatformSettingRecord,
  RiskRecordItem,
} from "@/entities/console";

export class ArcheBffError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ArcheBffError";
  }
}

async function responseErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.clone().json()) as {
      message?: string | string[];
    };
    return Array.isArray(body.message)
      ? (body.message[0] ?? fallback)
      : (body.message ?? fallback);
  } catch {
    return fallback;
  }
}

/** 宽松读:失败(网络/非 2xx)回退到 fallback,不抛。用于"空即空"语义安全的页。 */
async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(path, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

/** 严格读:失败抛 ArcheBffError,让页面把"读取失败"与"空结果"分开。 */
async function readJsonStrict<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new ArcheBffError("Arche BFF is unavailable.", 503);
  }
  if (!response.ok) {
    throw new ArcheBffError(
      await responseErrorMessage(response, `Arche BFF request failed: ${path}`),
      response.status,
    );
  }
  return (await response.json()) as T;
}

function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value !== "") search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

// ── 审计日志(support.audit_logs,只读)────────────────────────────────────────

export interface AuditLogFilters {
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  module?: string;
  result?: "success" | "failure" | "denied";
}

// 服务端筛选(arche-bff audit-logs.router)。日期区间是关键项:审计日志无限增长,
// 不带 from/to 时只看得到最近 500 条。走 strict:读取失败要能与"空结果"区分,
// 不被静默吞成空列表。
export async function fetchAuditLogs(
  filters: AuditLogFilters = {},
): Promise<AuditLogRecord[]> {
  return readJsonStrict<AuditLogRecord[]>(
    `/api/audit-logs${queryString(filters)}`,
  );
}

// ── 通知投递台账(support.notification_logs,只读)────────────────────────────

export interface NotificationLogListFilters {
  channel?: string;
  status?: string;
  from?: string;
  to?: string;
  search?: string;
}

export async function fetchNotificationLogs(
  filters: NotificationLogListFilters = {},
): Promise<NotificationLogRecord[]> {
  return readJson<NotificationLogRecord[]>(
    `/api/notification-logs${queryString(filters)}`,
    [],
  );
}

/** 写:失败抛 ArcheBffError(带服务端 message)。同源相对路径。 */
async function mutateJson<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  fallbackMessage = "Arche BFF request failed",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ArcheBffError("Arche BFF is unavailable.", 503);
  }
  if (!response.ok) {
    throw new ArcheBffError(
      await responseErrorMessage(response, fallbackMessage),
      response.status,
    );
  }
  return (await response.json()) as T;
}

// ── 风险记录(admin.risk_records,读写)──────────────────────────────────────

export interface RiskRecordListFilters {
  tenantId?: string;
  riskLevel?: string;
  reviewed?: "true" | "false";
  tag?: string;
}

export async function fetchRiskRecords(
  filters: RiskRecordListFilters = {},
): Promise<RiskRecordItem[]> {
  return readJsonStrict<RiskRecordItem[]>(
    `/api/risk-records${queryString(filters)}`,
  );
}

export interface RiskRecordWriteInput {
  tenantId?: string;
  riskLevel?: RiskRecordItem["riskLevel"];
  riskScore?: number | null;
  scope?: string | null;
  reason: string;
  tags?: string[];
}

export async function createRiskRecord(
  payload: RiskRecordWriteInput,
): Promise<RiskRecordItem> {
  return mutateJson<RiskRecordItem>(
    "/api/risk-records",
    "POST",
    payload,
    "Risk record creation failed",
  );
}

export async function updateRiskRecord(
  recordId: string,
  payload: RiskRecordWriteInput,
): Promise<RiskRecordItem> {
  return mutateJson<RiskRecordItem>(
    `/api/risk-records/${recordId}`,
    "PUT",
    payload,
    "Risk record update failed",
  );
}

export async function reviewRiskRecord(
  recordId: string,
): Promise<RiskRecordItem> {
  return mutateJson<RiskRecordItem>(
    `/api/risk-records/${recordId}/review`,
    "POST",
    undefined,
    "Risk record review failed",
  );
}

export async function deleteRiskRecord(
  recordId: string,
): Promise<{ id: string; status: "deleted" }> {
  return mutateJson<{ id: string; status: "deleted" }>(
    `/api/risk-records/${recordId}`,
    "DELETE",
    undefined,
    "Risk record deletion failed",
  );
}

// ── 合规事件(admin.compliance_events,读写)──────────────────────────────────

export interface ComplianceEventListFilters {
  status?: string;
  tenantId?: string;
  eventType?: string;
  tag?: string;
}

export async function fetchComplianceEvents(
  filters: ComplianceEventListFilters = {},
): Promise<ComplianceEventItem[]> {
  return readJsonStrict<ComplianceEventItem[]>(
    `/api/compliance-events${queryString(filters)}`,
  );
}

export interface ComplianceEventWriteInput {
  tenantId?: string | null;
  eventType: string;
  regulationCode?: string | null;
  evidenceUrl?: string | null;
  detail?: Record<string, unknown> | null;
  tags?: string[];
}

export async function createComplianceEvent(
  payload: ComplianceEventWriteInput,
): Promise<ComplianceEventItem> {
  return mutateJson<ComplianceEventItem>(
    "/api/compliance-events",
    "POST",
    payload,
    "Compliance event creation failed",
  );
}

export async function updateComplianceEvent(
  eventId: string,
  payload: ComplianceEventWriteInput,
): Promise<ComplianceEventItem> {
  return mutateJson<ComplianceEventItem>(
    `/api/compliance-events/${eventId}`,
    "PUT",
    payload,
    "Compliance event update failed",
  );
}

export async function assignComplianceEvent(
  eventId: string,
  handlerId: string,
): Promise<ComplianceEventItem> {
  return mutateJson<ComplianceEventItem>(
    `/api/compliance-events/${eventId}/assign`,
    "POST",
    { handlerId },
    "Compliance event assignment failed",
  );
}

export async function resolveComplianceEvent(
  eventId: string,
): Promise<ComplianceEventItem> {
  return mutateJson<ComplianceEventItem>(
    `/api/compliance-events/${eventId}/resolve`,
    "POST",
    undefined,
    "Compliance event resolution failed",
  );
}

export async function dismissComplianceEvent(
  eventId: string,
): Promise<ComplianceEventItem> {
  return mutateJson<ComplianceEventItem>(
    `/api/compliance-events/${eventId}/dismiss`,
    "POST",
    undefined,
    "Compliance event dismissal failed",
  );
}

export async function deleteComplianceEvent(
  eventId: string,
): Promise<{ id: string; status: "deleted" }> {
  return mutateJson<{ id: string; status: "deleted" }>(
    `/api/compliance-events/${eventId}`,
    "DELETE",
    undefined,
    "Compliance event deletion failed",
  );
}

// ── 功能开关(admin.feature_flags,读写)──────────────────────────────────────

export interface FeatureFlagListFilters {
  category?: string;
  environment?: string;
  archived?: "true" | "false" | "all";
}

export async function fetchFeatureFlags(
  filters: FeatureFlagListFilters = {},
): Promise<FeatureFlagRecord[]> {
  return readJson<FeatureFlagRecord[]>(
    `/api/feature-toggles${queryString(filters)}`,
    [],
  );
}

export interface FeatureFlagWriteInput {
  flagKey?: string;
  category?: string;
  environment?: string;
  description?: string | null;
  rolloutPercentage?: number;
  tenantOverrides?: Record<string, boolean>;
  expiresAt?: string | null;
}

export async function createFeatureFlag(
  payload: FeatureFlagWriteInput,
): Promise<FeatureFlagRecord> {
  return mutateJson<FeatureFlagRecord>(
    "/api/feature-toggles",
    "POST",
    payload,
    "Feature flag creation failed",
  );
}

export async function updateFeatureFlag(
  flagId: string,
  payload: FeatureFlagWriteInput,
): Promise<FeatureFlagRecord> {
  return mutateJson<FeatureFlagRecord>(
    `/api/feature-toggles/${flagId}`,
    "PUT",
    payload,
    "Feature flag update failed",
  );
}

export async function toggleFeatureFlag(
  flagId: string,
): Promise<FeatureFlagRecord> {
  return mutateJson<FeatureFlagRecord>(
    `/api/feature-toggles/${flagId}/toggle`,
    "POST",
    undefined,
    "Feature flag toggle failed",
  );
}

export async function archiveFeatureFlag(
  flagId: string,
  archived: boolean,
): Promise<FeatureFlagRecord> {
  return mutateJson<FeatureFlagRecord>(
    `/api/feature-toggles/${flagId}/archive`,
    "POST",
    { archived },
    "Feature flag archive failed",
  );
}

// ── 系统参数(admin.settings,读写)──────────────────────────────────────────

export interface PlatformSettingListFilters {
  group?: string;
  search?: string;
}

export async function fetchPlatformSettings(
  filters: PlatformSettingListFilters = {},
): Promise<PlatformSettingRecord[]> {
  return readJson<PlatformSettingRecord[]>(
    `/api/system-parameters${queryString(filters)}`,
    [],
  );
}

export async function updatePlatformSetting(
  settingId: string,
  configValue: string,
): Promise<PlatformSettingRecord> {
  return mutateJson<PlatformSettingRecord>(
    `/api/system-parameters/${settingId}`,
    "PUT",
    { configValue },
    "Platform setting update failed",
  );
}

// ── 运营账号(合规事件"指派处理人"选择器用;完整 RBAC 面在 PR③ 迁入)──────────
// 打 /api/platform-admins;该 router 于 Batch 3(RBAC)迁入 arche-bff,在此之前
// 选择器为空(页面可手填 handler uuid),不影响本页其余功能。

export async function fetchPlatformAdmins(): Promise<PlatformAdminRecord[]> {
  return readJsonStrict<PlatformAdminRecord[]>("/api/platform-admins");
}
