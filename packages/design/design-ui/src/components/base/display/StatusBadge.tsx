/**
 * StatusBadge.tsx - 状态标。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 收录依据：产品扫描出现频次第二（console 11 / admin 39 处文件）。上游 shadcn
 * 只有 Badge，状态标是在它之上加"语气 + 可选圆点"的一层。
 *
 * 语气刻度见 `./tone`——与 `Banner` 共用一份。
 *
 * **三件一体：表意图标 + 语气底色 + 文字**（2026-08-05 owner 定）。图标缺省随
 * 语气取自 `toneIcons`，因此不必每处各配一张：成功=对勾、危险=叉、警告=感叹、
 * 中性/信息=信息符，五档都是**圆形**图标——圆形在一列状态标里外形一致，尺寸
 * 与视重不随语气跳动，方形/异形混排会让整列看起来忽大忽小。（`brand` 是唯一
 * 例外，它的图是 sparkles：那是"有新东西"的语气，本就不是一种状态；状态列
 * 真要用 brand，显式传一个圆形图标。）
 *
 * 三件里少哪一件都退化：只有底色 = 得靠记颜色；只有文字 = 一屏扫不出来；
 * 只有图标 = 同一张图在不同业务里含义不同。表格的业务语气全靠这一列表达
 * （行不染色，见 `DataTable` 文件头），所以这一列必须自己说清楚。
 *
 * `dot` 是**密集场景的降级**：一行里并排四五个标时圆点比图标省宽。给了 `dot`
 * 就不出图标，两个前导记号不叠。
 *
 * 原实现挂了 .vx-status-badge，且间距与圆点尺寸用的是不跟随三档的裸数值。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { Badge, type BadgeProps } from "./Badge";
import { Icon, type IconName } from "../../../icons";
import { toneIcons, toneSurfaceClasses, type Tone } from "../../tone";

export type StatusBadgeTone = Tone;

export interface StatusBadgeProps extends Omit<BadgeProps, "variant"> {
  readonly tone?: StatusBadgeTone;
  /**
   * 前导图标。缺省随语气（`toneIcons`）。传具体图标名可换——业务态比语气细时
   * 用得上（"停止中"是 warning 语气，但时钟比感叹号准）。`false` 关掉。
   */
  readonly icon?: IconName | false;
  /** 改用圆点而非图标：密集并排场景省宽。给了它就不出图标。 */
  readonly dot?: boolean;
}

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  function StatusBadge(
    { className, tone = "neutral", icon, dot = false, children, ...props },
    ref,
  ) {
    const iconName = dot ? false : (icon ?? toneIcons[tone]);
    return (
      <Badge
        ref={ref}
        variant="outline"
        className={cn(toneSurfaceClasses[tone], className)}
        {...props}
      >
        {dot ? (
          <span
            className="size-2xs rounded-full bg-current"
            aria-hidden="true"
          />
        ) : iconName ? (
          <Icon name={iconName} size="xs" aria-hidden="true" />
        ) : null}
        {children}
      </Badge>
    );
  },
);

StatusBadge.displayName = "StatusBadge";

export { StatusBadge };
