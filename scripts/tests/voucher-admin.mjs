/**
 * voucher-admin.mjs - Isolated Admin action authorization and voucher acceptance.
 * @package vxture-platform
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { spawn, execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { setTimeout } from "node:timers/promises";

// ============================================================================
// Only basic process settings survive; no existing database, Redis or secrets.
// ============================================================================
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(join(root, "bff/admin-bff/package.json"));
const ts = require("typescript");
const vitest = join(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const env = { NODE_ENV: "test", TZ: "UTC", NO_COLOR: "1" };
for (const [key, value] of Object.entries(process.env))
  if (
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata)$/i.test(
      key,
    )
  )
    env[key] = value;
const id =
  new Date().toISOString().replaceAll(/[:.]/g, "-") +
  "-" +
  randomUUID().slice(0, 8);
const output = join(root, "output/voucher-admin", id);
mkdirSync(output, { recursive: true });
const scope = {
  files: [
    {
      path: "bff/admin-bff/src/auth/operator-stepup.service.ts",
    },
    {
      path: "bff/admin-bff/src/auth/operator-stepup.service.spec.ts",
    },
    {
      path: "bff/admin-bff/src/auth/step-up.decorator.ts",
    },
    {
      path: "bff/admin-bff/src/auth/step-up.guard.ts",
    },
    {
      path: "bff/admin-bff/src/auth/step-up.guard.spec.ts",
    },
    {
      path: "bff/admin-bff/src/auth/voucher-step-up.ts",
    },
    {
      path: "bff/admin-bff/src/auth/voucher-step-up.spec.ts",
    },
    {
      path: "bff/admin-bff/src/middleware/auth.middleware.ts",
    },
    {
      path: "bff/admin-bff/src/routers/operator-stepup.router.ts",
    },
    {
      path: "bff/admin-bff/src/routers/commercial.router.ts",
    },
    {
      path: "bff/admin-bff/src/routers/voucher-management.read.ts",
    },
    {
      path: "bff/admin-bff/src/routers/voucher-management.itest.spec.ts",
    },
    {
      path: "bff/admin-bff/src/routers/voucher-security.http.spec.ts",
    },
    {
      path: "bff/admin-bff/src/routers/voucher-action.http.spec.ts",
    },
    {
      path: "bff/admin-bff/src/routers/invite-voucher.spec.ts",
    },
    {
      path: "bff/admin-bff/src/routers/order-payment-e2e.itest.spec.ts",
    },
    {
      path: "bff/admin-bff/src/types/console.types.ts",
    },
    {
      path: "scripts/tests/voucher-admin.mjs",
    },
    {
      path: "packages/core/config/src/schemas/auth.schema.ts",
    },
    {
      path: "packages/core/config/src/schemas/auth.schema.spec.ts",
    },
  ],
};
const fingerprint = () =>
  Object.fromEntries(
    scope.files.map(({ path }) => [
      path,
      existsSync(join(root, path))
        ? createHash("sha256")
            .update(readFileSync(join(root, path)))
            .digest("hex")
        : null,
    ]),
  );
const report = {
  batch: "S07-R3b",
  runId: id,
  startedAt: new Date().toISOString(),
  groups: [],
  checks: [],
  sourceBefore: fingerprint(),
  containers: [],
  limitations: [
    "Uses disposable PostgreSQL and synthetic local IdP fixtures; no existing services or credentials.",
    "Auth grant protection was verified in S07-R3a; this validates Admin integration and receipt enforcement. Console, UI and deployment remain later batches.",
  ],
};
const docker = (args) =>
  execFileSync("docker", args, {
    env,
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
  });
const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const paths = ts.readConfigFile(
  join(root, "tsconfig.base.json"),
  ts.sys.readFile,
).config.compilerOptions.paths;
// Check workspace sources without requiring unrelated prebuilt dist artifacts.
for (const [name, source] of Object.entries({
  "@vxture/core-mail": "packages/core/mail/src/index.ts",
  "@vxture/core-oidc-rp": "packages/core/oidc-rp/src/index.ts",
  "@vxture/core-identity-sdk": "packages/core/identity-sdk/src/index.ts",
  "@vxture/core-config/openapi": "packages/core/config/src/utils/openapi.ts",
  "@vxture/core-utils/phone": "packages/core/utils/src/utils/phone.utils.ts",
}))
  paths[name] = [source];
const aliases = Object.entries(paths)
  .sort(
    ([left], [right]) =>
      Number(left.endsWith("/*")) - Number(right.endsWith("/*")) ||
      right.length - left.length,
  )
  .map(([name, targets]) => {
    const wildcard = name.endsWith("/*");
    let replacement = resolve(root, targets[0].replace(/\/\*$/, ""));
    if (
      !wildcard &&
      existsSync(replacement) &&
      statSync(replacement).isDirectory()
    )
      replacement = join(replacement, "index.ts");
    const pattern = wildcard
      ? "^" + escaped(name.slice(0, -1))
      : "^" + escaped(name) + "$";
    return `{find:new RegExp(${JSON.stringify(pattern)}),replacement:${JSON.stringify(replacement + (wildcard ? "/" : ""))}}`;
  });
const config = join(output, "vitest.config.mjs");
writeFileSync(
  config,
  `export default {resolve:{alias:[${aliases.join(",")}]},test:{environment:"node",include:["src/**/*.spec.ts"],testTimeout:30000,hookTimeout:60000}};`,
);

