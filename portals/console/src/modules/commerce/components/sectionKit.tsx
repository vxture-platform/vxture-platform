/**
 * sectionKit.tsx — 订阅链路页面共用的板块标题与「内部信息行」规格。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 1) SectionTitle：DS SectionHeader 的 icon 槽按「标题+描述」双行设计做了
 *    items-start + mt-2xs 的顶对齐——只有标题时 icon 与文字视觉错位
 *    （owner 2026-08-20 条 1）。不改 DS：把图标放进 title ReactNode 里自行
 *    items-center，弃用 Section 的 icon prop。
 * 2) 信息行规格（owner 条 2）：归属 / 套餐 / 周期三卡以及付款、完成页里的
 *    自组信息行统一为「icon 底板 | 文本区 | 右侧区」三段，同 padding /
 *    高度 / gap，数值以 WorkspacePicker 原基准为准：
 *    行 = px-md py-sm gap-md rounded-lg；icon 底板 = size-control-md（32px）
 *    内 icon sm（16px）；右侧区 = body-sm muted tabular-nums。
 * 3) SECTION_TIGHT：确认订单/付款/完成三页的板块纵向收一档
 *    （raised p-lg→p-md、标题与内容 gap-md→gap-sm），目标 1080p 一屏。
 */

import type { ReactNode } from "react";
import { Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";

/** 板块纵向收窄一档（配合 PageSection 的 className 合并，后者覆盖前者）。 */
export const SECTION_TIGHT = "gap-sm p-md";

/** 信息行外框：三段式一行，占满卡宽。 */
export const infoRow =
  "flex w-full items-center gap-md rounded-lg border border-border bg-card px-md py-sm";

/** 信息行 icon 底板（配色由调用点给：品牌淡底 / success 淡底…）。 */
export const infoRowGlyph =
  "flex size-control-md shrink-0 items-center justify-center rounded-lg";

/** 信息行文本区（主行 + 次行）。 */
export const infoRowText = "flex min-w-0 flex-1 flex-col text-left";

/** 信息行右侧信息区（日期 / 金额 / 编号）。 */
export const infoRowRight =
  "shrink-0 text-body-sm text-muted-foreground tabular-nums";

export interface SectionTitleProps {
  readonly icon: IconName;
  readonly children: ReactNode;
}

/** 二级板块标题：icon 与文字垂直居中（替代 Section 的 icon prop）。 */
export function SectionTitle({ icon, children }: SectionTitleProps) {
  return (
    <span className="flex min-w-0 items-center gap-md">
      <span className="shrink-0 text-primary-text" aria-hidden="true">
        <Icon name={icon} size="lg" />
      </span>
      <span className="truncate">{children}</span>
    </span>
  );
}
