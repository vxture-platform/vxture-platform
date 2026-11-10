/**
 * Verify the real DI providers preserve query isolation and release every pool.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-06
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { afterEach, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PoolsModule } from "./pools.module";
import {
  ACTIVITY_WRITE_POOL,
  INBOX_WRITE_POOL,
  PRIMARY_POOL,
  READ_POOL,
} from "./tokens";

afterEach(() => vi.unstubAllEnvs());

// ============================================================================
// Pool isolation and cleanup
// ============================================================================
it("keeps both query pools read-only and isolates the inbox writer", async () => {
  const env = {
    WORKBENCH_BASE_URL: "http://127.0.0.1",
    WORKBENCH_BFF_PORT: "0",
    OIDC_ISSUER: "http://127.0.0.1",
    OIDC_CLIENT_ID: "workbench",
    OIDC_CLIENT_SECRET: "fixture-only",
    RP_COOKIE_INSECURE: "true",
    NODE_ENV: "test",
    REDIS_URL: "redis://127.0.0.1:1",
    DATABASE_URL: "postgresql://reporting_ro@127.0.0.1/unused",
    REPORTING_RO_DATABASE_URL: "postgresql://reporting_ro@127.0.0.1/reporting",
    WORKBENCH_ACTIVITY_DATABASE_URL:
      "postgresql://svc_workbench_activity@127.0.0.1/unused",
    WORKBENCH_INBOX_DATABASE_URL:
      "postgresql://svc_workbench_inbox@127.0.0.1/unused",
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const app = await NestFactory.createApplicationContext(PoolsModule, {
    logger: false,
  });
  const primary = app.get<Pool>(PRIMARY_POOL);
  const reporting = app.get<Pool>(READ_POOL);
  const writer = app.get<Pool>(INBOX_WRITE_POOL);
  const activity = app.get<Pool>(ACTIVITY_WRITE_POOL);
  try {
    expect(primary.options).toMatchObject({
      connectionString: env.DATABASE_URL,
      options: "-c default_transaction_read_only=on",
    });
    expect(reporting.options).toMatchObject({
      connectionString: env.REPORTING_RO_DATABASE_URL,
      options: "-c default_transaction_read_only=on",
    });
    expect(writer.options).toMatchObject({
      connectionString: env.WORKBENCH_INBOX_DATABASE_URL,
      options: "-c default_transaction_read_only=off",
      max: 2,
    });
    expect(activity.options).toMatchObject({
      connectionString: env.WORKBENCH_ACTIVITY_DATABASE_URL,
      options: "-c default_transaction_read_only=off",
      max: 2,
    });
    expect(activity).not.toBe(writer);
    expect(activity).not.toBe(primary);
    expect(writer).not.toBe(primary);
    expect(writer).not.toBe(reporting);
  } finally {
    await app.close();
  }
  expect(primary.ended).toBe(true);
  expect(reporting.ended).toBe(true);
  expect(writer.ended).toBe(true);
  expect(activity.ended).toBe(true);
});
