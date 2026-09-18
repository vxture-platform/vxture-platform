import { PlanDraftEditorPage } from "@/modules/products/PlanDraftEditorPage";

/* 草稿版本编辑器（设计稿第三屏）。
 *
 * 只有草稿进得来——已发布版本 `is_locked=true`，组件对非草稿不渲染任何输入控件，
 * 只给一句说明与去只读屏的入口。路由中间段用 `plan_code`，理由见同级的只读页。 */
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
    <PlanDraftEditorPage
      productCode={decodeURIComponent(productCode)}
      planCode={decodeURIComponent(planCode)}
      versionNo={Number(versionNo)}
    />
  );
}
