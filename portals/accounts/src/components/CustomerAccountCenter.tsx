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
  Banner,
  Button,
  DialogForm,
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
    if (!value) return t("notSet");
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? t("notSet")
      : parsed.toLocaleString(locale);
  }

  function device(userAgent: string | null) {
    const info = deviceInfo(userAgent);
    return `${info.browser || t("unknownBrowser")} · ${info.os || t("unknownOs")}`;
  }

  function method(value: string) {
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
      )
      .join(" · ");
  }

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
                            <p className="accounts-activity-meta">
                              {t("lastActive")} · {date(session.lastActiveAt)}
                            </p>
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
                    <p className="text-body-sm text-muted-foreground">
                      {t("noSessions")}
                    </p>
                  )
                ) : (
                  failed
                )}
              </Panel>
              <Panel title={t("history")} icon="timer">
                {load.history.ok ? (
                  load.history.value.length ? (
                    <ul className="accounts-activity-list">
                      {load.history.value.map((attempt, index) => (
                        <li
                          key={`${attempt.loginAt}-${index}`}
                          className="accounts-activity-row"
                        >
                          <span className="accounts-activity-details">
                            {date(attempt.loginAt)} · {attempt.ipAddress} ·{" "}
                            {method(attempt.authMethod)}
                            <span className="block text-muted-foreground">
                              {device(attempt.userAgent)}
                            </span>
                          </span>
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
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-body-sm text-muted-foreground">
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
        submitLabel={t("confirm")}
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
          <p className="text-body-sm text-muted-foreground">
            {device(signOut.userAgent)}
          </p>
        ) : null}
        {revokeError ? <Banner tone="danger" title={revokeError} /> : null}
      </DialogForm>
    </main>
  );
}
