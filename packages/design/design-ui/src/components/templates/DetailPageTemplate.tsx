/**
 * DetailPageTemplate.tsx - 详情页骨架。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Template
 *
 * 页头 → 主列（children，由 Section / SectionHeader 阶梯自组）→ 可选右栏
 * 摘要（aside）。模板只给两列的排布与宽度，栏里放什么全是调用方的事——
 * 详情页"分几个板块、摘要列哪些字段"是信息结构，不在 DS 内定。
 *
 * 右栏宽度封在 `max-w-panel-sm`（28rem）：摘要栏放的是键值对与状态一类的
 * 短内容，给它 flex-1 会长出一整栏空白；主列 `min-w-0 flex-1`，不被右栏挤压。
 *
 * 窄屏（<lg）塌单列，**aside 落到主列之下**：详情主体是页面的主对象，摘要栏
 * 只是它关键字段的快照——塌到主列之上会把主体挤出首屏，读者先看到的是二手
 * 信息。与 SplitViewLayout 导航塌到上方不同：导航是入口，不先见就无路可走；
 * 摘要是冗余，后见无损。
 */

import * as React from "react";
import { ViewLayout } from "../layout/ViewLayout";

export interface DetailPageTemplateProps {
  /** 页头槽，通常是 ViewHeader。 */
  readonly header?: React.ReactNode;
  /** 主列内容，通常是若干 Section / SectionHeader 组成的阶梯。 */
  readonly children: React.ReactNode;
  /** 可选右栏摘要，宽屏固定 max-w-panel-sm，窄屏塌到主列之下。 */
  readonly aside?: React.ReactNode;
  readonly className?: string;
}

export function DetailPageTemplate({
  header,
  children,
  aside,
  className,
}: DetailPageTemplateProps) {
  return (
    <ViewLayout {...(className !== undefined ? { className } : {})}>
      {header}
      {aside ? (
        <div className="flex flex-col gap-lg lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-xl">{children}</div>
          <aside className="w-full lg:max-w-panel-sm lg:shrink-0">
            {aside}
          </aside>
        </div>
      ) : (
        // 没有右栏时 children 直接落进 ViewLayout 的 gap-xl 节奏，不多包一层。
        children
      )}
    </ViewLayout>
  );
}
