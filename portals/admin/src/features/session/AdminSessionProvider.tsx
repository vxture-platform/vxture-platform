"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { IDLE_MS, startIdleWatcher } from "@vxture/core-identity-sdk";
import { buildRpLoginUrl, logout, restoreSession } from "@/api/admin-bff";
import type { SessionSnapshot } from "@/entities/console";

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

  useEffect(() => {
    let active = true;

    const params = new URLSearchParams(window.location.search);
    const silentJustFailed = params.get("vx_sso_silent") === "0";
    if (silentJustFailed) {
      params.delete("vx_sso_silent");
      const cleanUrl = `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}${window.location.hash}`;
      window.history.replaceState(null, "", cleanUrl);
    }

    restoreSession()
      .then((snapshot) => {
        if (!active) return;
        setSession(snapshot);
        if (snapshot.isAuthenticated) {
          setStatus("ready");
          return;
        }
        /* 未登录：**不置 ready**，直接把浏览器送走。
         *
         * 原先这里先 setStatus('ready') 再跳转，于是外壳会拿着"已就绪但未登录"
         * 的状态渲染一帧（骨架/空壳），紧接着整页被替换掉——冷启动要落回门户
         * 两次，这一帧就闪两次。状态停在 loading，加载页一直盖着，直到导航发生。
         *
         * 静默失败过就直接走交互式登录，不再退回 `/login` 中转页：那一跳是一次
         * 完整的页面加载，只为了在屏幕上写一句"正在跳转到登录…"再跳走。
         * BFF 侧还记了一个 5 分钟的备忘 cookie，所以连着刷新也不会重复静默往返。 */
        window.location.replace(
          silentJustFailed
            ? buildRpLoginUrl(window.location.href)
            : buildRpLoginUrl(window.location.href, { prompt: "none" }),
        );
      })
      .catch(() => {
        if (!active) return;
        setSession(EMPTY_SESSION);
        setStatus("ready");
      });

    return () => {
      active = false;
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
      onIdle: () => {
        void signOut();
      },
    });
    // signOut 只依赖模块级的 logout 与两个 setter，身份稳定，不必进依赖数组。
    // （新版 react-hooks 已不再对此报 exhaustive-deps，原来的行内豁免成了
    // "unused disable directive"，反过来卡 CI 的零警告闸——豁免随规则一起退。）
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
    setSession(EMPTY_SESSION);
    setStatus("ready");
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
