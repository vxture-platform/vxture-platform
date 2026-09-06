import { redirect } from "@/lib/i18n/navigation";

/**
 * 批 9(owner 2026-09-06):邀请记录并成成员管理页里的一段(`/members`)。旧地址保留
 * 做跳转——待办卡片、邮件里的链接都还指着它;同一份内容两个地址会让面包屑、搜索、
 * 活动态各认一个,所以这里只跳转,不再渲染第二份页面。
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/members", locale });
}
