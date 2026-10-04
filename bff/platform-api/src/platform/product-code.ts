/**
 * product-code.ts — the one definition of what a self-reported product code looks like.
 * @package  @vxture/bff-platform-api
 * @layer    Application
 * @category util
 * @description
 *   产品面的每条路由都收一个请求里**自报**的产品码（`product` / `products`），在它经目录
 *   校验（`resolveProductId`）之前就已经被当作 Redis field、日志字段、信号归因键在用。
 *   形状只在这里定一次：entitlements / usage / sharing 三份 view 原先各抄一份同样的
 *   正则，provisioning 的回执解析却一份都没抄——于是旧凭据计数（E6）在那条路上收到的
 *   是任意长度、可带换行的字符串。词表有一处就只有一处会漂。
 *
 * @author AI-Generated
 * @date 2026-10-04
 */

/** 小写字母开头，`[a-z0-9_-]`，总长 1–32（目录列 `product.products.product_code` 只有 UNIQUE，形状在这里定）。 */
export const PRODUCT_CODE_RE = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * Whether a string is a well-formed product code (shape only, not catalog membership).
 *
 * @param value - the self-reported code, already trimmed by the caller
 * @returns true when it matches PRODUCT_CODE_RE
 */
export function isProductCode(value: string): boolean {
  return PRODUCT_CODE_RE.test(value);
}
