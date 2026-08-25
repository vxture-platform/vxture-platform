"use client";

import {
  FullscreenProvider,
  ThemeProvider,
  ToastProvider,
  TooltipProvider,
} from "@vxture/design-system";
import type { Density } from "@vxture/design-system";
import type { Theme } from "@vxture-platform/shared";
import { StepUpProvider } from "@/providers/StepUpProvider";

/* locale 与 messages 不再经过这一层：`NextIntlClientProvider` 挂在根 layout 上，
   由服务端按 `NEXT_LOCALE` cookie 定，切换靠 `router.refresh()` 重渲染。
   这里原来存着 locale/messages 两份 state、把**两本词条都发给客户端**、再订阅
   偏好变更就地替换——切得快，代价是每个访问者都下载了自己不看的那一本，而且
   客户端从此有一份需要和服务端保持一致的语言状态。 */
type Props = {
  children: React.ReactNode;
  initialTheme: Theme;
  initialDensity: Density;
};

export function ConsoleAppProviders({
  children,
  initialTheme,
  initialDensity,
}: Props) {
  return (
    <ThemeProvider defaultMode={initialTheme} defaultDensity={initialDensity}>
      <FullscreenProvider defaultMode="native" defaultLockScroll={false}>
        <ToastProvider>
          <TooltipProvider>
            <StepUpProvider>{children}</StepUpProvider>
          </TooltipProvider>
        </ToastProvider>
      </FullscreenProvider>
    </ThemeProvider>
  );
}
