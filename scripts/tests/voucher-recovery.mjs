/**
 * voucher-recovery.mjs - Isolated scheduled refund recovery and runtime composition acceptance.
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
const output = join(root, "output/voucher-recovery", id);
mkdirSync(output, { recursive: true });
const scope = {
  files: [
    {
      path: "bff/platform-api/src/jobs/order-payment-expiry.job.ts",
    },
    {
      path: "bff/platform-api/src/jobs/order-payment-expiry.job.spec.ts",
    },
    {
      path: "bff/platform-api/src/notifications/customer-notifications.wiring.ts",
    },
    {
      path: "bff/platform-api/src/notifications/customer-notifications.wiring.spec.ts",
    },
    {
      path: "bff/platform-api/src/jobs/voucher-recovery.itest.spec.ts",
    },
    {
      path: "scripts/tests/voucher-recovery.mjs",
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
  batch: "S07-R3c3",
  runId: id,
  startedAt: new Date().toISOString(),
  groups: [],
  checks: [],
  sourceBefore: fingerprint(),
  containers: [],
  limitations: [
    "Uses one disposable PostgreSQL 18 container and synthetic fixtures under platform_svc and svc_platform_api; no existing services or credentials.",
    "Calls the real platform job directly with real domain and wallet wiring; customer sends are suppressed. No production scheduler, external messages, transfers, login, products or deployment.",
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
  "@vxture/service-billing": "services/commerce/billing/src/index.ts",
  "@vxture/service-promotion": "services/commerce/promotion/src/index.ts",
  "@vxture/service-provisioning": "services/commerce/provisioning/src/index.ts",
  "@vxture/service-subscription": "services/commerce/subscription/src/index.ts",
  "@vxture/service-account": "services/identity/account/src/index.ts",
  "@vxture/service-iam": "services/identity/iam/src/index.ts",
  "@vxture/service-organization": "services/identity/organization/src/index.ts",
  "@vxture/service-notification": "services/notification/dispatch/src/index.ts",
  "@vxture/service-mail": "services/notification/mail/src/index.ts",
  "@vxture/service-notice": "services/notification/notice/src/index.ts",
  "@vxture/service-sms": "services/notification/sms/src/index.ts",
  "@vxture/service-ops-todos": "services/ops/todos/src/index.ts",
  "@vxture/service-sharing": "services/platform/sharing/src/index.ts",
  "@vxture/service-review": "services/support/review/src/index.ts",
  "@vxture/service-ticket": "services/support/ticket/src/index.ts",
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
  console.log("[S07-R3c3] " + name);
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
    result.numPendingTests === 0 &&
    result.testResults.every(
      (s) =>
        s.assertionResults.length > 0 &&
        s.assertionResults.every((a) => a.status === "passed"),
    );
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
// The runner owns the disposable target and its cleanup; suites verify its marker.
// ============================================================================
let failure;
let owned;
let owner;
let pool;
try {
  await group("platform-regression", "bff/platform-api", [
    "src/jobs/order-payment-expiry.job.spec.ts",
    "src/jobs/provisioning-dispatch.job.spec.ts",
    "src/jobs/sweep-interval.util.spec.ts",
    "src/jobs/trial-expiry.job.spec.ts",
    "src/jobs/addon-lifecycle.job.spec.ts",
    "src/jobs/invitation-expiry.job.spec.ts",
    "src/notifications/customer-notifications.wiring.spec.ts",
  ]);
  for (const pkg of [
    "bff/platform-api",
    "bff/console-bff",
    "bff/admin-bff",
    "services/commerce/billing",
    "services/commerce/provisioning",
    "services/commerce/promotion",
    "services/commerce/subscription",
  ]) {
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
              Object.entries(paths).map(([key, targets]) => [
                key,
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
  const runId = randomUUID();
  const name = "codex-voucher-s07-r3c3-" + runId.slice(0, 12);
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
  owned = { name, id: containerId, runId };
  writeFileSync(
    join(output, "container-ownership.json"),
    JSON.stringify(owned, null, 2),
  );
  const info = JSON.parse(docker(["inspect", containerId]))[0];
  if (
    info.Id !== containerId ||
    info.Config.Labels["codex.run"] !== runId ||
    info.HostConfig.PortBindings["5432/tcp"][0].HostIp !== "127.0.0.1"
  )
    throw new Error("Isolated target ownership mismatch");
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
  const { Pool } = require("pg");
  owner = new Pool({
    connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres`,
    connectionTimeoutMillis: 10000,
    statement_timeout: 20000,
  });
  await owner.query("create database voucher_recovery");
  await owner.query(
    `comment on database voucher_recovery is 'codex-voucher-recovery:${runId}'`,
  );
  const url = `postgresql://postgres@127.0.0.1:${port}/voucher_recovery`;
  pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 10000,
    statement_timeout: 20000,
  });
  const ddl = join(root, "deploy/database/ddl");
  for (const file of readdirSync(ddl)
    .filter((n) => /^\d.*\.sql$/.test(n))
    .sort())
    await pool.query(readFileSync(join(ddl, file), "utf8"));
  await pool.query(
    "alter role svc_admin_bff login; alter role svc_console_bff login; alter role svc_platform_api login; alter role platform_svc login",
  );
  await group(
    "voucher-recovery",
    "bff/platform-api",
    ["src/jobs/voucher-recovery.itest.spec.ts"],
    {
      VOUCHER_RECOVERY_ITEST: "1",
      VOUCHER_RECOVERY_OWNED_DATABASE_URL: url,
      VOUCHER_RECOVERY_OWNED_RUN_ID: runId,
    },
  );
} catch (error) {
  failure = String(error);
} finally {
  await pool?.end();
  await owner?.end();
  if (owned) {
    const record = { ...owned, cleaned: false, remaining: true, error: null };
    try {
      if (!/^[a-f0-9]{64}$/.test(owned.id))
        throw new Error("Malformed container identity");
      const info = JSON.parse(docker(["inspect", owned.id]))[0];
      if (
        info.Id !== owned.id ||
        info.Name !== "/" + owned.name ||
        info.Config.Labels["codex.run"] !== owned.runId
      )
        throw new Error("Container ownership changed; cleanup refused");
      docker(["rm", "--force", "--volumes", owned.id]);
      record.cleaned = true;
      record.remaining =
        docker([
          "ps",
          "-aq",
          "--no-trunc",
          "--filter",
          "name=^/" + owned.name + "$",
        ]).trim() !== "";
    } catch (error) {
      record.error = String(error);
    }
    report.containers.push(record);
  }
  report.sourceAfter = fingerprint();
  report.sourceUnchanged =
    JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
  report.error = failure ?? null;
  report.finishedAt = new Date().toISOString();
  report.ok =
    !failure &&
    report.groups.length === 2 &&
    report.groups.every((g) => g.ok) &&
    report.checks.length === 7 &&
    report.checks.every((c) => c.ok) &&
    report.containers.length === 1 &&
    report.containers.every((c) => c.cleaned && !c.remaining && !c.error) &&
    report.sourceUnchanged;
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(root, "output/voucher-recovery-current.json"),
    JSON.stringify({ directory: output, ok: report.ok }, null, 2),
  );
  console.log("REPORT=" + join(output, "report.json"));
  if (!report.ok) process.exitCode = 1;
}
