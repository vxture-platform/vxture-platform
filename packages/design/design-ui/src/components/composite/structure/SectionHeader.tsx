/**
 * SectionHeader.tsx - 二级及以下的标题区。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 层级由 `level` 给出，同时决定语义元素与排版角色，两者不会各说各话。
 * 整页的标题阶梯（owner 定稿 2026-08-02）：ViewHeader 是页头（20px / icon 48），
 * 其后的板块层级由本件承担，icon 与字级逐级递减、语法同构（icon+标题+描述+可选操作）：
 *
 *   level 1 → <h1> + title-lg (18px) + icon 32   大板块
 *   level 2 → <h2> + title-md (16px) + icon 24   二级板块，默认带虚线下边框
 *   level 3 → <h3> + title-sm (14px) + icon 20   板块内的分组
 *   level 4 → <h4> + label-md (14px medium) + icon 16   分组内的小节
 *
 * 展示体 heading 族退出工作界面的标题阶——它是营销页的字体。
 * 板块标题（level 2）默认带虚线下边框，这是 admin 的板块开始记号（V4：虚线分
 * 字段、实线开区块——标题属于"字段级"分隔，界的是标题与正文，不是区块与区块）。
 *
 * **四档全开，包括 level 1。** 本件的职责到"每一档长什么样"为止——排版角色、语义
 * 元素、两者的对应关系。放几个、放在哪属于信息结构，不在这里的题目里。
 *
 * 与 `ViewHeader` 的分工：`ViewHeader` 是 view 顶部那个完整区域（眉标、图标底板、
 * 描述、标题旁附加物、右侧动作区），`SectionHeader` 是纯粹的标题阶梯。要那套完整
 * 结构用前者，只要一行标题用后者。
 *
 * 相对原实现（DetailSectionHeading）的三处收窄：
 * - **`icon` 改为可选**。原来是必填，导致没有合适图标的板块只能硬塞一个。
 * - **增 `description` 与 `action`**，让它能直接充当 `Section` 的头部，两处不再
 *   各写一套标题排版——原先 PageSection 自己渲染 h2，与本件的 h2 样式并不一致。
 * - **删掉 `iconClassName` / `copyClassName` 两个逃生口**，理由同 ViewHeader：
 *   逃生口会把内部 DOM 变成公开契约。
 */

import * as React from "react";
import { Icon } from "../../../icons";
import type { IconName, IconSize } from "../../../icons";
import { hairline } from "../../../styles/recipes";
import { cn } from "../../../utils/cn";

export type SectionHeaderLevel = 1 | 2 | 3 | 4;

export interface SectionHeaderProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  readonly title: React.ReactNode;
  /**
   * 标题行内、紧跟标题的挂件：口径说明的 `?`、跳去图表的小图标一类。
   *
   * 与 `action` 分工：`action` 靠右、是这个板块的动作；本槽贴着标题、是标题的
   * 一部分——admin 总览的四个面板头里，"详情"在右端而 `?` 紧贴标题，分属两处
   * （2026-08-05）。同 `TableTitleCell.titleSuffix` 的先例。
   */
  readonly titleSuffix?: React.ReactNode;
  /** 1–4，同时决定语义元素与排版角色。 */
  readonly level?: SectionHeaderLevel;
  readonly description?: React.ReactNode;
  /** 板块级动作，通常是一个 ghost / outline 按钮。 */
  readonly action?: React.ReactNode;
  readonly icon?: IconName;
  readonly iconSize?: IconSize | number;
  readonly iconFallback?: IconName;
  /** 虚线下边框。缺省时 level 2 有、其余没有——板块开始的记号只属于板块标题。 */
  readonly divider?: boolean;
}

/* icon 档随层级走（32/24/20/16），与字级同向递减；20px/48 那一档属 ViewHeader。 */
const BY_LEVEL = {
  1: { tag: "h1", type: "text-title-lg", iconSize: "xl" },
  2: { tag: "h2", type: "text-title-md", iconSize: "lg" },
  3: { tag: "h3", type: "text-title-sm", iconSize: "md" },
  4: { tag: "h4", type: "text-label-md", iconSize: "sm" },
} as const;

function SectionHeader({
  className,
  title,
  titleSuffix,
  level = 2,
  description,
  action,
  icon,
  iconSize,
  iconFallback = "placeholder",
  divider,
  ...props
}: SectionHeaderProps) {
  const { tag: Tag, type, iconSize: levelIconSize } = BY_LEVEL[level];
  const withDivider = divider ?? level === 2;

  return (
    <div
      className={cn(
        "flex items-start gap-lg",
        withDivider && ["border-b pb-md", hairline.field],
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="mt-2xs shrink-0 text-primary-text" aria-hidden="true">
          <Icon
            name={icon}
            size={iconSize ?? levelIconSize}
            fallback={iconFallback}
          />
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2xs">
        {titleSuffix ? (
          <span className="flex min-w-0 items-center gap-xs">
            <Tag className={cn(type, "min-w-0 text-foreground")}>{title}</Tag>
            <span className="shrink-0">{titleSuffix}</span>
          </span>
        ) : (
          <Tag className={cn(type, "text-foreground")}>{title}</Tag>
        )}
        {description ? (
          <p className="text-body-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? (
        /* self-end：与标题块下沿对齐，不跟标题首行齐平。 */
        <div className="flex shrink-0 items-center gap-sm self-end">
          {action}
        </div>
      ) : null}
    </div>
  );
}

export { SectionHeader };
