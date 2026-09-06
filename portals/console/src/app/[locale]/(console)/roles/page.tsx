import { redirect } from "@/lib/i18n/navigation";

/**
 * 批 9(owner 2026-09-06):「成员与权限」分组撤销,角色与权限成为成员管理的二级页
 * `/members/roles`。旧地址保留做跳转——书签、邮件里的链接、面板旧链接都还指着它;
 * 同一页两个地址会让面包屑、搜索、活动态各认一个,所以这里只跳转,不再渲染第二份页面。
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/members/roles", locale });
}
