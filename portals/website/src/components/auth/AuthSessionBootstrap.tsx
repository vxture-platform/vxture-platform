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
import { IDLE_MS, startIdleWatcher } from "@vxture/core-identity-sdk";
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
  const bootstrapAllowed = useRef(true);
  const initialized = useRef(false);

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
    let inFlight = false;
    let lastSyncAt = 0;
    let attemptedAt = ssoAttemptAt.current;
    const params = new URLSearchParams(window.location.search);
    if (params.get("vx_sso_silent") === "0") {
      bootstrapAllowed.current = false;
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
    const sync = async (bootstrap: boolean) => {
      if (
        !active ||
        inFlight ||
        document.visibilityState !== "visible" ||
        Date.now() - lastSyncAt < 1500
      )
        return;
      inFlight = true;
      lastSyncAt = Date.now();
      try {
        const user = await getProfile();
        if (!active) return;
        useAuthStore.getState().setUser(user);
      } catch (error: unknown) {
        if (
          !active ||
          !axios.isAxiosError(error) ||
          error.response?.status !== 401
        )
          return;
        useAuthStore.getState().setUser(null);
        const hint = document.cookie
          .split("; ")
          .some((cookie) => cookie.startsWith("vx_hint="));
        try {
          attemptedAt =
            Number(sessionStorage.getItem(SSO_ATTEMPT_STORAGE_KEY)) ||
            attemptedAt;
        } catch {
          /* Use the in-memory guard. */
        }
        if (
          bootstrap &&
          bootstrapAllowed.current &&
          hint &&
          Date.now() - attemptedAt >= SYNC_INTERVAL_MS
        ) {
          bootstrapAllowed.current = false;
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
      } finally {
        inFlight = false;
        if (active) useAuthStore.setState({ isLoading: false });
      }
    };
    // Only first bootstrap reserves a loading state; later checks retain the header.
    if (!initialized.current) {
      initialized.current = true;
      useAuthStore.setState({ isLoading: true });
    }
    void sync(true);
    const reconcile = () => {
      void sync(false);
    };
    const interval = window.setInterval(() => {
      void sync(false);
    }, SYNC_INTERVAL_MS);
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pageshow", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [pathname]);

  return null;
}
