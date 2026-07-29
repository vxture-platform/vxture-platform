#!/usr/bin/env node
// TD-024 boot-smoke runner. Boots a Nest BFF's REAL esbuild bundle with a fake but
// schema-valid env and BOOT_SMOKE=1, asserting the full DI graph resolves (exit 0)
// within a timeout. This is the only check that exercises the bundled runtime form,
// where the esbuild implicit-constructor-injection trap lives (a bundled service
// whose deps silently become undefined) — invisible to tsc and unit tests.
//
// Usage: node scripts/guardrails/boot-smoke.mjs <bundle.cjs> [labelName]
// The target's main.ts must honour BOOT_SMOKE=1 by init()+close()+exit(0).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const bundlePath = process.argv[2];
const label = process.argv[3] ?? bundlePath;
if (!bundlePath) {
  console.error("usage: boot-smoke.mjs <bundle.cjs> [label]");
  process.exit(2);
}
const abs = resolve(bundlePath);
if (!existsSync(abs)) {
  console.error(`[boot-smoke] bundle not found: ${abs} (build it first)`);
  process.exit(2);
}

const TIMEOUT_MS = 60_000;

// Fake but schema-valid env covering the config domains the Nest BFFs register
// (app / auth / database / redis / oauth / platform) plus the S2S / mail /
// provisioning knobs their service modules read. Values are deliberately
// non-routable — most services' pg/redis clients are lazy and never open a
// socket. auth-bff and varda-bff are exceptions: both wire a Redis-backed
// service whose onModuleInit() awaits a real connection and fails closed by
// design (auth-bff's RedisService is the central session store; varda-bff's
// AccessTokenRevocationService, from @vxture/core-auth, is the shared jti
// revocation check) — REDIS_URL is overridable below for those cases, backed
// by a real ephemeral Redis service container in CI.
const FAKE_ENV = {
  NODE_ENV: "production",
  BOOT_SMOKE: "1",
  // database
  DATABASE_URL: "postgresql://smoke:smoke@127.0.0.1:5432/smoke",
  DB_HOST: "127.0.0.1",
  DB_PORT: "5432",
  DB_USER: "smoke",
  DB_PASSWORD: "smoke",
  DB_NAME: "smoke",
  // redis
  REDIS_URL: "redis://127.0.0.1:6379",
  // auth
  JWT_SECRET: "boot-smoke-jwt-secret-value-000000000000",
  JWT_REFRESH_SECRET: "boot-smoke-jwt-refresh-secret-value-00000",
  JWT_ACCESS_EXPIRES_IN: "15m",
  JWT_REFRESH_EXPIRES_IN: "7d",
  AUTH_COOKIE_DOMAIN: ".example.com",
  AUTH_INTERNAL_TOKEN: "boot-smoke-internal-token",
  // platform / app (cross-service URLs + origins)
  WEBSITE_BASE_URL: "https://smoke.example.com",
  CONSOLE_BASE_URL: "https://console.smoke.example.com",
  ADMIN_BASE_URL: "https://admin.smoke.example.com",
  AUTH_BFF_URL: "https://auth.smoke.example.com",
  ATLAS_API_URL: "https://atlas.smoke.example.com",
  ADMIN_BFF_ORIGIN: "https://admin.smoke.example.com",
  AUTH_BFF_ORIGIN: "https://auth.smoke.example.com",
  ADMIN_BFF_PORT: "3031",
  // mail
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_SECURE: "false",
  SMTP_USER: "smoke",
  SMTP_PASS: "smoke",
  SMTP_FROM: "smoke@example.com",
};

// Start from a clean env (only PATH-ish essentials) so a developer's local
// .env-derived shell vars cannot mask a missing key that CI would hit. core-config
// reads .env.local from disk when present, so run this with that file absent to
// mirror CI faithfully. REDIS_URL is the one deliberate escape hatch: when the
// invoking job sets it (a real ephemeral Redis service container in CI), it
// overrides FAKE_ENV's unroutable default for targets whose boot path needs an
// actual connection (auth-bff).
const redisOverride = process.env["REDIS_URL"]
  ? { REDIS_URL: process.env["REDIS_URL"] }
  : {};
const child = spawn(process.execPath, [abs], {
  env: {
    PATH: process.env["PATH"],
    HOME: process.env["HOME"],
    SystemRoot: process.env["SystemRoot"],
    ...FAKE_ENV,
    ...redisOverride,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));

const timer = setTimeout(() => {
  child.kill("SIGKILL");
  console.error(`[boot-smoke] ${label}: TIMEOUT after ${TIMEOUT_MS}ms`);
  console.error(out);
  process.exit(1);
}, TIMEOUT_MS);

child.on("exit", (code) => {
  clearTimeout(timer);
  if (code === 0) {
    console.log(`[boot-smoke] ${label}: OK`);
    process.exit(0);
  }
  console.error(`[boot-smoke] ${label}: FAILED (exit ${code})`);
  console.error(out);
  process.exit(1);
});
