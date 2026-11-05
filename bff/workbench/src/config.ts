/**
 * Validated, server-only deployment configuration for the workbench RP.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category config
 * @author AI-Generated
 * @date 2026-11-05
 */
import { rpSessionCookieName, type OidcRpConfig } from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: reuse the platform RP contract.

// ============================================================================
// Private runtime contract and origin validation
// ============================================================================
export interface WorkbenchConfig {
  origin: string;
  port: number;
  secure: boolean;
  cookieName: string;
  redisUrl: string;
  databaseUrl: string;
  reportingUrl: string;
  oidc: OidcRpConfig;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

function origin(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Expected an HTTP(S) origin");
  return url.origin;
}

// ============================================================================
// Fail-closed deployment configuration
// ============================================================================
/**
 * Validate configuration before connecting or accepting requests.
 * @param env - Process environment supplied by deployment.
 * @returns Validated private runtime configuration.
 * @throws {Error} When required configuration is absent or unsafe.
 */
export function loadConfig(env: NodeJS.ProcessEnv): WorkbenchConfig {
  const base = origin(required(env, "WORKBENCH_BASE_URL"));
  const issuer = origin(required(env, "OIDC_ISSUER"));
  const secure = env.RP_COOKIE_INSECURE !== "true";
  const production = env.NODE_ENV === "production";
  const port = Number(required(env, "WORKBENCH_BFF_PORT"));
  const clientId = required(env, "OIDC_CLIENT_ID");
  if (!Number.isInteger(port) || port < (production ? 1 : 0) || port > 65535)
    throw new Error("Invalid WORKBENCH_BFF_PORT");
  if (!/^workbench(?:-beta|-canary)?$/.test(clientId))
    throw new Error("Workbench requires its own registered OIDC client");
  if (
    production &&
    (!secure || !base.startsWith("https:") || !issuer.startsWith("https:"))
  )
    throw new Error("Production requires HTTPS and secure host-only cookies");
  if (
    !secure &&
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)
  )
    throw new Error("Insecure cookies are restricted to loopback development");
  const databaseUrl = required(env, "DATABASE_URL");
  return {
    origin: base,
    port,
    secure,
    cookieName: rpSessionCookieName(secure, clientId),
    redisUrl: required(env, "REDIS_URL"),
    databaseUrl,
    reportingUrl: env.REPORTING_RO_DATABASE_URL?.trim() || databaseUrl,
    oidc: {
      issuer,
      ...(env.OIDC_BACKCHANNEL_ISSUER?.trim()
        ? {
            backchannelIssuer: origin(env.OIDC_BACKCHANNEL_ISSUER.trim()),
          }
        : {}),
      clientId,
      clientSecret: required(env, "OIDC_CLIENT_SECRET"),
      redirectUri: `${base}/auth/callback`,
      scopes: ["openid", "profile", "email", "phone"],
      sessionTtlSec: 86400,
    },
  };
}
