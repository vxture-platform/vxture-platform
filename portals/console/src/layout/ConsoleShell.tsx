"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import type { SessionSnapshot } from "@/entities/console";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  ConsoleSessionProvider,
  useConsoleSession,
} from "@/features/session/ConsoleSessionProvider";
import { TenantProvider } from "@/features/tenant";
import { PortalEntryProvider } from "@/contexts/PortalEntryContext";
import { ConsoleAppShell } from "@/layout/template/ConsoleAppShell";

// Default username shape assigned at account creation (`_{user_no}`, see
// identity-platform-account.md §1.2). A user still on this default has never
// completed first-time setup — that state alone (no extra DB flag) drives the
// onboarding redirect below, since setup always changes the username away
// from it.
const DEFAULT_USERNAME_RE = /^_\d+$/;
const ONBOARDING_PATH = "/onboarding";

function ShellFrame({ children }: { children: ReactNode }) {
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
      router.replace(ONBOARDING_PATH);
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

  return (
    <ConsoleAppShell>
      <div className="console-page">
        <div className="console-page__body">{children}</div>
      </div>
    </ConsoleAppShell>
  );
}

export function ConsoleShell({
  children,
  initialSession,
}: {
  children: ReactNode;
  initialSession?: SessionSnapshot | null;
}) {
  return (
    <ConsoleSessionProvider initialSession={initialSession ?? null}>
      <TenantProvider>
        <PortalEntryProvider>
          <ShellFrame>{children}</ShellFrame>
        </PortalEntryProvider>
      </TenantProvider>
    </ConsoleSessionProvider>
  );
}
