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
  useCallback,
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
  /**
   * 当前操作者的能力码（`admin.operator_permission.perm_code` 同域）。
   *
   * 与 `operator` 分两次取是刻意的：身份来自 RP 令牌的 claims（`/auth/session`，
   * 不碰库），授权要回库解析（`/api/session`）。两件事、两个来源，端点也分开。
   *
   * ⚠ **只用来决定界面显示什么**。真正的裁决在 BFF 各 router 的能力门上——
   * 前端藏了按钮不等于接口关了，接口自己会 403。
   */
  capabilities: readonly string[];
  /** 能力码就绪前一律当作"没有"，避免写操作按钮闪一下又消失。 */
  can: (capability: string) => boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  operator: null,
  status: "loading",
  capabilities: [],
  can: () => false,
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
  const [capabilities, setCapabilities] = useState<readonly string[]>([]);

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

  // 能力码单独取：来源是库不是令牌。失败就保持空数组——界面按"没有权限"渲染，
  // 这个方向是安全的（多藏按钮不会造成越权，多显才会）。
  useEffect(() => {
    if (status !== "ready") return;
    let active = true;
    fetch("/api/session", { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (!active || !res.ok) return;
        const body = (await res.json()) as { capabilities?: string[] };
        setCapabilities(body.capabilities ?? []);
      })
      .catch(() => {
        /* 保持空数组 */
      });
    return () => {
      active = false;
    };
  }, [status]);

  const can = useCallback(
    (capability: string) => capabilities.includes(capability),
    [capabilities],
  );

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
    <SessionContext.Provider
      value={{ operator, status, capabilities, can, signOut }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useOperatorSession() {
  return useContext(SessionContext);
}
