/**
 * DashboardTemplate.tsx - 工作台骨架。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Template
 *
 * 页头 → 指标区（metrics，放 MetricGrid）→ 入口区（entries，放 EntryCard
 * 栅格）→ 其余板块（children）。工作台的阅读顺序是固定的：先看数、再选路、
 * 最后处理具体事项——模板把这个顺序焊死，摆什么数、开什么入口是产品的事。
 *
 * 四段之间统一走 ViewLayout 的 `gap-xl` 板块节奏，模板不再加自己的间距——
 * 槽位为空时（比如没有入口区）对应板块连同间距一起消失，不留空行。
 *
 * 响应式：本件不设断点。指标栅格降列由 MetricGrid 自带（窄屏单列、中屏两列、
 * 宽屏按 columns），入口卡栅格由调用方的 Grid / grid-cols 自己声明——模板
 * 替它们定断点只会和各自的规则打架。
 */

import * as React from "react";
import { ViewLayout } from "../layout/ViewLayout";

export interface DashboardTemplateProps {
  /** 页头槽，通常是 ViewHeader。 */
  readonly header?: React.ReactNode;
  /** 指标区槽，通常是 MetricGrid。 */
  readonly metrics?: React.ReactNode;
  /** 入口区槽，通常是一组 EntryCard 的栅格。 */
  readonly entries?: React.ReactNode;
  /** 其余板块，通常是若干 Section。 */
  readonly children?: React.ReactNode;
  readonly className?: string;
}

export function DashboardTemplate({
  header,
  metrics,
  entries,
  children,
  className,
}: DashboardTemplateProps) {
  return (
    <ViewLayout {...(className !== undefined ? { className } : {})}>
      {header}
      {metrics}
      {entries}
      {children}
    </ViewLayout>
  );
}
