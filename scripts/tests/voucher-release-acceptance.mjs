/**
 * voucher-release-acceptance.mjs - One saved-source build and isolated delivery gate.
 * @package vxture-platform
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 * Run: node scripts/tests/voucher-release-acceptance.mjs --ip-asset-cache <local pinned data>
 */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  createWriteStream,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Original dependencies remain untouched; every test runs in the new build copy.
// ============================================================================
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
assert.equal(process.argv[2], "--ip-asset-cache");
const cache = resolve(process.argv[3] ?? "missing-cache");
const id =
  new Date().toISOString().replaceAll(/[:.]/g, "-") +
  "-" +
  randomUUID().slice(0, 8);
const output = join(root, "output/voucher-release-acceptance", id);
mkdirSync(output, { recursive: true });
const env = {
  CI: "1",
  NODE_ENV: "test",
  TZ: "UTC",
  NO_COLOR: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  DO_NOT_TRACK: "1",
  COREPACK_ENABLE_NETWORK: "0",
};
for (const [key, value] of Object.entries(process.env))
  if (
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata)$/i.test(
      key,
    )
  )
    env[key] = value;
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
// Historical CLI suites use os.tmpdir(); keep even their temporary files in output.
env.TEMP = join(output, "tmp");
env.TMP = env.TEMP;
mkdirSync(env.TEMP, { recursive: true });
const sha = (file) =>
  existsSync(file)
    ? createHash("sha256").update(readFileSync(file)).digest("hex")
    : null;
const metadata = [
  "node_modules/.modules.yaml",
  "node_modules/.pnpm/lock.yaml",
  "pnpm-lock.yaml",
  "scripts/guardrails/design-system-baseline.json",
];
const before = Object.fromEntries(
  metadata.map((file) => [file, sha(join(root, file))]),
);
const report = {
  batch: "S07-R5b",
  runId: id,
  startedAt: new Date().toISOString(),
  stages: [],
  checks: [],
  containers: [],
  releaseReady: false,
  limitations: [
    "Uses saved uncommitted source; final-commit clean-checkout CI and target-environment acceptance remain separate.",
    "Business and HTTP/DOM suites retain their approved test doubles/source aliases. Separate standard builds and runtime smoke use real compiled artifacts.",
    "Unauthenticated Portal HTTP and BFF init/close do not prove external login, product integration or live payment behavior.",
  ],
};
let snapshot;
let manifest;
let failure;
function within(base, target) {
  const rest = relative(base, target);
  return !rest.startsWith("..") && !isAbsolute(rest);
}
function check(name, ok, evidence = {}) {
  report.checks.push({ name, ok, ...evidence });
  console.log(JSON.stringify(report.checks.at(-1)));
}
function docker(args) {
  return execFileSync("docker", args, {
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
  }).trim();
}
/** Run an exact local Node command and preserve its full log. @param name - Stable stage name. @param args - Node argv. @param cwd - Snapshot or original root. @returns Exit status and log text. */
async function run(name, args, cwd) {
  const startedAt = new Date().toISOString();
  const log = join(output, name + ".log");
  const stream = createWriteStream(log);
  let spawnError;
  const code = await new Promise((accept) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 1800000);
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    child.once("error", (error) => {
      spawnError = error.message;
    });
    child.once("close", (value) => {
      clearTimeout(timer);
      stream.end(() => accept(value));
    });
  });
  const stage = {
    name,
    code,
    ok: code === 0 && !spawnError,
    startedAt,
    finishedAt: new Date().toISOString(),
    log,
    ...(spawnError ? { error: spawnError } : {}),
  };
  report.stages.push(stage);
  console.log(JSON.stringify(stage));
  writeFileSync(join(output, "progress.json"), JSON.stringify(report, null, 2));
  return { stage, text: readFileSync(log, "utf8") };
}
/** Require a fresh report inside this exact new snapshot. @param path - Child report. @param stage - Stage timing. @returns Parsed report. @throws For stale or escaped evidence. */
function freshReport(path, stage) {
  assert.ok(within(snapshot, resolve(path)), "Report escaped the snapshot");
  const result = read(path);
  assert.ok(
    Date.parse(result.startedAt) >= Date.parse(stage.startedAt) - 1000,
    "Stale child report",
  );
  return result;
}
/** Independently prove every reported container is gone. @param entries - Ownership receipts. */
function verifyCleanup(entries) {
  for (const owner of entries) {
    assert.match(owner.id, /^[a-f0-9]{64}$/);
    const remaining = docker([
      "ps",
      "-aq",
      "--no-trunc",
      "--filter",
      "id=" + owner.id,
    ]);
    assert.equal(remaining, "", "Owned container remains: " + owner.id);
    assert.equal(owner.remaining, false);
    assert.ok(
      owner.cleaned || owner.cleanedByOwnedSuite || owner.fallbackCleaned,
    );
    assert.ok(!owner.error);
    report.containers.push({
      id: owner.id,
      name: owner.name,
      runId: owner.runId,
      absent: true,
    });
  }
}

