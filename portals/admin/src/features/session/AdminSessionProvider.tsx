"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  broadcastSignOut,
  IDLE_MS,
  onSignOutBroadcast,
  signOutBroadcastKey,
  startIdleWatcher,
} from "@vxture/core-identity-sdk";
import { buildRpLoginUrl, logout, restoreSession } from "@/api/admin-bff";
import type { SessionSnapshot } from "@/entities/console";

const SIGN_OUT_KEY = signOutBroadcastKey("admin");

type SessionStatus = "idle" | "loading" | "ready";

const EMPTY_SESSION: SessionSnapshot = {
  isAuthenticated: false,
  user: null,
  capabilities: [],
};

interface SessionContextValue {
  session: SessionSnapshot;
  status: SessionStatus;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  session: EMPTY_SESSION,
  status: "idle",
  signOut: async () => undefined,
  refreshSession: async () => undefined,
});

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionSnapshot>(EMPTY_SESSION);
  const [status, setStatus] = useState<SessionStatus>("loading");

  // Probe independently: restoreSession also returns an empty snapshot on outages.
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let lastSyncAt = 0;
    const controller = new AbortController();
    const params = new URLSearchParams(window.location.search);
    const silentJustFailed = params.get("vx_sso_silent") === "0";
    if (silentJustFailed) {
      params.delete("vx_sso_silent");
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`,
      );
    }
    const sessionUrl = new URL(buildRpLoginUrl(), window.location.origin);
    sessionUrl.pathname = sessionUrl.pathname.replace(/\/login$/, "/session");
    sessionUrl.search = "";
    const sync = async () => {
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
        const response = await fetch(sessionUrl.href, {
          credentials: "include",
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15_000),
          ]),
        });
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          setSession(EMPTY_SESSION);
          setStatus("loading");
          window.location.replace(
            silentJustFailed
              ? buildRpLoginUrl(window.location.href)
              : buildRpLoginUrl(window.location.href, { prompt: "none" }),
          );
          return;
        }
        if (!response.ok) return;
        const snapshot = await restoreSession();
        if (!active || !snapshot.isAuthenticated) return;
        setSession(snapshot);
        setStatus("ready");
      } catch {
        // Retain the authenticated shell on transient failures; retry on focus.
      } finally {
        inFlight = false;
      }
    };
    const reconcile = () => {
      void sync();
    };
    reconcile();
    const interval = window.setInterval(reconcile, 300_000);
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pageshow", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, []);

  /**
   * 闲置钟。运营面 30 分钟，到点**直接登出，不弹窗询问**。
   *
   * "要不要继续"是消费级网银的 UX 惯例而非安全要求（NIST 800-63B 未要求），对
   * 正在操作的人定期打断是荒谬的（owner 2026-08-07 判，见 workplans §二十三）。
   * 判据由真实交互事件给出，不是请求频率——读长表格、填长表单的人一个请求都不发，
   * 但他在场。
   */
  useEffect(() => {
    return startIdleWatcher({
      idleMs: IDLE_MS.workforce,
      storageKey: "vx:admin:last-activity",
      /* 同 opera：workforce 一体计闲，见 SessionProvider 同位置注释。 */
      sharedActivityCookie: "vx_wf_activity",
      onIdle: () => {
        void signOut();
      },
    });
    // signOut 只依赖模块级的 logout 与两个 setter，身份稳定，不必进依赖数组。
    // （新版 react-hooks 已不再对此报 exhaustive-deps，原来的行内豁免成了
    // "unused disable directive"，反过来卡 CI 的零警告闸——豁免随规则一起退。）
  }, []);

  /**
   * 同源的另一个标签页登出了 → 本页也走。
   *
   * 服务端会话已经没了，本页却不会自己发现——它不发请求就一直停在登录后的界面上，
   * 能点能填。这里**不复用登出流程**：会话早已结束，再 POST 一次 logout 是对着
   * 空气打；直接回登录入口。
   */
  useEffect(() => {
    return onSignOutBroadcast(SIGN_OUT_KEY, () => {
      window.location.replace(buildRpLoginUrl(window.location.origin + "/"));
    });
  }, []);

  /**
   * 登出 = 本地清理 + **顶层跳到 IdP 结束中央会话**。
   *
   * 原来这里只清了 React state：中央会话在、RP cookie 刚被 BFF 清掉，页面却留在原地，
   * 下一次取数一跳 authorize 就静默 SSO 回来了——用户看到的是「点了退出，还是登录态」。
   * 跳转必须是顶层导航：accounts 域的会话 cookie 是 SameSite=Lax，跨站 fetch 不带它。
   */
  async function signOut() {
    const endSessionUrl = await logout();
    /**
     * **不在这里 setState。**
     *
     * 原先这里先 `setSession(EMPTY_SESSION)` 再跳转，React 立刻按"未认证"重绘，
     * 消费方的守卫抢在 `location.replace` 生效之前把页面跳去登录——实测从 admin
     * 登出落在 `login?login_challenge=…` 而不是登出页。页面正在离开，那次重绘
     * 没有任何意义，只会制造一场和自己的竞速。
     */
    broadcastSignOut(SIGN_OUT_KEY);
    window.location.replace(
      endSessionUrl ?? buildRpLoginUrl(window.location.origin + "/"),
    );
  }

  async function refreshSession() {
    setStatus("loading");
    const snapshot = await restoreSession();
    setSession(snapshot);
    setStatus("ready");
  }

  return (
    <SessionContext.Provider
      value={{
        session,
        status,
        signOut,
        refreshSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useAdminSession() {
  return useContext(SessionContext);
}
