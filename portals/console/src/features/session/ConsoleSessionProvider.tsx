"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IDLE_MS, startIdleWatcher } from "@vxture/core-identity-sdk";
import {
  buildLogoutUrl,
  buildRpLoginUrl,
  restoreSession,
  switchTenantSession,
} from "@/api/console-bff";
import type { SessionSnapshot } from "@/entities/console";

type SessionStatus = "idle" | "loading" | "ready";
// Background heartbeat only. focus/visibilitychange below already sync immediately
// when the user returns to the tab, so this interval just catches session expiry
// while the tab stays focused. Kept at 5 min (was 2 s): every 2 s each open console
// tab fired 5 HTTP requests (probe + 4 aggregated reads) at the shared 2C/2G host.
const SESSION_SYNC_INTERVAL_MS = 300_000;
const SESSION_SYNC_THROTTLE_MS = 1500;
const ANONYMOUS_SESSION: SessionSnapshot = {
  isAuthenticated: false,
  user: null,
  tenant: null,
  tenantOptions: [],
  capabilities: [],
};

interface RefreshSessionOptions {
  silent?: boolean;
}

interface SessionContextValue {
  session: SessionSnapshot;
  status: SessionStatus;
  signOut: () => void;
  switchTenant: (tenantId: string) => Promise<void>;
  refreshSession: (options?: RefreshSessionOptions) => Promise<SessionSnapshot>;
}

const SessionContext = createContext<SessionContextValue>({
  session: ANONYMOUS_SESSION,
  status: "idle",
  signOut: () => undefined,
  switchTenant: async () => undefined,
  refreshSession: async () => ANONYMOUS_SESSION,
});

