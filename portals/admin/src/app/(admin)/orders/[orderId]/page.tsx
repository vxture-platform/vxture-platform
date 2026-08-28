import { OrderDetailPage } from "@/modules/orders/OrderDetailPage";

/* 路由参数是**面向用户的**订单编号（`order_no`，如 `SO202600100`），不是内部 UUID——地址栏是可见面，
   UUID 不在任何场景对外展示。BFF 侧同时仍接受 UUID（存量书签、审计
   日志里记的 id），所以形参名保留 `orderId`：它现在的含义是「id 或编码」。 */
export default async function Page({
  params,
}: {
  params: Promise<{
    orderId: string;
  }>;
}) {
  const { orderId } = await params;
  return <OrderDetailPage orderId={decodeURIComponent(orderId)} />;
}
