import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { ToastProvider } from "@vxture/design-system";
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
      {/* 写操作的结果反馈要有落点：opera 此前全是只读页，没挂过 ToastProvider，
          而 `useToast` 在 provider 外是直接抛错的。 */}
      <ToastProvider>
        <OperaShell initialNavCollapsed={navCollapsed}>{children}</OperaShell>
      </ToastProvider>
    </SessionProvider>
  );
}
