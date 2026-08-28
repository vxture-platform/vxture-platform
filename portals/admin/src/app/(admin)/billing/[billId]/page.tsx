import { BillingDetailPage } from "@/modules/billing/BillingDetailPage";

/* 路由参数是**面向用户的**账单编号（`bill_no`，如 `BILL202600100`），不是内部 UUID——地址栏是可见面，
   UUID 不在任何场景对外展示。BFF 侧同时仍接受 UUID（存量书签、审计
   日志里记的 id），所以形参名保留 `billId`：它现在的含义是「id 或编码」。 */
export default async function Page({
  params,
}: {
  params: Promise<{
    billId: string;
  }>;
}) {
  const { billId } = await params;
  return <BillingDetailPage billId={decodeURIComponent(billId)} />;
}
