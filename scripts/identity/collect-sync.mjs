/**
 * Bounded multi-client inspection with one atomic textfile snapshot.
 * @package @vxture/repo
 * @layer Application
 * @category operations
 * @author AI-Generated
 * @date 2026-11-25
 */
import {
  mkdir,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectSync,
  metricLabels,
  prometheus,
  validateScope,
} from "./inspect-sync.mjs";

// ===========================================================================
// Explicit, bounded configuration; no service discovery or implicit target.
// ===========================================================================
/** Validate a batch before connecting. @param value - Non-secret JSON. @returns Unique scopes. @throws Error On duplicates, unknown fields or unbounded input. */
export function validateBatch(value) {
  if (
    !value ||
    Object.keys(value).some((key) => key !== "scopes") ||
    !Array.isArray(value.scopes) ||
    value.scopes.length < 1 ||
    value.scopes.length > 32
  )
    throw new Error("Expected between one and 32 explicit scopes");
  const labels = new Set();
  return value.scopes.map((raw) => {
    const scope = validateScope(raw);
    if (Object.keys(raw).some((key) => !Object.hasOwn(scope, key)))
      throw new Error("Unknown scope field");
    const key = metricLabels(scope);
    if (labels.has(key)) throw new Error("Duplicate metric scope");
    labels.add(key);
    return scope;
  });
}

/** Collect all requested clients; one outage cannot hide healthy peers. @param scopes - Validated scopes. @param inspect - Explicit read-only inspector. @returns Redacted outcomes. */
export async function collectScopes(scopes, inspect) {
  const results = [];
  for (const scope of scopes) {
    const labels = {
      clientId: scope.clientId,
      environment: scope.environment,
      realm: scope.realm,
      releaseChannel: scope.releaseChannel,
    };
    try {
      const report = await inspect(scope);
      if (metricLabels(report.scope) !== metricLabels(scope))
        throw new Error("Inspection scope mismatch");
      prometheus(report);
      results.push({ scope: labels, available: true, report });
    } catch {
      results.push({
        scope: labels,
        available: false,
        error: "inspection_unavailable",
      });
    }
  }
  return { observedAt: new Date().toISOString(), results };
}

/** Render one valid exposition, including explicit failures without fake zero queues. @param batch - Collected outcomes. @returns Textfile contents. */
export function batchPrometheus(batch) {
  const lines = [];
  const types = new Set();
  const append = (text) => {
    for (const line of text.trimEnd().split("\n")) {
      if (line.startsWith("# TYPE ") || line.startsWith("# HELP ")) {
        if (types.has(line)) continue;
        types.add(line);
      }
      lines.push(line);
    }
  };
  const timestamp = Date.parse(batch.observedAt) / 1000;
  if (!Number.isFinite(timestamp)) throw new Error("Invalid batch timestamp");
  for (const result of batch.results) {
    const labels = metricLabels(result.scope);
    const help = {
      scope_expected:
        "Whether this client scope is included in the explicit collection configuration.",
      collection_success:
        "Whether the latest database inspection of this scope completed successfully.",
      collection_timestamp_seconds:
        "Unix time of the latest completed batch collection attempt.",
    };
    for (const [key, value] of Object.entries({
      scope_expected: 1,
      collection_success: Number(result.available),
      collection_timestamp_seconds: timestamp,
    }))
      append(
        `# HELP vxture_identity_${key} ${help[key]}\n# TYPE vxture_identity_${key} gauge\nvxture_identity_${key}{${labels}} ${value}\n`,
      );
    if (result.available) append(prometheus(result.report));
  }
  return lines.join("\n") + "\n";
}

// ===========================================================================
// One writer, same-directory rename; crashes leave a stale complete snapshot.
// ===========================================================================
/** Publish a complete batch. @param output - Dedicated .prom path in an existing directory. @param collect - Bounded collection callback. @returns Batch and CLI status. @throws Error On locked or unwritable output; previous snapshot survives. */
export async function publishBatch(output, collect) {
  const target = resolve(output);
  if (!target.endsWith(".prom"))
    throw new Error("Output must be a dedicated .prom file");
  const lock = `${target}.lock`;
  const temp = `${target}.${randomUUID()}.tmp`;
  await mkdir(lock);
  try {
    const batch = await collect();
    await writeFile(temp, batchPrometheus(batch), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temp, target);
    const exitCode = batch.results.some((item) => !item.available)
      ? 1
      : batch.results.some((item) => !item.report.databaseReady)
        ? 2
        : 0;
    return { batch, exitCode };
  } finally {
    await unlink(temp).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rmdir(lock);
  }
}

// ===========================================================================
// One-shot collector. The deployment scheduler, if installed, owns repetition.
// ===========================================================================
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let pool;
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== "--config" || args[2] !== "--output")
      throw new Error("Use --config <batch.json> --output <dedicated.prom>");
    const scopes = validateBatch(JSON.parse(await readFile(args[1], "utf8")));
    if (!process.env.IDENTITY_INSPECT_DATABASE_URL)
      throw new Error("Missing database URL");
    const { Pool } = createRequire(
      new URL("../../bff/auth-bff/package.json", import.meta.url),
    )("pg");
    pool = new Pool({
      connectionString: process.env.IDENTITY_INSPECT_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    pool.on("error", () => undefined);
    const result = await publishBatch(args[3], () =>
      collectScopes(scopes, (scope) => inspectSync(pool, scope)),
    );
    process.stdout.write(
      JSON.stringify(
        {
          observedAt: result.batch.observedAt,
          scopes: result.batch.results.map((item) => ({
            ...item.scope,
            available: item.available,
            databaseReady: item.available ? item.report.databaseReady : null,
            failedChecks: item.available
              ? item.report.checks
                  .filter((check) => !check.passed)
                  .map((check) => check.code)
              : [],
          })),
        },
        null,
        2,
      ) + "\n",
    );
    process.exitCode = result.exitCode;
  } catch {
    process.stderr.write(
      "Identity batch unavailable, locked or invalid; inspect the previous snapshot freshness.\n",
    );
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
