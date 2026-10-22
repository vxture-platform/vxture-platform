/**
 * run-invoice-receipts.mjs - Provision an isolated local database and run finance regressions.
 * @package vxture-platform
 * @layer Application
 * @category Test
 * @author AI-Generated
 * @date 2026-10-22
 */
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Local-only database and historical DDL baseline
// ============================================================================
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(resolve(root, "bff/console-bff/package.json"));
const { Pool } = require("pg");
const { buildSync } = require("esbuild");
const url = new URL(
  process.env.INVOICE_TEST_ADMIN_URL ??
    "postgres://postgres@127.0.0.1:14785/postgres",
);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error("Invoice tests require a local PostgreSQL instance");
const base = process.env.BASE_SHA || "HEAD";
if (!/^[a-zA-Z0-9^~._/-]+$/.test(base)) throw new Error("Invalid baseline ref");
const files = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", base, "deploy/database/ddl"],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter((path) => /\/\d+_[^/]+\.sql$/.test(path))
  .sort();
if (files.length < 19) throw new Error("Historical DDL baseline is incomplete");
const database = `invoice232_${randomUUID().replaceAll("-", "")}`;
const owner = new Pool({ connectionString: url.href });
let fixture;
let created = false;
try {
  await owner.query(`create database ${database}`);
  created = true;
  url.pathname = `/${database}`;
  fixture = new Pool({ connectionString: url.href });
  for (const path of files) {
    await fixture.query(
      execFileSync("git", ["show", `${base}:${path}`], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  }
  const bundle = resolve(
    root,
    "bff/console-bff/dist/invoice-receipts.integration.cjs",
  );
  buildSync({
    entryPoints: [
      resolve(root, "scripts/tests/invoice-receipts.integration.ts"),
    ],
    outfile: bundle,
    nodePaths: [resolve(root, "bff/console-bff/node_modules")],
    bundle: true,
    platform: "node",
    format: "cjs",
    tsconfig: resolve(root, "bff/console-bff/tsconfig.json"),
    external: [
      "pg-native",
      "@nestjs/websockets/socket-module",
      "@nestjs/microservices",
      "@nestjs/microservices/microservices-module",
      "class-transformer/storage",
    ],
  });
  const result = spawnSync(process.execPath, ["--test", bundle], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, INVOICE_TEST_DATABASE_URL: url.href },
  });
  if (result.status !== 0)
    throw new Error(`Invoice regression failed (${result.status})`);
} finally {
  await fixture?.end();
  // The generated name can never address an existing application database.
  if (created) await owner.query(`drop database ${database} with (force)`);
  await owner.end();
}
