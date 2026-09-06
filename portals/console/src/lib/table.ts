"use client";

/* table.ts — 表格内建文案的出口(console),与 `lib/destructive.ts` 同一模式。
 *
 * DS `DataTable` 有四处自带文案:行操作列的**可见表头**,以及展开列 / 全选 /
 * 行选三处读屏名。它们的内建托底是英文("Actions" / "Select all rows on this
 * page" / …),而且那是**有意的**——DS 零语言假设,托底只为漏传时仍可读,不是让
 * 人依赖它。英文托底出现在中文界面上,说明有人忘了传(与 ConfirmDestructive
 * 一模一样的坑,那份的注释里已经写过一遍)。
 *
 * 于是收成一处:每张表 `labels={useTableLabels()}`,文案走 `t("table.*")` 与全站
 * 同一本词典,不在调用点各写各的。此前 console 的 14 张表一张都没传,行操作列
 * 表头在中文界面上全是「Actions」(owner 2026-09-06 在企业认证页看见)。
 */

import { useTranslations } from "next-intl";

/**
 * DS DataTable 的四处内建文案,一次给全。
 *
 * 返回类型交给推断:`DataTableLabels` 长在 `@vxture/design-ui` 上,design-system
 * 只再导出了值、没再导出这个类型,而门户只依赖 design-system(不该越过伞包直连
 * 内层包)。结构一致即可赋给 `labels`。
 */
export function useTableLabels() {
  const t = useTranslations("table");
  return {
    rowActions: t("rowActions"),
    expand: t("expand"),
    selectAll: t("selectAll"),
    deselectAll: t("deselectAll"),
    selectRow: t("selectRow"),
  };
}
