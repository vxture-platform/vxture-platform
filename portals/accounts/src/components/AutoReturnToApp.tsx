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

  return (
    <main className="vx-accounts-notice">
      <p>登录会话已失效，正在返回…</p>
    </main>
  );
}
