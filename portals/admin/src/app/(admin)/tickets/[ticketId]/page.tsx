import { TicketDetailPage } from "@/modules/support/TicketDetailPage";

/* 路由参数是**面向用户的**工单编号（`ticket_no`），不是内部 UUID——地址栏是可见面。
   BFF 侧同时仍接受 UUID（存量书签、审计日志里记的 id），所以形参名保留
   `ticketId`：它现在的含义是「id 或编码」。同 /orders/[orderId] 的口径。 */
export default async function Page({
  params,
}: {
  params: Promise<{
    ticketId: string;
  }>;
}) {
  const { ticketId } = await params;
  return <TicketDetailPage ticketId={decodeURIComponent(ticketId)} />;
}
