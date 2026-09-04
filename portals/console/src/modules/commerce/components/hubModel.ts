/**
 * hubModel.ts — 产品订阅总览页（product_330）的展示映射与日期/状态工具。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 1) 受众映射为代码级约定（与 website pricing-model 同口径，非 i18n 数据）：
 *    free/starter/pro=个人(person)、business=团队(team)、enterprise=私有化(private)。
 * 2) 订单六态在表格里投影为「付费状态 × 服务状态」两轴（owner 定稿），完整
 *    六态叙事留在展开区的进度时间线。
 */

import type { StatusBadgeTone } from "@vxture/design-system";
import type { OrderState } from "@/api/console-bff";

export type PlanAudience = "person" | "team" | "private";

export const TIER_AUDIENCE: Record<string, PlanAudience> = {
  free: "person",
  starter: "person",
  pro: "person",
  business: "team",
  enterprise: "private",
};

/** C2 订阅状态六值域（@vxture-platform/shared SUBSCRIPTION_STATUSES）→ 徽章语气。 */
export const SUB_STATUS_TONES: Record<string, StatusBadgeTone> = {
  active: "success",
  expiring: "warning",
  trialing: "info",
  overdue: "warning",
  suspended: "danger",
  expired: "neutral",
  cancelled: "neutral",
};

interface AxisView {
  /** i18n key（subscriptionHub.payAxis.* / svcAxis.*）。 */
  key: string;
  tone: StatusBadgeTone;
}

/** 付费状态轴。completed 的 ¥0 单在调用点改写为 settledZero（已结清）。 */
export const PAY_AXIS: Record<OrderState, AxisView> = {
  pending_payment: { key: "pending", tone: "warning" },
  paid_pending_verify: { key: "declared", tone: "info" },
  activating: { key: "received", tone: "success" },
  completed: { key: "received", tone: "success" },
  cancelled: { key: "unpaid", tone: "neutral" },
  expired: { key: "unpaid", tone: "neutral" },
};

/** 服务状态轴。 */
export const SVC_AXIS: Record<OrderState, AxisView> = {
  pending_payment: { key: "notProvisioned", tone: "neutral" },
  paid_pending_verify: { key: "notProvisioned", tone: "neutral" },
  activating: { key: "provisioning", tone: "info" },
  completed: { key: "active", tone: "success" },
  cancelled: { key: "cancelled", tone: "neutral" },
  expired: { key: "closed", tone: "neutral" },
};

/** 本地时区 yyyy-MM-dd（toISOString 会因 UTC 偏移串日）。 */
export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 本地时区 HH:mm。 */
export function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** MM-dd HH:mm（进度时间线的紧凑刻度）。 */
export function fmtStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}-${day} ${fmtTime(iso)}`;
}

/** 距到期的整天数（向上取整）；无到期（长期有效）→ null。 */
export function daysLeft(endIso: string | null): number | null {
  if (!endIso) return null;
  const end = new Date(endIso).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / 86_400_000);
}

/** 周期进度 0..100（无起止 → null，不画进度）。 */
export function cyclePercent(
  startIso: string | null,
  endIso: string | null,
): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return null;
  const p = ((Date.now() - start) / (end - start)) * 100;
  return Math.min(100, Math.max(0, Math.round(p)));
}

/** 剩余毫秒 → mm:ss / hh:mm:ss（与 OrderPayPage useCountdown 同刻度）。 */
export function formatRemain(deadlineIso: string, now: number): string {
  const remain = new Date(deadlineIso).getTime() - now;
  if (remain <= 0) return "00:00";
  const h = Math.floor(remain / 3_600_000);
  const m = Math.floor((remain % 3_600_000) / 60_000);
  const s = Math.floor((remain % 60_000) / 1_000);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 产品字母牌（icon 缺省时的 2 字符缩写）。 */
export function productInitials(
  name: string | null,
  code: string | null,
): string {
  const base = (name ?? code ?? "?").trim();
  return base.slice(0, 2);
}
