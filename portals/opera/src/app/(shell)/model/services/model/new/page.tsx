/* 注册模型 —— 与模型详情同一张页（owner 2026-10-05：view/add/edit 提成二级页）。
 *
 * 静态段 `new` 优先于 `[modelCode]`，所以 `new` 不能作 modelCode。
 * `ModelDetailPage` 读 `useSearchParams`（新建带 `?providerId=` 预填所属 Provider），
 * 静态路由在预渲染时要求它在 Suspense 边界里。 */

import { Suspense } from "react";
import { ModelDetailPage } from "@/features/atlas/ModelDetailPage";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ModelDetailPage modelCode={null} />
    </Suspense>
  );
}