/** Run one bounded local command with a complete, sanitized log. */
async function run(name, args, cwd = root, extra = {}) {
  const stream = createWriteStream(join(output, name + ".log"));
  let code;
  try {
    code = await new Promise((accept, reject) => {
      const child = spawn(process.execPath, args, {
        cwd,
        env: { ...env, ...extra },
        windowsHide: true,
        timeout: 240000,
      });
      child.stdout.pipe(stream, { end: false });
      child.stderr.pipe(stream, { end: false });
      child.once("error", reject);
      child.once("close", (c) => accept(c ?? 1));
    });
  } finally {
    await new Promise((done) => stream.end(done));
  }
  return code;
}
/** Each required group must execute every selected file with no skipped tests. */
async function group(name, directory, files, flags = {}) {
  console.log("[S07-R3b] " + name);
  const resultFile = join(output, name + ".json");
  const code = await run(
    name,
    [
      vitest,
      "run",
      ...files,
      "--config",
      config,
      "--maxWorkers=1",
      "--reporter=default",
      "--reporter=json",
      "--outputFile",
      resultFile,
    ],
    join(root, directory),
    flags,
  );
  let result;
  try {
    result = JSON.parse(readFileSync(resultFile, "utf8"));
  } catch {}
  const present = files.every((file) =>
    result?.testResults?.some((s) =>
      s.name.replaceAll("\\", "/").endsWith(file),
    ),
  );
  const ok =
    code === 0 &&
    result?.success === true &&
    present &&
    result.numPassedTests > 0 &&
    result.numPendingTests === 0;
  report.groups.push({
    name,
    ok,
    exitCode: code,
    passed: result?.numPassedTests ?? 0,
    failed: result?.numFailedTests ?? null,
    skipped: result?.numPendingTests ?? null,
    selectedFilesPresent: present,
  });
  console.log(JSON.stringify(report.groups.at(-1)));
}

