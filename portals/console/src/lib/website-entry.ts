/**
 * website-entry.ts — console → website 营销站外链。
 * @package @vxture/console
 * @layer Infrastructure
 *
 * 与 website 的 console-entry（反向）同族。基址取构建期
 * NEXT_PUBLIC_WEBSITE_URL（Dockerfile.nextjs 已透传，compose 注入），
 * 本地/缺省回退生产域名——外链坏链的代价远低于空链接。
 */

const WEBSITE_BASE_URL = (
  process.env.NEXT_PUBLIC_WEBSITE_URL ?? "https://www.vxture.com"
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
