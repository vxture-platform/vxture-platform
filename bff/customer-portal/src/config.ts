/**
 * Server-only runtime configuration and strict customer-host validation.
 * @package @vxture/bff-customer-portal
 * @layer Application
 * @category config
 * @author AI-Generated
 * @date 2026-11-15
 */
import type { OidcRpConfig } from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: use the public RP configuration contract.
import type { PublishedPortal } from "@vxture/service-customer-portal"; // ⚠️ 跨层引用: use the published domain binding.
import { portalHostname } from "@vxture/service-customer-portal"; // ⚠️ Cross-layer reference: share the canonical customer hostname policy.

export interface PortalConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  proxyToken: string;
  oidc: Omit<OidcRpConfig, "redirectUri">;
}
export interface PortalRuntime {
  origin: string;
  secure: boolean;
  cookieName: string;
  binding: PublishedPortal;
  oidc: OidcRpConfig;
}

/** Accept a single exact customer subdomain; forwarding lists and ports are invalid. */
export function customerHost(value: unknown): string {
  if (typeof value !== "string" || !value.endsWith(".ruyin.work"))
    throw new Error("Invalid customer portal host");
  const prefix = value.slice(0, -".ruyin.work".length);
  if (portalHostname(prefix, prefix === "a") !== value)
    throw new Error("Invalid customer portal host");
  return value;
}

// ============================================================================
// No inherited general-portal client, database connection or numeric port defaults
// ============================================================================
/** Reject incomplete deployment settings before accepting requests. */
export function loadConfig(env: NodeJS.ProcessEnv): PortalConfig {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing required configuration: ${name}`);
    return value;
  };
  const port = Number(required("CUSTOMER_PORTAL_BFF_PORT"));
  if (
    !Number.isInteger(port) ||
    port < (env.NODE_ENV === "production" ? 1 : 0) ||
    port > 65535
  )
    throw new Error("Invalid CUSTOMER_PORTAL_BFF_PORT");
  const issuer = new URL(required("OIDC_ISSUER"));
  if (
    issuer.protocol !== "https:" ||
    issuer.origin !== issuer.href.slice(0, -1)
  )
    throw new Error("OIDC_ISSUER must be an HTTPS origin");
  const clientId = required("OIDC_CLIENT_ID");
  if (!/^customer-portal(?:-beta|-canary)?$/.test(clientId))
    throw new Error("An independent customer-portal OIDC client is required");
  const proxyToken = required("CUSTOMER_PORTAL_BFF_TOKEN");
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(proxyToken))
    throw new Error(
      "A private proxy token of at least 32 characters is required",
    );
  const databaseUrl = required("CUSTOMER_PORTAL_DATABASE_URL");
  const database = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    database.username !== "svc_customer_portal"
  )
    throw new Error(
      "Customer portal requires its dedicated read-only database role",
    );
  return {
    port,
    proxyToken,
    databaseUrl,
    redisUrl: required("CUSTOMER_PORTAL_REDIS_URL"),
    oidc: {
      issuer: issuer.origin,
      clientId,
      clientSecret: required("OIDC_CLIENT_SECRET"),
      scopes: ["openid", "profile"],
      sessionTtlSec: 28800,
      ...(env.OIDC_BACKCHANNEL_ISSUER
        ? { backchannelIssuer: new URL(env.OIDC_BACKCHANNEL_ISSUER).origin }
        : {}),
    },
  };
}

/** Derive the callback exclusively from a published, validated host binding. */
export function runtimeFor(
  config: PortalConfig,
  binding: PublishedPortal,
): PortalRuntime {
  const origin = `https://${customerHost(binding.hostname)}`;
  return {
    binding,
    origin,
    secure: true,
    cookieName: "__Host-vx_customer_portal_session",
    oidc: { ...config.oidc, redirectUri: `${origin}/auth/callback` },
  };
}
