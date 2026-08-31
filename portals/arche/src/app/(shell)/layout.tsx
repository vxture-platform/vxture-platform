import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { ToastProvider } from "@vxture/design-system";
import { readNavCollapsed } from "@vxture-platform/shared";
import { SessionProvider } from "@/features/session/SessionProvider";
import { StepUpProvider } from "@/features/stepup/StepUpProvider";
import { ArcheShell } from "@/layout/ArcheShell";

/* 侧栏收起态在服务端读出来当初始值。localStorage 对服务端不可见，靠它就必然是
 * "首帧展开、effect 里再收起"。 */
export default async function ShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  const navCollapsed = readNavCollapsed((await cookies()).toString(), "arche");
  return (
    <SessionProvider>
      {/* 写操作的结果反馈要有落点：opera 此前全是只读页，没挂过 ToastProvider，
          而 `useToast` 在 provider 外是直接抛错的。 */}
      <ToastProvider>
        {/* StepUpProvider 在 ToastProvider 之内：仪式失败时的提示要能落到 toast；
            在 SessionProvider 之内：换凭证要求已有会话（BFF 侧同样从会话取
            operatorId，不信请求体）。 */}
        <StepUpProvider>
          <ArcheShell initialNavCollapsed={navCollapsed}>{children}</ArcheShell>
        </StepUpProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
