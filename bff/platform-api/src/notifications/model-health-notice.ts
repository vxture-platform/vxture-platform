/**
 * model-health-notice.ts - Compose Admin-only notices from Atlas health snapshots.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category notifications
 * @author AI-Generated
 * @date 2026-10-19
 * Snapshot keys suppress duplicate writes, but do not yet track recovery episodes.
 */
import type {
  CreateSystemNoticeInput,
  NoticeSeverity,
} from "@vxture/service-notice";

import {
  OPS_NOTICE_INFO_TTL_MS,
  opsNoticeReferenceId,
  redactUuids,
} from "./ops-notice";

/** 去重锚类别：与 `ops_signal` 分家，各自占一套键规则，不挤同一个唯一索引。 */
export const MODEL_HEALTH_REFERENCE_TYPE = "model_health";

// ── Atlas ServiceHealthView 的形状（逐字抄自 atlas service/src/health，不跨仓 import） ──
// 跨仓 import 会把两份构建拴死；这里只声明本文件消费到的字段，多出来的忽略即可。

/** atlas health-state.ts：模型健康态词表。 */
export type ModelHealthState =
  | "ok"
  | "rate_limited"
  | "account_refused"
  | "unavailable"
  | "unreachable"
  | "model_missing"
  | "unknown"
  | "degraded";

export type RouteHealthState = "ok" | "degraded" | "down";
export type HealthSeverity = "info" | "warning" | "critical";
export type RouteConfigIssueCode =
  | "model_missing"
  | "model_inactive"
  | "wrong_type"
  | "no_key";

export interface HealthModelView {
  readonly modelCode: string;
  readonly providerCode: string;
  readonly state: ModelHealthState;
  readonly since?: string;
  readonly upstreamStatus?: number;
  readonly detail?: string;
}

export interface HealthRouteConfigIssue {
  readonly role: "primary" | "fallback";
  readonly modelCode: string;
  readonly code: RouteConfigIssueCode;
  readonly detail: string;
}

export interface HealthRouteView {
  readonly code: string;
  readonly state: RouteHealthState;
  readonly severity: HealthSeverity | null;
  readonly primary: {
    readonly modelCode: string;
    readonly state: ModelHealthState;
  };
  readonly fallback: {
    readonly modelCode: string;
    readonly state: ModelHealthState;
  } | null;
  readonly configIssues: readonly HealthRouteConfigIssue[];
}

export interface HealthVendorView {
  readonly providerCode: string;
  readonly state: "ok" | "balance_low" | "not_supported" | "unknown";
  readonly since?: string;
  readonly detail?: string;
  readonly currency?: string;
  readonly balance?: number;
  readonly daysLeft?: number;
}

export interface HealthAtlasComponentView {
  readonly component: "usage_reporting" | "request_log" | "partitions";
  readonly state: "ok" | "failing" | "at_risk" | "unknown";
  readonly since?: string;
  readonly detail?: string;
}

export interface ServiceHealthView {
  readonly generatedAt: string;
  readonly models: readonly HealthModelView[];
  readonly routes: readonly HealthRouteView[];
  readonly vendors: readonly HealthVendorView[];
  readonly atlas: readonly HealthAtlasComponentView[];
}

/** Warning model states follow Atlas modelSeverity; unknown is informational. */
const MODEL_FAILING: ReadonlySet<ModelHealthState> = new Set<ModelHealthState>([
  "rate_limited",
  "account_refused",
  "unavailable",
  "unreachable",
  "model_missing",
  "degraded",
]);

/** 每个模型失败态对应的人读说法。 */
const MODEL_STATE_LABEL: Record<string, string> = {
  degraded: "服务降级（延迟或空响应）",
  rate_limited: "被上游限流（429）",
  account_refused: "被上游拒付（账户/余额）",
  unavailable: "上游不可用（5xx / 超时）",
  unreachable: "连不上上游",
  model_missing: "上游找不到该模型（404）",
};

