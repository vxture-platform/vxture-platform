import { redirect } from "@/lib/i18n/navigation";

/**
 * 「安全设置」并入「账号信息」(批 5a,owner 2026-09-04 定稿):密码 / 登录开关 /
 * 活跃会话 / 登录历史都在账号信息页里各自行内展开。路由保留给旧书签,直接跳过去
 * 并展开会话。
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/profile?panel=sessions", locale });
}
