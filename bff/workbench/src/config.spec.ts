/**
 * Production RP configuration must fail closed before opening infrastructure.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  WORKBENCH_BASE_URL: "https://ruyin.work",
  WORKBENCH_BFF_PORT: "3061",
  OIDC_ISSUER: "https://accounts.vxture.com",
  OIDC_CLIENT_ID: "workbench",
  OIDC_CLIENT_SECRET: "synthetic-secret",
  DATABASE_URL: "postgresql://test:test@127.0.0.1/test",
  WORKBENCH_INBOX_DATABASE_URL:
    "postgresql://svc_workbench_inbox:test@127.0.0.1/test",
  REDIS_URL: "redis://127.0.0.1:6379",
};

// ============================================================================
// Runtime configuration validation
// ============================================================================
describe("workbench runtime configuration", () => {
  it("derives host-only secure callbacks from the configured origin", () => {
    const config = loadConfig(env);
    expect(config.port).toBe(3061);
    expect(config.secure).toBe(true);
    expect(config.cookieName).toMatch(/^__Host-/);
    expect(config.oidc.redirectUri).toBe("https://ruyin.work/auth/callback");
    expect(config.reportingUrl).toBe(config.databaseUrl);
    expect(config.inboxDatabaseUrl).toBe(env.WORKBENCH_INBOX_DATABASE_URL);
  });
  it.each([
    ["OIDC_CLIENT_SECRET", ""],
    ["OIDC_CLIENT_ID", "console"],
    ["WORKBENCH_BFF_PORT", "0"],
    ["WORKBENCH_BFF_PORT", "3061.5"],
    ["WORKBENCH_BASE_URL", "http://ruyin.work"],
    ["WORKBENCH_BASE_URL", "https://ruyin.work/path"],
    ["WORKBENCH_BASE_URL", "https://user:pass@ruyin.work"],
    ["OIDC_ISSUER", "http://accounts.vxture.com"],
    ["RP_COOKIE_INSECURE", "true"],
    ["REDIS_URL", ""],
    ["DATABASE_URL", ""],
    ["WORKBENCH_INBOX_DATABASE_URL", ""],
    [
      "WORKBENCH_INBOX_DATABASE_URL",
      "postgresql://reporting_ro@127.0.0.1/test",
    ],
    [
      "WORKBENCH_INBOX_DATABASE_URL",
      "postgresql://platform_svc@127.0.0.1/test",
    ],
    [
      "WORKBENCH_INBOX_DATABASE_URL",
      "https://svc_workbench_inbox@localhost/test",
    ],
  ])("rejects unsafe or incomplete %s=%s", (key, value) => {
    expect(() => loadConfig({ ...env, [key]: value })).toThrow();
  });
  it("permits insecure development cookies only on loopback", () => {
    const dev = {
      ...env,
      NODE_ENV: "development",
      RP_COOKIE_INSECURE: "true",
      WORKBENCH_BASE_URL: "http://127.0.0.1:3060",
    };
    expect(loadConfig(dev).secure).toBe(false);
    expect(() =>
      loadConfig({ ...dev, WORKBENCH_BASE_URL: "http://test.example" }),
    ).toThrow();
  });
});

it("rejects a broad database role for activity writes", () => {
  expect(() =>
    loadConfig({
      ...env,
      WORKBENCH_ACTIVITY_DATABASE_URL:
        "postgresql://platform_svc@127.0.0.1/test",
    }),
  ).toThrow();
});

describe("optional desktop module", () => {
  const desktop = {
    WORKBENCH_DESKTOP_ENABLED: "1",
    RUYIN_BFF_BASE: "https://app.ruyin.work",
    RUYIN_DESKTOP_OIDC_CLIENT_SECRET: "desktop-synthetic-secret",
  };
  it("preserves the browser-only configuration and ignores inactive desktop settings", () => {
    expect(loadConfig(env).desktop).toBeUndefined();
    expect(
      loadConfig({ ...env, RUYIN_BFF_BASE: "invalid" }).desktop,
    ).toBeUndefined();
  });
  it("adds a separate RP without changing the existing listener or browser secret", () => {
    const config = loadConfig({ ...env, ...desktop });
    expect(config.port).toBe(3061);
    expect(config.oidc.clientId).toBe("workbench");
    expect(config.oidc.clientSecret).toBe(env.OIDC_CLIENT_SECRET);
    expect(config.desktop?.oidc).toMatchObject({
      clientId: "ruyin-desktop",
      clientSecret: desktop.RUYIN_DESKTOP_OIDC_CLIENT_SECRET,
      redirectUri: "https://app.ruyin.work/auth/callback",
    });
  });
  it("uses the app callback without renaming the desktop identity or session namespace", () => {
    const config = loadConfig({ ...env, ...desktop });
    expect(config.desktop?.base).toBe("https://app.ruyin.work");
    expect(config.desktop?.oidc.clientId).toBe("ruyin-desktop");
    expect(config.desktop?.oidc.redirectUri).toBe(
      "https://app.ruyin.work/auth/callback",
    );
    expect(config.oidc.redirectUri).toBe("https://ruyin.work/auth/callback");
    expect(config.desktop?.keyPrefix).toBe("vx:");
  });
  it.each([
    { WORKBENCH_DESKTOP_ENABLED: "true" },
    { RUYIN_DESKTOP_OIDC_CLIENT_SECRET: "" },
    { RUYIN_DESKTOP_OIDC_CLIENT_SECRET: env.OIDC_CLIENT_SECRET },
    { RUYIN_BFF_BASE: env.WORKBENCH_BASE_URL },
    { RUYIN_DESKTOP_SESSION_TTL: "1" },
  ])("rejects unsafe desktop configuration %j", (patch) => {
    expect(() => loadConfig({ ...env, ...desktop, ...patch })).toThrow();
  });
});
