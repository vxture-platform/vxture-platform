/**
 * oidc-rp.module.ts - opera-bff OIDC Relying Party wiring (product_250 M-4)
 * @package @vxture/bff-opera
 * @description
 *   Wires @vxture/core-oidc-rp for the Capability Console shell as a
 *   confidential RP in the WORKFORCE realm (client_id=opera). Same shape
 *   as admin-bff's RP wiring; base URL comes from OPERA_BASE_URL, which in
 *   production carries the real (repo-external) hostname. RP routes live under
 *   /auth/*; /auth/check additionally serves the nginx auth_request gate that
 *   enforces the "no content unauthenticated" hardening at the vhost edge.
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
import { OperatorExchangeService } from "../auth/operator-exchange.service";
import {
  RP_AUTH_SERVICE,
  RP_OIDC_CLIENT,
  RP_REDIS,
  RP_RUNTIME,
  RP_SESSION_STORE,
  type RpRuntime,
} from "./oidc-rp.tokens";

const CLIENT_ID = "opera";

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
        const consoleBase = c.platform.OPERA_BASE_URL;
        const cfg: OidcRpConfig = {
          issuer: c.auth.OIDC_ISSUER,
          // Back-channel (token + JWKS) over the internal IdP URL so it never
          // hairpins out to the public issuer (times out from the origin).
          backchannelIssuer:
            process.env.OIDC_BACKCHANNEL_ISSUER ?? process.env.AUTH_BFF_URL,
          clientId: process.env.OIDC_CLIENT_ID ?? CLIENT_ID,
          clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
          redirectUri:
            process.env.OIDC_REDIRECT_URI ?? `${consoleBase}/auth/callback`,
          scopes: (process.env.OIDC_SCOPES ?? "openid profile admin")
            .split(/\s+/)
            .filter(Boolean),
          // Operator surface: short RP session (default 12h), not the 30d
          // customer default — small audience, high privilege.
          // 会话由两个时钟界定：门户的闲置钟（identity-sdk/idle.ts）与 IdP 的总时效
          // （24h）。RP 会话没有独立于这两者之外的第三个寿命——原先那些 30 天 / 12 小时
          // 的值和它们所代表的登录态都对不上（见 workplans §二十三）。
          sessionTtlSec: Number(process.env.RP_SESSION_TTL ?? 86400),
        };
        return {
          config: cfg,
          allowedReturnOrigins: [consoleBase],
          defaultReturnTo: `${consoleBase}/`,
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
    OperatorExchangeService,
  ],
  exports: [RP_AUTH_SERVICE, RP_SESSION_STORE, RP_OIDC_CLIENT, RP_RUNTIME],
})
export class OidcRpModule {}
