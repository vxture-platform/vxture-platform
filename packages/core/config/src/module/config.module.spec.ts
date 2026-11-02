/**
 * @package @vxture/core-config
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-02
 */

import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  appSchema,
  databaseSchema,
  mailSchema,
  oauthSchema,
  redisSchema,
} from "../schemas";

import { stripEmptyEnvValues, VxConfigModule } from "./config.module";

vi.mock("node:fs", () => ({ existsSync: () => false, readFileSync: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ============================================================================
// Empty environment values
// ============================================================================

describe("stripEmptyEnvValues", () => {
  it("removes empty-string values (treats `KEY=` as unset)", () => {
    expect(stripEmptyEnvValues({ A: "", B: "x" })).toEqual({ B: "x" });
  });

  it("keeps non-empty values verbatim, including falsy-looking strings", () => {
    expect(stripEmptyEnvValues({ A: "v", B: "0", C: "false", D: " " })).toEqual(
      {
        A: "v",
        B: "0",
        C: "false",
        D: " ",
      },
    );
  });

  it("lets an optional+constrained key accept an empty env value (boot-crash regression)", () => {
    // OPERATOR_TOTP_ENC_KEY shape. The raw "" took down prod auth-bff at boot:
    // .optional() does not short-circuit "" so .min(32) ran and threw.
    const schema = z.object({ K: z.string().min(32).optional() });

    expect(() => schema.parse({ K: "" })).toThrow();
    expect(schema.parse(stripEmptyEnvValues({ K: "" }))).toEqual({});
  });

  it("lets .default() apply when the env value is empty", () => {
    const schema = z.object({ K: z.string().default("fallback") });

    expect(schema.parse(stripEmptyEnvValues({ K: "" }))).toEqual({
      K: "fallback",
    });
  });

  it("still surfaces a missing REQUIRED key as a validation error", () => {
    const schema = z.object({ K: z.string().min(1) });

    expect(() => schema.parse(stripEmptyEnvValues({ K: "" }))).toThrow();
  });
});

// ============================================================================
// Configuration validation compatibility
// ============================================================================

describe("configuration validation", () => {
  it("preserves defaults, numeric coercion and unknown-key stripping", () => {
    expect(appSchema.parse({ PORT: "3021", EXTRA: "ignored" })).toEqual({
      NODE_ENV: "development",
      PORT: 3021,
      AGENT_SERVER_BASE_URL: "http://127.0.0.1:3112",
      LOG_LEVEL: "info",
      APP_NAME: "vxture",
    });
    expect(databaseSchema.parse({}).DB_PORT).toBe(5432);
    expect(redisSchema.parse({}).REDIS_PORT).toBe(6379);
  });

  it("accepts database and Redis protocol URLs and rejects invalid ports", () => {
    expect(
      databaseSchema.parse({ DATABASE_URL: "postgresql://user:pass@db/app" })
        .DATABASE_URL,
    ).toBe("postgresql://user:pass@db/app");
    expect(
      redisSchema.parse({ REDIS_URL: "redis://cache:6379/0" }).REDIS_URL,
    ).toBe("redis://cache:6379/0");
    for (const PORT of ["0", "65536", "abc"]) {
      expect(appSchema.safeParse({ PORT }).success).toBe(false);
    }
  });

  it("keeps optional integrations optional and rejects incomplete credentials", () => {
    expect(mailSchema.parse({}).SMTP_HOST).toBeUndefined();
    expect(oauthSchema.parse({})).toEqual({});
    expect(
      mailSchema.safeParse({ SMTP_HOST: "smtp.example.com" }).success,
    ).toBe(false);
    expect(oauthSchema.safeParse({ FEISHU_APP_ID: "app" }).success).toBe(false);
    expect(
      oauthSchema.safeParse({
        FEISHU_APP_ID: "app",
        FEISHU_APP_SECRET: "secret",
      }).success,
    ).toBe(true);
  });

  it("reports Zod issues and fails fast instead of crashing in the error handler", () => {
    vi.stubEnv("PORT", "invalid-port");
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("configuration rejected");
    });

    expect(() => VxConfigModule.register({ domains: ["app"] })).toThrow(
      "configuration rejected",
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("APP.PORT"));
  });
});
