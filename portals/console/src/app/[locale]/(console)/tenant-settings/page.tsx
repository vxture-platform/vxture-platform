import { redirect } from "@/lib/i18n/navigation";

/**
 * `/tenant-settings` 与 `/settings` 是同一页(批 4 收口审计的「双 URL」):导航去
 * `/settings`,只有旧书签与租户面板的旧链接会到这里。保留路由做 301 语义的跳转,
 * 不再渲染第二份页面——同一页两个地址,面包屑、搜索、活动态高亮各认一个。
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/tenant", locale });
}
