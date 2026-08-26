"use client";

/**
 * PanelLinkItem.tsx - 可点的面板项：语气图标 · 标题/说明 · 去向箭头。
 *
 * DS 的 `PanelItem` 明确**不出** `onClick`（其注释：「现有七个面板的项都不可点，
 * 跳转在面板头的详情」）。admin 的风险清单不是那个形态——每一项本身就是一个跳转
 * 目标，"去处理这条"就是它存在的理由。所以这里在门户侧补一件，而不是改 DS。
 *
 * **为什么是拉伸链接，不是把 `PanelItem` 包进 `<Link>`。** `PanelItem` 的
 * `first:pt-none last:pb-none` 认的是「我是 `PanelList` 的第一个/最后一个孩子」；
 * 外面包一层，选择器就落到包装元素上，首尾两项会多出一截内边距。所以 `<Link>` 留
 * 在 `main` 槽里，用 `::after` 铺满整项取得整行热区——`PanelItem` 仍是 `PanelList`
 * 的直接孩子，分隔虚线与首尾裁剪都还归 DS 管。
 *
 * 语气色取 DS 的 `toneSurfaceClasses`，不自己配色：这一族的 muted/text/border 三件
 * 是配好的，单独挑一个前景色会在暗色主题下失配。
 */

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Icon,
  PanelItem,
  TableTitleCell,
  cn,
  toneSurfaceClasses,
} from "@vxture/design-system";
import type { IconName, StatusBadgeTone } from "@vxture/design-system";

interface PanelLinkItemProps {
  readonly href: string;
  readonly icon: IconName;
  /** 图标底色的语气。缺省 `brand`，与 `MetricCard` 同。 */
  readonly tone?: StatusBadgeTone;
  readonly title: ReactNode;
  readonly description?: ReactNode;
}

export function PanelLinkItem({
  href,
  icon,
  tone = "brand",
  title,
  description,
}: PanelLinkItemProps) {
  return (
    <PanelItem
      className="relative rounded-md transition-colors hover:bg-primary-muted/40"
      lead={
        <span
          aria-hidden="true"
          className={cn(
            /* 跟 `PanelItem` 的 lead 槽同一条尺度（`w-control-md`），而不是写死
               `size-icon-xl` 那 2rem：`--space-control-md` 是**密度变量**，紧凑档
               只有 1.75rem，写死的图标片会顶出槽去。 */
            "inline-grid size-control-md place-items-center rounded-full border",
            toneSurfaceClasses[tone],
          )}
        >
          <Icon name={icon} size="sm" fallback="placeholder" />
        </span>
      }
      main={
        <Link
          href={href}
          className="no-underline after:absolute after:inset-0 after:content-['']"
        >
          <TableTitleCell
            title={title}
            {...(description ? { description } : {})}
          />
        </Link>
      }
      trail={
        <Icon
          name="arrow-right"
          size="xs"
          fallback="placeholder"
          className="text-muted-foreground"
        />
      }
    />
  );
}