function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}

/** 把一段从 Atlas 带进来的 detail 文本安全地接进正文：先抹 UUID，再截长。 */
function safeDetail(detail: string | undefined, max = 600): string | null {
  if (!detail) return null;
  return clip(redactUuids(detail), max);
}

function warningExpiry(now: Date): Date {
  return new Date(now.getTime() + OPS_NOTICE_INFO_TTL_MS);
}

// ── 四类 compose（均纯函数，返回 CreateSystemNoticeInput 或 null） ──

/** 路由：down → critical；有 configIssues 但未 down → warning（能兜底，但配置已坏）。 */
function composeRouteNotice(
  route: HealthRouteView,
  now: Date,
): CreateSystemNoticeInput | null {
  const hasIssues = route.configIssues.length > 0;
  const down = route.state === "down";
  if (!down && !hasIssues && route.state !== "degraded") return null;

  const severity: NoticeSeverity = down ? "critical" : "warning";

  const lines: string[] = [];
  if (down) {
    lines.push(
      `路由 ${route.code} 当前不可用（主模型 ${route.primary.modelCode} 为 ${route.primary.state}` +
        (route.fallback
          ? `，兜底 ${route.fallback.modelCode} 为 ${route.fallback.state}`
          : "，无兜底") +
        "）。",
    );
  }
  if (!down && route.state === "degraded") {
    lines.push(
      `路由 ${route.code} 当前降级，主模型 ${route.primary.modelCode} 为 ${route.primary.state}。`,
    );
  }
  if (hasIssues) {
    lines.push("配置问题：");
    for (const i of route.configIssues) {
      lines.push(
        `· [${i.role}] ${i.modelCode}（${i.code}）：${safeDetail(i.detail, 300)}`,
      );
    }
    lines.push(
      "配置问题与实时流量无关——即便暂时有兜底在服务，这条路由也没有按声明配好。",
    );
  }
  if (down) {
    lines.push(
      "先在 opera 模型服务页看这条路由，再查对应 provider 的 key / 状态。",
    );
  }

  // Snapshot deduplication is retained; recurring episodes need the event feed.
  const issueFingerprint = route.configIssues
    .map((i) => `${i.role}:${i.modelCode}:${i.code}`)
    .sort()
    .join(",");
  const key = down
    ? `route_down:${route.code}`
    : hasIssues
      ? `route_config:${route.code}:${issueFingerprint}`
      : `route_degraded:${route.code}`;

  return {
    targetPlanes: ["admin"],
    severity,
    title: clip(
      down
        ? `模型路由不可用：${route.code}`
        : hasIssues
          ? `模型路由配置异常：${route.code}（${route.configIssues.length} 项）`
          : `模型路由降级：${route.code}`,
      256,
    ),
    body: lines.join("\n"),
    link: null,
    referenceType: MODEL_HEALTH_REFERENCE_TYPE,
    referenceId: opsNoticeReferenceId(key),
    // Expiry only controls visibility; episode recovery is not implemented here.
    expiresAt: down ? null : warningExpiry(now),
  };
}

/** 模型：失败态 → warning（account_refused 归欠费一类，但仍 warning，critical 由 vendor 余额那条承担）。 */
function composeModelNotice(
  model: HealthModelView,
  now: Date,
): CreateSystemNoticeInput | null {
  if (!MODEL_FAILING.has(model.state)) return null;

  const label = MODEL_STATE_LABEL[model.state] ?? model.state;
  const lines = [
    `模型 ${model.modelCode}（provider ${model.providerCode}）${label}` +
      (typeof model.upstreamStatus === "number"
        ? `，上游状态 ${model.upstreamStatus}`
        : "") +
      "。",
  ];
  const detail = safeDetail(model.detail);
  if (detail) lines.push(`详情：${detail}`);

  return {
    targetPlanes: ["admin"],
    severity: "warning",
    title: clip(`模型异常：${model.modelCode}（${label}）`, 256),
    body: lines.join("\n"),
    link: null,
    referenceType: MODEL_HEALTH_REFERENCE_TYPE,
    // 一个 modelCode 一个失败态一条；态变了（如 rate_limited→unavailable）自然成新的一条。
    referenceId: opsNoticeReferenceId(
      `model_${model.state}:${model.modelCode}`,
    ),
    expiresAt: warningExpiry(now),
  };
}

