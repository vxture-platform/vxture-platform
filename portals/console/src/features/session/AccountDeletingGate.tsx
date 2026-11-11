"use client";

/**
 * Gate business access during account deletion; accounts owns proof and recovery.
 * @package @vxture/console
 * @layer Presentation
 * @category Feature
 */

import { useLocale, useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import { accountCenterUrl } from "@/lib/account-center";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { formatDay as sharedDay } from "@vxture-platform/shared";

const RETENTION_DAYS = 30;

function formatDay(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return sharedDay(date, locale);
}

export function AccountDeletingGate() {
  const t = useTranslations("shell.accountDeleting");
  const locale = useLocale();
  const { session, signOut } = useConsoleSession();
  const requestedAt = session.user?.deletionRequestedAt ?? null;
  const purgeAt = requestedAt
    ? new Date(
        new Date(requestedAt).getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString()
    : null;

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
        <div className="flex flex-wrap items-center justify-end gap-sm">
          <Button variant="outline" size="md" onClick={() => signOut()}>
            {t("keep")}
          </Button>
          <Button
            size="md"
            onClick={() =>
              window.location.assign(accountCenterUrl(locale, "deletion"))
            }
          >
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
