/**
 * index.ts - Schemas barrel export
 * @package @vxture/core-config
 */

export type { AppConfig, AppEnv } from "./app.schema";
export { appSchema, AppEnvEnum } from "./app.schema";

export type { DatabaseConfig } from "./database.schema";
export { databaseSchema } from "./database.schema";

export type { RedisConfig } from "./redis.schema";
export { redisSchema } from "./redis.schema";

export type { AuthConfig } from "./auth.schema";
export { authSchema } from "./auth.schema";

export type { MailEnvConfig } from "./mail.schema";
export { mailSchema, toSmtpConfig } from "./mail.schema";

export type { OauthConfig } from "./oauth.schema";
export { oauthSchema } from "./oauth.schema";

export type { PlatformConfig } from "./platform.schema";
export { platformSchema } from "./platform.schema";

export type { VardaConfig } from "./varda.schema";
export { vardaSchema } from "./varda.schema";
