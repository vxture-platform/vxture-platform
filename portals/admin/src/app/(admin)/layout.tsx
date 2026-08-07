import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { readNavCollapsed } from "@vxture/shared";
import { AdminSessionProvider } from "@/features/session/AdminSessionProvider";
import { AdminAppShell } from "@/layout/template/AdminAppShell";

/**
 * 侧栏收起态在**服务端**读出来，作为外壳的初始值。
 *
 * 此前它存在 localStorage 里，由外壳挂载后的 effect 读取——localStorage 对服务端
 * 不可见，所以首帧必然是展开的，读完才收起，刷新时能看到导航"先展开再收起"。
 * 换成 cookie 后它随请求一起到达，首帧即最终态。
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const navCollapsed = readNavCollapsed((await cookies()).toString(), "admin");

  return (
    <AdminSessionProvider>
      <AdminAppShell initialNavCollapsed={navCollapsed}>
        {children}
      </AdminAppShell>
    </AdminSessionProvider>
  );
}
