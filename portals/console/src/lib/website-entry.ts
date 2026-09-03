/**
 * website-entry.ts — console → website 营销站外链。
 * @package @vxture/console
 * @layer Infrastructure
 *
 * 与 website 的 console-entry（反向）同族。基址取构建期 NEXT_PUBLIC_WEBSITE_URL，
 * 缺省回退生产域名——外链坏链的代价远低于空链接。
 *
 * 2026-09-03 owner 线上实测：产品详情 / 返回定价页全部落到 console.* 自己的路径 404。
 * 根因：Dockerfile.nextjs 声明了 ARG NEXT_PUBLIC_WEBSITE_URL，console 镜像未传该
 * build-arg 时 ENV 被烘成**空字符串**；空串不是 nullish，`??` 回退失效。这里改用
 * `||`（空串也回退），并与 next.config.js 的回退统一为 https://vxture.com（此前两处一个
 * 写 www 一个不写）。镜像侧同时在 scripts/workflows/images.mjs 给 console 补传该参数。
 */

const WEBSITE_BASE_URL = (
  process.env.NEXT_PUBLIC_WEBSITE_URL || "https://vxture.com"
).replace(/\/+$/, "");

/** 产品详情页：/{locale}/products/{productCode}。 */
export function buildWebsiteProductUrl(
  locale: string,
  productCode: string,
): string {
  return `${WEBSITE_BASE_URL}/${locale}/products/${encodeURIComponent(productCode)}`;
}

/** 产品市场（产品列表页）：/{locale}/products。 */
export function buildWebsiteProductsUrl(locale: string): string {
  return `${WEBSITE_BASE_URL}/${locale}/products`;
}

/** 退款说明（product_330 §5，官网统一维护，newtab）：/{locale}/legal/refund。 */
export function buildWebsiteRefundPolicyUrl(locale: string): string {
  return `${WEBSITE_BASE_URL}/${locale}/legal/refund`;
}

/** 定价 / 档位选择页：/{locale}/pricing?product={productCode}。「升级」从这里看清档位再下单。 */
export function buildWebsitePricingUrl(
  locale: string,
  productCode: string,
): string {
  return `${WEBSITE_BASE_URL}/${locale}/pricing?product=${encodeURIComponent(productCode)}`;
}
