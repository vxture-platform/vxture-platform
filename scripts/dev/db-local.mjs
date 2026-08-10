#!/usr/bin/env node
/**
 * db-local.mjs — local platform database lifecycle (Docker Desktop).
 *
 * Why a script instead of the deploy/ shell scripts: those run on worker-01,
 * assume a psql client on PATH and /srv/vxture/runtime secrets. A Windows dev
 * host has neither — but it has Docker, so every SQL statement runs inside the
 * db container and the seed runs the same way production runs it (a node:24
 * container with pg installed into a cache dir, mirroring
 * deploy/scripts/29-seed-platform-ddl.sh).
 *
 * The DDL path is deliberately identical to production's: deploy/database/ddl/
 * applied in filename order, clean-baseline model (reset → apply once). A local
 * database built by a different mechanism than production proves nothing.
 *
 * Commands:
 *   up      start postgres + redis
 *   down    stop them (data survives in deploy/dev/data/)
 *   ddl     apply the DDL; --reset drops the schemas first (DATA LOSS, local only)
 *   secrets generate local OIDC client secrets + hashes into .env.local
 *   signing-key provision the IdP RS256 key (DB) + write the pair into .env.local
 *   seed    catalog + sample seed
 *   verify  run the baseline assertions
 *   all     up → ddl --reset → secrets → signing-key → seed → verify
 *   status  containers + schema count
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const COMPOSE = ["compose", "-f", "deploy/dev/compose.dev.yml"];
const DB_CONTAINER = "vx-platform-postgres-db-dev";
const DB_USER = process.env.POSTGRES_USER ?? "vxture";
const DB_NAME = process.env.POSTGRES_DB ?? "platform_main";
const DB_PASSWORD = process.env.POSTGRES_PASSWORD ?? "localdev";
const NETWORK = "platform-net";
const DDL_DIR = resolve(ROOT, "deploy/database/ddl");

/** The 19 schemas the DDL owns (deploy/database/ddl/apply.sh keeps the same list). */
const SCHEMAS =
  "account,identity,credential,kyc,tenancy,access,appoidc,session,loyalty," +
  "metering,billing,provisioning,promotion,product,model,safety,support,admin,sharing";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: false, ...opts });
  if (r.status !== 0) {
    console.error(`\n✗ ${cmd} ${args.join(" ")} → exit ${r.status}`);
    process.exit(r.status ?? 1);
  }
  return r;
}

