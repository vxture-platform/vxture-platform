/**
 * order-format.ts — 订单模块的金额写法。
 *
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Orders
 *
 * 2026-09-27 订单详情页重构前，同一个金额在本模块有四种写法（`Intl.NumberFormat`
 * 各自 new 一遍、小数位 0/2 不一）。这里收成一处：人民币走 `tenant-utils.formatMoney`
 * （全 admin 同一份），其它币种不套人民币格式，数字 + 币种码。
 */

import { formatMoney, formatNumber } from "@/modules/tenants/tenant-utils";

export function formatOrderAmount(value: number, currency: string | null) {
  if (!currency || currency === "CNY") return formatMoney(value);
  return `${formatNumber(value)} ${currency}`;
}
