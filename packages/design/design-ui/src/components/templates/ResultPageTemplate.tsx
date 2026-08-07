/**
 * ResultPageTemplate.tsx - 结果 / 异常页骨架。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Template
 *
 * 提交成功、404、无权限这类"整页只说一件事"的页面。本质是 EmptyState 的
 * 整页形态——直接组合它，不重写：图标 / 标题 / 描述 / 动作的排版只有一个
 * 来源，结果页与列表空态长得不一样才是错。
 *
 * tone 走 tone.ts 的六档语气刻度，表达方式与 MetricCard 同一条判据：语义色
 * 只走顶缘 2px 色条（toneEdgeClasses + border-t-medium），永不填底——整页
 * 染色会把"发生了什么"盖成"到处都是红"。图标缺省随语气（toneIcons），
 * 同一语气在各处配不同的图就散了；调用方可显式换图。
 *
 * 垂直居中靠 `min-h-full`：占多高由外层容器决定（外壳给内容区多高，结果页
 * 就在多高里居中），模板不猜视口高度。窄屏无断点——单列居中的形状在任何
 * 宽度都成立，卡片吃满可用宽、封顶 max-w-content-narrow-lg。
 */

import * as React from "react";
import type { IconName } from "../../icons";
import { cn } from "../../utils/cn";
import { EmptyState } from "../base/display/EmptyState";
import { toneEdgeClasses, toneIcons, type Tone } from "../tone";

export interface ResultPageTemplateProps {
  /** 结果的语气：成功 success、出错 danger、提示 info…… */
  readonly tone?: Tone;
  /** 缺省随语气（toneIcons），显式传入可换。 */
  readonly icon?: IconName;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  /** 动作区：返回、重试一类的按钮。 */
  readonly actions?: React.ReactNode;
  readonly className?: string;
}

export function ResultPageTemplate({
  tone = "neutral",
  icon,
  title,
  description,
  actions,
  className,
}: ResultPageTemplateProps) {
  return (
    <div
      className={cn(
        "flex min-h-full w-full flex-col items-center justify-center p-xl",
        className,
      )}
    >
      <EmptyState
        className={cn(
          "w-full max-w-content-narrow-lg border-t-medium",
          toneEdgeClasses[tone],
        )}
        icon={icon ?? toneIcons[tone]}
        title={title}
        {...(description !== undefined ? { description } : {})}
        {...(actions !== undefined ? { action: actions } : {})}
      />
    </div>
  );
}
