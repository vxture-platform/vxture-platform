/**
 * oidc-rp.module.ts - admin-bff OIDC Relying Party wiring (P2, additive)
 * @package @vxture/bff-admin
 * @description
 *   Wires @vxture/core-oidc-rp for admin as a confidential RP in the OPERATOR
 *   realm (client_id=admin, scopes "openid profile admin"). Provides the OIDC
 *   client, RP session store, and per-request auth service. RP routes live under
 *   /auth/* (outside api/*), so the legacy delegate-sign AuthMiddleware path is
 *   untouched here; the gray-rollout dual-read into AuthMiddleware is gated by
 *   OIDC_RP_ENABLED. The operator central session is host-only (vx_sid_op, D-7)
 *   and never bleeds to tenant subdomains. See docs/design/identity-platform-operator.md.
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

const CLIENT_ID = "admin";

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
        const adminBase = c.platform.ADMIN_BASE_URL;
        const cfg: OidcRpConfig = {
          issuer: c.auth.OIDC_ISSUER,
          // Back-channel (token + JWKS) over the internal IdP URL so it never
          // hairpins out to the public issuer (Cloudflare), which times out from
          // the origin. iss is still verified against the public issuer.
          backchannelIssuer:
            process.env.OIDC_BACKCHANNEL_ISSUER ?? process.env.AUTH_BFF_URL,
          clientId: process.env.OIDC_CLIENT_ID ?? CLIENT_ID,
          clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
          redirectUri:
            process.env.OIDC_REDIRECT_URI ?? `${adminBase}/auth/callback`,
          scopes: (process.env.OIDC_SCOPES ?? "openid profile admin")
            .split(/\s+/)
            .filter(Boolean),
          // 会话由两个时钟界定：门户的闲置钟（identity-sdk/idle.ts）与 IdP 的总时效
          // （24h）。RP 会话没有独立于这两者之外的第三个寿命——原先那个 30 天的值
          // 比它所代表的登录态活得久得多，是纯粹的摆设（见 workplans §二十三）。
          sessionTtlSec: Number(process.env.RP_SESSION_TTL ?? 86400),
        };
        return {
          config: cfg,
          allowedReturnOrigins: [adminBase],
          defaultReturnTo: `${adminBase}/`,
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
