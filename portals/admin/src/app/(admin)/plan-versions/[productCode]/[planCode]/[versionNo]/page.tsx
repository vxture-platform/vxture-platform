import { PlanVersionReadonlyPage } from "@/modules/products/PlanVersionReadonlyPage";

/* 已发布版本的只读详情（设计稿第四屏）。
 *
 * 中间一段是 **plan_code** 而不是档位：库里不禁止同档多套餐（arda 的 `pro` 档挂着
 * `arda-pro` 与 `arda-beta-trial` 两条），「pro 档的 v2」指代不唯一。`plan_code`
 * 本身唯一且可读，符合「地址栏走可读码、不出现 UUID」。 */
export default async function Page({
  params,
}: {
  params: Promise<{
    productCode: string;
    planCode: string;
    versionNo: string;
  }>;
}) {
  const { productCode, planCode, versionNo } = await params;
  return (
    <PlanVersionReadonlyPage
      productCode={decodeURIComponent(productCode)}
      planCode={decodeURIComponent(planCode)}
      versionNo={Number(versionNo)}
    />
  );
}
