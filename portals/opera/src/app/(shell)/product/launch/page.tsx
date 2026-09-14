"use client";

/* 产品上线 —— 已并入产品页的「接入检查」抽屉（2026-09-14）。
 *
 * owner:「产品接入页面，注册客户端需要填写的信息是不是都整合在产品接入的新建/配置页面，
 * 除了需要单独的密钥管理可以弹出单独面板，现在分散且重复。」这一页跑复验、列交给对方的
 * 清单、确认上线——而产品页的检查抽屉同时也在跑复验、看检查单，目录页还有一个检查单抽屉。
 * 同一件事三处，现在收到产品页一处。
 *
 * 旧地址 `/product/launch?productId=…` 可能留在工单与聊天记录里，所以保留为跳转：
 * 按 id 查出产品码，落到 `/product/catalog/:code?panel=checks`，抽屉自动打开。 */

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

export default function ProductLaunchRedirectPage() {
  return (
    <Suspense fallback={null}>
      <ProductLaunchRedirect />
    </Suspense>
  );
}

function ProductLaunchRedirect() {
  const router = useRouter();
  const productId = useSearchParams().get("productId") ?? "";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const product = productId
        ? await api
            .get<{
              productCode: string;
            } | null>(`/api/products/${encodeURIComponent(productId)}`)
            .catch(() => null)
        : null;
      if (cancelled) return;
      router.replace(
        product
          ? `/product/catalog/${encodeURIComponent(product.productCode)}?panel=checks`
          : "/product/catalog",
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, router]);

  return null;
}
