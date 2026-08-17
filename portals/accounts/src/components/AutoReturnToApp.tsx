/**
 * AutoReturnToApp.tsx - dead-end recovery for the accounts surface
 * @package @vxture/accounts
 *
 * Rendered when the accounts surface is reached with no usable login flow
 * (missing/expired login_challenge, or a bare visit to accounts.vxture.com).
 * Instead of stranding the user on a static notice, silently sends them back
 * to wherever they came from — see resolveReturnUrl in
 * @vxture/platform-browser for the fallback chain.
 */
"use client";

import { useEffect } from "react";
import { resolveReturnUrl } from "@vxture/platform-browser";

const WEBSITE_HOME_URL = process.env.NEXT_PUBLIC_WEBSITE_URL ?? "";

export function AutoReturnToApp() {
  useEffect(() => {
    window.location.replace(resolveReturnUrl(WEBSITE_HOME_URL));
  }, []);

  // 这一屏只存在到 replace 生效为止，但它确实会被看见（跳转慢或返回地址解析
  // 失败时就一直停在这里）。给一个居中的等待态，而不是左上角贴着边的一行字。
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-md px-md">
      <span
        className="size-icon-lg animate-spin rounded-full border-medium border-primary border-t-transparent"
        aria-hidden="true"
      />
      <p className="text-body-md text-muted-foreground">
        登录会话已失效，正在返回…
      </p>
    </main>
  );
}
