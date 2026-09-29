/**
 * inbox-format.ts — 站内消息的展示辅助(product_330 P2-g)。
 * 时间:7 天内相对时间(Intl.RelativeTimeFormat),更早显示日期;模板键 → 抽屉图标 / 语气。
 * 批 4:图标从 Phosphor 字体类改为 DS IconName(fill 字体从未加载,图标位一直是空的)。
 */

import type { IconName } from "@vxture/design-system";
import { formatDay } from "@vxture-platform/shared";

export type InboxLevel = "danger" | "warning" | "info";

/** 模板键 → 抽屉里的语气与 DS 图标(与 TemplateDrawer 的 DrawerNotif 对齐)。 */
export function inboxPresentation(templateCode: string): {
  level: InboxLevel;
  icon: IconName;
} {
  switch (templateCode) {
    case "subscription.expired":
      return { level: "danger", icon: "warning" };
    case "refund.rejected":
      return { level: "danger", icon: "warning" };
    case "subscription.expiring_soon":
      return { level: "warning", icon: "calendar" };
    case "order.renewal_created":
      return { level: "warning", icon: "receipt" };
    case "refund.requested":
    case "refund.approved":
    case "refund.completed":
      return { level: "info", icon: "wallet" };
    case "order.fulfilled":
    case "subscription.renewed":
      return { level: "info", icon: "seal-check" };
    case "announcement.published":
      return { level: "info", icon: "bell" };
    /* 工单三条（2026-09-29 批 2）。图标按**客户的下一步**分，不按"是好消息还是坏
       消息"：读回复 / 核对结果 / 这张单归档了。`ticket.replied` 用的是时间线上运营
       回复那一格的同一个图标（`headset`），两处指的就是同一件事，客户从收件箱点进
       详情页时认得出自己刚看的是哪一条。
       三条都是 info：关单是正常收尾，不是出了问题——给它 warning 会让每一次结案都
       在收件箱里亮一下。 */
    case "ticket.replied":
      return { level: "info", icon: "headset" };
    case "ticket.resolved":
      return { level: "info", icon: "seal-check" };
    case "ticket.closed":
      return { level: "info", icon: "archive" };
    default:
      return { level: "info", icon: "bell" };
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
  return formatDay(at, locale);
}
