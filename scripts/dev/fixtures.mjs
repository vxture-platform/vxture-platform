#!/usr/bin/env node
/**
 * fixtures.mjs — inject and purge TEST data. Standalone, never part of a deploy.
 *
 * Deliberately not wired into `db-init`, `deploy.yml` or `db:local:all`:
 * loading test data is a decision someone makes, not a side effect of building
 * a database. `db:local:all` reaches a clean, production-shaped baseline; this
 * script is what puts a hundred rows on top of it and — the half that was
 * missing — takes them off again.
 *
 * Layers (the seed files' own division of labour):
 *   demo  seed-demo.mjs        a state matrix — one row per enum, hand-written,
 *                              readable. Answers "what does this status look like".
 *   bulk  seed-bulk-core.mjs   the trunk: users → tenants → workspaces →
 *         + seed-bulk.mjs      memberships → subscriptions → invoices → payments
 *                              → tickets, then the leaf tables. Answers "does
 *                              pagination / filtering / counting hold at volume".
 *
 * Injection order is a hard dependency: demo → bulk-core → bulk.
 *
 * ── How purge knows what to delete ──────────────────────────────────────────
 * Every fixture row carries a deterministic id in its own UUID segment:
 *   catalog `…-a000-…`  demo `…-b000-…`  bulk leaves `…-c000-…`  bulk trunk `…-d000-…`
 * so purge is "delete rows whose id lives in this segment" — no timestamps, no
 * name matching, and catalog data (a000) can never be caught by it. Tables are
 * discovered from information_schema rather than listed here, because a list
 * would go stale exactly when a new fixture table is added and would then leave
 * rows behind silently.
 *
 * Foreign keys are handled by repetition, not by a hand-maintained order: each
 * pass deletes what it can and remembers what failed, and passes repeat while
 * progress is still being made. A hardcoded dependency order is another list to
 * keep correct, and getting it wrong fails loudly in one direction and silently
 * in the other.
 *
 * Usage:
 *   node scripts/dev/fixtures.mjs inject [demo|bulk|all]
 *   node scripts/dev/fixtures.mjs purge  [demo|bulk|all]   (needs CONFIRM_PURGE=yes)
 *   node scripts/dev/fixtures.mjs status
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DB_CONTAINER = process.env["FIXTURES_DB_CONTAINER"] ?? "vx-platform-postgres-db-dev";
const DB_USER = process.env["POSTGRES_USER"] ?? "vxture";
const DB_NAME = process.env["POSTGRES_DB"] ?? "platform_main";
const DB_PASSWORD = process.env["POSTGRES_PASSWORD"] ?? "localdev";
const NETWORK = process.env["FIXTURES_NETWORK"] ?? "platform-net";

/**
 * The seed layers' id segments. `a000` (catalog) is deliberately absent.
 *
 * `bulk` is TWO segments, and getting that wrong is not a cosmetic bug: the
 * trunk (seed-bulk-core — users, tenants, workspaces, subscriptions, invoices,
 * tickets) lives in `d000`, the leaves (seed-bulk) in `c000`. An earlier version
 * of this file knew only `c000`, so `status` under-reported by ~500 rows and
 * `purge` printed a tick while leaving the entire trunk in place — precisely the
 * silent-leftover failure this script's header claims to design against. Adding
 * a fixture segment means adding it here; there is no discovery for segments.
 */
const SEGMENTS = { demo: ["b000"], bulk: ["c000", "d000"] };

/**
 * Ledger and audit tables whose DELETE is refused by an append-only trigger
 * (`95_triggers.sql`). This is not an obstacle to work around — it is the
 * platform enforcing that a ledger is a ledger. It has two consequences a purge
 * must state rather than hide:
 *
 *   1. Their own fixture rows survive a purge.
 *   2. So does anything they reference — deleting a subscription cascades into
 *      subscription_histories, which the trigger refuses, so the subscription
 *      stays too. The block propagates upward through tenants and users.
 *
 * A complete removal of fixture data is therefore not a DELETE problem at all:
 * it is `pnpm db:local:reset` (drop schemas → re-apply DDL → re-seed). Purge
 * exists for the common case — clearing the leaf volume so a page is readable
 * again — and says plainly where it stops.
 */
const APPEND_ONLY = new Set([
  "admin.operator_login_attempt",
  "billing.transactions",
  "identity.oauth_states",
  "metering.subscription_histories",
  "metering.usage_event_pools",
  "metering.usage_events",
  "safety.moderation_logs",
  "session.login_attempts",
  "support.audit_logs",
  "support.ticket_comments",
]);

const SCHEMAS = [
  "account", "identity", "credential", "kyc", "tenancy", "access", "appoidc",
  "session", "loyalty", "metering", "billing", "provisioning", "promotion",
  "product", "model", "safety", "support", "admin", "sharing",
];

