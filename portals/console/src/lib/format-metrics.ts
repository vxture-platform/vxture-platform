/**
 * format-metrics.ts — 计量数值的展示格式化(配额 / 用量 / 加油包 / 租户面板共用;非样式)。
 * @package @vxture/console
 * @layer Application
 * @category Lib
 *
 * 批 3:此前 formatBytes 有两份(QuotasPage 导出一份、TenantPanel 自带一份),
 * AddonPacksSection 还反向 import 页面模块(循环依赖,审计 X4);收成一份放 lib。
 */

/** 二进制字节格式化(200 MiB 底池等额度都是 2 的幂,用 1024 进位)。 */
export function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return "0 B";
  const neg = value < 0 ? "-" : "";
  let v = Math.abs(value);
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return `${neg}${v.toFixed(digits)} ${units[i]}`;
}

/** 计数(千分位;非有限值画 0)。 */
export const fmtCount = (v: number): string =>
  Number.isFinite(v) ? v.toLocaleString("en-US") : "0";
