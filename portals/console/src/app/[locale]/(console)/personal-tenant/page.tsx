import { redirect } from "@/lib/i18n/navigation";

/**
 * 批 5c:租户信息 / 组织信息 / 系统设置三页合并为「租户信息」`/tenant`(企业认证
 * 随之搬到 `/tenant/verification`)。旧地址保留做跳转——书签、邮件里的链接、
 * 面板旧链接都还指着它们;同一页两个地址会让面包屑、搜索、活动态各认一个,
 * 所以这里只跳转,不再渲染第二份页面。
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/tenant", locale });
}