function psql(sql, { quiet = true } = {}) {
  const r = spawnSync(
    "docker",
    ["exec", "-e", `PGPASSWORD=${DB_PASSWORD}`, "-i", DB_CONTAINER, "psql",
     "-U", DB_USER, "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-tAc", sql],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (r.status !== 0 && !quiet) console.error(r.stderr?.trim());
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

/** Tables with a uuid `id` column, discovered — never listed. */
function uuidTables() {
  const list = SCHEMAS.map((s) => `'${s}'`).join(",");
  const { out } = psql(
    `select table_schema||'.'||table_name from information_schema.columns
      where table_schema in (${list}) and column_name = 'id' and data_type = 'uuid'
      order by 1`,
  );
  return out ? out.split("\n") : [];
}

function inject(layer) {
  const files =
    layer === "demo" ? ["seed-demo.mjs"]
    : layer === "bulk" ? ["seed-bulk-core.mjs", "seed-bulk.mjs"]
    : ["seed-demo.mjs", "seed-bulk-core.mjs", "seed-bulk.mjs"];
  const url = `postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}`;
  for (const f of files) {
    console.log(`\n── ${f}`);
    const r = spawnSync("docker", [
      "run", "--rm", "--network", NETWORK,
      "-e", `DATABASE_URL=${url}`,
      "-v", `${resolve(ROOT, "deploy/database/seed")}:/db/seed:ro`,
      "-v", "vx-platform-db-tools:/tmp/vxture-db",
      "node:24-alpine", "sh", "-lc",
      "set -e; " +
        "if [ ! -d /tmp/vxture-db/node_modules/pg ]; then npm install --prefix /tmp/vxture-db pg@8.20.0 >/dev/null; fi; " +
        `cd /db/seed && NODE_PATH=/tmp/vxture-db/node_modules node ${f}`,
    ], { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

function purge(layer) {
  if (process.env["CONFIRM_PURGE"] !== "yes") {
    console.error("refusing: purge deletes fixture rows. Re-run with CONFIRM_PURGE=yes");
    process.exit(1);
  }
  const segments = (layer === "all" ? Object.values(SEGMENTS).flat() : SEGMENTS[layer]) ?? [];
  if (!segments.length) {
    console.error(`unknown layer '${layer}' — use demo | bulk | all`);
    process.exit(1);
  }
  const tables = uuidTables().filter((t) => !APPEND_ONLY.has(t));
  const skipped = uuidTables().filter((t) => APPEND_ONLY.has(t));
  console.log(`scanning ${tables.length} uuid-keyed tables for segments ${segments.join(", ")}`);

  let pending = tables.slice();
  let total = 0;
  for (let pass = 1; pass <= 8 && pending.length; pass++) {
    const blocked = [];
    let deletedThisPass = 0;
    for (const t of pending) {
      const cond = segments.map((seg) => `id::text like '00000000-0000-4000-${seg}-%'`).join(" or ");
      const r = psql(`with d as (delete from ${t} where ${cond} returning 1) select count(*) from d`);
      if (!r.ok) { blocked.push(t); continue; }
      const n = Number(r.out || 0);
      if (n > 0) { console.log(`  ${String(n).padStart(5)}  ${t}`); deletedThisPass += n; }
      total += n;
    }
    if (blocked.length && deletedThisPass === 0) { pending = blocked; break; }
    pending = blocked;
  }

  // Non-uuid fixture rows: product_categories has a smallint id, so the segment
  // trick cannot reach it. Its fixture rows are identifiable by code prefix.
  const cat = psql(
    `with d as (delete from product.product_categories where code like 'bulk-cat-%' returning 1) select count(*) from d`,
  );
  if (cat.ok && Number(cat.out || 0) > 0) {
    console.log(`  ${String(cat.out).padStart(5)}  product.product_categories (by code prefix)`);
    total += Number(cat.out);
  }
  console.log(`\n✓ purged ${total} fixture row(s); catalog (a000) untouched`);

  // Anything left is reported, never swallowed. A purge that prints a tick while
  // leaving rows behind is worse than one that fails: the next person reads the
  // tick and stops looking.
  const remaining = psql(
    `select count(*) from (` +
      [...tables, ...skipped]
        .map(
          (t) =>
            `select 1 from ${t} where ` +
            ["b000", "c000", "d000"]
              .map((seg) => `id::text like '00000000-0000-4000-${seg}-%'`)
              .join(" or "),
        )
        .join(" union all ") +
      `) x`,
  );
  const left = remaining.ok ? Number(remaining.out || 0) : -1;
  if (left > 0 || pending.length) {
    console.log(`\n⚠ ${left} fixture row(s) remain, and they cannot be deleted:`);
    for (const t of skipped) console.log(`   ${t}  (append-only ledger — DELETE is refused by design)`);
    for (const t of pending) console.log(`   ${t}  (referenced by an append-only ledger)`);
    console.log("\nA ledger that can be emptied is not a ledger, so this is the guard working.");
    console.log("To clear these too, rebuild rather than delete:");
    console.log("   CONFIRM_RESET=yes pnpm db:local:reset && pnpm db:local:seed");
  }
}

function status() {
  const rows = [];
  for (const t of uuidTables()) {
    const r = psql(
      `select count(*) filter (where id::text like '00000000-0000-4000-b000-%'),
              count(*) filter (where id::text like '00000000-0000-4000-c000-%'
                                  or id::text like '00000000-0000-4000-d000-%'),
              count(*) from ${t}`,
    );
    if (!r.ok) continue;
    const [demo, bulk, all] = r.out.split("|").map(Number);
    if (demo || bulk) rows.push({ t, demo, bulk, all });
  }
  if (!rows.length) return console.log("no fixture rows present (demo/bulk segments empty)");
  console.log("table".padEnd(42) + "demo".padStart(7) + "bulk".padStart(7) + "total".padStart(8));
  for (const r of rows) {
    console.log(r.t.padEnd(42) + String(r.demo).padStart(7) + String(r.bulk).padStart(7) + String(r.all).padStart(8));
  }
  const d = rows.reduce((s, r) => s + r.demo, 0);
  const b = rows.reduce((s, r) => s + r.bulk, 0);
  console.log(`\n${rows.length} table(s) carry fixtures — demo ${d}, bulk ${b}`);
}

const [cmd, layerArg] = process.argv.slice(2);
const layer = layerArg ?? "all";
switch (cmd) {
  case "inject": inject(layer); break;
  case "purge": purge(layer); break;
  case "status": status(); break;
  default:
    console.error("usage: node scripts/dev/fixtures.mjs <inject|purge|status> [demo|bulk|all]");
    process.exit(1);
}