// ============================================================================
// Suites own their exact container ID + label; fallback cleanup repeats ownership.
// ============================================================================
let failure;
let ownedLegacy;
let legacyPool;
try {
  await group("claim-config", "packages/core/config", [
    "src/schemas/auth.schema.spec.ts",
  ]);
  await group("admin-security", "bff/admin-bff", [
    "src/auth/operator-stepup.service.spec.ts",
    "src/auth/step-up.guard.spec.ts",
    "src/auth/voucher-step-up.spec.ts",
    "src/auth/auth.service.spec.ts",
    "src/routers/invite-voucher.spec.ts",
    "src/routers/voucher-security.http.spec.ts",
    "src/routers/billing-action-guard.spec.ts",
    "src/providers/commerce-services.provider.spec.ts",
  ]);
  await group(
    "voucher-management",
    "bff/admin-bff",
    ["src/routers/voucher-management.itest.spec.ts"],
    { VOUCHER_MANAGEMENT_ITEST: "1" },
  );
  await group(
    "voucher-action",
    "bff/admin-bff",
    ["src/routers/voucher-action.http.spec.ts"],
    { VOUCHER_ACTION_ITEST: "1" },
  );
  for (const pkg of ["bff/auth-bff", "bff/admin-bff", "packages/core/config"]) {
    const name = "types-" + pkg.split("/").at(-1);
    const typeConfig = join(output, name + ".tsconfig.json");
    writeFileSync(
      typeConfig,
      JSON.stringify(
        {
          extends: join(root, pkg, "tsconfig.json"),
          compilerOptions: {
            lib: ["ES2023", "DOM"],
            paths: Object.fromEntries(
              Object.entries(paths).map(([name, targets]) => [
                name,
                targets.map((target) => resolve(root, target)),
              ]),
            ),
          },
        },
        null,
        2,
      ),
    );
    const code = await run(name, [
      join(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--project",
      typeConfig,
    ]);
    report.checks.push({ name, ok: code === 0, exitCode: code });
    console.log(name + ": " + code);
  }
  const runId = randomUUID(),
    name = "codex-voucher-s07-r3b-legacy-" + runId.slice(0, 12);
  const containerId = docker([
    "run",
    "--detach",
    "--pull=never",
    "--name",
    name,
    "--label",
    "codex.run=" + runId,
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "--publish",
    "127.0.0.1::5432",
    "postgres:18-alpine",
  ]).trim();
  ownedLegacy = { name, id: containerId, runId };
  const info = JSON.parse(docker(["inspect", containerId]))[0];
  if (
    info.Id !== containerId ||
    info.Config.Labels["codex.run"] !== runId ||
    info.HostConfig.PortBindings["5432/tcp"][0].HostIp !== "127.0.0.1"
  )
    throw new Error("Isolated legacy target ownership mismatch");
  for (let attempt = 0; ; attempt++) {
    try {
      docker([
        "exec",
        containerId,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
      ]);
      break;
    } catch (error) {
      if (attempt === 40) throw error;
      await setTimeout(250);
    }
  }
  const port = Number(
    docker(["port", containerId, "5432/tcp"]).trim().split(":").at(-1),
  );
  const databaseUrl = "postgresql://postgres@127.0.0.1:" + port + "/postgres";
  const { Pool } = require("pg");
  legacyPool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10000,
    statement_timeout: 20000,
  });
  const ddl = join(root, "deploy/database/ddl");
  for (const file of readdirSync(ddl)
    .filter((n) => /^\d.*\.sql$/.test(n))
    .sort())
    await legacyPool.query(readFileSync(join(ddl, file), "utf8"));
  const seed = await run(
    "catalog-fixture",
    [join(root, "deploy/database/seed/seed-catalog.mjs")],
    root,
    { DATABASE_URL: databaseUrl },
  );
  if (seed !== 0) throw new Error("Isolated catalog seed failed");
  const plans = await legacyPool.query(
    "select pl.plan_code from product.plans pl join product.plan_versions pv on pv.id=pl.current_version_id where pl.plan_code=any($1::text[])",
    [["arda-free", "arda-starter", "arda-pro", "arda-business"]],
  );
  if (plans.rowCount !== 4)
    throw new Error("All four isolated catalog tiers must exist");
  await legacyPool.query(
    "create table public.codex_voucher_run(id uuid primary key)",
  );
  await legacyPool.query(
    "insert into public.codex_voucher_run(id) values($1)",
    [runId],
  );
  await group(
    "legacy-order",
    "bff/admin-bff",
    ["src/routers/order-payment-e2e.itest.spec.ts"],
    {
      ORDER_PAYMENT_E2E: "1",
      VOUCHER_ADMIN_OWNED_DATABASE_URL: databaseUrl,
      VOUCHER_ADMIN_OWNED_RUN_ID: runId,
    },
  );
} catch (error) {
  failure = String(error);
} finally {
  await legacyPool?.end();
  for (const name of ["voucher-management", "voucher-action", "legacy-order"]) {
    const log = existsSync(join(output, name + ".log"))
      ? readFileSync(join(output, name + ".log"), "utf8")
      : "";
    const owned = [
      ...log.matchAll(/S07_R3B_CONTAINER_OWNERSHIP=(\{[^\r\n]+\})/g),
    ].map((m) => JSON.parse(m[1]));
    if (name === "legacy-order" && ownedLegacy) owned.push(ownedLegacy);
    const cleaned = [
      ...log.matchAll(/S07_R3B_CONTAINER_CLEANED=([a-z0-9-]+)/g),
    ].map((m) => m[1]);
    for (const container of owned) {
      const record = {
        ...container,
        cleanedByOwnedSuite: cleaned.includes(container.name),
        fallbackCleaned: false,
        remaining: true,
        error: null,
      };
      try {
        if (
          !/^[a-f0-9]{64}$/.test(container.id) ||
          !/^[a-z0-9-]+$/.test(container.name)
        )
          throw new Error("Malformed container ownership receipt");
        let remaining = docker([
          "ps",
          "-aq",
          "--no-trunc",
          "--filter",
          "name=^/" + container.name + "$",
        ]).trim();
        if (remaining) {
          const info = JSON.parse(docker(["inspect", container.name]))[0];
          if (
            remaining !== container.id ||
            info.Id !== container.id ||
            info.Config.Labels["codex.run"] !== container.runId
          )
            throw new Error("Container ownership changed; cleanup refused");
          docker(["rm", "--force", "--volumes", container.id]);
          record.fallbackCleaned = true;
          remaining = docker([
            "ps",
            "-aq",
            "--no-trunc",
            "--filter",
            "name=^/" + container.name + "$",
          ]).trim();
        }
        record.remaining = remaining !== "";
      } catch (error) {
        record.error = String(error);
      }
      report.containers.push(record);
    }
  }
  report.sourceAfter = fingerprint();
  report.sourceUnchanged =
    JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
  report.error = failure ?? null;
  report.finishedAt = new Date().toISOString();
  report.ok =
    !failure &&
    report.groups.length === 5 &&
    report.groups.every((g) => g.ok) &&
    report.checks.length === 3 &&
    report.checks.every((c) => c.ok) &&
    report.containers.length === 3 &&
    report.containers.every(
      (c) =>
        (c.cleanedByOwnedSuite || c.fallbackCleaned) &&
        !c.remaining &&
        !c.error,
    ) &&
    report.sourceUnchanged;
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(root, "output/voucher-admin-current.json"),
    JSON.stringify({ directory: output, ok: report.ok }, null, 2),
  );
  console.log("REPORT=" + join(output, "report.json"));
  if (!report.ok) process.exitCode = 1;
}
