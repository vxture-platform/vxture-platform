"use client";

/**
 * PlanCompareTable — /pricing 分组功能对比表。
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * DS DataTable 渲染：首列功能名（分组行渲染分组标题），其余每档一列，
 * 推荐列整列淡色高亮（底色画在内容上——DataTable 无列级 className 口子）。
 */

import { DataTable, Icon } from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import type { ComparisonRow, PricingModel } from "./pricing-model";

/** 推荐档位在对比表中的整列淡色高亮。 */
const HIGHLIGHT_COL = "bg-vx-brand-50/50 dark:bg-vx-brand-950/25";

/** 对比表行模型：分组标题行 + 功能行，扁平化后交给 DS DataTable 渲染。 */
type CompareTableRow =
  | { kind: "group"; title: string }
  | ({ kind: "feature" } & ComparisonRow);

function buildCompareColumns(
  model: PricingModel,
  featureHeader: string,
): DataTableColumn<CompareTableRow>[] {
  return [
    {
      id: "feature",
      /* 宽度落在内容上而不是列上：`block w-56` 让这一列的内容撑出固定宽度。 */
      header: (
        <span className="block w-56 text-xs uppercase tracking-wide text-vx-gray-500 dark:text-vx-gray-400">
          {featureHeader}
        </span>
      ),
      cell: (row) =>
        row.kind === "group" ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-vx-brand-600 dark:text-vx-brand-300">
            {row.title}
          </span>
        ) : (
          <span className="text-vx-gray-700 dark:text-vx-gray-200">
            {row.label}
          </span>
        ),
    },
    ...model.plans.map(
      (plan, planIndex): DataTableColumn<CompareTableRow> => ({
        id: plan.tier,
        align: "center",
        /* 推荐列的底色画在**内容**上（headerClassName/cellClassName 已随
         * DataTable 收窄移除，画在列上会静默失效，见 2026-08-05 排查 #24）。 */
        header: (
          <span
            className={
              plan.highlight
                ? `block ${HIGHLIGHT_COL} font-bold text-vx-brand-600 dark:text-vx-brand-300`
                : "block text-vx-gray-900 dark:text-vx-white"
            }
          >
            {plan.name}
          </span>
        ),
        cell: (row) =>
          row.kind === "group" ? null : (
            <span
              className={plan.highlight ? `block ${HIGHLIGHT_COL}` : undefined}
            >
              <ComparisonCell value={row.values[planIndex] ?? false} />
            </span>
          ),
      }),
    ),
  ];
}

function ComparisonCell({ value }: { value: string | boolean }) {
  if (value === true) {
    return (
      <Icon
        name="check"
        className="mx-auto h-4 w-4 text-vx-brand-500"
        aria-hidden
      />
    );
  }
  if (value === false) {
    return <span className="text-vx-gray-300 dark:text-vx-gray-600">—</span>;
  }
  return (
    <span className="font-medium text-vx-gray-700 dark:text-vx-gray-200">
      {value}
    </span>
  );
}

export function PlanCompareTable({
  model,
  featureHeader,
}: {
  model: PricingModel;
  featureHeader: string;
}) {
  return (
    <DataTable<CompareTableRow>
      className="vx-data-table--banded mt-10 shadow-none"
      columns={buildCompareColumns(model, featureHeader)}
      rows={model.comparison.groups.flatMap((group) => [
        { kind: "group" as const, title: group.title },
        ...group.rows.map((row) => ({ kind: "feature" as const, ...row })),
      ])}
      rowKey={(row) =>
        row.kind === "group" ? `group:${row.title}` : row.label
      }
    />
  );
}
