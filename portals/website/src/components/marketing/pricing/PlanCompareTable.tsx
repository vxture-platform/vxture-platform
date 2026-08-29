"use client";

/**
 * PlanCompareTable — /pricing 分组功能对比表。
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * DS DataTable 渲染：首列功能名（分组行渲染分组标题），其余每档一列，
 * 当前选中档整列淡色高亮（底色画在内容上——DataTable 无列级 className 口子）。
 *
 * 2026-08-30 起行来自阶梯真数据（配额键 ∪ 功能键，见 pricing-model
 * buildComparison），两组：配额 / 功能。高亮列从「推荐档」改为「选中档」——
 * 推荐标记没有数据支撑已删，而选中态是用户自己点出来的。
 */

import { useLocale, useTranslations } from "next-intl";
import { formatNumber, type Locale } from "@vxture-platform/shared";
import { DataTable, Icon } from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import { usePlanLabels } from "./plan-labels";
import {
  formatBytes,
  type CompareCell,
  type ComparisonGroupId,
  type PricingModel,
} from "./pricing-model";

/** 选中档位在对比表中的整列淡色高亮。 */
const HIGHLIGHT_COL = "bg-vx-brand-50/50 dark:bg-vx-brand-950/25";

/** 对比表行模型：分组标题行 + 功能行，扁平化后交给 DS DataTable 渲染。 */
type CompareTableRow =
  | { kind: "group"; id: ComparisonGroupId; title: string }
  | {
      kind: "feature";
      groupId: ComparisonGroupId;
      key: string;
      label: string;
      cells: CompareCell[];
    };

export function PlanCompareTable({
  model,
  selectedTier,
}: {
  model: PricingModel;
  selectedTier: string | null;
}) {
  const t = useTranslations("products.subscription");
  const labels = usePlanLabels();
  const locale = useLocale() as Locale;

  const renderCell = (key: string, cell: CompareCell) => {
    switch (cell.kind) {
      case "yes":
        return (
          <Icon
            name="check"
            className="mx-auto h-4 w-4 text-vx-brand-500"
            aria-hidden
          />
        );
      case "no":
        return (
          <span className="text-vx-gray-300 dark:text-vx-gray-600">—</span>
        );
      case "unlimited":
        return (
          <span className="font-medium text-vx-gray-700 dark:text-vx-gray-200">
            {t("unlimited")}
          </span>
        );
      case "number":
        return (
          <span className="font-medium tabular-nums text-vx-gray-700 dark:text-vx-gray-200">
            {formatNumber(cell.value, locale)}
          </span>
        );
      case "bytes":
        return (
          <span className="font-medium tabular-nums text-vx-gray-700 dark:text-vx-gray-200">
            {formatBytes(cell.value)}
          </span>
        );
      case "text":
        return (
          <span className="font-medium text-vx-gray-700 dark:text-vx-gray-200">
            {labels.quotaValue(key, cell.value)}
          </span>
        );
    }
  };

  const columns: DataTableColumn<CompareTableRow>[] = [
    {
      id: "feature",
      /* 宽度落在内容上而不是列上：`block w-64` 让这一列的内容撑出固定宽度。 */
      /* 缩进层次：轮廓线占满容器宽，内容整体左收（pl-6）；
       * 分组标题一级缩进，功能行再深一级（pl-14），读出树状层次。 */
      header: (
        <span className="block w-64 pl-6 text-xs uppercase tracking-wide text-vx-gray-500 dark:text-vx-gray-400">
          {t("compare.feature")}
        </span>
      ),
      cell: (row) =>
        row.kind === "group" ? (
          <span className="block pl-6 text-xs font-semibold uppercase tracking-wide text-vx-brand-600 dark:text-vx-brand-300">
            {row.title}
          </span>
        ) : (
          <span className="block pl-14 text-vx-gray-700 dark:text-vx-gray-200">
            {row.label}
          </span>
        ),
    },
    ...model.plans.map((plan, planIndex): DataTableColumn<CompareTableRow> => {
      const highlighted = plan.tier === selectedTier;
      /* 尾列内容右收（pr-6），与首列 pl-6 对称，内容不顶容器边。 */
      const trailing = planIndex === model.plans.length - 1 ? " pr-6" : "";
      return {
        id: plan.tier,
        align: "center",
        /* 选中列的底色画在**内容**上（headerClassName/cellClassName 已随
         * DataTable 收窄移除，画在列上会静默失效，见 2026-08-05 排查 #24）。 */
        header: (
          <span
            className={
              (highlighted
                ? `block ${HIGHLIGHT_COL} font-bold text-vx-brand-600 dark:text-vx-brand-300`
                : "block text-vx-gray-900 dark:text-vx-white") + trailing
            }
          >
            {plan.name}
          </span>
        ),
        cell: (row) =>
          row.kind === "group" ? null : (
            <span
              className={
                (highlighted ? `block ${HIGHLIGHT_COL}` : "block") + trailing
              }
            >
              {renderCell(row.key, row.cells[planIndex] ?? { kind: "no" })}
            </span>
          ),
      };
    }),
  ];

  const rows: CompareTableRow[] = model.comparison.flatMap((group) => [
    {
      kind: "group" as const,
      id: group.id,
      title: t(`compare.groups.${group.id}`),
    },
    ...group.rows.map((row) => ({
      kind: "feature" as const,
      groupId: group.id,
      key: row.key,
      label:
        group.id === "quota" ? labels.quota(row.key) : labels.feature(row.key),
      cells: row.cells,
    })),
  ]);

  return (
    <DataTable<CompareTableRow>
      className="vx-data-table--banded mt-10 shadow-none"
      columns={columns}
      rows={rows}
      rowKey={(row) =>
        row.kind === "group" ? `group:${row.id}` : `${row.groupId}:${row.key}`
      }
    />
  );
}
