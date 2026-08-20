"use client";

/**
 * OrderFlowStrip.tsx — 订单四步流程条。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 「下单 → 付款 → 收款 → 开通」是六态订单状态机（product_321 P1）的用户视角
 * 投影：六态是后端契约，四步是给人看的旅程，映射关系收在本件，不外泄。
 * 已完成步骤可带时间戳；右端可挂订单状态徽章（语气由调用方判断）。
 * cancelled/expired 停在「待付款」一步，异常语义由右端徽章表达——流程条只画
 * 走到哪，不画为什么停。
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon, cn } from "@vxture/design-system";

/** 「下单中」是尚未生成订单的确认页；其余六态来自订单契约。 */
export type OrderFlowStage =
  | "ordering"
  | "pending_payment"
  | "paid_pending_verify"
  | "activating"
  | "completed"
  | "cancelled"
  | "expired";

const STEPS = ["order", "pay", "verify", "provision"] as const;
export type OrderFlowStep = (typeof STEPS)[number];

/** 每个 stage 对应的「当前步」下标；4 = 全部完成。 */
const STAGE_CURSOR: Record<OrderFlowStage, number> = {
  ordering: 0,
  pending_payment: 1,
  paid_pending_verify: 2,
  activating: 3,
  completed: 4,
  cancelled: 1,
  expired: 1,
};

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface OrderFlowStripProps {
  readonly stage: OrderFlowStage;
  /** 已完成步骤的时间戳（ISO）；缺省只显示步名。 */
  readonly times?: Partial<Record<OrderFlowStep, string | null>>;
  /** 右端状态徽章（通常是 StatusBadge），语气由调用方定。 */
  readonly badge?: ReactNode;
}

export function OrderFlowStrip({ stage, times, badge }: OrderFlowStripProps) {
  const t = useTranslations("orderFlow");
  const cursor = STAGE_CURSOR[stage];

  return (
    <div className="flex items-center gap-lg rounded-xl bg-card px-lg py-sm shadow-raised ring-1 ring-foreground/10">
      <ol className="flex min-w-0 flex-1 items-center">
        {STEPS.map((key, i) => {
          const done = i < cursor;
          const cur = i === cursor;
          const time = done ? times?.[key] : null;
          return (
            <li
              key={key}
              className="flex min-w-0 flex-1 items-center gap-sm last:flex-none"
            >
              {i > 0 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px min-w-md flex-1",
                    done || cur ? "bg-primary" : "bg-border",
                  )}
                />
              ) : null}
              <span
                className={cn(
                  "flex size-icon-lg shrink-0 items-center justify-center rounded-full border-2 text-body-sm font-semibold",
                  done && "border-primary bg-primary text-primary-foreground",
                  cur && "border-primary bg-surface-selected text-primary-text",
                  !done &&
                    !cur &&
                    "border-border bg-card text-content-tertiary",
                )}
              >
                {done ? <Icon name="check" size="xs" /> : i + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    "truncate text-label-sm",
                    done
                      ? "text-foreground"
                      : cur
                        ? "font-semibold text-primary-text"
                        : "text-content-tertiary",
                  )}
                >
                  {t(`${key}.${done ? "done" : "pending"}`)}
                </span>
                {time ? (
                  <time className="hidden truncate text-body-sm text-content-tertiary tabular-nums sm:block">
                    {formatTs(time)}
                  </time>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      {badge ? <span className="shrink-0">{badge}</span> : null}
    </div>
  );
}
