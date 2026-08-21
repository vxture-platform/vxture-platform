import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { readNavCollapsed } from "@vxture-platform/shared";
import { ConsoleShell } from "@/layout/ConsoleShell";
import { loadServerSessionSnapshot } from "@/lib/server/bff-server";

// Server component: resolve the session snapshot with the caller's cookies so
// the shell paints on first render instead of a client-side spinner waterfall.
// A null snapshot (unauthenticated / expired / tenant mismatch) is intentional —
// ConsoleShell then runs the existing client restore + silent-SSO flow.
export default async function ConsoleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const initialSession = await loadServerSessionSnapshot();
  /* 侧栏收起态同样在服务端读出——localStorage 对服务端不可见，靠它就必然是
   * "首帧展开、effect 里再收起"，刷新时看得到那一下跳变。 */
  const navCollapsed = readNavCollapsed(
    (await cookies()).toString(),
    "console",
  );
  return (
    <ConsoleShell
      initialSession={initialSession}
      initialNavCollapsed={navCollapsed}
    >
      {children}
    </ConsoleShell>
  );
}
