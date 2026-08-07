/**
 * PanelCard.tsx - 带头部的面板卡：一个标题 + 一块自带内容。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 与 `Section` 的分工：`Section` 是页面里的一段（默认不托起，靠留白与标题分层），
 * 本件是**一张卡**——它与同排的兄弟并列，边界必须画出来，否则三张并排的面板会连成
 * 一片。所以它有描边、有语气顶缘；`Section` 的 `raised` 档只有描边与底色，没有语气。
 *
 * 与 `MetricCard` / `StatCard` 的分工：那两件的内容是固定的（一个读数），本件的内容
 * 是任意的——排行行、读数行、一小段列表。头部固定，内容交给调用方。
 *
 * 头部**复用 `SectionHeader`（level 3）**，不自己再渲染一遍 h3：admin 总览里四个面板
 * （经营指标 / 产品排行 / 模型分类 / 服务分块）各写了一份结构相同的头部，字重从 760
 * 到 780 各写各的，四份 CSS 说的是同一件事（2026-08-05 盘点）。
 *
 * 内容与头部之间的虚线来自 `SectionHeader` 的 `divider`——虚线分字段、实线开区块
 * （V4），标题与正文之间界的是字段级。
 *
 * 语气只染顶缘 2px，不染底：一排面板靠顶缘色条区分归属，底色染满会盖过内容本身，
 * 与 `MetricCard` 同一判断。**标题不染**——admin 的四个面板头把 h3 也染成语气色，
 * 但标题是深色的（owner 2026-08-05 定：主标题深色，不走彩色链接模式），语气交给
 * 顶缘那一条就够。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import type { IconName } from "../../../icons";
import { Card, CardContent } from "../../base/display/Card";
import type { StatusBadgeTone } from "../../base/display/StatusBadge";
import { toneEdgeClasses } from "../../tone";
import { SectionHeader } from "./SectionHeader";

export interface PanelCardProps {
  readonly title: React.ReactNode;
  /** 标题行内的挂件：口径说明的 `?`、跳去图表的图标一类。 */
  readonly titleSuffix?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly icon?: IconName;
  /** 头部右端的板块动作，通常是一个"详情"链接。 */
  readonly action?: React.ReactNode;
  /** 整块的语气，只染顶缘色条。默认 `brand`，与 `MetricCard` 同。 */
  readonly tone?: StatusBadgeTone;
  readonly children: React.ReactNode;
  readonly className?: string;
}

function PanelCard({
  title,
  titleSuffix,
  description,
  icon,
  action,
  tone = "brand",
  children,
  className,
}: PanelCardProps) {
  return (
    <Card
      className={cn(
        "gap-md border-t-medium",
        toneEdgeClasses[tone],
        // 顶缘之外的三边回到常规发丝线：toneEdgeClasses 只给顶边与前景色。
        className,
      )}
    >
      <CardContent>
        <SectionHeader
          level={3}
          title={title}
          {...(titleSuffix !== undefined ? { titleSuffix } : {})}
          {...(description !== undefined ? { description } : {})}
          {...(icon !== undefined ? { icon } : {})}
          {...(action !== undefined ? { action } : {})}
          divider
        />
      </CardContent>
      <CardContent className="flex min-w-0 flex-col">{children}</CardContent>
    </Card>
  );
}

export { PanelCard };
