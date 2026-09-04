import { redirect } from "@/lib/i18n/navigation";

/**
 * `/todos` 并入「待办与消息」(批 4b,owner 2026-09-04 裁定):路由保留给旧书签与
 * 邮件里的链接,直接跳到 `/inbox?filter=todo`。
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/inbox?filter=todo", locale });
}
