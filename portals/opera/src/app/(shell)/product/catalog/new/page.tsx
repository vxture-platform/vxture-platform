/* 接入产品 —— 与产品详情同一张页（owner 2026-09-14：「新建/配置页面」整合）。
 *
 * 此前新建是目录页上一个三个字段的弹窗，登记完再跳去详情页配其余的，客户端还要去第三个
 * 页面注册。现在登记、边缘与回调、登录客户端在这一页一次填完，一个事务写进去。
 *
 * 静态段 `new` 优先于 `[productCode]`，所以 `new` 不能作产品码——登记侧拒收它
 * （opera-bff `validateWrite`）。
 *
 * `ProductDetailPage` 读 `useSearchParams`（深链打开面板），静态路由在预渲染时要求它在
 * Suspense 边界里。 */

import { Suspense } from "react";
import { ProductDetailPage } from "@/features/product/ProductDetailPage";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProductDetailPage productCode={null} />
    </Suspense>
  );
}
