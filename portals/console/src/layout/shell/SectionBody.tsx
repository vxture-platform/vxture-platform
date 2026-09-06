/**
 * SectionBody — 板块正文的缩进骨架:正文**与板块标题的文字对齐**。
 * @package @vxture/console
 * @layer Presentation
 * @category Layout
 *
 * `PageSection`(DS `Section`)的标题行是「icon(icon-lg)+ gap-lg + 标题文字」。正文
 * 若直接顶头排,它的左缘落在 **icon** 那条竖线上,读起来像与标题并列的另一块内容,
 * 而不是标题底下的东西(owner 2026-09-06:「内容需要缩进,文字与标题文字对齐,
 * 明确内容隶属关系」;2026-09-06 早些时候在企业认证页说过同一条)。
 *
 * 所以正文照标题行同一骨架留一个 icon 宽的占位,左缘就落在标题文字那条竖线上。
 *
 * **不是每种正文都该套**:表格自带边框与表头,是一个独立的面,顶头排才对齐得上
 * 页面其它表;要缩进的是说明、字段行这类「跟着标题读」的内容。
 *
 * 账号页的 `CardRows` 是同一骨架的更早一份(卡片正文的字段行),现在从这里取,
 * 一份实现两个用法。
 */

import type { ReactNode } from "react";

export function SectionBody({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex gap-lg">
      <span aria-hidden="true" className="w-icon-lg shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-md">{children}</div>
    </div>
  );
}
