/**
 * enum-labels.ts — 业务枚举 → 界面文案的**单一权威**（console 侧）。
 * @package @vxture/console
 * @layer Presentation
 * @category Shared
 *
 * 与 admin 的 `modules/shared/enum-labels.ts` 同一套规矩（那边的头注记着为什么：四份
 * `subscriptionStatusLabel` 实测互不相同、一份漏了分支）：
 *   · 只收**值域已经成文**的枚举（值域在 `@vxture-platform/shared` 的 catalog-domains）；
 *   · `satisfies Record<值域, string>` 让 TypeScript 强制穷尽——值域加一个值，这里不补就
 *     编译不过；
 *   · 每个键都写成字面量，不写 `t(\`x.${v}\`)`——动态键 lint:message-usage 扫不到。
 *
 * 文案要走 `t()`，而 `t` 只能在组件里拿，所以是 hook 不是纯函数。
 */

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { StatusBadgeTone } from "@vxture/design-system";
import type { SuspensionReason } from "@vxture-platform/shared";
import type { SubscriptionSuspension } from "@/api/console-bff";
import { useDateFormat } from "@/lib/use-date-format";

/**
 * 冻结中的状态词，按暂停原因分（产品维护窗口 PR B）。
 *
 * 值域 = `SUSPENSION_REASONS`（与 `chk_subscription_suspensions_reason` 由 lint:catalog-domains
 * 逐值对账）。词与官网 `products.catalog.suspension.*` 一致：
 *   platform_ops → 升级维护中 · dispute_review → 审核中 · customer_violation → 服务受限 ·
 *   other → 已暂停。
 *
 * 为什么不一律写「已暂停」：产品级维护会把一个产品名下所有租户一起暂停，那时说「已暂停」
 * 等于把平台自己的维护说成客户的事；而对违规被停的客户说「维护中」是平台替自己撒谎。
 * 四个词各自对客户为真，原因本身留在运营侧。
 */
export function useSuspensionStateLabels(): Record<SuspensionReason, string> {
  const t = useTranslations("enums.suspensionState");
  return useMemo(
    () =>
      ({
        platform_ops: t("platform_ops"),
        dispute_review: t("dispute_review"),
        customer_violation: t("customer_violation"),
        other: t("other"),
      }) satisfies Record<SuspensionReason, string>,
    [t],
  );
}

export interface SuspensionLabels {
  /** 冻结中那一格的状态词。episode 缺席（存量冻结行）→ 最中性的「已暂停」。 */
  state: (suspension: SubscriptionSuspension | null) => string;
  /**
   * 副句：「预计 {time} 恢复 · 暂停期间不计入有效期」。前半句要运营填了预计恢复时刻，
   * 后半句要 extendsTerm 为真——对违规暂停无条件写「不计入有效期」是假承诺。两半都不
   * 成立 → null，界面不画空行。
   */
  hint: (suspension: SubscriptionSuspension | null) => string | null;
  /**
   * 徽标语气。平台运维（升级维护中）是**计划内的运行态**——状态页一族都把维护与故障分开
   * 着色，这里同理用 warning；其余原因（审查 / 违规 / 其他）仍是 danger。
   */
  tone: (suspension: SubscriptionSuspension | null) => StatusBadgeTone;
}

/** 状态词 + 副句一起给：三个渲染点（订阅总览卡 / 应用中心磁贴 / 订单表服务列）共用。 */
export function useSuspensionLabels(): SuspensionLabels {
  const states = useSuspensionStateLabels();
  const t = useTranslations("enums.suspensionHint");
  const { fmtDateTime } = useDateFormat();

  const state = useCallback(
    (suspension: SubscriptionSuspension | null) =>
      states[suspension?.reason ?? "other"],
    [states],
  );
  const hint = useCallback(
    (suspension: SubscriptionSuspension | null) => {
      if (!suspension) return null;
      const parts: string[] = [];
      if (suspension.expectedResumeAt) {
        parts.push(
          t("expected", { time: fmtDateTime(suspension.expectedResumeAt) }),
        );
      }
      if (suspension.extendsTerm) parts.push(t("extendsTerm"));
      return parts.length > 0 ? parts.join(" · ") : null;
    },
    [t, fmtDateTime],
  );

  const tone = useCallback(
    (suspension: SubscriptionSuspension | null): StatusBadgeTone =>
      suspension?.reason === "platform_ops" ? "warning" : "danger",
    [],
  );

  return useMemo(() => ({ state, hint, tone }), [state, hint, tone]);
}
