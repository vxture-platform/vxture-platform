"use client";

/* Capability Console session bootstrap. Defense-in-depth only: in production
 * the nginx auth_request gate already guarantees no page is served without an
 * RP session (hardening "any path, no content unauthenticated"), so this
 * provider mainly hydrates operator identity for the header; the redirect
 * branch matters in dev (no edge gate) and on session expiry while the tab
 * stays open. All URLs are same-origin relative — the real hostname never
 * enters the bundle. */

import {
  broadcastSignOut,
  IDLE_MS,
  onSignOutBroadcast,
  signOutBroadcastKey,
  startIdleWatcher,
} from "@vxture/core-identity-sdk";
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
  /** 运营者邮箱。与 admin 同源（`admin.operator_account.email`），经 access_token 下发。 */
  email: string;
  /**
   * 邮箱认证态。**与 email 成对**——只拿得到邮箱而拿不到它的认证态，面板要么不显示、
   * 要么写死一个字面量，admin 那边正是这么错过一轮。
   */
  emailVerified: boolean;
}

/** `forbidden`：身份成立，但没有进入本平台的权限（没有本平台根码）。 */
type SessionStatus = "loading" | "ready" | "anonymous" | "forbidden";

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

const SIGN_OUT_KEY = signOutBroadcastKey("arche");

export function buildLoginUrl(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

function toIdentity(claims: Record<string, unknown>): OperatorIdentity {
  const pick = (k: string): string =>
    typeof claims[k] === "string" ? (claims[k] as string) : "";
  const role = pick("operator_role");
  return {
    sub: pick("sub"),
    email: pick("email"),
    emailVerified: claims["email_verified"] === true,
    /**
     * **兜底不落到 `sub`。**
     *
     * 原来的链是 `name → preferred_username → sub → "Operator"`，而运营者的 `sub`
     * 是 `opr_<uuid>`——于是「取不到名字」被渲染成了一串 UUID，违反本仓那条
     * 「任何场景只展示可视码」。
     *
     * 更要紧的是它**掩盖了故障**：真正的原因是 `name` 只进了 id_token 而 RP 会话
     * 解析的是 access_token（已在 auth-bff 一并修），但界面上看不出「没取到名字」，
     * 只看到一个像是身份的字符串，于是没人去查。
     *
     * 落到角色名、再落到「运营者」：两者都**明显不是一个人名**，取不到就看得出来。
     */
    displayName: pick("name") || pick("preferred_username") || role || "运营者",
    role,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<OperatorIdentity | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [capabilities, setCapabilities] = useState<readonly string[]>([]);

  // Revalidate identity and capabilities together after foreground transitions.
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let lastSyncAt = 0;
    let currentSubject: string | null = null;
    const controller = new AbortController();
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
      const options = {
        credentials: "include" as const,
        cache: "no-store" as const,
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15_000),
        ]),
      };
      try {
        const response = await fetch("/auth/session", options);
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          setOperator(null);
          setCapabilities([]);
          setStatus("anonymous");
          window.location.replace(buildLoginUrl(window.location.href));
          return;
        }
        if (!response.ok) return;
        const body = (await response.json()) as {
          claims?: Record<string, unknown>;
        };
        if (!active) return;
        const identity = toIdentity(body.claims ?? {});
        // Keep verified grants during same-account background reconciliation.
        // Identity changes must clear the previous account before permission loading.
        if (identity.sub !== currentSubject) {
          currentSubject = identity.sub;
          setCapabilities([]);
          setStatus("ready");
        }
        setOperator(identity);
        const permissions = await fetch("/api/session", options);
        if (!active) return;
        if (permissions.status === 401) {
          setOperator(null);
          setCapabilities([]);
          setStatus("anonymous");
          window.location.replace(buildLoginUrl(window.location.href));
          return;
        }
        if (permissions.status === 403) {
          setCapabilities([]);
          setStatus("forbidden");
          return;
        }
        if (!permissions.ok) return;
        const access = (await permissions.json()) as {
          capabilities?: string[];
          planeEntitled?: boolean;
        };
        if (!active) return;
        setCapabilities(access.capabilities ?? []);
        setStatus(access.planeEntitled === false ? "forbidden" : "ready");
      } catch {
        // A network failure is not proof that the central session ended.
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
      storageKey: "vx:arche:last-activity",
      /* admin/opera 共用中央会话，闲置也按同一个人算：任一工作台有活动，全体不闲。
         否则后台开着的另一个工作台 30 分钟没动就全局登出，把正在干活的人带走。 */
      sharedActivityCookie: "vx_wf_activity",
      onIdle: () => {
        void signOut();
      },
    });
  }, []);

  /**
   * 同源的另一个标签页登出了 → 本页也走。
   *
   * 服务端会话已经没了，本页却不会自己发现——它不发请求就一直停在登录后的界面上，
   * 能点能填，直到某次请求撞上 401 或用户手动刷新。这里**不复用登出流程**：
   * 会话早已结束，再 POST 一次 /auth/logout 是对着空气打；直接回登录入口。
   */
  useEffect(() => {
    return onSignOutBroadcast(SIGN_OUT_KEY, () => {
      window.location.replace(buildLoginUrl(window.location.origin + "/"));
    });
  }, []);

  /**
   * 登出 = 本地清理 + **顶层跳到 IdP 结束中央会话**。
   *
   * 只做前半段的话，中央会话仍在，下一次 authorize 会静默 SSO 把人直接送回来——
   * 用户看到的是「点了退出，还是登录态」。后半段必须是顶层导航：accounts 域的会话
   * cookie 是 SameSite=Lax，跨站 fetch 不带它。
   *
   * 地址由 BFF 给（它知道 issuer、client、id_token）。拿不到就退回登录页——那至少
   * 是个诚实的失败：本地会话确实没了，不会停在一个看着像登录态的界面上。
   */
  async function signOut() {
    let endSessionUrl: string | undefined;
    try {
      const res = await fetch("/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const body = (await res.json()) as { endSessionUrl?: string };
        endSessionUrl = body.endSessionUrl;
      }
    } catch {
      /* local sign-out stays resilient if the BFF is unreachable */
    }
    broadcastSignOut(SIGN_OUT_KEY);
    window.location.replace(
      endSessionUrl ?? buildLoginUrl(window.location.origin + "/"),
    );
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
