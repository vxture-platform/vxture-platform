import { TicketDetailPage } from "@/modules/support/TicketDetailPage";

/* 路由参数叫 `ticketNo` 而不是 `id`:它收的是**可视码**(`TK-{YYYYMM}-{10}`)。
   名字本身就是契约的一半——叫 `id` 的参数迟早会被人塞一个 uuid 进去,
   而地址栏是展示面。 */
export default function Page() {
  return <TicketDetailPage />;
}
