/**
 * Resolve the production DI graph and prove native access reuses existing connections.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-23
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import Redis from "ioredis";
import { afterEach, expect, it, vi } from "vitest";
import { AppModule } from "../app.module";
import {
  READ_POOL,
  REDIS,
  INBOX_WRITE_POOL,
  ACTIVITY_WRITE_POOL,
} from "../tokens";
import { DESKTOP_RUNTIME, type DesktopRuntime } from "./runtime";
import { ScopeService } from "../scope-service";
import { ResourceOverview } from "../resource-overview";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each(["0", "1"])(
  "resolves the real module with desktop enabled=%s and no extra connections",
  async (flag) => {
    const env = {
      NODE_ENV: "test",
      WORKBENCH_BFF_PORT: "0",
      WORKBENCH_BASE_URL: "http://127.0.0.1:3060",
      OIDC_ISSUER: "http://127.0.0.1:1",
      OIDC_CLIENT_ID: "workbench",
      OIDC_CLIENT_SECRET: "browser-test",
      REDIS_URL: "redis://127.0.0.1:1",
      DATABASE_URL: "postgresql://reader@127.0.0.1:1/unused",
      WORKBENCH_INBOX_DATABASE_URL:
        "postgresql://svc_workbench_inbox@127.0.0.1:1/unused",
      WORKBENCH_ACTIVITY_DATABASE_URL:
        "postgresql://svc_workbench_activity@127.0.0.1:1/unused",
      WORKBENCH_DESKTOP_ENABLED: flag,
      RUYIN_BFF_BASE: "http://127.0.0.1:3061",
      RUYIN_DESKTOP_OIDC_CLIENT_SECRET: "native-test",
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const connect = vi.spyOn(Redis.prototype, "connect").mockResolvedValue();
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    try {
      const native = app.get<DesktopRuntime | null>(DESKTOP_RUNTIME);
      if (flag === "0") expect(native).toBeNull();
      else {
        expect(native!.redis).toBe(app.get(REDIS));
        expect(Reflect.get(native!.resources!, "scope")).toBe(
          app.get(ScopeService),
        );
        expect(Reflect.get(native!.resources!, "overview")).toBe(
          app.get(ResourceOverview),
        );
        expect(Reflect.get(native!.applications!, "pool")).toBe(
          app.get(READ_POOL),
        );
        expect(Reflect.get(native!.applications!, "pool")).not.toBe(
          app.get(INBOX_WRITE_POOL),
        );
        expect(Reflect.get(native!.applications!, "pool")).not.toBe(
          app.get(ACTIVITY_WRITE_POOL),
        );
      }
      expect(connect).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  },
);
