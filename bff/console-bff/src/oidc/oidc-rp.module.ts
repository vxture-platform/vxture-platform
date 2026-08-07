/**
 * oidc-rp.module.ts - console-bff OIDC Relying Party wiring (P1-e, additive)
 * @package @vxture/bff-console
 * @description
 *   Wires @vxture/core-oidc-rp for console as a confidential RP. Provides the
 *   OIDC client, RP session store, and per-request auth service. The routes
 *   (OidcAuthRouter) live under /auth/* — outside api/* — so the existing
 *   AuthMiddleware (legacy vx_tenant_*) is untouched in this slice; the
 *   gray-rollout dual-read into AuthMiddleware is a follow-up sub-slice.
 *   See docs/design/identity-platform-rp-integration.md.
 */
import { Module } from "@nestjs/common";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import {
  HttpOidcRpClient,
  RpAuthService,
  RpSessionStore,
  type OidcRpConfig,
} from "@vxture/core-oidc-rp";
import Redis from "ioredis";
import { OidcAuthRouter } from "../routers/oidc-auth.router";
import {
  RP_AUTH_SERVICE,
  RP_OIDC_CLIENT,
  RP_REDIS,
  RP_RUNTIME,
  RP_SESSION_STORE,
  type RpRuntime,
} from "./oidc-rp.tokens";

const CLIENT_ID = "console";

@Module({
  imports: [
    VxConfigModule.register({ domains: ["auth", "redis", "platform"] }),
  ],
  controllers: [OidcAuthRouter],
  providers: [
    {
      provide: RP_RUNTIME,
      inject: [VxConfigService],
      useFactory: (c: VxConfigService): RpRuntime => {
        const consoleBase = c.platform.CONSOLE_BASE_URL;
        const cfg: OidcRpConfig = {
          issuer: c.auth.OIDC_ISSUER,
          // Back-channel (token + JWKS) over the internal IdP URL so it never
          // hairpins out to the public issuer (Cloudflare). iss is still verified
          // against the public issuer.
          backchannelIssuer:
            process.env.OIDC_BACKCHANNEL_ISSUER ?? process.env.AUTH_BFF_URL,
          clientId: process.env.OIDC_CLIENT_ID ?? CLIENT_ID,
          clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
          redirectUri:
            process.env.OIDC_REDIRECT_URI ?? `${consoleBase}/auth/callback`,
          scopes: (process.env.OIDC_SCOPES ?? "openid profile console")
            .split(/\s+/)
            .filter(Boolean),
          // 会话由两个时钟界定：门户的闲置钟（identity-sdk/idle.ts）与 IdP 的总时效
          // （24h）。RP 会话没有独立于这两者之外的第三个寿命——原先那些 30 天 / 12 小时
          // 的值和它们所代表的登录态都对不上（见 workplans §二十三）。
          sessionTtlSec: Number(process.env.RP_SESSION_TTL ?? 86400),
        };
        return {
          config: cfg,
          enabled: (process.env.OIDC_RP_ENABLED ?? "false") === "true",
          allowedReturnOrigins: [consoleBase],
          defaultReturnTo: `${consoleBase}/`,
          // Unified post-logout page on the accounts surface. In prod the issuer
          // IS the accounts origin (accounts.vxture.com), so ${issuer}/logout is
          // correct; locally accounts runs on a separate port, set explicitly.
          postLogoutRedirectUri:
            process.env.OIDC_POST_LOGOUT_REDIRECT_URI ??
            `${c.auth.OIDC_ISSUER.replace(/\/$/, "")}/logout`,
          // __Host- cookies require Secure; honored in prod (https). Local http
          // e2e is driven via curl, which stores the cookie regardless.
          cookieSecure: process.env.RP_COOKIE_INSECURE !== "true",
          keyPrefix: c.redis.REDIS_KEY_PREFIX ?? "vx:",
        };
      },
    },
    {
      provide: RP_REDIS,
      inject: [VxConfigService],
      useFactory: (c: VxConfigService) => {
        const r = c.redis;
        return r.REDIS_URL
          ? new Redis(r.REDIS_URL, { lazyConnect: false })
          : new Redis({
              host: r.REDIS_HOST ?? "localhost",
              port: r.REDIS_PORT ?? 6379,
              password: r.REDIS_PASSWORD,
              db: r.REDIS_DB,
            });
      },
    },
    {
      provide: RP_OIDC_CLIENT,
      inject: [RP_RUNTIME],
      useFactory: (rt: RpRuntime) => new HttpOidcRpClient(rt.config),
    },
    {
      provide: RP_SESSION_STORE,
      inject: [RP_REDIS, VxConfigService],
      useFactory: (redis: Redis, c: VxConfigService) =>
        new RpSessionStore(redis, CLIENT_ID, c.redis.REDIS_KEY_PREFIX ?? "vx:"),
    },
    {
      provide: RP_AUTH_SERVICE,
      inject: [RP_SESSION_STORE, RP_OIDC_CLIENT, RP_RUNTIME],
      useFactory: (
        store: RpSessionStore,
        client: HttpOidcRpClient,
        rt: RpRuntime,
      ) => new RpAuthService(store, client, rt.config.sessionTtlSec),
    },
  ],
  exports: [RP_AUTH_SERVICE, RP_SESSION_STORE, RP_OIDC_CLIENT, RP_RUNTIME],
})
export class OidcRpModule {}
