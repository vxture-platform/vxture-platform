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

import type { AuditLogRecord, NotificationLogRecord } from "@/entities/console";

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
