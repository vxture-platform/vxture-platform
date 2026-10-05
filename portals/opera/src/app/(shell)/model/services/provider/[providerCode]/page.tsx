/* Provider 详情 —— 地址走可读码 `providerCode`（能读、能分享、能粘进工单），
 * 不走 uuid。本层只解参数，内容全在 `ProviderDetailPage`（与产品详情同一分工：
 * 路由文件薄、页面组件住在 features/ 下，可被别处复用）。
 *
 * atlas 没有单取接口，详情页按列表端点 + code 命中（Provider 是运营量级）。 */

import { Suspense } from "react";
import { ProviderDetailPage } from "@/features/atlas/ProviderDetailPage";

export default async function Page({
  params,
}: {
  params: Promise<{ providerCode: string }>;
}) {
  const { providerCode } = await params;
  return (
    <Suspense fallback={null}>
      <ProviderDetailPage providerCode={decodeURIComponent(providerCode)} />
    </Suspense>
  );
}
