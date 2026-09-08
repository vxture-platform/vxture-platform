import { redirect } from "@/lib/i18n/navigation";

/**
 * 加油包支付页迁到费用中心（owner 2026-09-08 的板块梳理）：加油包是**一次性购买**，
 * 与订阅、账单、发票同属「钱」这条线；配额页答的是「用了多少、还剩多少」。
 *
 * 旧地址保留跳转：**在途订单**会撞上它——下单后跳到支付页、人走开、再从书签或
 * 历史回来，那笔订单还没付。派生待办本身会重算出新地址，但已经打开的标签页和
 * 书签不会。这类跳转与 /roles、/invitations 同一形态：只跳转，不渲染第二份页面
 * （同一页两个地址会让面包屑、搜索、活动态各认一个）。
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; orderNo: string }>;
}) {
  const { locale, orderNo } = await params;
  redirect({ href: `/billing/addon-pay/${orderNo}`, locale });
}
