"use client";

/**
 * CardRows — 卡片正文的缩进骨架:字段行的**名列与面头标题文字对齐**。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * SectionHeader 是「icon(icon-lg)+ gap-lg + 标题」;正文照同一骨架留一个 icon 宽的
 * 占位,行的字段名就落在标题文字那条竖线上(owner 2026-09-04:二级缩进不够、
 * 名与值间距过大)。名列随之从 media-3xl 收到 media-2xl,值列位置基本不动、名值间距
 * 收窄。RowExpand 的占位与此处的名列同宽。
 *
 * 骨架本身现在归 `layout/shell/SectionBody`——二级页的说明板块要的是同一件事
 * (owner 2026-09-06),一份实现两个用法。本文件只留卡片正文特有的两个名列宽度。
 */

export { SectionBody as CardRows } from "@/layout/shell";

/** 名列宽度(与 RowExpand 的占位同源)。 */
export const ROW_LABEL_WIDTH_CLASS = "sm:w-media-2xl";

/** 挂在 DetailList 上:把 DS 默认的 media-3xl 名列改成本页的 media-2xl。 */
export const DETAIL_LIST_CLASS = "sm:[&>div>dt]:w-media-2xl";
