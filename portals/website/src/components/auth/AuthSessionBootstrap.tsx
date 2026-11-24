"use client";

/**
 * Reconcile the website RP after navigation and cross-tab identity changes.
 * @package @vxture/website
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-09
 */
import axios from "axios";
import { useEffect, useRef } from "react";
import { usePathname } from "@/lib/i18n/navigation";
import { useAuthStore } from "@/stores/auth.store";
import {
  IDLE_MS,
  startIdleWatcher,
  startSessionSync,
  type SessionRecheck,
} from "@vxture/core-identity-sdk";
import { buildLogoutUrl, buildRpLoginUrl, getProfile } from "@/api/auth.api";

// ============================================================================
// Bounded reconciliation; the hint never grants authentication.
// ============================================================================
const SSO_ATTEMPT_STORAGE_KEY = "vx_sso_attempted";
const SYNC_INTERVAL_MS = 300_000;

/**
 * Restore the local session and bootstrap central SSO only after a definitive 401.
 * @returns No visible content.
 */
export function AuthSessionBootstrap() {
  const pathname = usePathname();
  const ssoAttemptAt = useRef(0);

  useEffect(
    () =>
      startIdleWatcher({
        idleMs: IDLE_MS.customer,
        storageKey: "vx:website:last-activity",
        onIdle: () => window.location.assign(buildLogoutUrl()),
      }),
    [],
  );

  useEffect(() => {
    let active = true;

    let attemptedAt = ssoAttemptAt.current;
    const params = new URLSearchParams(window.location.search);
    if (params.get("vx_sso_silent") === "0") {
      attemptedAt = Date.now();
      ssoAttemptAt.current = attemptedAt;
      params.delete("vx_sso_silent");
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`,
      );
      try {
        sessionStorage.setItem(SSO_ATTEMPT_STORAGE_KEY, String(attemptedAt));
      } catch {
        /* Optional loop guard. */
      }
    }
    const read = async (
      signal: AbortSignal,
      forced: boolean,
    ): Promise<SessionRecheck> => {
      try {
        const user = await getProfile(signal);
        if (!active || signal.aborted) return "unavailable";
        useAuthStore.getState().setUser(user);
        return "active";
      } catch (error: unknown) {
        if (
          !active ||
          signal.aborted ||
          !axios.isAxiosError(error) ||
          error.response?.status !== 401
        )
          return "unavailable";
        useAuthStore.getState().setUser(null);
        const hint =
          !forced &&
          document.cookie
            .split("; ")
            .some((cookie) => cookie.startsWith("vx_hint="));
        try {
          attemptedAt =
            Number(sessionStorage.getItem(SSO_ATTEMPT_STORAGE_KEY)) ||
            attemptedAt;
        } catch {
          /* Use the in-memory guard. */
        }
        if (hint && Date.now() - attemptedAt >= SYNC_INTERVAL_MS) {
          attemptedAt = Date.now();
          ssoAttemptAt.current = attemptedAt;
          try {
            sessionStorage.setItem(
              SSO_ATTEMPT_STORAGE_KEY,
              String(attemptedAt),
            );
          } catch {
            /* Use the in-memory guard. */
          }
          window.location.replace(
            buildRpLoginUrl(window.location.href, { prompt: "none" }),
          );
        }
        return "anonymous";
      } finally {
        if (active) useAuthStore.setState({ isLoading: false });
      }
    };
    useAuthStore.setState({ isLoading: true });
    const sync = startSessionSync(read);
    return () => {
      active = false;
      sync.stop();
    };
  }, [pathname]);

  return null;
}