// ============================================================================
// Every mandatory runner executes against one immutable saved-source manifest.
// ============================================================================
try {
  const built = await run(
    "standard-offline-build",
    [
      join(root, "scripts/tests/voucher-release-build.mjs"),
      "--ip-asset-cache",
      cache,
    ],
    root,
  );
  const pointer = read(join(root, "output/voucher-release-build-current.json"));
  const buildPath = join(pointer.directory, "report.json");
  const build = read(buildPath);
  assert.ok(
    built.stage.ok &&
      build.ok &&
      Date.parse(build.startedAt) >= Date.parse(built.stage.startedAt),
    "Standard build failed or stale",
  );
  snapshot = resolve(build.source.directory);
  assert.ok(within(join(root, "output"), snapshot));
  manifest = read(join(pointer.directory, "source-manifest.json"));
  report.snapshot = snapshot;
  report.buildReport = buildPath;
  report.sourceFiles = Object.keys(manifest).length;
  check(
    "exact-source-before-tests",
    Object.entries(manifest).every(
      ([file, hash]) =>
        sha(join(snapshot, file)) === hash && sha(join(root, file)) === hash,
    ),
  );

  const runtime = await run(
    "built-runtime",
    [join(snapshot, "scripts/tests/voucher-release-runtime.mjs"), buildPath],
    snapshot,
  );
  const runtimePointer = read(
    join(snapshot, "output/voucher-release-runtime-current.json"),
  );
  const runtimeReport = freshReport(
    join(runtimePointer.directory, "report.json"),
    runtime.stage,
  );
  check("built-runtime-report", runtime.stage.ok && runtimeReport.ok, {
    report: join(runtimePointer.directory, "report.json"),
  });
  verifyCleanup(runtimeReport.containers);

  for (const name of [
    "promotion-ownership",
    "migration-channel",
    "legacy-test-wallet",
  ]) {
    const result = await run(
      "migration-" + name,
      [
        "--test",
        "--test-reporter=tap",
        join(snapshot, "deploy/database/verify", name + ".test.mjs"),
      ],
      snapshot,
    );
    const tests = Number(result.text.match(/^# tests (\d+)$/m)?.[1] ?? 0);
    const cleanups = [
      ...result.text.matchAll(/VOUCHER_CONTAINER_CLEANUP=(\{[^\r\n]+\})/g),
    ].map((match) => JSON.parse(match[1]));
    const complete =
      tests > 0 &&
      /^# fail 0$/m.test(result.text) &&
      /^# skipped 0$/m.test(result.text) &&
      /^# cancelled 0$/m.test(result.text);
    check(
      name + "-test-execution",
      result.stage.ok && complete && cleanups.length === 1,
      { tests, cleanupReceipts: cleanups.length },
    );
    verifyCleanup(cleanups);
  }
  check(
    "historical-migration-count",
    readdirSync(join(snapshot, "deploy/database/migrations")).filter((file) =>
      file.endsWith(".sql"),
    ).length === 137,
    { expected: 137 },
  );

  for (const name of [
    "balance",
    "promotion",
    "subscription",
    "stepup",
    "admin",
    "console",
    "invitation",
    "recovery",
    "admin-ui",
    "console-ui",
  ]) {
    const result = await run(
      "voucher-" + name,
      [join(snapshot, "scripts/tests/voucher-" + name + ".mjs")],
      snapshot,
    );
    let path;
    const pointerPath = join(
      snapshot,
      "output/voucher-" + name + "-current.json",
    );
    if (existsSync(pointerPath))
      path = join(read(pointerPath).directory, "report.json");
    else
      path = [...result.text.matchAll(/"report":"([^"\r\n]+)"/g)]
        .map((match) => JSON.parse('"' + match[1] + '"'))
        .at(-1);
    assert.ok(path, "Missing structured suite report: " + name);
    const suite = freshReport(path, result.stage);
    const executed =
      suite.groups?.length > 0 &&
      suite.groups.every(
        (group) =>
          group.ok &&
          group.passed > 0 &&
          group.failed === 0 &&
          group.skipped === 0 &&
          group.selectedFilesPresent,
      );
    check(
      name + "-fresh-report",
      result.stage.ok &&
        suite.ok &&
        executed &&
        suite.checks.every((item) => item.ok),
      {
        report: path,
        groups: suite.groups,
        tests: suite.groups.reduce((count, group) => count + group.passed, 0),
      },
    );
    verifyCleanup(suite.containers ?? []);
    if (name === "stepup")
      check(
        "internal-policy-self-test",
        suite.checks.some(
          (item) => item.name === "internal-route-policy-self-test" && item.ok,
        ),
      );
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  check(
    "original-metadata-and-baseline-stable",
    metadata.every((file) => sha(join(root, file)) === before[file]),
  );
  check(
    "original-and-tested-source-stable",
    !!manifest &&
      Object.entries(manifest).every(
        ([file, hash]) =>
          sha(join(root, file)) === hash && sha(join(snapshot, file)) === hash,
      ),
  );
  report.error = failure ?? null;
  report.finishedAt = new Date().toISOString();
  const mandatory = [
    "standard-offline-build",
    "built-runtime",
    ...["promotion-ownership", "migration-channel", "legacy-test-wallet"].map(
      (name) => "migration-" + name,
    ),
    ...[
      "balance",
      "promotion",
      "subscription",
      "stepup",
      "admin",
      "console",
      "invitation",
      "recovery",
      "admin-ui",
      "console-ui",
    ].map((name) => "voucher-" + name),
  ];
  report.notRun = mandatory.filter(
    (name) => !report.stages.some((stage) => stage.name === name),
  );
  report.ok =
    !failure &&
    report.notRun.length === 0 &&
    report.stages.every((stage) => stage.ok) &&
    report.checks.every((item) => item.ok) &&
    report.containers.length > 10;
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(root, "output/voucher-release-acceptance-current.json"),
    JSON.stringify({ directory: output, ok: report.ok }, null, 2),
  );
  console.log(
    JSON.stringify({
      ok: report.ok,
      report: join(output, "report.json"),
      error: report.error,
      notRun: report.notRun,
    }),
  );
  if (!report.ok) process.exitCode = 1;
}
