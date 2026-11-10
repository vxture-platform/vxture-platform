/**
 * Customer account overview independent of application tenancy.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-07
 */
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccountHeading, AccountSection as Panel } from "./AccountPrimitives";
import {
  useAccountSessionExpired,
  useAccountMenuUpdate,
} from "./AccountCenterShell";
import { useLocale, useTranslations } from "next-intl";
import {
  formatClock,
  formatDateTime,
  formatDay,
} from "@vxture-platform/shared";
import {
  Banner,
  useToast,
  Button,
  DialogForm,
  DataTable,
  Icon,
  Skeleton,
  StatusBadge,
} from "@vxture/design-system";
import { CustomerDeletion } from "./CustomerDeletion";
import { CustomerSecurityEditor } from "./CustomerSecurityEditor";
import { CustomerProfileEditor } from "./CustomerProfileEditor";
import { deviceInfo } from "@/lib/device-info";
import {
  CustomerReadError,
  fetchCustomerSelf,
  accountsRequest,
  type CustomerProfile,
  type CustomerSecurity,
  type CustomerSession,
  type CustomerLoginAttempt,
} from "@/api/customer-self";

// ============================================================================
// Overview state
// ============================================================================

type Projection<T> = { ok: true; value: T } | { ok: false };
type Load =
  | { state: "loading" | "unauthenticated" | "error" }
  | {
      state: "ready";
      profile: CustomerProfile;
      security: Projection<CustomerSecurity>;
      sessions: Projection<CustomerSession[]>;
      history: Projection<CustomerLoginAttempt[]>;
    };

function projection<T>(result: PromiseSettledResult<T>): Projection<T> {
  return result.status === "fulfilled"
    ? { ok: true, value: result.value }
    : { ok: false };
}

// ============================================================================
// Components
// ============================================================================

/**
 * Read only the customer realm, with bounded requests and recoverable partial errors.
 * @returns Customer profile, security status and recent activity.
 */
