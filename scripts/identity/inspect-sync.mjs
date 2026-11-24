/**
 * Read-only deployment checks and bounded identity delivery metrics.
 * @package @vxture/repo
 * @layer Application
 * @category operations
 * @author AI-Generated
 * @date 2026-11-24
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ===========================================================================
// Configuration contains no credentials; runtime evidence is never inferred.
// ===========================================================================
/** Validate the selected immutable client binding. @param value - Parsed JSON. @returns Validated configuration. @throws Error For unsupported or unsafe scope. */
export function validateScope(value) {
  const fields = [
    "clientId",
    "issuer",
    "environment",
    "releaseChannel",
    "logoutUri",
    "receiverUri",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    fields.some((key) => typeof value[key] !== "string")
  )
    throw new Error("A complete non-secret client scope is required");
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(value.clientId) ||
    !["dev", "beta", "prod"].includes(value.environment) ||
    !["stable", "beta", "canary"].includes(value.releaseChannel)
  )
    throw new Error("Unsupported client scope");
  for (const field of ["issuer", "logoutUri", "receiverUri"]) {
    const url = new URL(value[field]);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (url.protocol !== "https:" &&
        !(value.environment === "dev" && local && url.protocol === "http:"))
    )
      throw new Error(
        "Scope endpoints require HTTPS (loopback HTTP only in dev)",
      );
    if (field === "issuer" && value[field] !== url.origin)
      throw new Error(
        "Issuer must be the exact origin without a trailing slash",
      );
  }
  const realm = value.realm ?? "customer";
  if (!["customer", "workforce"].includes(realm))
    throw new Error("Unsupported identity realm");
  return {
    ...Object.fromEntries(fields.map((key) => [key, value[key]])),
    realm,
  };
}

const requiredTables = [
  "appoidc.oidc_clients",
  "session.auth_sessions",
  "session.oidc_session_clients",
  "session.logout_deliveries",
  "session.identity_recovery_streams",
  "session.identity_recovery_events",
  "session.identity_change_streams",
  "session.identity_subject_versions",
  "session.identity_change_events",
  "session.identity_change_outbox",
  "session.identity_change_receivers",
  "session.identity_change_deliveries",
  "session.rp_revocation_receipts",
  "session.rp_identity_inbox",
  "session.rp_identity_versions",
  "session.identity_time_boundaries",
];
const triggers = [
  ["session.auth_sessions", "trg_central_identity", ""],
  ["session.identity_change_outbox", "trg_central_identity", ""],
  ["tenancy.customer_portals", "trg_portal_identity", ""],
  ["session.auth_sessions", "trg_customer_session_logout", ""],
  ["session.auth_sessions", "trg_identity_context_version", ""],
  ["session.auth_sessions", "trg_identity_context_change", ""],
  ["session.oidc_session_clients", "trg_identity_change_binding", ""],
  ["session.identity_change_outbox", "trg_identity_change_route", ""],
  ["session.logout_deliveries", "trg_logout_recovery", ""],
  ["session.rp_revocation_receipts", "trg_rp_revocation_notify", ""],
  ["session.rp_identity_versions", "trg_rp_identity_notify", ""],
  ["session.identity_change_events", "trg_identity_change_enqueue", ""],
  ["account.users", "trg_identity_access", "account,email,phone"],
  ["account.user_profiles", "trg_identity_presentation", ""],
  ["tenancy.tenants", "trg_identity_access", "name,display_name,tenant_no"],
  ["tenancy.workspaces", "trg_identity_access", "name,workspace_no"],
  ["tenancy.tenant_logos", "trg_identity_presentation", ""],
  ...[
    "tenancy.tenant_memberships",
    "tenancy.workspace_memberships",
    "metering.product_seats",
    "access.roles",
    "access.permissions",
    "access.role_permissions",
    "metering.subscriptions",
  ].map((table) => [table, "trg_identity_access", ""]),
  ...[
    "product.products",
    "product.plans",
    "product.plan_versions",
    "product.plan_components",
    "metering.subscription_entitlement_overrides",
  ].map((table) => [table, "trg_identity_commerce", ""]),
  ...[
    "metering.subscriptions",
    "metering.subscription_entitlement_overrides",
  ].map((table) => [table, "trg_identity_schedule", ""]),
];

