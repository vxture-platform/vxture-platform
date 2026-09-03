/**
 * inbox-format.ts — 站内消息的展示辅助（product_330 P2-g）。
 * 时间：7 天内相对时间（Intl.RelativeTimeFormat），更早显示日期；模板键 → 抽屉图标 / 语气。
 */

export type InboxLevel = "danger" | "warning" | "info";

/** 模板键 → 抽屉里的语气与 phosphor 图标类（与 TemplateDrawer 的 DrawerNotif 对齐）。 */
export function inboxPresentation(templateCode: string): {
  level: InboxLevel;
  icon: string;
} {
  switch (templateCode) {
    case "subscription.expired":
      return { level: "danger", icon: "ph-clock-countdown" };
    case "refund.rejected":
      return { level: "danger", icon: "ph-warning-circle" };
    case "subscription.expiring_soon":
      return { level: "warning", icon: "ph-clock" };
    case "order.renewal_created":
      return { level: "warning", icon: "ph-receipt" };
    case "refund.requested":
    case "refund.approved":
    case "refund.completed":
      return { level: "info", icon: "ph-arrow-u-up-left" };
    case "order.fulfilled":
    case "subscription.renewed":
      return { level: "info", icon: "ph-check-circle" };
    case "announcement.published":
      return { level: "info", icon: "ph-megaphone" };
    default:
      return { level: "info", icon: "ph-bell" };
  }
}

export function formatInboxTime(iso: string, locale: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const diffMs = at.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < 7 * day) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (abs < hour) return rtf.format(Math.round(diffMs / minute), "minute");
    if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour");
    return rtf.format(Math.round(diffMs / day), "day");
  }
  return at.toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