/** psql inside the db container — no host psql client required. */
function psql(args, { quiet = false } = {}) {
  return run("docker", [
    "exec", "-e", `PGPASSWORD=${DB_PASSWORD}`, "-i", DB_CONTAINER,
    "psql", "-U", DB_USER, "-d", DB_NAME, "-v", "ON_ERROR_STOP=1",
    ...(quiet ? ["-q"] : []), ...args,
  ]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function up() {
  run("docker", [...COMPOSE, "up", "-d"]);
  // Wait on the container HEALTH state, not on a bare pg_isready: on a first
  // boot initdb runs a temporary server that answers pg_isready and then shuts
  // down to restart for real, so pg_isready alone reports ready ~2s before the
  // database can take a connection ("the database system is shutting down").
  console.log("\n⏳ waiting for postgres to become healthy…");
  for (let i = 0; i < 60; i++) {
    const r = spawnSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", DB_CONTAINER],
      { cwd: ROOT, encoding: "utf8" });
    if (r.stdout?.trim() === "healthy") return console.log("✓ postgres ready");
    await sleep(1000);
  }
  console.error("✗ postgres did not become ready — check `docker logs " + DB_CONTAINER + "`");
  process.exit(1);
}

function ddl({ reset }) {
  if (reset) {
    if (process.env.CONFIRM_RESET !== "yes") {
      console.error("refusing: `ddl --reset` drops every platform schema. Re-run with CONFIRM_RESET=yes");
      process.exit(1);
    }
    console.log("⚠ dropping all 19 platform schemas (local only)");
    psql(["-c", `DROP SCHEMA IF EXISTS ${SCHEMAS} CASCADE;`]);
  }
  const files = ddlFiles();
  for (const f of files) {
    console.log(`  → ${f}`);
    psql(["-f", `/database/ddl/${f}`], { quiet: true });
  }
  // Stamp the baseline fingerprint the way apply.sh does — verify recomputes it
  // and compares, so skipping the stamp would fail [B0] on every local verify.
  const hash = ddlHash();
  psql(["-c",
    `CREATE TABLE IF NOT EXISTS public.vx_ddl_baseline (id int PRIMARY KEY, ddl_hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());` +
    `INSERT INTO public.vx_ddl_baseline (id, ddl_hash) VALUES (1, '${hash}') ` +
    `ON CONFLICT (id) DO UPDATE SET ddl_hash = excluded.ddl_hash, applied_at = now();`], { quiet: true });
  console.log(`✓ DDL applied (${files.length} files, baseline hash = ${hash})`);
}

/** ddl/[0-9]*.sql in filename order — the same set apply.sh and verify hash. */
function ddlFiles() {
  return readdirSync(DDL_DIR).filter((f) => /^[0-9].*\.sql$/.test(f)).sort();
}

/** md5 of the concatenated DDL, byte-identical to `cat ddl/[0-9]*.sql | md5sum`. */
function ddlHash() {
  const buf = Buffer.concat(ddlFiles().map((f) => readFileSync(resolve(DDL_DIR, f))));
  return createHash("md5").update(buf).digest("hex");
}

/** Minimal .env parser — only what this script forwards to the seed. */
function readEnvLocal() {
  const file = resolve(ROOT, ".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

/**
 * Seed exactly the way production does (29-seed-platform-ddl.sh): a throwaway
 * node container on the stack network with pg installed into a cache volume.
 *
 * Portal base URLs are left unset on purpose — the seed's own fallbacks ARE the
 * local port map, so oidc_clients gets working local redirect_uris. What does
 * get forwarded: umbra's real base (its redirect_uri is asserted by the baseline
 * audit and ruyin.ai is the true value, not a local one) and any client-secret
 * hashes `pnpm db:local:secrets` has written into .env.local — without those the
 * IdP has no hash to compare and every local RP login dies at invalid_client.
 */
function seed() {
  const env = readEnvLocal();
  const forward = ["UMBRA_BASE_URL=" + (env.UMBRA_BASE_URL || "https://ruyin.ai")];
  for (const [k, v] of Object.entries(env)) {
    if (v && (k.startsWith("OIDC_CLIENT_SECRET_HASH_") || k === "SAMPLE_USER_PASSWORD_HASH")) {
      forward.push(`${k}=${v}`);
    }
  }
  const url = `postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}`;
  run("docker", [
    "run", "--rm", "--network", NETWORK,
    "-e", `DATABASE_URL=${url}`,
    "-e", "SEED_ALLOW_DEFAULT_SUPERADMIN=yes",
    ...forward.flatMap((kv) => ["-e", kv]),
    "-v", `${resolve(ROOT, "deploy/database/seed")}:/db/seed:ro`,
    "-v", "vx-platform-db-tools:/tmp/vxture-db",
    "node:24-alpine", "sh", "-lc",
    "set -e; " +
      "if [ ! -d /tmp/vxture-db/node_modules/pg ]; then npm install --prefix /tmp/vxture-db pg@8.20.0 >/dev/null; fi; " +
      "cd /db/seed && NODE_PATH=/tmp/vxture-db/node_modules node seed.mjs",
  ]);
  console.log("✓ seeded (catalog + sample)");
}

/**
 * Generate local confidential-client secrets and write both halves into
 * .env.local: the bcrypt hash (seed → oidc_clients.client_secret_hash) and the
 * plaintext (the RP BFF presents it at token exchange). Same generator
 * production uses (27-provision-client-secrets.sh), so the hash format is the
 * one the IdP verifies with.
 *
 * Per-client plaintext keys, not one shared OIDC_CLIENT_SECRET: four RPs with
 * four secrets sharing one variable means three of them get invalid_client, and
 * the failure surfaces as "login just doesn't work" on whichever portal you
 * happened to open (the trap documented in tools/dev-panel/src/services.mjs).
 */
function secrets() {
  const CLIENTS = ["website", "console", "admin", "opera", "umbra"];
  const r = spawnSync("docker", [
    "run", "--rm",
    "-e", `CLIENTS=${CLIENTS.join(" ")}`,
    "-v", `${resolve(ROOT, "deploy/database/prisma")}:/db/prisma:ro`,
    "-v", "vx-platform-db-tools:/tmp/vxture-db",
    "node:24-alpine", "sh", "-lc",
    "set -e; " +
      "if [ ! -d /tmp/vxture-db/node_modules/bcryptjs ]; then npm install --prefix /tmp/vxture-db bcryptjs@2.4.3 >/dev/null; fi; " +
      "NODE_PATH=/tmp/vxture-db/node_modules node /db/prisma/provision-client-secrets.mjs",
  ], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0 || !r.stdout.trim()) {
    console.error(r.stderr || "✗ secret generator produced no output");
    process.exit(1);
  }
  const file = resolve(ROOT, ".env.local");
  let content = existsSync(file) ? readFileSync(file, "utf8") : "";
  const upsert = (k, v) => {
    const re = new RegExp(`^${k}=.*$`, "m");
    content = re.test(content) ? content.replace(re, `${k}=${v}`) : `${content.replace(/\s*$/, "\n")}${k}=${v}\n`;
  };
  for (const line of r.stdout.trim().split(/\r?\n/)) {
    const [client, secret, hash] = line.split("\t");
    if (!client) continue;
    const KEY = client.toUpperCase().replace(/-/g, "_");
    upsert(`OIDC_CLIENT_SECRET_HASH_${KEY}`, `'${hash}'`);
    upsert(`OIDC_CLIENT_SECRET_${KEY}`, secret);
  }
  writeFileSync(file, content, "utf8");
  console.log(`✓ wrote ${CLIENTS.length} client secrets + hashes into .env.local (git-ignored)`);
  console.log("  next: pnpm db:local:seed  (hashes only reach the DB through a seed)");
}

/**
 * Same two expectations 30-verify-platform-baseline.sh derives on worker-01:
 * the table count from the authoritative DDL, and the DDL fingerprint. Both are
 * derived, never hardcoded, so the assertion follows the DDL as it evolves.
 */
/**
 * Provision the IdP's RS256 signing key and write the matching pair into
 * .env.local.
 *
 * Both halves matter and they must agree: the PUBLIC jwk goes into
 * `appoidc.signing_keys` (served at `/oidc/jwks`), the PRIVATE key only ever
 * lives in env. If the DB has a key the env does not match, auth-bff signs with
 * one `kid` while JWKS publishes another and every RP rejects the id_token with
 * "kid not found" — a failure that looks like a broken RP rather than a
 * mismatched key. If the DB has no key at all, `/oidc/jwks` answers 500 and no
 * login can complete.
 *
 * `--force` rotates (current active → retiring). Without it, an existing active
 * key is left alone and .env.local is not touched, because the private half of
 * an existing key cannot be recovered from the database — it is not there.
 */
function signingKey({ force }) {
  const url = `postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}`;
  const r = spawnSync("docker", [
    "run", "--rm", "--network", NETWORK,
    "-e", `DATABASE_URL=${url}`,
    "-v", `${resolve(ROOT, "deploy/database/prisma")}:/db/prisma:ro`,
    "-v", "vx-platform-db-tools:/tmp/vxture-db",
    "node:24-alpine", "sh", "-lc",
    "set -e; " +
      "if [ ! -d /tmp/vxture-db/node_modules/pg ]; then npm install --prefix /tmp/vxture-db pg@8.20.0 >/dev/null; fi; " +
      "cd /db/prisma && NODE_PATH=/tmp/vxture-db/node_modules node provision-signing-key.mjs" +
      (force ? " --force" : ""),
  ], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    console.error(r.stderr || "✗ signing-key provisioning failed");
    process.exit(1);
  }
  const kid = /^OIDC_ACTIVE_KID=(.+)$/m.exec(r.stdout ?? "")?.[1];
  const pem = /^OIDC_SIGNING_PRIVATE_KEY=(.+)$/m.exec(r.stdout ?? "")?.[1];
  if (!kid || !pem) {
    // The script exits 0 and prints nothing new when a key is already active.
    console.log("• signing key already active — .env.local left as is (use --force to rotate)");
    return;
  }
  const file = resolve(ROOT, ".env.local");
  let content = existsSync(file) ? readFileSync(file, "utf8") : "";
  for (const [k, v] of [["OIDC_ACTIVE_KID", kid], ["OIDC_SIGNING_PRIVATE_KEY", pem]]) {
    const re = new RegExp(`^${k}=.*$`, "m");
    content = re.test(content)
      ? content.replace(re, `${k}=${v}`)
      : `${content.trimEnd()}\n${k}=${v}\n`;
  }
  writeFileSync(file, content, "utf8");
  console.log(`✓ signing key provisioned (kid=${kid.slice(0, 12)}…) and written to .env.local`);
}

function verify() {
  const file = resolve(ROOT, "deploy/database/verify/baseline-assertions.sql");
  if (!existsSync(file)) {
    console.error("✗ missing deploy/database/verify/baseline-assertions.sql");
    process.exit(1);
  }
  const expectedTables = ddlFiles()
    .map((f) => readFileSync(resolve(DDL_DIR, f), "utf8"))
    .join("\n")
    .split("\n")
    .filter((l) => /^CREATE TABLE/.test(l)).length;
  psql([
    "-v", `expected_tables=${expectedTables}`,
    "-v", `expected_ddl_hash=${ddlHash()}`,
    "-f", "/database/verify/baseline-assertions.sql",
  ]);
  console.log(`✓ baseline audit PASSED (expected tables = ${expectedTables})`);
}

function status() {
  run("docker", [...COMPOSE, "ps"]);
  psql(["-c", `SELECT count(*) AS schemas FROM information_schema.schemata WHERE schema_name = ANY (string_to_array('${SCHEMAS}', ','));`]);
}

const [cmd, ...rest] = process.argv.slice(2);
const reset = rest.includes("--reset");
switch (cmd) {
  case "up": await up(); break;
  case "down": run("docker", [...COMPOSE, "down"]); break;
  case "ddl": ddl({ reset }); break;
  case "secrets": secrets(); break;
  case "signing-key": signingKey({ force: reset || rest.includes("--force") }); break;
  case "seed": seed(); break;
  case "verify": verify(); break;
  case "status": status(); break;
  case "all":
    await up();
    process.env.CONFIRM_RESET = "yes";
    ddl({ reset: true });
    secrets();
    signingKey({ force: true });
    seed();
    verify();
    break;
  default:
    console.error("usage: node scripts/dev/db-local.mjs <up|down|ddl [--reset]|secrets|signing-key [--force]|seed|verify|status|all>");
    process.exit(1);
}
