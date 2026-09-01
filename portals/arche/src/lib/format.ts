/**
 * format.ts — 通用格式化 helper(从 admin 的 tenant-utils 抽出的通用子集)。
 * @package @vxture/arche
 * @layer Utility
 *
 * admin 的 `modules/tenants/tenant-utils.ts` 大半是租户专有(statusLabel /
 * verifiedLabel / subscriptionCycleLabel …,属 tenant-ops 留在 admin);这里只抽
 * 与业务域无关的格式化件供治理台各页复用,不整文件搬。
 */

export function joinClasses(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

/* 收 `locale` 而不是写死 "zh-CN":日期的字段顺序属于语言——中文 2026/08/18、
   英文 08/18/2026。同一串数字,读出来是两个日期。 */
export function formatDateTime(value: string | null, locale: string): string {
  if (!value) return "未设置";
  return new Date(value).toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
