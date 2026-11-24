/**
 * Host-owned optional identity synchronization infrastructure.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category auth
 * @author AI-Generated
 * @date 2026-11-24
 */
import { Client, Pool } from "pg";
import type { Redis } from "ioredis";
import { IdentitySyncRuntime, type OidcRpConfig } from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: shared protocol, host-owned connections.

/** Build explicitly enabled persistence; identity writes use a dedicated connection. */
export function identitySync(
  config: OidcRpConfig,
  redis: Redis,
): IdentitySyncRuntime {
  const recovery = process.env.RP_IDENTITY_RECOVERY_ENABLED === "true";
  const url = process.env.RP_IDENTITY_DATABASE_URL;
  if (recovery && !url)
    throw new Error(
      "RP_IDENTITY_DATABASE_URL is required for identity persistence",
    );
  const postgres = {
    connectionString: url,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    max: 3,
  };
  const sync = new IdentitySyncRuntime(
    config,
    {
      recovery,
      changes: process.env.RP_IDENTITY_CHANGES_ENABLED === "true",
      events: process.env.RP_SESSION_EVENTS_ENABLED === "true",
      retirement: process.env.RP_SESSION_POLLING_RETIREMENT_ENABLED === "true",
      environment: process.env.RP_IDENTITY_ENVIRONMENT,
    },
    () => new Pool(postgres),
    () => {
      const client = new Client(postgres);
      return {
        connect: () => client.connect(),
        end: () => client.end(),
        query: client.query.bind(client),
        onNotification: (listener) => {
          client.on("notification", listener);
        },
        onDisconnect: (listener) => {
          client.on("error", listener);
          client.on("end", listener);
        },
      };
    },
    () => redis.status === "ready",
  );
  if (recovery) {
    redis.on("ready", () => sync.invalidate());
    redis.on("close", () => sync.invalidate());
  }
  return sync;
}
