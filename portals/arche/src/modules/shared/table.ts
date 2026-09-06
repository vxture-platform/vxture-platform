"use client";

/* table.ts — 表格内建文案的出口,与本门户的 `destructive.ts` 同一模式。
 *
 * DS `DataTable` 有四处自带文案:行操作列的**可见表头**,以及展开列 / 全选 /
 * 行选三处读屏名。内建托底是英文("Actions" / "Select all rows on this page" /
 * …),而且那是**有意的**——DS 零语言假设,托底只为漏传时仍可读,不是让人依赖它。
 * 英文托底出现在中文界面上,说明有人忘了传。
 *
 * 于是收成一处:每张表 `labels={useTableLabels()}`,文案走 `t("table.*")` 与全站
 * 同一本词典,不在调用点各写各的(console 2026-09-06 先落,本门户随后横扫)。
 */

import { useTranslations } from "next-intl";

/** DS DataTable 的四处内建文案,一次给全。 */
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
