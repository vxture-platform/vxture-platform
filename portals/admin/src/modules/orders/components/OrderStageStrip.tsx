"use client";

/**
 * OrderStageStrip.tsx — 订单五步进度条：下单 → 客户付款并申报 → 运营核对 → 确认收款 → 自动开通/完成。
 *
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Orders
 *
 * DS 没有 Stepper（设计稿 §3.8 明说）：用 `StatusBadge` 当步骤记号、`Separator` 当连线
 * 组一个小件，admin 内部复用；不自造样式。每一步的状态由 `orderStagePlan` 算，本件只管
 * 排布与文案。
 *
 * 语气：已完成 = success（勾）；进行中 = 由数据给（等客户 info、等运营 warning、出事
 * danger）；未开始 = neutral 无图标；已关闭的单剩余步骤同样 neutral——「不会再开始」
 * 与「还没开始」在颜色上不必分，徽标文案与任务卡会说清。
 */

import { useTranslations } from "next-intl";
import { Separator, StatusBadge } from "@vxture/design-system";
import type { StatusBadgeTone } from "@vxture/design-system";
import type { OrderStageSpec } from "@/modules/orders/order-status";

function stageTone(stage: OrderStageSpec): StatusBadgeTone {
  if (stage.state === "done") return "success";
  if (stage.state === "current") return stage.tone ?? "info";
  return "neutral";
}

export function OrderStageStrip({
  stages,
}: {
  stages: readonly OrderStageSpec[];
}) {
  const tPage = useTranslations("orderDetailPage");
  const labels = {
    placed: tPage("stages.placed"),
    declared: tPage("stages.declared"),
    verify: tPage("stages.verify"),
    confirm: tPage("stages.confirm"),
    provision: tPage("stages.provision"),
    refund: tPage("stages.refund"),
  } satisfies Record<OrderStageSpec["id"], string>;

  return (
    <ol
      aria-label={tPage("stages.ariaLabel")}
      className="m-0 flex min-w-0 list-none flex-wrap items-center gap-xs p-0"
    >
      {stages.map((stage, index) => (
        <li
          key={stage.id}
          className={
            index === 0
              ? "flex min-w-0 items-center"
              : "flex min-w-0 flex-1 items-center gap-xs"
          }
          aria-current={stage.state === "current" ? "step" : undefined}
        >
          {index > 0 ? (
            <Separator
              decorative
              orientation="horizontal"
              className="min-w-icon-md flex-1"
            />
          ) : null}
          {/* 进行中不传 icon（随语气出默认图标）；exactOptionalPropertyTypes 下不能传 undefined，
              所以按状态展开而不是三元。 */}
          <StatusBadge
            tone={stageTone(stage)}
            {...(stage.state === "done"
              ? { icon: "check" as const }
              : stage.state === "current"
                ? {}
                : { icon: false as const })}
          >
            {`${index + 1}. ${labels[stage.id]}`}
          </StatusBadge>
        </li>
      ))}
    </ol>
  );
}
