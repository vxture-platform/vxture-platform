/**
 * index.ts - Public export entry
 * @package @vxture/core-config
 * @description
 *   Environment-aware typed configuration (zod + NestJS)
 */

// ============================================
// Schemas & Types
// ============================================

// Schema exports (explicit listing for maintainability)
export {
  appSchema,
  AppEnvEnum,
  databaseSchema,
  redisSchema,
  authSchema,
  mailSchema,
  toSmtpConfig,
  oauthSchema,
  platformSchema,
  vardaSchema,
} from "./schemas";

// Type exports (explicit listing for maintainability)
export type {
  AppConfig,
  AppEnv,
  DatabaseConfig,
  RedisConfig,
  AuthConfig,
  MailEnvConfig,
  OauthConfig,
  PlatformConfig,
  VardaConfig,
} from "./schemas";

export type {
  VxConfig,
  ConfigLoadResult,
  ConfigValidationError,
} from "./types";
export { CONFIG_TOKEN } from "./types";

// ============================================
// Module & Service
// ============================================

export type { VxConfigModuleOptions } from "./module";
export { VxConfigModule } from "./module";

export { VxConfigService } from "./service";

// object utils (deepMerge / deepClone / isPlainObject) → import from @vxture-platform/shared

// Bootstrap helpers live behind subpaths, not the barrel: `setupOpenApi` imports
// @nestjs/swagger at module scope, and this barrel is imported by every service —
// exporting it here dragged swagger (and its class-transformer reach) into the
// bundle of services that never asked for docs. See @vxture/core-config/openapi.
