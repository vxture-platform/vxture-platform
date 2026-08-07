import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { readNavCollapsed } from "@vxture/shared";
import { SessionProvider } from "@/features/session/SessionProvider";
import { OperaShell } from "@/layout/OperaShell";

/* 侧栏收起态在服务端读出来当初始值。localStorage 对服务端不可见，靠它就必然是
 * "首帧展开、effect 里再收起"。 */
export default async function ShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  const navCollapsed = readNavCollapsed((await cookies()).toString(), "opera");
  return (
    <SessionProvider>
      <OperaShell initialNavCollapsed={navCollapsed}>{children}</OperaShell>
    </SessionProvider>
  );
}