// ===========================================================================
// Repeatable, read-only observation: no session reads, replay, signing or DDL.
// ===========================================================================
/** Collect a bounded snapshot. @param pool - Explicit PostgreSQL connection pool. @param supplied - Non-secret scope. @returns Redacted checks and numeric gauges. @throws Error On unavailable persistence; never reports healthy zeros. */
export async function inspectSync(pool, supplied) {
  const scope = validateScope(supplied);
  const checks = [];
  const metrics = {};
  const check = (code, passed) =>
    checks.push({ code, passed: Boolean(passed) });
  const tx = await pool.connect();
  try {
    await tx.query("begin isolation level repeatable read read only");
    await tx.query("set local statement_timeout='3s'");
    await tx.query("set local idle_in_transaction_session_timeout='5s'");
    const tables = await tx.query(
      "select name, to_regclass(name) is not null as present from unnest($1::text[]) name",
      [
        [
          ...requiredTables,
          ...(scope.realm === "workforce"
            ? ["session.workforce_identity_versions"]
            : []),
        ],
      ],
    );
    for (const row of tables.rows) check(`table:${row.name}`, row.present);
    const columns = await tx.query(
      `select name,exists(select 1 from pg_attribute
       where attrelid=to_regclass(name) and attname='realm' and not attisdropped) as present
       from unnest($1::text[]) name`,
      [["session.logout_deliveries", "session.identity_change_outbox"]],
    );
    for (const row of columns.rows)
      check(`column:${row.name}:realm`, row.present);
    if (checks.every((item) => item.passed)) {
      for (const [table, trigger, projection] of [
        ...triggers,
        ...(scope.realm === "workforce"
          ? [
              "operator_account",
              "operator_role",
              "operator_permission",
              "operator_role_permission",
              "operator_credential",
              "operator_mfa",
              "operator_webauthn_credential",
            ].map((name) => [`admin.${name}`, "trg_workforce_identity", ""])
          : []),
      ]) {
        const result = await tx.query(
          "select pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid=to_regclass($1) and tgname=$2 and tgenabled in ('O','A') and not tgisinternal",
          [table, trigger],
        );
        check(
          `trigger:${table}:${trigger}`,
          result.rows[0]?.definition.includes(projection),
        );
      }
      const binding = await tx.query(
        `select
        c.realm=$7 and c.client_kind='platform' and c.status='active'
          and c.token_endpoint_auth_method='client_secret_basic' and c.slo_participation='back_channel'
          and c.release_channel=$4 and c.back_channel_logout_uri=$5 as client_matches,
        s.issuer=$2 and s.environment=$3 and s.realm=$7 and s.release_channel=$4
          and s.logout_uri=$5 and s.enabled as recovery_matches,
        changes.enabled as changes_enabled,
        r.receiver_uri=$6 and r.enabled as receiver_matches
        from appoidc.oidc_clients c
        left join session.identity_recovery_streams s on s.client_id=c.client_id
        left join session.identity_change_streams changes on changes.stream_id=s.stream_id
        left join session.identity_change_receivers r on r.stream_id=s.stream_id
        where c.client_id=$1`,
        [
          scope.clientId,
          scope.issuer,
          scope.environment,
          scope.releaseChannel,
          scope.logoutUri,
          scope.receiverUri,
          scope.realm,
        ],
      );
      for (const name of [
        "client_matches",
        "recovery_matches",
        "changes_enabled",
        "receiver_matches",
      ])
        check(name, binding.rows[0]?.[name]);
      for (const kind of ["logout", "changes"]) {
        const source =
          kind === "logout"
            ? `select status,attempts,available_at,lease_until,retry_until,created_at as occurred_at
             from session.logout_deliveries where client_id=$1 and release_channel=$4 and logout_uri=$5 and realm=$7`
            : `select d.status,d.attempts,d.available_at,d.lease_until,d.retry_until,o.occurred_at
             from session.identity_change_deliveries d
             join session.identity_recovery_streams s using(stream_id)
             join session.identity_change_events e using(stream_id,sequence)
             join session.identity_change_outbox o on o.event_id=e.event_id
             where s.client_id=$1 and s.issuer=$2 and s.environment=$3 and s.release_channel=$4
               and s.logout_uri=$5 and s.realm=$7 and o.realm=$7 and d.receiver_uri=$6`;
        // Bind every scope dimension even when a delivery profile uses a subset.
        const result = await tx.query(
          `with scope as (select $1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text), work as (${source})
          select count(*) filter(where status='pending')::float8 as pending,
          count(*) filter(where status='quarantined')::float8 as quarantined,
          count(*) filter(where status='pending' and attempts>1)::float8 as retried_pending,
          count(*) filter(where status='pending' and lease_until<=now())::float8 as expired_leases,
          count(*) filter(where status='pending' and retry_until<=now())::float8 as exhausted,
          coalesce(max(extract(epoch from now()-occurred_at)) filter(where status='pending'),0)::float8 as oldest_pending_seconds
          from work where status in ('pending','quarantined')`,
          [
            scope.clientId,
            scope.issuer,
            scope.environment,
            scope.releaseChannel,
            scope.logoutUri,
            scope.receiverUri,
            scope.realm,
          ],
        );
        for (const [name, value] of Object.entries(result.rows[0]))
          metrics[`${kind}_${name}`] = Math.max(0, value);
      }
      const due = await tx.query(
        "select count(*)::float8 as pending,coalesce(max(extract(epoch from now()-due_at)),0)::float8 as oldest from session.identity_time_boundaries where not emitted and due_at<=now()",
      );
      metrics.global_due_boundaries = due.rows[0].pending;
      metrics.global_oldest_due_seconds = Math.max(0, due.rows[0].oldest);
      check(
        "no_quarantined_work",
        metrics.logout_quarantined + metrics.changes_quarantined === 0,
      );
      check(
        "no_exhausted_retries",
        metrics.logout_exhausted + metrics.changes_exhausted === 0,
      );
    }
    await tx.query("commit");
    return {
      observedAt: new Date().toISOString(),
      scope: {
        clientId: scope.clientId,
        environment: scope.environment,
        realm: scope.realm,
        releaseChannel: scope.releaseChannel,
      },
      databaseReady: checks.every((item) => item.passed),
      checks,
      metrics,
      requiredExternalEvidence: [
        "runtime switches and signing/JWKS",
        "target proxy and browser",
        "cross-product acceptance",
        "capacity and alert routing",
      ],
    };
  } catch (error) {
    await tx.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}

/** Render bounded labels for a textfile collector. @param report - Inspection result. @returns Prometheus exposition; no user/session/event labels. */
export function prometheus(report) {
  const labels = metricLabels(report.scope);
  const values = {
    database_ready: Number(report.databaseReady),
    inspection_timestamp_seconds: Date.parse(report.observedAt) / 1000,
    ...report.metrics,
  };
  if (
    Object.entries(values).some(
      ([key, value]) =>
        !/^[a-z_]+$/.test(key) || !Number.isFinite(value) || value < 0,
    )
  )
    throw new Error("Invalid inspection metric");
  return Object.entries(values)
    .map(
      ([key, value]) =>
        `# HELP vxture_identity_${key} ${metricHelp(key)}\n# TYPE vxture_identity_${key} gauge\nvxture_identity_${key}{${labels}} ${value}\n`,
    )
    .join("");
}

/** Describe snapshot gauges without exposing scope endpoints. @param key - Validated metric suffix. @returns Metric help text. */
function metricHelp(key) {
  const descriptions = {
    database_ready:
      "Whether all schema, registration and queue readiness checks passed.",
    inspection_timestamp_seconds:
      "Unix time of the completed database observation.",
    global_due_boundaries:
      "Unemitted due time boundaries across the database; aggregate scopes with max.",
    global_oldest_due_seconds:
      "Age of the oldest unemitted due time boundary across the database.",
    pending: "Pending deliveries in the exact registered scope.",
    quarantined:
      "Quarantined deliveries requiring explicit recovery in this scope.",
    retried_pending:
      "Pending deliveries attempted more than once in this scope.",
    expired_leases:
      "Pending deliveries with an expired worker lease in this scope.",
    exhausted:
      "Pending deliveries whose retry window has expired in this scope.",
    oldest_pending_seconds: "Age of the oldest pending fact in this scope.",
  };
  return (
    descriptions[key] ??
    descriptions[key.replace(/^(logout|changes)_/, "")] ??
    "Current bounded identity inspection value."
  );
}

/** Render exact bounded scope labels. @param scope - Public scope fields. @returns Safe Prometheus labels. @throws Error On incomplete or unsafe labels. */
export function metricLabels(scope) {
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(scope.clientId ?? "") ||
    !["dev", "beta", "prod"].includes(scope.environment) ||
    !["customer", "workforce"].includes(scope.realm) ||
    !["stable", "beta", "canary"].includes(scope.releaseChannel)
  )
    throw new Error("Invalid metric scope");
  return `client_id="${scope.clientId}",environment="${scope.environment}",realm="${scope.realm}",release_channel="${scope.releaseChannel}"`;
}

// ===========================================================================
// CLI: secrets come from one explicit env var and never enter output/errors.
// ===========================================================================
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let pool;
  try {
    const args = process.argv.slice(2);
    if (
      args.length < 2 ||
      args[0] !== "--config" ||
      (args[2] && args[2] !== "--prometheus") ||
      args.length > 3
    )
      throw new Error("Use --config <non-secret.json> [--prometheus]");
    const scope = validateScope(JSON.parse(await readFile(args[1], "utf8")));
    if (!process.env.IDENTITY_INSPECT_DATABASE_URL)
      throw new Error("Missing explicit inspection database URL");
    const require = createRequire(
      new URL("../../bff/auth-bff/package.json", import.meta.url),
    );
    const { Pool } = require("pg");
    pool = new Pool({
      connectionString: process.env.IDENTITY_INSPECT_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    const report = await inspectSync(pool, scope);
    process.stdout.write(
      args.includes("--prometheus")
        ? prometheus(report)
        : JSON.stringify(report, null, 2) + "\n",
    );
    if (!report.databaseReady) process.exitCode = 2;
  } catch {
    process.stderr.write(
      "Identity inspection unavailable or configuration invalid; no healthy metrics were emitted.\n",
    );
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
