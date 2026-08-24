/**
 * PostLogout.tsx - unified post-logout surface + return router (D-AU)
 * @package @vxture/accounts
 *
 * The IdP end_session redirects here after single-logout, carrying
 *   ?client=<id>&mode=signout|switch&relogin=<rp-login-entry>.
 * It is the single place that decides where the user lands next:
 *   - mode=switch (切换用户)                  → the originating RP's /auth/login
 *     (a fresh authorize → the accounts login form, ready to sign in as someone
 *     else), via the `relogin` entry the RP passed.
 *   - mode=signout from website / console     → vxture.com homepage.
 *   - mode=signout from any other business RP → the originating RP's /auth/login
 *     (the central accounts login form), via `relogin`.
 * `relogin` is validated to a *.vxture.com origin before use (no open redirect).
 * When no onward destination resolves, the static "已安全退出" notice is shown.
 */
"use client";

import { useEffect, useState } from "react";
import { Button } from "@vxture/design-system";
import { AccountsNotice } from "./AuthChrome";

const OIDC_API_BASE =
  process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081";

/** Clients that own the public marketing surface → land on the website home. */
const HOME_CLIENTS = new Set(["website", "console"]);
const WEBSITE_HOME =
  process.env.NEXT_PUBLIC_WEBSITE_HOME_URL ?? "https://vxture.com/";

interface ClientInfo {
  clientId: string;
  name: string;
  displayName: string | null;
  logoUrl: string | null;
}

/** Only allow same-platform (*.vxture.com) https/localhost targets for `relogin`. */
function safeReturnUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname;
    const ok =
      host === "vxture.com" ||
      host.endsWith(".vxture.com") ||
      host === "localhost" ||
      host === "127.0.0.1";
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 自动跳转的目的地。**只有切换用户会返回非 null。**
 *
 * 登出不再自动跳走：登出后那一屏是"事情办完了"唯一的确认，把它一闪而过地跳成
 * 登录表单，人就分不清三件事——我登出了？会话过期了？还是登出失败又被要求重登？
 * 切换用户是另一回事，它的意图本来就是"马上登另一个号"，立刻跳是对的。
 */
function resolveDestination(
  mode: string,
  relogin: string | null,
): string | null {
  return mode === "switch" ? safeReturnUrl(relogin) : null;
}

/** 确认屏上那个出口按钮的去向：营销面回官网，业务应用回自己的登录入口。 */
function resolveExit(
  clientId: string,
  relogin: string | null,
): { href: string; label: string } | null {
  if (HOME_CLIENTS.has(clientId)) {
    return { href: WEBSITE_HOME, label: "返回首页" };
  }
  const reloginUrl = safeReturnUrl(relogin);
  return reloginUrl ? { href: reloginUrl, label: "重新登录" } : null;
}

export function PostLogout({
  clientId,
  mode = "signout",
  relogin = null,
}: {
  clientId: string;
  mode?: string;
  relogin?: string | null;
}) {
  const [info, setInfo] = useState<ClientInfo | null>(null);
  const dest = resolveDestination(mode, relogin);
  const exit = resolveExit(clientId, relogin);

  // Onward routing: if a destination resolves, leave immediately (replace so the
  // post-logout page is not kept in history); otherwise fall through to the notice.
  useEffect(() => {
    if (dest) window.location.replace(dest);
  }, [dest]);

  // Branding for the static fallback notice (shown only when no destination).
  useEffect(() => {
    if (!clientId || dest) return;
    const url = `${OIDC_API_BASE}/oidc/client-info?client_id=${encodeURIComponent(clientId)}`;
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<ClientInfo>) : null))
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [clientId, dest]);

  if (dest) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-md px-md">
        <span
          className="size-icon-lg animate-spin rounded-full border-medium border-primary border-t-transparent"
          aria-hidden="true"
        />
        <p className="text-body-md text-muted-foreground">正在跳转…</p>
      </main>
    );
  }

  const title = info?.displayName || info?.name || "Vxture";

  // 登出后是**唯一**一屏"事情办完了"的确认。原先它顶着页面左上角，一个 48px
  // 的 logo、一个裸 h1、一段裸 p——`.vx-accounts-notice` 的内边距因为引用未定义
  // 的 `--vx-space-*` 被浏览器整条丢掉，连居中都没有。
  return (
    <AccountsNotice
      tone="success"
      title={`已从 ${title} 安全退出`}
      description={
        <>
          {info?.logoUrl ? (
            // Logo is an arbitrary per-client URL — a plain img is intentional.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="mx-auto mb-md block size-media-xs object-contain"
              src={info.logoUrl}
              alt={title}
            />
          ) : null}
          你已登出当前应用及所有关联应用。
        </>
      }
      /* 没有出口的确认屏是死胡同：告诉人"你登出了"，却不给一条回去的路。 */
      action={
        exit ? (
          <Button asChild size="lg">
            <a href={exit.href}>{exit.label}</a>
          </Button>
        ) : undefined
      }
    />
  );
}
