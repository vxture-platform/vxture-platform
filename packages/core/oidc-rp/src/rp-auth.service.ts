/**
 * rp-auth.service.ts - per-request RP auth orchestration
 * @package @vxture/core-oidc-rp
 * @description
 *   Resolves an authenticated request from the opaque rpsid: loads the RP
 *   session, silently refreshes the access token when near expiry (rotation
 *   updates server-side state only — the rpsid cookie is stable), verifies the
 *   (possibly refreshed) access token via JWKS, and returns its claims. A
 *   missing session or a failed refresh yields "expired" so the BFF can route
 *   to re-login. Framework-light: the BFF middleware/guard wraps this.
 *   See identity-platform-rp-integration.md §6/§7.
 */
import type { OidcRpClient, RpSession } from "./types";
import type { RpSessionStore } from "./rp-session.store";

/** Seconds before access-token expiry at which we proactively refresh. */
const DEFAULT_REFRESH_SKEW = 60;

export type RpAuthOutcome =
  | {
      status: "ok";
      rpsid: string;
      /** verified access-token claims (sub, userType, active_org, active_workspace, roles, …) */
      claims: Record<string, unknown>;
      /** true if the access token was refreshed on this request */
      refreshed: boolean;
      /**
       * The raw (verified) access token backing this session — needed when the
       * BFF must present it as an RFC 8693 subject_token (e.g. the operator-OBO
       * exchange of product_250 M-1). Server-side only; never send to the browser.
       */
      accessToken: string;
    }
  | { status: "expired" }; // no usable session / refresh failed → re-login

export class RpAuthService {
  /**
   * 正在飞的刷新，按 rpsid 去重。
   *
   * 一次页面加载会并发打出十几个带同一 rpsid 的请求（console 实测约 19 个），
   * 它们会同时落进过期前 60 秒的窗口里。没有这个表，十几个请求就拿**同一枚**
   * refresh token 各自去换 —— IdP 那边一个赢、其余全部被判为重放。
   *
   * 行业 SDK（auth0-spa-js、MSAL）都是这个做法：共享同一个 in-flight promise。
   * 我们是 BFF 架构，所以落点在服务端而不是浏览器——单进程内这一张表就能
   * 消掉绝大多数并发；跨进程那一档由下面 `refreshOnce` 的回读兑掉。
   */
  private readonly inFlight = new Map<string, Promise<RpSession | null>>();

  constructor(
    private readonly store: RpSessionStore,
    private readonly client: OidcRpClient,
    private readonly sessionTtlSec: number,
    private readonly refreshSkewSec: number = DEFAULT_REFRESH_SKEW,
  ) {}

  /**
   * Resolve the authenticated context for a request bearing `rpsid`.
   * Returns "expired" when there is no session or the refresh fails (the BFF
   * then 401s an XHR or 302s a page navigation to /auth/login).
   */
  async resolve(rpsid: string | undefined): Promise<RpAuthOutcome> {
    if (!rpsid) return { status: "expired" };

    let session = await this.store.get(rpsid);
    if (!session) return { status: "expired" };

    let refreshed = false;
    const now = Math.floor(Date.now() / 1000);
    if (now >= session.accessExpiresAt - this.refreshSkewSec) {
      const next = await this.refreshOnce(rpsid, session);
      if (!next) return { status: "expired" };
      refreshed = next !== session;
      session = next;
    }

    let claims: Record<string, unknown>;
    try {
      claims = await this.client.verifyAccessToken(session.accessToken);
    } catch {
      return { status: "expired" };
    }
    return {
      status: "ok",
      rpsid,
      claims,
      refreshed,
      accessToken: session.accessToken,
    };
  }

  /**
   * 刷新一次，同一 rpsid 的并发调用共享同一个结果。
   * 返回 `null` = 这条会话真的没了（已销毁）。
   */
  private refreshOnce(
    rpsid: string,
    session: RpSession,
  ): Promise<RpSession | null> {
    const existing = this.inFlight.get(rpsid);
    if (existing) return existing;

    const pending = this.doRefresh(rpsid, session);
    this.inFlight.set(rpsid, pending);
    void pending.finally(() => {
      if (this.inFlight.get(rpsid) === pending) this.inFlight.delete(rpsid);
    });
    return pending;
  }

  private async doRefresh(
    rpsid: string,
    session: RpSession,
  ): Promise<RpSession | null> {
    try {
      const next = await this.client.refresh(session.refreshToken);
      const updated: RpSession = {
        ...session,
        idToken: next.idToken,
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        accessExpiresAt: next.accessExpiresAt,
      };
      await this.store.update(rpsid, updated, this.sessionTtlSec);
      return updated;
    } catch {
      /* 刷新被拒不等于会话没了。跨进程并发时（另一个 BFF 实例、桌面端与
         浏览器同时在用），别人可能刚刚换成功并把新令牌写回了存储。
         所以先回读一次：存储里的过期时刻向前走了，就用那份，不要把人踢下线。
         旧写法是 catch 里直接 destroy，于是任何一次刷新失败都等于登出。 */
      const fresh = await this.store.get(rpsid);
      if (fresh && fresh.accessExpiresAt > session.accessExpiresAt)
        return fresh;
      await this.store.destroy(rpsid);
      return null;
    }
  }
}