export function CustomerAccountCenter() {
  const { toast } = useToast();
  const expire = useAccountSessionExpired();
  const updateMenu = useAccountMenuUpdate();
  const t = useTranslations("accountCenter");
  const locale = useLocale();
  const ui = useTranslations("accountsUi");
  const requested = useSearchParams().get("section");
  const section =
    requested && ["security", "devices", "deletion"].includes(requested)
      ? requested
      : "profile";
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [revision, setRevision] = useState(0);
  const [signOut, setSignOut] = useState<CustomerSession | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState("");

  useEffect(() => {
    if (load.state !== "ready") return;
    const { profile, security } = load;
    const base =
      process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081";
    updateMenu({
      identityKey: `customer:${profile.id}`,
      account: profile.account,
      displayName: profile.name?.trim() || profile.account,
      ...(profile.avatarHash
        ? {
            avatarSrc: `${base}/avatar/usr_${profile.id}?v=${encodeURIComponent(profile.avatarHash)}`,
          }
        : {}),
      ...(security.ok
        ? { phone: security.value.phone, email: security.value.email }
        : {}),
    });
  }, [load, updateMenu]);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ state: "loading" });
    let inFlight = false;
    let lastReadAt = 0;
    async function read() {
      if (
        controller.signal.aborted ||
        inFlight ||
        document.visibilityState !== "visible" ||
        Date.now() - lastReadAt < 1500
      )
        return;
      inFlight = true;
      lastReadAt = Date.now();
      try {
        const profile = await fetchCustomerSelf("", controller.signal);
        // A route must never display an account from the other identity domain.
        if (profile.realm !== "customer")
          throw new CustomerReadError("unavailable");
        const results = await Promise.allSettled([
          fetchCustomerSelf("/security", controller.signal),
          fetchCustomerSelf("/sessions", controller.signal),
          fetchCustomerSelf("/login-history", controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (
          results.some(
            (result) =>
              result.status === "rejected" &&
              result.reason instanceof CustomerReadError &&
              result.reason.kind === "unauthenticated",
          )
        ) {
          setLoad({ state: "unauthenticated" });
          expire();
          return;
        }
        setLoad({
          state: "ready",
          profile,
          security: projection(results[0]),
          sessions: projection(results[1]),
          history: projection(results[2]),
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (
          error instanceof CustomerReadError &&
          error.kind === "unauthenticated"
        ) {
          setLoad({ state: "unauthenticated" });
          expire();
        } else {
          setLoad((previous) =>
            previous.state === "ready" ? previous : { state: "error" },
          );
        }
      } finally {
        inFlight = false;
      }
    }
    void read();
    const reconcile = () => {
      void read();
    };
    const interval = window.setInterval(reconcile, 300_000);
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pageshow", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [revision, expire]);

  function date(value: string | undefined) {
    return formatDateTime(value, locale, t("notSet"));
  }

  function device(userAgent: string | null) {
    const info = deviceInfo(userAgent);
    return `${info.browser || t("unknownBrowser")} · ${info.os || t("unknownOs")}`;
  }

  function methodParts(value: string) {
    const labels: Record<string, string> = {
      phone: t("methodPhone"),
      password: t("methodPassword"),
      email: t("methodEmail"),
      totp: t("methodTotp"),
      recovery: t("methodRecovery"),
      webauthn: t("methodPasskey"),
    };
    return value
      .split("+")
      .map(
        (part) =>
          labels[part] ??
          (part.startsWith("social:") ? t("methodSocial") : t("methodUnknown")),
      );
  }

  function method(value: string) {
    return methodParts(value).join(" · ");
  }

  function locationLabel(attempt: CustomerLoginAttempt) {
    if (attempt.location?.kind === "private") return t("privateLocation");
    const location = attempt.location;
    const region = location?.region;
    const city = location?.city;
    const countryCode = location?.countryCode || attempt.countryCode;
    let country = location?.country;
    if (countryCode && /^[A-Z]{2}$/.test(countryCode)) {
      country =
        new Intl.DisplayNames([locale], { type: "region" }).of(countryCode) ||
        country;
    }
    const parts =
      countryCode === "CN" && (region || city)
        ? [region, city]
        : [country, region, city];
    return (
      [...new Set(parts.filter(Boolean))].join(" · ") || t("unknownLocation")
    );
  }

  const historyNow = Date.now();
  const recentHistory =
    load.state === "ready" && load.history.ok
      ? load.history.value.filter((attempt) => {
          const at = Date.parse(attempt.loginAt);
          return (
            Number.isFinite(at) &&
            at > historyNow - 30 * 86400000 &&
            at <= historyNow
          );
        })
      : [];

  const retry = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => setRevision((value) => value + 1)}
    >
      {t("retry")}
    </Button>
  );
  const failed = (
    <div className="flex flex-col items-start gap-sm">
      <Banner tone="danger" title={t("loadFailed")} />
      {retry}
    </div>
  );

  if (load.state === "unauthenticated") return null;
  return (
    <main className="flex flex-col gap-lg">
      <AccountHeading
        title={ui(section)}
        icon={
          section === "security"
            ? "shield-check"
            : section === "devices"
              ? "desktop"
              : section === "deletion"
                ? "warning"
                : "user"
        }
      />
      {load.state === "loading" ? (
        <div role="status" aria-label={t("loading")}>
          <Skeleton className="h-40 w-full" />
          <span className="sr-only">{t("loading")}</span>
        </div>
      ) : null}
      {load.state === "error" ? failed : null}
      {load.state === "ready" ? (
        <>
          {section === "profile" ? (
            <>
              <CustomerProfileEditor
                key={load.profile.id}
                profile={load.profile}
                security={load.security.ok ? load.security.value : null}
                onSaved={() => setRevision((v) => v + 1)}
              />
            </>
          ) : null}
          {section === "security" ? (
            load.security.ok ? (
              <CustomerSecurityEditor
                key={load.profile.id}
                security={load.security.value}
                onSaved={() => setRevision((value) => value + 1)}
              />
            ) : (
              failed
            )
          ) : null}
          {section === "devices" ? (
            <>
              <Panel title={t("sessions")} icon="desktop">
                {load.sessions.ok ? (
                  load.sessions.value.length ? (
                    <ul className="accounts-activity-list">
                      {load.sessions.value.map((session) => (
                        <li key={session.sid} className="accounts-activity-row">
                          <Icon
                            name="desktop"
                            size="md"
                            className="accounts-activity-icon"
                          />
                          <div className="accounts-activity-details">
                            <div className="accounts-activity-title">
                              <strong>{device(session.userAgent)}</strong>
                              <StatusBadge
                                tone={session.current ? "success" : "neutral"}
                              >
                                {t(
                                  session.current
                                    ? "currentSession"
                                    : "otherSession",
                                )}
                              </StatusBadge>
                            </div>
                            <p className="accounts-activity-meta">
                              {session.ipAddress || t("notSet")} ·{" "}
                              {method(session.authMethod)}
                            </p>
                          </div>
                          <div className="accounts-session-active">
                            <span>{t("lastActive")}</span>
                            <time dateTime={session.lastActiveAt}>
                              {date(session.lastActiveAt)}
                            </time>
                          </div>
                          <Button
                            className="accounts-activity-actions"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSignOut(session);
                              setRevokeError("");
                            }}
                          >
                            {t(
                              session.current
                                ? "signOutCurrent"
                                : "signOutDevice",
                            )}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-body-small text-muted-foreground">
                      {t("noSessions")}
                    </p>
                  )
                ) : (
                  failed
                )}
              </Panel>
              <Panel title={t("history")} icon="timer">
                <p className="accounts-history-range">{t("historyRange")}</p>
                {load.history.ok ? (
                  recentHistory.length ? (
                    <div
                      className="accounts-history-scroll"
                      role="region"
                      aria-label={t("history")}
                      tabIndex={0}
                    >
                      <DataTable
                        className="accounts-history"
                        rows={recentHistory}
                        rowKey={(attempt, index) =>
                          `${attempt.loginAt}-${index}`
                        }
                        columns={[
                          {
                            id: "time",
                            header: t("loginTime"),
                            align: "center",
                            cell: (attempt) => (
                              <time dateTime={attempt.loginAt}>
                                {formatDay(
                                  attempt.loginAt,
                                  locale,
                                  t("notSet"),
                                )}
                                <span className="accounts-history-secondary">
                                  {formatClock(attempt.loginAt, locale)}
                                </span>
                              </time>
                            ),
                          },
                          {
                            id: "client",
                            header: t("browserAndOs"),
                            align: "center",
                            cell: (attempt) => {
                              const client = deviceInfo(attempt.userAgent);
                              return (
                                <>
                                  {client.browser || t("unknownBrowser")}
                                  <span className="accounts-history-secondary">
                                    {client.os || t("unknownOs")}
                                  </span>
                                </>
                              );
                            },
                          },
                          {
                            id: "location",
                            header: t("loginAddress"),
                            align: "center",
                            cell: (attempt) => (
                              <>
                                {locationLabel(attempt)}
                                <span className="accounts-history-secondary">
                                  {attempt.ipAddress || t("notSet")}
                                </span>
                              </>
                            ),
                          },
                          {
                            id: "method",
                            header: t("loginMethod"),
                            align: "center",
                            cell: (attempt) => (
                              <span className="accounts-history-method">
                                {methodParts(attempt.authMethod).map(
                                  (part, index) => (
                                    <span key={`${part}-${index}`}>{part}</span>
                                  ),
                                )}
                              </span>
                            ),
                          },
                          {
                            id: "result",
                            header: t("loginResult"),
                            align: "center",
                            width: "xs",
                            cell: (attempt) => (
                              <StatusBadge
                                tone={
                                  attempt.result === "success"
                                    ? "success"
                                    : "danger"
                                }
                              >
                                {attempt.result === "success"
                                  ? t("success")
                                  : t("unsuccessful")}
                              </StatusBadge>
                            ),
                          },
                        ]}
                      />
                    </div>
                  ) : (
                    <p className="text-body-small text-muted-foreground">
                      {t("noHistory")}
                    </p>
                  )
                ) : (
                  failed
                )}
              </Panel>
            </>
          ) : null}
          {section === "deletion" ? (
            <CustomerDeletion
              security={load.security.ok ? load.security.value : null}
            />
          ) : null}
        </>
      ) : null}
      <DialogForm
        size="sm"
        title={t(signOut?.current ? "signOutCurrent" : "signOutDevice")}
        danger
        description={t("signOutConsequence")}
        submitLabel={t(signOut?.current ? "signOutCurrent" : "signOutDevice")}
        cancelLabel={t("cancel")}
        submitting={revoking}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!signOut || revoking) return;
          setRevoking(true);
          setRevokeError("");
          try {
            await accountsRequest(
              `/oidc/customer/self/sessions/${encodeURIComponent(signOut.sid)}`,
              { method: "DELETE" },
            );
            if (signOut.current) expire();
            else {
              setSignOut(null);
              toast({ tone: "success", title: t("deviceSignedOut") });
              setRevision((v) => v + 1);
            }
          } catch (error) {
            setRevokeError(
              error instanceof Error ? error.message : t("loadFailed"),
            );
          } finally {
            setRevoking(false);
          }
        }}
        open={Boolean(signOut)}
        onOpenChange={(open) => {
          if (!open && !revoking) setSignOut(null);
        }}
      >
        {signOut ? (
          <p className="text-body-small text-muted-foreground">
            {device(signOut.userAgent)}
          </p>
        ) : null}
        {revokeError ? <Banner tone="danger" title={revokeError} /> : null}
      </DialogForm>
    </main>
  );
}
