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
  buildTenantSwitchUrl,
  buildWorkspaceSwitchUrl,
  restoreSession,
} from "@/api/console-bff";
import type { SessionSnapshot } from "@/entities/console";
import { startSessionEvents } from "./session-events";

type SessionStatus = "idle" | "loading" | "ready";
// Legacy deployments and disconnected streams retain bounded reconciliation.
// A negotiated, reconciled events-v1 connection removes timer/focus reads.
const SESSION_SYNC_INTERVAL_MS = 300_000;
const SESSION_SYNC_THROTTLE_MS = 1500;
const SESSION_CONTEXT_CHANNEL = "vx:console:context-changed";
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
  /**
   * 切换活跃租户:一次**顶层导航**去 console-bff 的 /auth/switch-tenant(identity/080
   * §2.8),回来时页面已整体重载到新租户。返回的 Promise 在页面卸载前不会 resolve,
   * 调用方不要在它之后排任何事;切完要落到别的页面就传 `returnTo`。
   */
  switchTenant: (tenantId: string, returnTo?: string) => Promise<void>;
  /**
   * 切换活跃工作空间。与切租户**同一条链路**(顶层导航 → IdP 静默重授权),
   * 只换提示参数;两级各切各的,切工作空间不动 active_org。
   */
  switchWorkspace: (workspaceId: string, returnTo?: string) => Promise<void>;
  refreshSession: (options?: RefreshSessionOptions) => Promise<SessionSnapshot>;
}

const SessionContext = createContext<SessionContextValue>({
  session: ANONYMOUS_SESSION,
  status: "idle",
  signOut: () => undefined,
  switchTenant: async () => undefined,
  switchWorkspace: async () => undefined,
  refreshSession: async () => ANONYMOUS_SESSION,
});

function getSessionIdentity(snapshot: SessionSnapshot) {
  return JSON.stringify({
    isAuthenticated: snapshot.isAuthenticated,
    user: snapshot.user,
    tenant: snapshot.tenant,
    tenantOptions: snapshot.tenantOptions ?? [],
    capabilities: snapshot.capabilities,
  });
}

function getSessionScope(snapshot: SessionSnapshot) {
  return JSON.stringify([
    snapshot.user?.id ?? null,
    snapshot.tenant?.id ?? null,
    snapshot.tenant?.workspace ?? null,
  ]);
}

/*
 * Render the server's RP session snapshot. The IdP revalidates the central
 * session's current context when issuing or refreshing tokens; the browser
 * never restores a historical tenant from local storage over that selection.
 */
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
  const [eventSync, setEventSync] = useState(false);
  const eventSyncRef = useRef(false);
  const sessionRef = useRef<SessionSnapshot>(
    initialSession ?? ANONYMOUS_SESSION,
  );
  const seededRef = useRef(seeded);
  const lastSyncAtRef = useRef(0);
  const syncInFlightRef = useRef(false);
  const refreshVersionRef = useRef(0);
  const sessionConfirmedRef = useRef(false);
  const contextChannelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SESSION_CONTEXT_CHANNEL);
    contextChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      // The message is an invalidation signal. Only the server restores context.
      if (
        typeof event.data === "string" &&
        event.data !== getSessionScope(sessionRef.current)
      ) {
        window.location.reload();
      }
    };
    return () => {
      contextChannelRef.current = null;
      channel.close();
    };
  }, []);

  const commitSession = useCallback((snapshot: SessionSnapshot) => {
    const previous = sessionRef.current;
    sessionRef.current = snapshot;

    if (snapshot.isAuthenticated) {
      contextChannelRef.current?.postMessage(getSessionScope(snapshot));
    }
    if (
      previous.isAuthenticated &&
      snapshot.isAuthenticated &&
      getSessionScope(previous) !== getSessionScope(snapshot)
    ) {
      // Reload every panel from the new server session, including panels whose
      // local caches do not subscribe to the session context.
      window.location.reload();
      return;
    }

    if (getSessionIdentity(previous) !== getSessionIdentity(snapshot)) {
      setSession(snapshot);
    }
  }, []);

  const refreshSession = useCallback(
    async (options: RefreshSessionOptions = {}) => {
      const version = ++refreshVersionRef.current;
      if (!options.silent) {
        setStatus("loading");
      }

      try {
        const snapshot = await restoreSession();
        if (version !== refreshVersionRef.current) return sessionRef.current;
        sessionConfirmedRef.current = true;
        commitSession(snapshot);
        setStatus("ready");

        return snapshot;
      } catch {
        if (version !== refreshVersionRef.current) return sessionRef.current;
        // An outage is not evidence of logout, including during bootstrap.
        sessionConfirmedRef.current = false;
        setStatus("ready");
        return sessionRef.current;
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
      if (
        sessionConfirmedRef.current &&
        !snapshot.isAuthenticated &&
        !silentJustFailed
      ) {
        window.location.replace(
          buildRpLoginUrl(window.location.href, { prompt: "none" }),
        );
      }
    });
  }, [refreshSession]);

  useEffect(() => {
    if (status !== "ready" || eventSync || !session.isAuthenticated) {
      return;
    }

    const syncIfStale = () => {
      const now = Date.now();
      if (
        document.visibilityState !== "visible" ||
        eventSyncRef.current ||
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
    window.addEventListener("online", syncIfStale);
    window.addEventListener("pageshow", syncIfStale);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", syncIfStale);
      window.removeEventListener("online", syncIfStale);
      window.removeEventListener("pageshow", syncIfStale);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshSession, status, eventSync, session.isAuthenticated]);

  useEffect(() => {
    if (!session.isAuthenticated) return;
    return startSessionEvents(
      async () => {
        const snapshot = await refreshSession({ silent: true });
        if (!sessionConfirmedRef.current) return "unavailable";
        return snapshot.isAuthenticated ? "active" : "anonymous";
      },
      (active) => {
        eventSyncRef.current = active;
        setEventSync(active);
      },
    );
  }, [refreshSession, session.isAuthenticated]);

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
    async (tenantId: string, returnTo?: string) => {
      // 顶层导航(见 buildTenantSwitchUrl):IdP 要收到中央会话 cookie 才能静默发码。
      // 不传 returnTo 就回到当前地址,查询串原样保留(/subscribe?product=… 之类的
      // 深链上下文不能丢)。
      setStatus("loading");
      const dest = new URL(
        returnTo ?? `${window.location.pathname}${window.location.search}`,
        window.location.origin,
      ).toString();
      window.location.assign(buildTenantSwitchUrl(tenantId, dest));
      // 页面即将卸载:不 resolve,免得调用方在导航中途继续改状态。
      await new Promise<void>(() => undefined);
    },
    [],
  );

  const switchWorkspace = useCallback(
    async (workspaceId: string, returnTo?: string) => {
      // 与 switchTenant 同一个理由:顶层导航,IdP 要收到中央会话 cookie。
      setStatus("loading");
      const dest = new URL(
        returnTo ?? `${window.location.pathname}${window.location.search}`,
        window.location.origin,
      ).toString();
      window.location.assign(buildWorkspaceSwitchUrl(workspaceId, dest));
      // 页面即将卸载:不 resolve,免得调用方在导航中途继续改状态。
      await new Promise<void>(() => undefined);
    },
    [],
  );

  // Stable context value: consumers only re-render when session/status actually
  // change, not on every ancestor render.
  const contextValue = useMemo<SessionContextValue>(
    () => ({
      session,
      status,
      signOut,
      switchTenant,
      switchWorkspace,
      refreshSession,
    }),
    [session, status, signOut, switchTenant, switchWorkspace, refreshSession],
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
