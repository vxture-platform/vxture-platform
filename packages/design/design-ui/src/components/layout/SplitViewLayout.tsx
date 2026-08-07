/**
 * SplitViewLayout.tsx - 左导航 + 右内容的 view 骨架。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 原名 SettingsSplitPage。改名不只是去掉产品词：`Settings` 是**场景**，而这件
 * 组件表达的是**形状**——同一个形状在账户、租户、通知偏好等处都成立，绑死在
 * 设置上会让下一个同形状的页面重写一遍。
 *
 * 窄屏塌成单列：导航在上、内容在下。分栏在小屏上把两边都挤到不可用，是这类
 * 布局最常见的失败方式。
 */

import * as React from "react";
import { ViewLayout } from "./ViewLayout";

export interface SplitViewLayoutProps {
  /** 通常是 ViewHeader。 */
  readonly header?: React.ReactNode;
  /** 通常是 SectionNav。 */
  readonly navigation: React.ReactNode;
  readonly content: React.ReactNode;
  readonly className?: string;
}

export function SplitViewLayout({
  header,
  navigation,
  content,
  className,
}: SplitViewLayoutProps) {
  return (
    <ViewLayout className={className}>
      {header}
      <div className="flex flex-col gap-lg md:flex-row md:items-start">
        {/* w-64 是裸值：T2 没有侧栏宽度刻度，container-* 是页面与正文宽度。
            与预览面同一个缺口，记在 workplans 未决表。 */}
        <aside className="w-full shrink-0 md:w-64">{navigation}</aside>
        <div className="min-w-0 flex-1">{content}</div>
      </div>
    </ViewLayout>
  );
}
