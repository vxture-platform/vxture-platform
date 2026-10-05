/* 模型详情 —— 地址走可读码 `modelCode`（全局唯一、锁死不可改，是消费方 pin 的那个标识，
 * 拿它做路由键稳定可分享），不走 uuid。本层只解参数，内容全在 `ModelDetailPage`。
 *
 * atlas 没有单取接口，详情页按列表端点 + modelCode 命中。 */

import { Suspense } from "react";
import { ModelDetailPage } from "@/features/atlas/ModelDetailPage";

export default async function Page({
  params,
}: {
  params: Promise<{ modelCode: string }>;
}) {
  const { modelCode } = await params;
  return (
    <Suspense fallback={null}>
      <ModelDetailPage modelCode={decodeURIComponent(modelCode)} />
    </Suspense>
  );
}
