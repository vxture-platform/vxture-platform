/**
 * exportCsv.ts — 客户端 CSV 导出工具(列表批量导出)。
 * @package @vxture/arche
 * @layer Utility
 *
 * 把行按列映射为 CSV(RFC-4180 转义)并触发浏览器下载。含 UTF-8 BOM 保证
 * Excel 正确识别中文。仅在 "use client" 组件中调用(依赖 Blob/URL/document)。
 */

export interface CsvColumn<T> {
  /** 表头文案 */
  readonly label: string;
  /** 从行提取单元格值 */
  readonly value: (row: T) => string | number | null | undefined;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  // 含逗号/引号/换行时用引号包裹并转义内部引号(RFC-4180)。
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * 把 rows 按 columns 导出为 CSV 并下载。
 * @param filename 文件名(自动补 .csv)
 * @param columns 列定义(表头 + 取值)
 * @param rows 要导出的行
 */
export function exportRowsToCsv<T>(
  filename: string,
  columns: readonly CsvColumn<T>[],
  rows: readonly T[],
): void {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(",");
  const body = rows
    .map((row) => columns.map((c) => escapeCsvCell(c.value(row))).join(","))
    .join("\r\n");
  const csv = `﻿${header}\r\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
