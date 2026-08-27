"use client";

/**
 * DetailSummaryHeader.tsx - 详情页顶部的身份概要：图标 · 标题/副标题 · 一排状态标。
 *
 * 六个详情页（账单、订单、订阅、业务方案、服务套餐、产品能力）顶部长的是同一个
 * 东西，此前各自挂 `vx-product-capability-summary__*` 那一族类名，结构在每个页面
 * 里重写一遍。这里收成一件。
 *
 * **右侧那一栏不进本件。** 它是 `MetricGrid`（读数）或一组按钮（动作），内容与
 * 排布各页不同——本件只管左边这块「这是谁」，右侧交给 `aside` 槽。同 `PanelItem`
 * 的判断：三槽都收 ReactNode，本件只管排布。
 *
 * 与 DS `ViewHeader` / `PageHeader` 的分工：那两件是**页面级**标题（面包屑、页名、
 * 页级动作），本件是页面内容里的**对象**概要——同一页上两者可以并存（详情页既有
 * 页头也有这张卡）。
 */

import type { ReactNode } from "react";
import { Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";

interface DetailSummaryHeaderProps {
  readonly icon: IconName;
  readonly title: ReactNode;
  /** 副标题：租户 / 套餐 / 编码这类「它属于谁」的一行。 */
  readonly subtitle?: ReactNode;
  /** 一排状态标，通常是若干 `StatusBadge`。 */
  readonly badges?: ReactNode;
  /** 右侧栏：读数（`MetricGrid`）或一组动作。宽屏并排，窄屏落到下面。 */
  readonly aside?: ReactNode;
}

export function DetailSummaryHeader({
  icon,
  title,
  subtitle,
  badges,
  aside,
}: DetailSummaryHeaderProps) {
  return (
    <section
      className={
        aside
          ? "grid min-w-0 items-start gap-md xl:grid-cols-2 xl:gap-xl"
          : "grid min-w-0 gap-md"
      }
    >
      <div className="flex min-w-0 items-start gap-md">
        <span
          className="inline-grid size-icon-2xl shrink-0 place-items-center text-primary-text"
          aria-hidden="true"
        >
          <Icon name={icon} size="lg" fallback="placeholder" />
        </span>
        <div className="min-w-0">
          <h2 className="m-0 truncate text-title-xl leading-tight font-semibold text-foreground">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-2xs mb-0 truncate text-body-sm font-extrabold text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
          {badges ? (
            <div className="mt-sm flex min-w-0 flex-wrap items-center gap-xs">
              {badges}
            </div>
          ) : null}
        </div>
      </div>
      {aside}
    </section>
  );
}
