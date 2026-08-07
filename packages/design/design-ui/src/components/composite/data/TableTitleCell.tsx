/**
 * TableTitleCell.tsx - 列表主列的两行单元格：主信息 + 辅助信息。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * admin 租户列表的行模式（owner 拍板保留，2026-08-03）：每行两层——主信息一行
 * （可点进详情），辅助信息一行（编码、区域一类的补充事实）。提炼成标准件后，
 * 各列表不再各写一遍 flex-col。
 *
 * 相对 admin 的修正（2026-08-05 owner 逐条实测 admin 现状后确认）：
 * - 主信息是**标题**，不是链接：`text-foreground` 深色，hover 才转品牌色。admin
 *   那边用 `Button variant="link"` 渲染，于是常态就是一整列蓝字——链接色是"可点"
 *   的信号，一列全蓝等于没信号，只剩刺眼。
 * - 主信息与辅助行**左缘齐平**：`Button` 自带 `px-md`，标题因此比它下面那行
 *   缩进 16px，两行读起来像不属于同一格。这里主信息不带横向内边距。
 * - 辅助行走 `text-body-sm` 常规字重——admin 用了 720+，与主信息几乎同重，
 *   抢了主信息的位置；层次由字号与前景色表达，不靠字重打架。
 * - 图标与主信息是**一体**：`gap-sm` 贴住标题（admin 的 16px 让图标看起来更靠近
 *   左边的序号列而不是它要标注的标题）。左侧留白归容器——`DataTable` 的业务列
 *   自带 `px-md`。
 *
 * 图标带 `fallback="placeholder"`：这里的图标名多半由业务数据映射而来，取不到
 * 时要出占位而不是留一个塌掉的空位。
 *
 * 两行的行高钉死（主 `control-2xs` = 20px、辅 `control-3xs` = 16px、行距
 * `gap-2xs` = 4px），不随内容撑：一行数据要能横向连读——本件的主信息得跟同行
 * 其他列的主信息齐平，辅助信息跟辅助信息齐平。主行的 20px 取自 `Badge` 的高度，
 * 所以标题后挂 `titleSuffix` 时这一行也不会比别的格高出一截。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { interactive } from "../../../styles/recipes";
import { Icon, type IconName } from "../../../icons";

export interface TableTitleCellProps {
  readonly title: React.ReactNode;
  /**
   * 紧跟主信息之后的同行内容：多为一两个标（"系统"、"默认"）。它标的是主信息
   * 本身的性质，所以必须与主信息同行——挪到辅助行就变成了另一条事实。
   * 换行时整体下沉，不切断主信息。
   */
  readonly titleSuffix?: React.ReactNode;
  /** 辅助信息行：编码、区域、时间一类的补充事实。 */
  readonly description?: React.ReactNode;
  readonly icon?: IconName;
  /** 给了主信息就渲染成可点的标题（进详情），不给就是纯文本。 */
  readonly onTitleClick?: () => void;
  /**
   * 原生 `title`：主信息与辅助行都会截断，完整内容得有地方看。只收纯文本——
   * 需要富内容的提示走 `Tooltip`，那是另一件。
   */
  readonly tooltip?: string;
  readonly className?: string;
}

function TableTitleCell({
  title,
  titleSuffix,
  description,
  icon,
  onTitleClick,
  tooltip,
  className,
}: TableTitleCellProps) {
  return (
    <span
      className={cn("flex min-w-0 items-center gap-sm", className)}
      {...(tooltip ? { title: tooltip } : {})}
    >
      {icon ? (
        <Icon
          name={icon}
          size="sm"
          fallback="placeholder"
          aria-hidden="true"
          className="shrink-0 text-muted-foreground"
        />
      ) : null}
      <span className="flex min-w-0 flex-col gap-2xs">
        <span className="flex min-h-control-2xs min-w-0 flex-wrap items-center gap-xs">
          {onTitleClick ? (
            <button
              type="button"
              onClick={onTitleClick}
              className={cn(
                "min-w-0 truncate rounded-sm text-label-md text-foreground",
                interactive,
                "hover:text-primary-text hover:underline",
              )}
            >
              {title}
            </button>
          ) : (
            <span className="min-w-0 truncate text-label-md text-foreground">
              {title}
            </span>
          )}
          {titleSuffix}
        </span>
        {description ? (
          <span className="flex min-h-control-3xs items-center truncate text-body-sm text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export { TableTitleCell };
