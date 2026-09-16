import { AccountDetailPage } from "@/modules/accounts/AccountDetailPage";

type AccountDetailRouteProps = {
  params: Promise<{
    accountId: string;
  }>;
};

/* 路由参数是**面向用户的**账号编码（`user_no`，10 位），不是内部 UUID——地址栏是可见面，
   UUID 不在任何场景对外展示（与租户详情同规矩）。BFF 侧同时仍接受 UUID（存量书签、
   审计日志里记的 id），所以形参名保留 `accountId`：它现在的含义是「id 或编码」。 */
export default async function Page({ params }: AccountDetailRouteProps) {
  const { accountId } = await params;
  return <AccountDetailPage accountId={decodeURIComponent(accountId)} />;
}