const ACTIVE_TENANT_STORAGE_KEY = "vx-console-active-tenant-id";
// Mirror of the active tenant in a cookie so the server (a future (console)
// server-layout building the initial session snapshot for SSR) can read the
// user's selected tenant — localStorage is not visible server-side. Non-sensitive
// (the BFF still validates membership per request); SameSite=Lax so it rides
// top-level navigations. Written client-side, hence not HttpOnly.
const ACTIVE_TENANT_COOKIE = "vx-console-active-tenant";
const ACTIVE_TENANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function readTenantCookie(): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${ACTIVE_TENANT_COOKIE}=([^;]*)`),
  );
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function writeTenantCookie(tenantId: string) {
  if (typeof document === "undefined") {
    return;
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${ACTIVE_TENANT_COOKIE}=${encodeURIComponent(tenantId)}; Path=/; Max-Age=${ACTIVE_TENANT_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function readStoredTenantId() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (
    window.localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY) ??
    readTenantCookie() ??
    undefined
  );
}

function writeStoredTenantId(tenantId: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, tenantId);
    writeTenantCookie(tenantId);
  }
}

async function applyStoredTenant(snapshot: SessionSnapshot) {
  const storedTenantId = readStoredTenantId();
  if (!storedTenantId || snapshot.tenant?.id === storedTenantId) {
    return snapshot;
  }

  const canUseStoredTenant = (snapshot.tenantOptions ?? []).some(
    (tenant) => tenant.id === storedTenantId,
  );
  return canUseStoredTenant ? switchTenantSession(storedTenantId) : snapshot;
}

function getSessionIdentity(snapshot: SessionSnapshot) {
  return JSON.stringify({
    isAuthenticated: snapshot.isAuthenticated,
    user: snapshot.user,
    tenant: snapshot.tenant,
    tenantOptions: snapshot.tenantOptions ?? [],
    capabilities: snapshot.capabilities,
  });
}

export function ConsoleSessionProvider({
  children,
  initialSession,
}: {
  children: ReactNode;
  initialSession?: SessionSnapshot | null;
}) {
  // Server-seeded snapshot (#7): when the (console) server layout resolved an
  // authenticated session, start `ready` so the shell paints on first render
  // with no client spinner waterfall. When absent (unauthenticated / tenant
  // mismatch / fetch failed) behaviour is exactly as before.
  const seeded = Boolean(initialSession?.isAuthenticated);
  const [session, setSession] = useState<SessionSnapshot>(
    initialSession ?? ANONYMOUS_SESSION,
  );
  const [status, setStatus] = useState<SessionStatus>(
    seeded ? "ready" : "loading",
  );
  const sessionRef = useRef<SessionSnapshot>(
    initialSession ?? ANONYMOUS_SESSION,
  );
  const seededRef = useRef(seeded);
  const lastSyncAtRef = useRef(0);
  const syncInFlightRef = useRef(false);

  const commitSession = useCallback((snapshot: SessionSnapshot) => {
    const previous = sessionRef.current;
    sessionRef.current = snapshot;

    if (getSessionIdentity(previous) !== getSessionIdentity(snapshot)) {
      setSession(snapshot);
    }
  }, []);

  const refreshSession = useCallback(
    async (options: RefreshSessionOptions = {}) => {
      if (!options.silent) {
        setStatus("loading");
      }

      try {
        const snapshot = await applyStoredTenant(await restoreSession());
        commitSession(snapshot);
        setStatus("ready");

        return snapshot;
      } catch (error) {
        if (!options.silent) {
          commitSession(ANONYMOUS_SESSION);
        }

        setStatus("ready");
        return options.silent ? sessionRef.current : ANONYMOUS_SESSION;
      }
    },
    [commitSession],
  );

  useEffect(() => {
    lastSyncAtRef.current = Date.now();

    const params = new URLSearchParams(window.location.search);
    const silentJustFailed = params.get("vx_sso_silent") === "0";
    if (silentJustFailed) {
      params.delete("vx_sso_silent");
      const cleanUrl = `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}${window.location.hash}`;
      window.history.replaceState(null, "", cleanUrl);
    }

    // Already seeded an authenticated snapshot server-side: reconcile silently
    // (no spinner, shell already painted) and never redirect — the user is in.
    if (seededRef.current) {
      void refreshSession({ silent: true });
      return;
    }

    refreshSession().then((snapshot) => {
      if (!snapshot.isAuthenticated && !silentJustFailed) {
        window.location.replace(
          buildRpLoginUrl(window.location.href, { prompt: "none" }),
        );
      }
    });
  }, [refreshSession]);

  useEffect(() => {
    if (status !== "ready") {
      return;
    }

    const syncIfStale = () => {
      const now = Date.now();
      if (
        syncInFlightRef.current ||
        now - lastSyncAtRef.current < SESSION_SYNC_THROTTLE_MS
      ) {
        return;
      }

      syncInFlightRef.current = true;
      lastSyncAtRef.current = now;

      void refreshSession({ silent: true }).finally(() => {
        syncInFlightRef.current = false;
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncIfStale();
      }
    };

    const intervalId = window.setInterval(
      syncIfStale,
      SESSION_SYNC_INTERVAL_MS,
    );
    window.addEventListener("focus", syncIfStale);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", syncIfStale);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshSession, status]);

  const signOut = useCallback(() => {
    // Top-level navigation (not fetch) so the browser sends vx_sid to the IdP
    // end_session, which performs single-logout across all RPs and lands on the
    // unified post-logout page. The page unloads, so no local commit is needed.
    window.location.assign(buildLogoutUrl());
  }, []);

  /**
   * 闲置钟。到点**直接登出，不弹窗询问**——"要不要继续"是消费级网银的 UX 惯例
   * 而非安全要求（NIST 800-63B 未要求），对正在操作的人定期打断是荒谬的
   * （owner 2026-08-07 判，见 workplans §二十三）。判据由真实交互事件给出，
   * 不是请求频率：读长表格、填长表单的人一个请求都不发，但他在场。
   */
  useEffect(() => {
    return startIdleWatcher({
      idleMs: IDLE_MS.customer,
      storageKey: "vx:console:last-activity",
      onIdle: signOut,
    });
  }, [signOut]);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      setStatus("loading");
      const snapshot = await switchTenantSession(tenantId);
      writeStoredTenantId(tenantId);
      commitSession(snapshot);
      setStatus("ready");
    },
    [commitSession],
  );

  // Stable context value: consumers only re-render when session/status actually
  // change, not on every ancestor render.
  const contextValue = useMemo<SessionContextValue>(
    () => ({ session, status, signOut, switchTenant, refreshSession }),
    [session, status, signOut, switchTenant, refreshSession],
  );

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
    </SessionContext.Provider>
  );
}

export function useConsoleSession() {
  return useContext(SessionContext);
}
