/**
 * runtime.ts - Validated configuration and shared RP dependencies.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category configuration
 * @author AI-Generated
 * @date 2026-11-22
 */
// ⚠️ 跨层引用: Reuse the platform RP infrastructure through its public exports.
import {
  HttpOidcRpClient,
  RpAuthService,
  RpSessionStore,
  type OidcRpConfig,
  type OidcRpClient,
  type RpRedis,
} from "@vxture/core-oidc-rp";
import { ApplicationReader } from "./application-reader";
import type { WorkspaceReader } from "./workspace-reader";
import type { ResourceReader } from "./resource-reader";

export const DESKTOP_RUNTIME = Symbol("DESKTOP_RUNTIME");
export const PENDING_TTL_SEC = 300;

export interface DesktopRedis extends RpRedis {
  getdel(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: "EX",
    ttl: number,
    condition: "NX",
  ): Promise<unknown>;
}

export interface DesktopConfig {
  base: string;
  keyPrefix: string;
  oidc: OidcRpConfig;
}

export interface DesktopRuntime {
  config: DesktopConfig;
  redis: DesktopRedis;
  client: OidcRpClient;
  store: RpSessionStore;
  auth: RpAuthService;
  workspaces?: WorkspaceReader;
  applications?: ApplicationReader;
  resources?: ResourceReader;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function origin(value: string, internal = false): string {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && (loopback || internal)))
  )
    throw new Error("An HTTPS origin or local HTTP origin is required");
  return url.origin;
}

export function desktopConfig(env: NodeJS.ProcessEnv): DesktopConfig {
  const base = origin(required(env, "RUYIN_BFF_BASE"));
  const clientId = "ruyin-desktop";
  const sessionTtlSec = Number(env.RUYIN_DESKTOP_SESSION_TTL ?? 86400);
  if (
    !Number.isInteger(sessionTtlSec) ||
    sessionTtlSec < PENDING_TTL_SEC ||
    sessionTtlSec > 86400
  )
    throw new Error(
      "RUYIN_DESKTOP_SESSION_TTL must be between 300 and 86400 seconds",
    );
  return {
    base,
    keyPrefix: "vx:",
    oidc: {
      issuer: origin(required(env, "OIDC_ISSUER")),
      ...(env.OIDC_BACKCHANNEL_ISSUER
        ? { backchannelIssuer: origin(env.OIDC_BACKCHANNEL_ISSUER, true) }
        : {}),
      clientId,
      clientSecret: required(env, "RUYIN_DESKTOP_OIDC_CLIENT_SECRET"),
      redirectUri: `${base}/auth/callback`,
      scopes: ["openid", "profile", "email", "phone"],
      sessionTtlSec,
    },
  };
}

export function createDesktopRuntime(
  config: DesktopConfig,
  redis: DesktopRedis,
): DesktopRuntime {
  // Redirects are forbidden on back-channel requests carrying credentials.
  const client = new HttpOidcRpClient(config.oidc, {
    fetchImpl: (url, init) =>
      fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      }),
  });
  const store = new RpSessionStore(
    redis,
    config.oidc.clientId,
    config.keyPrefix,
  );
  return {
    config,
    redis,
    client,
    store,
    auth: new RpAuthService(store, client, config.oidc.sessionTtlSec),
  };
}
