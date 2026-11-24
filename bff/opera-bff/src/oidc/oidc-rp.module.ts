/**
 * Compose the opera confidential RP and optional durable identity synchronization.
 * @package @vxture/bff-opera
 * @layer Application
 * @category module
 * @author AI-Generated
 * @date 2026-11-24
 */
import { Module } from "@nestjs/common";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import {
  HttpOidcRpClient,
  RpAuthService,
  RpSessionStore,
  HttpIdentityRecoveryClient,
  HttpIdentityChangesClient,
  IdentityEventVerifier,
  type IdentityEnvironment,
  type OidcRpConfig,
} from "@vxture/core-oidc-rp";
import Redis from "ioredis";
import { OperatorExchangeService } from "../auth/operator-exchange.service";
import { Pool, type PoolConfig } from "pg";
import { SessionRecoveryAuthority } from "./session-recovery.authority";
import { SessionEventsHub } from "./session-events.hub";
import { IdentityChangesAuthority } from "./identity-changes.authority";
import { IdentityEventsRouter } from "../routers/identity-events.router";
import { SessionEventsRouter } from "../routers/session-events.router";
import { OidcAuthRouter } from "../routers/oidc-auth.router";
import {
  RP_AUTH_SERVICE,
  RP_OIDC_CLIENT,
  RP_REDIS,
  RP_RUNTIME,
  RP_SESSION_STORE,
  RP_RECOVERY,
  RP_SESSION_EVENTS,
  RP_CHANGES,
  RP_EVENT_VERIFIER,
  type RpRuntime,
} from "./oidc-rp.tokens";

const CLIENT_ID = "opera";

/** @returns The same bounded database configuration for recovery and LISTEN. */
function recoveryPostgres(c: VxConfigService): PoolConfig {
  const database = c.database;
  return {
    ...(database.DATABASE_URL
      ? { connectionString: database.DATABASE_URL }
      : {
          host: database.DB_HOST,
          port: database.DB_PORT,
          database: database.DB_NAME,
          user: database.DB_USER,
          password: database.DB_PASSWORD,
          ssl:
            database.DB_SSL === "require"
              ? { rejectUnauthorized: false }
              : undefined,
        }),
    max: database.DB_POOL_MAX,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  };
}

