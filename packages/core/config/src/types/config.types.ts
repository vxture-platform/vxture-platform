/**
 * config.types.ts - Configuration type definitions
 * @package @vxture/core-config
 * @description
 *   Core config types and constants
 *
 * @author AI-Generated
 * @date 2026-03-15
 */

import type {
  AppConfig,
  AuthConfig,
  DatabaseConfig,
  RedisConfig,
  OauthConfig,
  PlatformConfig,
  MailEnvConfig,
  VardaConfig,
} from "../schemas";

// ============================================================================
// Configuration Types
// ============================================================================

export interface VxConfig {
  app: AppConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  auth: AuthConfig;
  oauth: OauthConfig;
  platform: PlatformConfig;
  mail: MailEnvConfig;
  varda: VardaConfig;
}

export const CONFIG_TOKEN = {
  APP: Symbol("VX_CONFIG_APP"),
  DATABASE: Symbol("VX_CONFIG_DATABASE"),
  REDIS: Symbol("VX_CONFIG_REDIS"),
  AUTH: Symbol("VX_CONFIG_AUTH"),
  OAUTH: Symbol("VX_CONFIG_OAUTH"),
  PLATFORM: Symbol("VX_CONFIG_PLATFORM"),
  MAIL: Symbol("VX_CONFIG_MAIL"),
  VARDA: Symbol("VX_CONFIG_VARDA"),
} as const;

export interface ConfigLoadResult {
  success: boolean;
  domains: string[];
  errors?: ConfigValidationError[];
}

export interface ConfigValidationError {
  field: string;
  message: string;
}
