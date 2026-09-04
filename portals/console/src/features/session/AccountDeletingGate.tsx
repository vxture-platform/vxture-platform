"use client";

/**
 * AccountDeletingGate — 删除保留期的强制门(批 5b,050-account §7)。
 * @package @vxture/console
 * @layer Application
 * @category Feature
 *
 * 账号进入 30 天保留期后仍能登录,但工作台不可用(console-bff 对其余路由一律 403
 * ACCOUNT_DELETING)。登录后只看到这一页:申请时刻、永久删除时刻、两个选择——
 * 「撤销删除并重新启用」回到正常状态;「保持删除并退出」直接登出。不套外壳:
 * 一个走不通的壳等于请人去按一排按不动的按钮(同首次补齐门的理由)。
 */

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Banner, Button, Icon } from "@vxture/design-system";
import { ConsoleBffError, cancelAccountDeletion } from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";

const RETENTION_DAYS = 30;

function formatDay(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function AccountDeletingGate() {
  const t = useTranslations("shell.accountDeleting");
  const locale = useLocale();
  const { session, signOut, refreshSession } = useConsoleSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestedAt = session.user?.deletionRequestedAt ?? null;
  const purgeAt = requestedAt
    ? new Date(
        new Date(requestedAt).getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString()
    : null;

  async function reactivate() {
    setBusy(true);
    setError(null);
    try {
      await cancelAccountDeletion();
      await refreshSession({ silent: true });
      // 会话快照里的 accountStatus 回到 active 后外壳自然恢复;整页重载最稳。
      window.location.replace(`/${locale}/profile`);
    } catch (err) {
      setError(
        err instanceof ConsoleBffError && err.message
          ? err.message
          : t("error"),
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-lg py-xl">
      <div className="flex w-full max-w-panel-md flex-col gap-lg rounded-xl bg-card p-xl shadow-raised ring-1 ring-foreground/10">
        <div className="flex items-start gap-lg">
          <span className="mt-2xs shrink-0 text-warning" aria-hidden="true">
            <Icon name="warning" size="lg" fallback="placeholder" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2xs">
            <h1 className="text-title-md text-foreground">{t("title")}</h1>
            <p className="text-body-sm text-muted-foreground">
              {t("body", {
                requestedAt: formatDay(requestedAt, locale),
                purgeAt: formatDay(purgeAt, locale),
              })}
            </p>
          </div>
        </div>
        {error ? <Banner tone="danger" title={error} /> : null}
        <div className="flex flex-wrap items-center justify-end gap-sm">
          <Button
            variant="outline"
            size="md"
            onClick={() => signOut()}
            disabled={busy}
          >
            {t("keep")}
          </Button>
          <Button size="md" onClick={() => void reactivate()} disabled={busy}>
            <Icon
              name="clock-counter-clockwise"
              size="xs"
              fallback="placeholder"
            />
            <span>{t("reactivate")}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