@Module({
  imports: [
    VxConfigModule.register({
      domains: ["auth", "redis", "platform", "database"],
    }),
  ],
  controllers: [OidcAuthRouter, SessionEventsRouter, IdentityEventsRouter],
  providers: [
    OperatorExchangeService,
    {
      provide: RP_RUNTIME,
      inject: [VxConfigService],
      useFactory: (c: VxConfigService): RpRuntime => {
        const websiteBase = c.platform.OPERA_BASE_URL;
        const sessionPollingRetirement =
          process.env.RP_SESSION_POLLING_RETIREMENT_ENABLED === "true";
        if (
          sessionPollingRetirement &&
          [
            "true",
            process.env.RP_IDENTITY_RECOVERY_ENABLED,
            process.env.RP_SESSION_EVENTS_ENABLED,
            process.env.RP_IDENTITY_CHANGES_ENABLED,
          ].some((value) => value !== "true")
        )
          throw new Error(
            "Polling retirement requires the RP, recovery, changes and session events",
          );
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
            process.env.OIDC_REDIRECT_URI ?? `${websiteBase}/auth/callback`,
          scopes: (process.env.OIDC_SCOPES ?? "openid profile admin")
            .split(/\s+/)
            .filter(Boolean),
          // 会话由两个时钟界定：门户的闲置钟（identity-sdk/idle.ts）与 IdP 的总时效
          // （24h）。RP 会话没有独立于这两者之外的第三个寿命——原先那些 30 天 / 12 小时
          // 的值和它们所代表的登录态都对不上（见 workplans §二十三）。
          sessionTtlSec: Number(process.env.RP_SESSION_TTL ?? 86400),
        };
        return {
          config: cfg,
          sessionPollingRetirement,
          enabled: true,
          allowedReturnOrigins: [websiteBase],
          defaultReturnTo: `${websiteBase}/`,
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
      provide: RP_RECOVERY,
      inject: [VxConfigService, RP_RUNTIME, RP_REDIS],
      useFactory: (c: VxConfigService, rt: RpRuntime, redis: Redis) => {
        if (process.env.RP_IDENTITY_RECOVERY_ENABLED !== "true") return null;
        const environment = process.env.RP_IDENTITY_ENVIRONMENT;
        if (
          !rt.enabled ||
          !["prod", "beta", "dev"].includes(environment ?? "") ||
          !rt.config.clientSecret
        )
          throw new Error(
            "Identity recovery requires an enabled confidential RP and explicit environment",
          );
        const pool = new Pool(recoveryPostgres(c));
        const scope = {
          realm: "workforce" as const,
          issuer: rt.config.issuer,
          clientId: rt.config.clientId,
          environment: environment as IdentityEnvironment,
        };
        const authority = new SessionRecoveryAuthority(
          pool,
          new HttpIdentityRecoveryClient(
            rt.config,
            scope.environment,
            "logout-v1",
            "workforce",
          ),
          scope,
        );
        redis.on("ready", () => authority.reset());
        redis.on("close", () => authority.reset());
        return authority;
      },
    },
    {
      provide: RP_CHANGES,
      inject: [VxConfigService, RP_RUNTIME, RP_REDIS, RP_RECOVERY],
      useFactory: (
        c: VxConfigService,
        rt: RpRuntime,
        redis: Redis,
        logout: SessionRecoveryAuthority | null,
      ) => {
        if (process.env.RP_IDENTITY_CHANGES_ENABLED !== "true") return null;
        if (!logout || process.env.RP_SESSION_EVENTS_ENABLED !== "true")
          throw new Error(
            "Identity changes require recovery and session events",
          );
        const environment = process.env
          .RP_IDENTITY_ENVIRONMENT as IdentityEnvironment;
        const authority = new IdentityChangesAuthority(
          new Pool(recoveryPostgres(c)),
          new HttpIdentityChangesClient(rt.config, environment, "workforce"),
          {
            realm: "workforce",
            issuer: rt.config.issuer,
            clientId: rt.config.clientId,
            environment,
          },
          logout,
        );
        redis.on("ready", () => authority.reset());
        redis.on("close", () => authority.reset());
        return authority;
      },
    },
    {
      provide: RP_EVENT_VERIFIER,
      inject: [RP_RUNTIME, RP_CHANGES],
      useFactory: (rt: RpRuntime, changes: IdentityChangesAuthority | null) =>
        changes
          ? new IdentityEventVerifier(
              rt.config,
              process.env.RP_IDENTITY_ENVIRONMENT as IdentityEnvironment,
              "workforce",
            )
          : null,
    },
    {
      provide: RP_SESSION_EVENTS,
      inject: [VxConfigService, RP_RUNTIME, RP_REDIS, RP_RECOVERY, RP_CHANGES],
      useFactory: (
        c: VxConfigService,
        rt: RpRuntime,
        redis: Redis,
        authority: SessionRecoveryAuthority | null,
        changes: IdentityChangesAuthority | null,
      ) => {
        if (process.env.RP_SESSION_EVENTS_ENABLED !== "true") return null;
        if (!authority)
          throw new Error("Session events require durable identity recovery");
        const hub = new SessionEventsHub(
          {
            ...recoveryPostgres(c),
            application_name: "opera-session-events",
          },
          {
            realm: "workforce",
            issuer: rt.config.issuer,
            clientId: rt.config.clientId,
            environment: process.env.RP_IDENTITY_ENVIRONMENT!,
          },
          () => redis.status === "ready",
          undefined,
          () => {
            authority.reset();
            changes?.reset();
          },
          Boolean(changes),
        );
        redis.on("close", () => hub.invalidate());
        redis.on("ready", () => hub.invalidate());
        return hub;
      },
    },
    {
      provide: RP_SESSION_STORE,
      inject: [RP_REDIS, VxConfigService, RP_RUNTIME, RP_RECOVERY],
      useFactory: (
        redis: Redis,
        c: VxConfigService,
        rt: RpRuntime,
        authority: SessionRecoveryAuthority | null,
      ) =>
        new RpSessionStore(
          redis,
          rt.config.clientId,
          c.redis.REDIS_KEY_PREFIX ?? "vx:",
          rt.config.sessionTtlSec,
          authority ?? undefined,
        ),
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
  // RP_REDIS 也导出:根模块里的 TenantSwitchRouter 要把待授权请求暂存到与
  // OidcAuthRouter 同一把 key 下(/auth/callback 才找得到 PKCE verifier)。
  exports: [
    OperatorExchangeService,
    RP_CHANGES,
    RP_AUTH_SERVICE,
    RP_SESSION_STORE,
    RP_OIDC_CLIENT,
    RP_RUNTIME,
    RP_REDIS,
  ],
})
export class OidcRpModule {}
