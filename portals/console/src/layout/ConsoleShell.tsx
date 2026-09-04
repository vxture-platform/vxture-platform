"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import type { SessionSnapshot } from "@/entities/console";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { useTranslations } from "next-intl";
import { TooltipProvider } from "@vxture/design-system";
import {
  ConsoleSessionProvider,
  useConsoleSession,
} from "@/features/session/ConsoleSessionProvider";
import { TenantProvider } from "@/features/tenant";
import { PortalEntryProvider } from "@/contexts/PortalEntryContext";
import { AccountDeletingGate } from "@/features/session/AccountDeletingGate";
import { ConsoleAppShell } from "@/layout/template/ConsoleAppShell";

// Default username shape assigned at account creation (`_{user_no}`, see
// identity-platform-account.md §1.2). A user still on this default has never
// completed first-time setup — that state alone (no extra DB flag) drives the
// onboarding redirect below, since setup always changes the username away
// from it.
const DEFAULT_USERNAME_RE = /^_\d+$/;
const ONBOARDING_PATH = "/onboarding";

function ShellFrame({
  children,
  initialNavCollapsed,
}: {
  children: ReactNode;
  initialNavCollapsed: boolean;
}) {
  const { session, status } = useConsoleSession();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("shell.loading");
  const needsOnboarding = Boolean(
    session.user?.username && DEFAULT_USERNAME_RE.test(session.user.username),
  );

  useEffect(() => {
    if (
      status === "ready" &&
      (!session.isAuthenticated || !session.user || !session.tenant)
    ) {
      // Keep the query string: conversion deep links (/subscribe?intent=...)
      // must survive the login round-trip, not just the pathname.
      const search =
        typeof window === "undefined" ? "" : window.location.search;
      router.replace(`/signin?next=${encodeURIComponent(pathname + search)}`);
      return;
    }
    if (
      status === "ready" &&
      session.isAuthenticated &&
      session.user &&
      session.tenant &&
      needsOnboarding &&
      pathname !== ONBOARDING_PATH
    ) {
      // 首次设置完成后要回到来处:受邀人从邮件链接进来、先被弹去补资料,
      // 补完不能把邀请 token 丢在半路(批 2)。
      const search =
        typeof window === "undefined" ? "" : window.location.search;
      const next =
        pathname === "/"
          ? ""
          : `?next=${encodeURIComponent(pathname + search)}`;
      router.replace(`${ONBOARDING_PATH}${next}`);
    }
  }, [
    needsOnboarding,
    pathname,
    router,
    session.isAuthenticated,
    session.tenant,
    session.user,
    status,
  ]);

  // 覆盖三种等待态：会话加载中 + token 已过期 + 首次设置未完成（useEffect 正在触发重定向）
  if (
    status !== "ready" ||
    !session.isAuthenticated ||
    !session.user ||
    !session.tenant ||
    (needsOnboarding && pathname !== ONBOARDING_PATH)
  ) {
    return (
      <div className="console-loading">
        <span
          className="console-loading__spinner"
          role="status"
          aria-label={t("label")}
        />
      </div>
    );
  }

  // 首次补齐是**强制门，不是普通页面**：上面那个 useEffect 会把用户从任何别的
  // 路径弹回这里，所以外壳里的侧栏、导航、租户切换器在这一步全部点不动——画出
  // 一个走不通的壳，等于请人去按一排按不动的按钮。这一页不套外壳。
  //
  // 位置在会话闸之后：`status` / 登录态 / user / tenant 四项仍然先过一遍，
  // 这里只决定"过了闸之后套不套外壳"。
  if (pathname === ONBOARDING_PATH) {
    return <>{children}</>;
  }

  // 删除保留期(批 5b):账号还能登录,工作台不可用。BFF 对其余路由一律 403,这里
  // 直接画「撤销删除 / 保持删除」两选一,同样不套外壳。
  if (session.user.accountStatus === "deleting") {
    return <AccountDeletingGate />;
  }

  return (
    <ConsoleAppShell initialNavCollapsed={initialNavCollapsed}>
      <div className="console-page">
        <div className="console-page__body">{children}</div>
      </div>
    </ConsoleAppShell>
  );
}

export function ConsoleShell({
  children,
  initialSession,
  initialNavCollapsed = false,
}: {
  children: ReactNode;
  initialSession?: SessionSnapshot | null;
  initialNavCollapsed?: boolean;
}) {
  return (
    /* Radix 的 Tooltip.Root 没有 Provider 会直接抛错（整页崩），所以同 opera/admin
     * 一样挂在外壳上，全部页面共用一套延迟。 */
    <TooltipProvider delayDuration={300}>
      <ConsoleSessionProvider initialSession={initialSession ?? null}>
        <TenantProvider>
          <PortalEntryProvider>
            <ShellFrame initialNavCollapsed={initialNavCollapsed}>
              {children}
            </ShellFrame>
          </PortalEntryProvider>
        </TenantProvider>
      </ConsoleSessionProvider>
    </TooltipProvider>
  );
}
