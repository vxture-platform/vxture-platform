/**
 * voucher-stepup.mjs - Isolated Auth step-up security acceptance.
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

// ============================================================================
// Only basic process settings survive; no existing database, Redis or secrets.
// ============================================================================
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(join(root, "bff/auth-bff/package.json"));
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
const output = join(root, "output/voucher-stepup", id);
mkdirSync(output, { recursive: true });
const scope = {
  files: [
    {
      path: "bff/auth-bff/src/redis/redis.service.ts",
    },
    {
      path: "bff/auth-bff/src/oidc/oidc.service.ts",
    },
    {
      path: "bff/auth-bff/src/routers/operator-stepup.router.ts",
    },
    {
      path: "bff/auth-bff/src/oidc/token-session-validity.spec.ts",
    },
    {
      path: "bff/auth-bff/src/oidc/operator-stepup.spec.ts",
    },
    {
      path: "bff/auth-bff/src/redis/operator-stepup.itest.spec.ts",
    },
    {
      path: "scripts/tests/voucher-stepup.mjs",
    },
    {
      path: "scripts/guardrails/internal-route-policy.snapshot.json",
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
  batch: "S07-R3a",
  runId: id,
  startedAt: new Date().toISOString(),
  groups: [],
  checks: [],
  sourceBefore: fingerprint(),
  containers: [],
  limitations: [
    "Uses disposable Redis, synthetic operator records and in-memory signing keys; no existing services or credentials.",
    "Admin binding and receipt enforcement remain S07-R3b; this validates the Auth authority and its protected internal HTTP endpoints.",
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
  console.log("[S07-R3a] " + name);
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
try {
  await group("auth-security", "bff/auth-bff", [
    "src/oidc/operator-stepup.spec.ts",
    "src/oidc/token-session-validity.spec.ts",
    "src/oidc/operator-security-step-up.spec.ts",
    "src/oidc/operator-mfa.service.spec.ts",
    "src/oidc/operator-login-freshness.spec.ts",
    "src/oidc/operator-self-mfa.spec.ts",
    "src/oidc/operator-enrollment-context.spec.ts",
    "src/oidc/operator-password-revocation.spec.ts",
    "src/oidc/realm-login-isolation.spec.ts",
    "src/oidc/oidc-key.service.spec.ts",
    "src/token/token.service.spec.ts",
    "src/routers/session-status.http.spec.ts",
    "src/oidc/logout-retry.job.spec.ts",
    "src/authn/internal-auth.guard.spec.ts",
    "src/authn/internal-route-policy.spec.ts",
    "src/authn/actor-binding.guard.spec.ts",
  ]);
  await group(
    "redis-protection",
    "bff/auth-bff",
    ["src/redis/operator-stepup.itest.spec.ts"],
    { OPERATOR_STEPUP_ITEST: "1" },
  );
  const typeConfig = join(output, "types-auth-bff.tsconfig.json");
  writeFileSync(
    typeConfig,
    JSON.stringify(
      {
        extends: join(root, "bff/auth-bff/tsconfig.json"),
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
  let code = await run("types-auth-bff", [
    join(root, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--project",
    typeConfig,
  ]);
  report.checks.push({
    name: "types-auth-bff",
    ok: code === 0,
    exitCode: code,
  });
  console.log("types-auth-bff: " + code);
  for (const selfTest of [false, true]) {
    const name = selfTest
      ? "internal-route-policy-self-test"
      : "internal-route-policy";
    code = await run(name, [
      join(root, "scripts/guardrails/check-internal-route-policy.mjs"),
      ...(selfTest ? ["--self-test"] : []),
    ]);
    report.checks.push({ name, ok: code === 0, exitCode: code });
    console.log(name + ": " + code);
  }
} catch (error) {
  failure = String(error);
} finally {
  for (const name of ["redis-protection"]) {
    const log = existsSync(join(output, name + ".log"))
      ? readFileSync(join(output, name + ".log"), "utf8")
      : "";
    const owned = [
      ...log.matchAll(/S07_R3A_CONTAINER_OWNERSHIP=(\{[^\r\n]+\})/g),
    ].map((m) => JSON.parse(m[1]));
    const cleaned = [
      ...log.matchAll(/S07_R3A_CONTAINER_CLEANED=([a-z0-9-]+)/g),
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
    report.groups.length === 2 &&
    report.groups.every((g) => g.ok) &&
    report.checks.length === 3 &&
    report.checks.every((c) => c.ok) &&
    report.containers.length === 1 &&
    report.containers.every(
      (c) =>
        (c.cleanedByOwnedSuite || c.fallbackCleaned) &&
        !c.remaining &&
        !c.error,
    ) &&
    report.sourceUnchanged;
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(root, "output/voucher-stepup-current.json"),
    JSON.stringify({ directory: output, ok: report.ok }, null, 2),
  );
  console.log("REPORT=" + join(output, "report.json"));
  if (!report.ok) process.exitCode = 1;
}
