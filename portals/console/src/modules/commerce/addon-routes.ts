/**
 * Shared add-on discovery and payment routes.
 * @package @vxture/console
 * @layer Presentation
 * @category utils
 */

/** Purchase catalog anchor on the quota page. */
export const ADDON_SECTION_ID = "quota-addons";

/** Resource purchases belong beside quota balances; payment stays in billing. */
export const ADDON_SECTION_HREF = `/quotas#${ADDON_SECTION_ID}`;

/** 加油包订单的支付页地址。 */
export function buildAddonPayHref(orderNo: string): string {
  return `/billing/addon-pay/${orderNo}`;
}
