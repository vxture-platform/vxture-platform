/**
 * config.service.ts - Configuration service
 * @package @vxture/core-config
 * @description
 *   NestJS injectable service for typed config access
 *
 * @author AI-Generated
 * @date 2026-03-15
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import type {
  AppConfig,
  DatabaseConfig,
  RedisConfig,
  AuthConfig,
  MailEnvConfig,
  OauthConfig,
  PlatformConfig,
  VardaConfig,
} from "../schemas";
import { CONFIG_TOKEN } from "../types";

// ============================================================================
// VxConfigService
//
// After injection, consumers access config through strongly typed getters.
// Calling getters for unregistered domains (e.g., ai domain not registered in agent-server)
// will throw clear errors at runtime instead of returning undefined.
// ============================================================================

@Injectable()
export class VxConfigService {
  constructor(
    @Optional() @Inject(CONFIG_TOKEN.APP) private readonly _app: AppConfig,
    @Optional()
    @Inject(CONFIG_TOKEN.DATABASE)
    private readonly _database: DatabaseConfig,
    @Optional()
    @Inject(CONFIG_TOKEN.REDIS)
    private readonly _redis: RedisConfig,
    @Optional() @Inject(CONFIG_TOKEN.AUTH) private readonly _auth: AuthConfig,
    @Optional()
    @Inject(CONFIG_TOKEN.MAIL)
    private readonly _mail: MailEnvConfig,
    @Optional()
    @Inject(CONFIG_TOKEN.OAUTH)
    private readonly _oauth: OauthConfig,
    @Optional()
    @Inject(CONFIG_TOKEN.PLATFORM)
    private readonly _platform: PlatformConfig,
    @Optional()
    @Inject(CONFIG_TOKEN.VARDA)
    private readonly _varda: VardaConfig,
  ) {}

  get app(): AppConfig {
    this.assertLoaded(this._app, "app");
    return this._app;
  }

  get database(): DatabaseConfig {
    this.assertLoaded(this._database, "database");
    return this._database;
  }

  get redis(): RedisConfig {
    this.assertLoaded(this._redis, "redis");
    return this._redis;
  }

  get auth(): AuthConfig {
    this.assertLoaded(this._auth, "auth");
    return this._auth;
  }

  /** Available only when ai domain is registered (agent-server only) */

  /** SMTP mail config. Available only when mail domain is registered. */
  get mail(): MailEnvConfig {
    this.assertLoaded(this._mail, "mail");
    return this._mail;
  }

  /** OAuth provider credentials. Available only when oauth domain is registered. */
  get oauth(): OauthConfig {
    this.assertLoaded(this._oauth, "oauth");
    return this._oauth;
  }

  /** Cross-service URLs and cookie domains. Available only when platform domain is registered. */
  get platform(): PlatformConfig {
    this.assertLoaded(this._platform, "platform");
    return this._platform;
  }

  /** Varda agent-server 运行配置，仅在注册 varda domain 后可用 */
  get varda(): VardaConfig {
    this.assertLoaded(this._varda, "varda");
    return this._varda;
  }

  /** Whether current environment is production */
  get isProduction(): boolean {
    return this._app?.NODE_ENV === "production";
  }

  /** Whether current environment is development */
  get isDevelopment(): boolean {
    return this._app?.NODE_ENV === "development";
  }

  /** Whether current environment is test */
  get isTest(): boolean {
    return this._app?.NODE_ENV === "test";
  }

  // --------------------------------------------------------------------------

  private assertLoaded(value: unknown, domain: string): void {
    if (value === undefined || value === null) {
      throw new Error(
        `[VxConfigService] Config domain "${domain}" is not loaded. ` +
          `Add "${domain}" to VxConfigModule.register({ domains: [...] }).`,
      );
    }
  }
}