/** 供应商余额：balance_low → 余额 <=0 或不可用判 critical，否则 warning（欠费类）。 */
function composeVendorNotice(
  vendor: HealthVendorView,
  now: Date,
): CreateSystemNoticeInput | null {
  if (vendor.state !== "balance_low") return null; // ok / not_supported / unknown 不发

  const outOfMoney = typeof vendor.balance === "number" && vendor.balance <= 0;
  const severity: NoticeSeverity = outOfMoney ? "critical" : "warning";

  const lines = [
    `供应商 ${vendor.providerCode} 余额不足` +
      (outOfMoney ? "（已耗尽，调用会被拒付）" : "") +
      "。",
  ];
  const detail = safeDetail(vendor.detail);
  if (detail) lines.push(`详情：${detail}`);
  lines.push(
    "充值后该供应商下所有模型会恢复；在充值前相关路由会走兜底或报拒付。",
  );

  return {
    targetPlanes: ["admin"],
    severity,
    title: clip(`供应商余额不足：${vendor.providerCode}`, 256),
    body: lines.join("\n"),
    link: null,
    referenceType: MODEL_HEALTH_REFERENCE_TYPE,
    // 按 provider + severity：warning 升到 critical 时再发一条（口径变了该提醒）。
    referenceId: opsNoticeReferenceId(
      `vendor_balance:${vendor.providerCode}:${severity}`,
    ),
    expiresAt: outOfMoney ? null : warningExpiry(now),
  };
}

/** Match Atlas atlasSeverity: lost request logs are critical; unknown is informational. */
function composeAtlasComponentNotice(
  comp: HealthAtlasComponentView,
  now: Date,
): CreateSystemNoticeInput | null {
  if (comp.state === "ok" || comp.state === "unknown") return null;
  const critical = comp.component === "request_log" && comp.state === "failing";
  const severity: NoticeSeverity = critical ? "critical" : "warning";

  const lines = [`Atlas 组件 ${comp.component} 状态 ${comp.state}。`];
  const detail = safeDetail(comp.detail);
  if (detail) lines.push(`详情：${detail}`);

  return {
    targetPlanes: ["admin"],
    severity,
    title: clip(`Atlas 组件异常：${comp.component}（${comp.state}）`, 256),
    body: lines.join("\n"),
    link: null,
    referenceType: MODEL_HEALTH_REFERENCE_TYPE,
    referenceId: opsNoticeReferenceId(
      `atlas_component:${comp.component}:${comp.state}`,
    ),
    expiresAt: critical ? null : warningExpiry(now),
  };
}

/**
 * 遍历一份健康快照，产出所有该发的通告。顺序：路由 → 模型 → 供应商 → Atlas 组件。
 * `now` 由调用方传入（纯函数不自取时钟，便于测试与 /loop 口径）。
 */
export function composeModelHealthNotices(
  view: ServiceHealthView,
  now: Date,
): CreateSystemNoticeInput[] {
  const out: CreateSystemNoticeInput[] = [];
  for (const route of view.routes) {
    const n = composeRouteNotice(route, now);
    if (n) out.push(n);
  }
  for (const model of view.models) {
    const n = composeModelNotice(model, now);
    if (n) out.push(n);
  }
  for (const vendor of view.vendors) {
    const n = composeVendorNotice(vendor, now);
    if (n) out.push(n);
  }
  for (const comp of view.atlas) {
    const n = composeAtlasComponentNotice(comp, now);
    if (n) out.push(n);
  }
  return out;
}
