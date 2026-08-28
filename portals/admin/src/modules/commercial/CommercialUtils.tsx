import { StatusBadge } from "@vxture/design-system";
import type { StatusBadgeTone } from "@vxture/design-system";

/** `Tag` 的旧语气名 → 六档。`normal` 是"正常/已达成"，落 success。 */
const COMMERCIAL_TAG_TONE: Record<string, StatusBadgeTone> = {
  normal: "success",
  warning: "warning",
  danger: "danger",
};

/**
 * 商业域的语气名 → DS 语气。
 *
 * 曾经导出过：卡片态的顶缘色条要跟 `Tag` 用同一个语气。卡片视图停用后那个
 * 消费方没了，收回成文件内私有。
 */
function commercialTone(tone: string): StatusBadgeTone {
  return COMMERCIAL_TAG_TONE[tone] ?? "neutral";
}

export type { PageSize } from "@/modules/shared/PageSizePicker";

export function formatCurrency(
  value: number,
  currency = "CNY",
  maximumFractionDigits = 2,
) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: Math.min(2, maximumFractionDigits),
    maximumFractionDigits,
  }).format(value);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * 商业域三页共用的小标。
 *
 * ── 为什么不再走 `vx-commercial-pill--*` ─────────────────────────────────
 * 那一族**背景色一直没生效**：它随 `admin-management.css` 在 `globals.css` 第 4 位
 * 导入，而基类 `.vx-tenant-pill` 在第 6 位——同层、同特异度（都是单类选择器），
 * 后写的赢，基类的背景把所有修饰符压死。文字色则另有一层：`Badge` 带的
 * `text-foreground` 是 Tailwind utilities 层，压过 admin 的 `layer(components)`。
 * 于是四种语气实测算出来是同一个蓝灰（2026-08-06 走查量到）。
 *
 * ── 四个入参恰好就是六档里的四档 ────────────────────────────────────────
 * 本件只出状态标。**类目不要走它**：类目没有严重度，调用点直接用朴素 `Badge`
 * （判据同 `publish-tone.ts` 文件尾那条）。
 *
 * 第一版曾让本件按 `tone === "muted"` 自己判"这是类目"，当场就错了：
 * `statusTone` 的 `paused`、`billStatusTone` 的 `cancelled` 返回的也是 `muted`，
 * 于是「已暂停」「已作废」被当成类目画。**语气名不携带"是状态还是类目"这个信息，
 * 只有调用点知道**，组件不该猜。
 */
export function Tag({
  tone,
  children,
  title,
}: {
  tone: string;
  children: string;
  title?: string;
}) {
  return (
    <StatusBadge tone={commercialTone(tone)} title={title}>
      {children}
    </StatusBadge>
  );
}
