import type { StatusTone } from "@vxture-platform/shared";
import type {
  TenantOperationAuditEvent,
  TenantOperationMember,
  TenantOperationModelPolicy,
  TenantOperationRecord,
  TenantOperationSubscription,
  TenantOperationTicket,
  TenantOperationUsageMetric,
} from "@/entities/console";

export function joinClasses(
  ...values: Array<string | false | null | undefined>
) {
  return values.filter(Boolean).join(" ");
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(
    value,
  );
}

/**
 * Billing-line quantity (invoice_items.quantity is NUMERIC(12,4)): keep the
 * real fraction (trailing zeros dropped) - the integer formatNumber turned
 * 1.5 seats into 2 and broke quantity x unit price = subtotal.
 */
export function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(
    value,
  );
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/* 收 `locale` 而不是写死 `"zh-CN"`：日期的字段顺序属于语言——中文
   `2026/08/18`，英文 `08/18/2026`。同一串数字，读出来是两个日期。 */
/* 参数由调用点传，不用模块级可变状态存当前 locale：服务端并发渲染时
   两个不同语言的请求会互相覆盖，后写的赢。 */
export function formatDate(value: string | null, locale: string) {
  if (!value) return "未设置";
  return new Date(value).toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * 日期 + 时刻，到秒。
 *
 * `formatDate` 只到日，对多数列是对的（到期日、认证日）；**台账类不行**：审计日志
 * 同一天可能几百条，只显示日期等于没有时间戳，排序也无从验证（2026-08-07 走查
 * 看到 500 条全是 2026/08/07）。秒不是装饰——同一分钟内的先后要能分辨。
 */
export function formatDateTime(value: string | null, locale: string) {
  if (!value) return "未设置";
  return new Date(value).toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function statusLabel(status: TenantOperationRecord["status"]) {
  if (status === "active") return "正常";
  if (status === "trial") return "试用";
  if (status === "suspended") return "暂停";
  return "注销";
}

export function typeLabel(type: TenantOperationRecord["tenantType"]) {
  return type === "company" ? "企业租户" : "个人租户";
}

type TenantRiskValue = TenantOperationRecord["riskLevel"] | "low" | "medium";

const tenantRiskLabels: Record<TenantOperationRecord["riskLevel"], string> = {
  normal: "正常",
  follow_up: "需跟进",
  high: "高风险",
};

export const tenantRiskOptions = [
  { value: "normal", label: tenantRiskLabels.normal },
  { value: "follow_up", label: tenantRiskLabels.follow_up },
  { value: "high", label: tenantRiskLabels.high },
] satisfies Array<{ value: TenantOperationRecord["riskLevel"]; label: string }>;

export function normalizeTenantRiskLevel(
  risk: TenantRiskValue,
): TenantOperationRecord["riskLevel"] {
  if (risk === "high") return "high";
  if (risk === "medium" || risk === "follow_up") return "follow_up";
  return "normal";
}

export function riskLabel(risk: TenantRiskValue) {
  return tenantRiskLabels[normalizeTenantRiskLevel(risk)];
}

export function verifiedLabel(status: TenantOperationRecord["verifiedStatus"]) {
  if (status === "verified") return "已认证";
  if (status === "pending") return "待审核";
  if (status === "rejected") return "已驳回";
  return "未认证";
}

export function memberStatusLabel(status: TenantOperationMember["status"]) {
  if (status === "active") return "正常";
  if (status === "invited") return "邀请中";
  return "停用";
}

export function subscriptionStatusLabel(
  status: TenantOperationSubscription["status"],
) {
  if (status === "active") return "生效";
  if (status === "trial") return "试用";
  if (status === "past_due") return "逾期";
  return "取消";
}

export function modelPolicyStateLabel(
  state: TenantOperationModelPolicy["state"],
) {
  if (state === "effective") return "生效";
  if (state === "limited") return "临界";
  if (state === "disabled") return "停用";
  return "未定义";
}

export function policySourceLabel(
  source: TenantOperationModelPolicy["source"],
) {
  if (source === "product") return "产品策略";
  if (source === "tenant") return "租户覆盖";
  return "默认策略";
}

export function ticketStatusLabel(status: TenantOperationTicket["status"]) {
  if (status === "open") return "待处理";
  if (status === "processing") return "处理中";
  if (status === "blocked") return "搁置";
  return "完成";
}

export function auditResultLabel(result: TenantOperationAuditEvent["result"]) {
  if (result === "success") return "完成";
  if (result === "warning") return "关注";
  return "风险";
}

export function usagePercent(metric: TenantOperationUsageMetric) {
  if (metric.quota === null) return 100;
  if (metric.quota <= 0) return metric.used > 0 ? 100 : 0;
  return Math.min(100, Math.round((metric.used / metric.quota) * 100));
}

export function tenantSearchText(tenant: TenantOperationRecord) {
  return [
    tenant.id,
    tenant.tenantCode,
    tenant.tenantName,
    tenant.displayName,
    tenant.region,
    tenant.industry,
    tenant.ownerName,
    tenant.ownerEmail,
    tenant.contactName,
    tenant.contactPhone,
    tenant.status,
    tenant.verifiedStatus,
    tenant.riskLevel,
    ...tenant.tags,
    ...tenant.subscriptions.map(
      (item) => `${item.productName} ${item.releaseName} ${item.planName}`,
    ),
  ]
    .join(" ")
    .toLowerCase();
}

// ── 展示语气映射（admin 侧）────────────────────────────────────────────────
/**
 * 这三族状态**还没有共享值域**（`@vxture-platform/shared` 只拥有 subscription / tier /
 * plan-version 三族），所以映射留在这里。先有值域契约、再谈它的展示映射——反过来
 * 等于让展示层先于契约定义业务词汇。等哪天租户状态进了共享值域，这三张表就该
 * 跟着上提，与 SUBSCRIPTION_STATUS_TONE 并列。
 *
 * 取代的是原先写死在 CSS 里的 `vx-tenant-pill--*` 一族：那套色调散在 3 个样式
 * 文件、244 个选择器里，console 想展示同样的状态只能再抄一遍。
 */
export const TENANT_STATUS_TONE: Record<
  TenantOperationRecord["status"],
  StatusTone
> = {
  active: "success",
  trial: "info", // 试用是"进行中"，不是达成态——与 SUBSCRIPTION_STATUS_TONE 同一判断
  suspended: "warning",
  cancelled: "neutral",
};

export const VERIFICATION_TONE: Record<
  TenantOperationRecord["verifiedStatus"],
  StatusTone
> = {
  verified: "success",
  pending: "info", // 待审核是流程中，不是问题——用 warning 会让运营以为要介入
  rejected: "danger",
  unverified: "neutral",
};

/** 风险档只有三级，且 normal 刻意不是绿色：没有风险是常态，不值得高亮。 */
export const TENANT_RISK_TONE: Record<
  TenantOperationRecord["riskLevel"],
  StatusTone
> = {
  high: "danger",
  follow_up: "warning",
  normal: "neutral",
};
