"use client";

/* Capability Console session bootstrap. Defense-in-depth only: in production
 * the nginx auth_request gate already guarantees no page is served without an
 * RP session (hardening "any path, no content unauthenticated"), so this
 * provider mainly hydrates operator identity for the header; the redirect
 * branch matters in dev (no edge gate) and on session expiry while the tab
 * stays open. All URLs are same-origin relative — the real hostname never
 * enters the bundle. */

import { IDLE_MS, startIdleWatcher } from "@vxture/core-identity-sdk";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface OperatorIdentity {
  sub: string;
  displayName: string;
  role: string;
}

type SessionStatus = "loading" | "ready" | "anonymous";

interface SessionContextValue {
  operator: OperatorIdentity | null;
  status: SessionStatus;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  operator: null,
  status: "loading",
  signOut: async () => undefined,
});

export function buildLoginUrl(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

function toIdentity(claims: Record<string, unknown>): OperatorIdentity {
  const pick = (k: string): string =>
    typeof claims[k] === "string" ? (claims[k] as string) : "";
  return {
    sub: pick("sub"),
    displayName:
      pick("name") || pick("preferred_username") || pick("sub") || "Operator",
    role: pick("operator_role"),
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<OperatorIdentity | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  useEffect(() => {
    let active = true;
    fetch("/auth/session", { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (!active) return;
        if (res.ok) {
          const body = (await res.json()) as {
            claims?: Record<string, unknown>;
          };
          setOperator(toIdentity(body.claims ?? {}));
          setStatus("ready");
          return;
        }
        setStatus("anonymous");
        if (res.status === 401 || res.status === 403) {
          window.location.replace(buildLoginUrl(window.location.href));
        }
      })
      .catch(() => {
        if (active) setStatus("anonymous");
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * 闲置钟。到点**直接登出，不弹窗询问**——"要不要继续"是消费级网银的 UX 惯例
   * 而非安全要求（NIST 800-63B 未要求），对正在操作的人定期打断是荒谬的
   * （owner 2026-08-07 判，见 workplans §二十三）。判据由真实交互事件给出，
   * 不是请求频率：读长表格、填长表单的人一个请求都不发，但他在场。
   */
  useEffect(() => {
    return startIdleWatcher({
      idleMs: IDLE_MS.workforce,
      storageKey: "vx:opera:last-activity",
      onIdle: () => {
        void signOut();
      },
    });
  }, []);

  async function signOut() {
    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* local sign-out stays resilient if the BFF is unreachable */
    }
    window.location.replace(buildLoginUrl(window.location.origin + "/"));
  }

  return (
    <SessionContext.Provider value={{ operator, status, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useOperatorSession() {
  return useContext(SessionContext);
}
