"use client";

import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  EmptyState,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { PageSection } from "@/layout/shell";
import {
  fetchLoginHistory,
  fetchSessions,
  revokeSession,
} from "@/api/console-bff";
import type { AuthSessionRecord, LoginHistoryEntry } from "@/entities/console";
import { useLocale, useTranslations } from "next-intl";

function parseOS(userAgent: string | null): string {
  if (!userAgent) return "";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Mac OS X/i.test(userAgent)) return "macOS";
  if (/iPhone|iPad/i.test(userAgent)) return "iOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "";
}

function formatDate(value: string, locale: string, fallback: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || fallback;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function SecurityPage() {
  const t = useTranslations("securityPage");
  const locale = useLocale();
  const [history, setHistory] = useState<LoginHistoryEntry[]>([]);
  const [sessions, setSessions] = useState<AuthSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  /* On a security page an outage must not read as "you have no active
   * sessions" — that is the reassuring answer, and it is the wrong one. The
   * API layer's readJson swallows every failure into an empty fallback, so
   * this page tracks its own load error and says so. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [revokeFailed, setRevokeFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void Promise.all([fetchLoginHistory(), fetchSessions()])
      .then(([rows, sess]) => {
        if (!active) return;
        setHistory(rows);
        setSessions(sess);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleRevoke(sid: string) {
    setRevoking(sid);
    setRevokeFailed(false);
    try {
      await revokeSession(sid);
      const next = await fetchSessions();
      setSessions(next);
    } catch {
      // Previously an unhandled rejection: the row stayed put with no feedback,
      // so a failed revoke looked identical to a successful one.
      setRevokeFailed(true);
    } finally {
      setRevoking(null);
    }
  }

  const empty = t("common.empty");

  return (
    <ViewLayout>
      <ViewHeader
        icon="shield-check"
        title={t("header.title")}
        description={t("header.description")}
      />

      {loadFailed ? (
        <Banner tone="danger" title={t("common.loadError")} />
      ) : null}
      {revokeFailed ? (
        <Banner tone="danger" title={t("common.revokeError")} />
      ) : null}

      <PageSection
        title={t("sections.loginHistory.title")}
        icon="clock-counter-clockwise"
        level={2}
        description={t("sections.loginHistory.description")}
      >
        {loading ? (
          <EmptyState title={t("common.loading")} />
        ) : history.length === 0 ? (
          <EmptyState title={t("sections.loginHistory.empty")} />
        ) : (
          /* Data rows, not field rows: the leading cell is a timestamp rather
           * than a field name, so DetailList (dl/dt/dd) would be semantically
           * wrong here. No column-header copy exists either, so a headerless
           * list beats a DataTable with invented headers. */
          <ul className="flex flex-col [&>*+*]:border-t [&>*+*]:border-dashed [&>*+*]:border-primary/10 dark:[&>*+*]:border-primary/20">
            {history.map((entry, index) => {
              const os = parseOS(entry.userAgent);
              const location = entry.countryCode || empty;
              const success = entry.result === "success";
              return (
                <li
                  key={`${entry.loginAt}-${index}`}
                  className="flex flex-wrap items-center gap-md py-sm"
                >
                  <span className="shrink-0 text-label-sm text-muted-foreground sm:w-media-3xl">
                    {formatDate(entry.loginAt, locale, empty)}
                  </span>
                  <span className="min-w-0 flex-1 text-body-md text-foreground">
                    {`${entry.ipAddress || empty} · ${location} · ${os || empty}`}
                  </span>
                  <StatusBadge tone={success ? "success" : "danger"}>
                    {success ? t("status.success") : t("status.failed")}
                  </StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </PageSection>

      <PageSection
        title={t("sections.sessions.title")}
        icon="device-mobile"
        level={2}
        description={t("sections.sessions.description")}
      >
        {loading ? (
          <EmptyState title={t("common.loading")} />
        ) : sessions.length === 0 ? (
          <EmptyState title={t("sections.sessions.empty")} />
        ) : (
          <ul className="flex flex-col [&>*+*]:border-t [&>*+*]:border-dashed [&>*+*]:border-primary/10 dark:[&>*+*]:border-primary/20">
            {sessions.map((s) => {
              const os = parseOS(s.userAgent) || empty;
              return (
                <li
                  key={s.sid}
                  className="flex flex-wrap items-center gap-md py-sm"
                >
                  <span className="shrink-0 text-label-sm text-muted-foreground sm:w-media-3xl">
                    {formatDate(s.lastActiveAt, locale, empty)}
                  </span>
                  <span className="min-w-0 flex-1 text-body-md text-foreground">
                    {`${s.ipAddress || empty} · ${os} · ${s.authMethod}`}
                  </span>
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => void handleRevoke(s.sid)}
                    disabled={revoking === s.sid}
                  >
                    {t("sections.sessions.revoke")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </PageSection>
    </ViewLayout>
  );
}
