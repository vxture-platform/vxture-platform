import { redirect } from "@/lib/i18n/navigation";

/**
 * 批 9(owner 2026-09-06):「成员与权限」分组撤销,邀请记录成为成员管理的二级页
 * `/members/invitations`。旧地址保留做跳转——待办卡片、邮件里的链接都还指着它;
 * 同一页两个地址会让面包屑、搜索、活动态各认一个,所以这里只跳转,不再渲染第二份页面。
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/members/invitations", locale });
}
