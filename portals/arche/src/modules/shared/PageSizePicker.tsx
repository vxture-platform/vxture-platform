/**
 * PageSizePicker.tsx - 管理后台分页尺寸选择器。
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Shared
 *
 * DS 的 `PageSizePicker` 在分类重构（22ca6ccc）里并进了 `SegmentedControl`
 * ——它与"列表/卡片"切换形状完全相同（一串按钮、一个选中），只是一个装数字
 * 一个装图标，合成一件后选项退回调用方。本文件就是 admin 那一行选项。
 *
 * 原先的 `activeVariant` / `inactiveVariant` / `optionAriaLabel` 三个口子随
 * 那次合并消失：选中态现在由 SegmentedControl 自己画（托起的底色片），不再
 * 由调用方各挑一个按钮变体——那正是同一个控件在不同页面长得不一样的来源。
 */

import { SegmentedControl } from "@vxture/design-system";

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export interface PageSizePickerProps {
  readonly value: PageSize;
  readonly onChange: (value: PageSize) => void;
  readonly className?: string;
}

const ITEMS = PAGE_SIZE_OPTIONS.map((size) => ({
  value: size,
  label: String(size),
  ariaLabel: `每页 ${size} 条`,
}));

export function PageSizePicker({
  value,
  onChange,
  className,
}: PageSizePickerProps) {
  return (
    <SegmentedControl<PageSize>
      items={ITEMS}
      value={value}
      onChange={onChange}
      ariaLabel="每页条数"
      {...(className ? { className } : {})}
    />
  );
}
