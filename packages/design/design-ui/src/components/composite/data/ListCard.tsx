/**
 * ListCard.tsx - 清单页卡片视图的行卡：与 DataTable 行同一份信息的卡片形态。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * list/cards 切换是清单页工具行的常备段（owner 拍板 2026-08-03），卡片形态
 * 不能各页手拼。行卡的语法固定为：两行主列（左上）+ 状态与操作（右上）+
 * meta 行（底部补充事实）。与 EntryCard 分工：EntryCard 引路（导航去别处），
 * ListCard 是数据行本身的另一种画法。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { type IconName } from "../../../icons";
import { Card, CardContent } from "../../base/display/Card";
import { TableTitleCell } from "./TableTitleCell";

export interface ListCardProps {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly icon?: IconName;
  readonly onTitleClick?: () => void;
  /** 右上角：状态徽章一类的即时态。 */
  readonly status?: React.ReactNode;
  /** 行操作（通常是 ActionMenu），挨着 status 靠右。 */
  readonly actions?: React.ReactNode;
  /** 底部补充事实行：徽章、读数、时间等，自动弱化前景。 */
  readonly meta?: React.ReactNode;
  readonly className?: string;
}

function ListCard({
  title,
  description,
  icon,
  onTitleClick,
  status,
  actions,
  meta,
  className,
}: ListCardProps) {
  return (
    /* data-list-card：供"每页条数自适应"一类的行高测量当探针用。 */
    <Card surface="soft" data-list-card="" className={className}>
      <CardContent className="flex flex-col gap-sm">
        <div className="flex items-start justify-between gap-sm">
          <TableTitleCell
            title={title}
            {...(description !== undefined ? { description } : {})}
            {...(icon !== undefined ? { icon } : {})}
            {...(onTitleClick !== undefined ? { onTitleClick } : {})}
          />
          {status || actions ? (
            <span className="flex shrink-0 items-center gap-xs">
              {status}
              {actions}
            </span>
          ) : null}
        </div>
        {meta ? (
          <div className="flex flex-wrap items-center gap-sm text-body-sm text-muted-foreground">
            {meta}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** 行卡的排布：断点全站统一，各页不再自定义列数。 */
function ListCardGrid({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("grid gap-md sm:grid-cols-2 xl:grid-cols-3", className)}
      {...props}
    />
  );
}

export { ListCard, ListCardGrid };
