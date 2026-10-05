/* 接入 Provider —— 与 Provider 详情同一张页（owner 2026-10-05：view/add/edit 提成二级页）。
 *
 * 静态段 `new` 优先于 `[providerCode]`，所以 `new` 不能作 Provider Code——atlas 侧也会拒。
 * `ProviderDetailPage` 读 `useSearchParams`（无直接深链，但密钥抽屉等走 Suspense 安全），
 * 静态路由在预渲染时要求它在 Suspense 边界里。 */

import { Suspense } from "react";
import { ProviderDetailPage } from "@/features/atlas/ProviderDetailPage";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProviderDetailPage providerCode={null} />
    </Suspense>
  );
}
