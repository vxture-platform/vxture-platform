"use client";

/**
 * RowActionsPlaceholder.tsx — 没有行动作的表格，操作列的占位（owner 2026-09-07）。
 * @package @vxture/console
 * @layer Presentation
 * @category Component
 *
 * 规范要求**每张表都有操作列**，哪怕当前一个动作也没有：
 *
 * - **列对齐**。操作列是钉在最右的固定 64px 列。一页上有的表有、有的没有，右缘就
 *   参差不齐；补上占位，整页的表右缘落在同一条线上（与首格槽补 `leadingSpacer`
 *   是同一个道理，一个管左缘一个管右缘）。
 * - **「或许哪天就有操作了」**（owner 原话）。位置先占住，将来加动作时改的是这一格的
 *   内容，不是整张表的列结构——后者会让所有列宽重新分配、页面观感整体变一次。
 *
 * 用 `ActionMenu` 的整体 `disabled` 而不是渲染一个空菜单：件的注释写得很清楚，
 * 「逐项禁用仍然可以打开菜单看见有哪些动作，整体禁用连打开都不给」。这里是后者
 * ——现在**什么都做不了**，不该让人点开一个空菜单再自己得出这个结论。
 *
 * 有真动作时不要用本件：直接给 `ActionMenu` 传 items。
 */

import { ActionMenu } from "@vxture/design-system";
import { useTranslations } from "next-intl";

export function RowActionsPlaceholder() {
  const t = useTranslations("table");
  return <ActionMenu label={t("rowActions")} items={[]} disabled />;
}
