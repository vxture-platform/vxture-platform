/**
 * voucher-notification-atomic.mjs - Offline subscription/outbox atomicity acceptance.
 * @package vxture-platform
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-23
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// A new source copy uses existing dependencies; nothing is installed or fetched.
// Usage: node scripts/tests/voucher-notification-atomic.mjs --dependencies <copy> [--batch N01-A2d]
// ============================================================================
const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
if (
  ![2, 4].includes(args.length) ||
  args[0] !== "--dependencies" ||
  (args.length === 4 &&
    (args[2] !== "--batch" ||
      ![
        "N01-A1",
        "N01-A2a",
        "N01-A2b1",
        "N01-A2b2",
        "N01-A2c1",
        "N01-A2c2",
        "N01-A2d",
      ].includes(args[3])))
)
  throw new Error(
    "Expected --dependencies <existing validated source copy> [--batch N01-A1|N01-A2a|N01-A2b1|N01-A2b2|N01-A2c1|N01-A2c2|N01-A2d]",
  );
const batch = args[3] ?? "N01-A1";
const dependencies = resolve(args[1]);
if (
  dependencies === resolve(root) ||
  !existsSync(join(dependencies, "node_modules"))
)
  throw new Error("A separate existing dependency copy is required");
const env = {
  NODE_ENV: "test",
  TZ: "UTC",
  NO_COLOR: "1",
  CI: "1",
  COREPACK_ENABLE_NETWORK: "0",
  npm_config_offline: "true",
  NEXT_TELEMETRY_DISABLED: "1",
  DO_NOT_TRACK: "1",
};
for (const [key, value] of Object.entries(process.env))
  if (
    /^(path|pathext|systemroot|windir|comspec|userprofile|appdata|localappdata)$/i.test(
      key,
    )
  )
    env[key] = value;
const id =
  new Date().toISOString().replaceAll(/[:.]/g, "-") +
  "-" +
  randomUUID().slice(0, 8);
const output = join(root, "output/voucher-notification-atomic", id);
const snapshot = join(output, "source");
mkdirSync(snapshot, { recursive: true });
for (const key of ["TEMP", "TMP", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"])
  mkdirSync((env[key] = join(output, "cache", key)), { recursive: true });
const adminSpecs = [
  "src/routers/write-paths.spec.ts",
  "src/routers/subscription-suspension-episodes.spec.ts",
  "src/routers/subscription-operator-renew-notify.spec.ts",
  "src/routers/subscription-notification-atomic.spec.ts",
];
const scope = [
  "services/commerce/subscription/src/repository/pg-subscription.repository.ts",
  "services/commerce/subscription/src/service/subscription.service.ts",
  "services/commerce/provisioning/src/service/provisioning.service.ts",
  "services/commerce/subscription/src/service/subscription-provisioning.spec.ts",
  "services/commerce/subscription/src/repository/subscription-notification-atomic.spec.ts",
  "services/commerce/provisioning/src/service/provisioning-transaction.spec.ts",
  "services/commerce/subscription/src/service/sweep-spec.helpers.ts",
  "services/commerce/subscription/src/service/trial-expiry-sweep.spec.ts",
  "services/commerce/subscription/src/service/expiry-sweep.spec.ts",
  "services/commerce/subscription/src/service/service-axis-writers.spec.ts",
  "services/commerce/subscription/src/service/suspension-term-extension.spec.ts",
  "services/commerce/subscription/src/service/product-maintenance-sweep.spec.ts",
  "services/commerce/subscription/src/repository/pg-order.repository.ts",
  "services/commerce/subscription/src/service/order.service.ts",
  "services/commerce/subscription/src/service/order.service.spec.ts",
  "services/commerce/subscription/src/repository/order-fulfillment-atomic.spec.ts",
  "bff/console-bff/src/lib/voucher-notification-atomic.spec.ts",
  ...(batch === "N01-A2d"
    ? [
        "bff/admin-bff/src/routers/subscriptions.router.ts",
        ...adminSpecs.map((file) => "bff/admin-bff/" + file),
      ]
    : []),
  "scripts/tests/voucher-notification-atomic.mjs",
];
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  env,
  encoding: "utf8",
  windowsHide: true,
  timeout: 30000,
})
  .split("\0")
  .filter(Boolean);
const files = [...new Set([...tracked, ...scope])].filter(
  (file) =>
    !file
      .split("/")
      .some((part) => ["node_modules", "output", ".git"].includes(part)) &&
    !basename(file).startsWith(".env"),
);
const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const fingerprint = (directory, selected = files) =>
  Object.fromEntries(
    selected.map((file) => [
      file,
      existsSync(join(directory, file)) ? hash(join(directory, file)) : null,
    ]),
  );
const report = {
  batch,
  runId: id,
  startedAt: new Date().toISOString(),
  root,
  snapshot,
  dependencies,
  complete: false,
  stages: [],
  sourceBefore: fingerprint(root),
  dependencySourceBefore: fingerprint(dependencies),
  limits: {
    containers: 0,
    installs: 0,
    downloads: 0,
    existingServiceConnections: 0,
    productionWrites: 0,
  },
  limitations: [
    "Transaction fault injection uses real repositories with an in-memory SQL double; PostgreSQL locking/roles/restart remain N01-A3.",
    "Generic/explicit lifecycle writes and trial/paid expiry, overdue and expiry-window scans, maintenance, suspension and compensation are covered; order fulfillment composition is covered; voucher redemption/extension composition is covered. Product receipt/integration is not verified.",
    batch === "N01-A2d"
      ? "Admin operator actions use the caller transaction; optional customer delivery and independent refund are post-commit. The money settlement port is tested without performing transfers."
      : "Admin external SQL writer coverage remains N01-A2d.",
  ],
};
const save = () => {
  writeFileSync(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  writeFileSync(
    join(root, "output/voucher-notification-atomic-current.json"),
    JSON.stringify({ output, report: join(output, "report.json") }, null, 2) +
      "\n",
  );
};
save();
const packageDirs = new Set([""]);
for (const file of files) {
  if (isAbsolute(file) || relative(root, resolve(root, file)).startsWith(".."))
    throw new Error("Source path escaped workspace");
  if (lstatSync(join(root, file)).isSymbolicLink())
    throw new Error("Source link requires review: " + file);
  const destination = join(snapshot, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(root, file), destination);
  if (basename(file) === "package.json")
    packageDirs.add(dirname(file) === "." ? "" : dirname(file));
}
for (const directory of packageDirs) {
  const from = join(dependencies, directory, "node_modules");
  if (existsSync(from))
    symlinkSync(
      from,
      join(snapshot, directory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
}
if (
  JSON.stringify(report.sourceBefore) !== JSON.stringify(fingerprint(snapshot))
)
  throw new Error("Frozen source copy does not match");

// ============================================================================
// Deny socket connections/listeners as well as HTTP, TLS, UDP and fetch.
// Every attempt is evidence and makes final acceptance fail.
// ============================================================================
const networkLog = join(output, "network-attempts.jsonl");
const guard = join(output, "offline-network.cjs");
writeFileSync(
  guard,
  `
const fs = require('node:fs');
const {syncBuiltinESMExports} = require('node:module');
const deny = operation => function() {
  fs.appendFileSync(${JSON.stringify(networkLog)}, JSON.stringify({pid:process.pid,operation})+'\\n');
  throw new Error('Offline acceptance forbids '+operation);
};
const net = require('node:net');
net.Socket.prototype.connect = deny('network connect');
net.Server.prototype.listen = deny('port listen');
require('node:tls').connect = deny('TLS connect');
for (const name of ['http','https']) {
  const api = require('node:'+name);
  api.request = deny(name+' request'); api.get = deny(name+' get');
}
const udp = require('node:dgram');
for (const name of ['bind','connect','send']) udp.Socket.prototype[name] = deny('UDP '+name);
globalThis.fetch = deny('fetch'); syncBuiltinESMExports();
`,
);
env.NODE_OPTIONS = `--require=${JSON.stringify(guard.replaceAll("\\", "/"))}`;
const require = createRequire(join(snapshot, "package.json"));
const serviceRequire = createRequire(
  join(snapshot, "services/commerce/subscription/package.json"),
);
const ts = require("typescript");
const paths = ts.readConfigFile(
  join(snapshot, "tsconfig.base.json"),
  ts.sys.readFile,
).config.compilerOptions.paths;
for (const directory of packageDirs) {
  const manifest = JSON.parse(
    readFileSync(join(snapshot, directory, "package.json"), "utf8"),
  );
  if (manifest.name && existsSync(join(snapshot, directory, "src/index.ts")))
    paths[manifest.name] = [join(snapshot, directory, "src/index.ts")];
}
for (const [name, path] of Object.entries({
  "@vxture/core-config/openapi": "packages/core/config/src/utils/openapi.ts",
  "@vxture/core-utils/phone": "packages/core/utils/src/utils/phone.utils.ts",
}))
  paths[name] = [join(snapshot, path)];
for (const [name, targets] of Object.entries(paths))
  paths[name] = targets.map((path) => resolve(snapshot, path));
const aliases = Object.entries(paths)
  .sort(
    ([a], [b]) =>
      Number(a.endsWith("/*")) - Number(b.endsWith("/*")) ||
      b.length - a.length,
  )
  .map(([name, targets]) => {
    const wildcard = name.endsWith("/*");
    const pattern = (wildcard ? name.slice(0, -1) : name).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    let replacement = targets[0].replace(/\/\*$/, "");
    if (
      !wildcard &&
      existsSync(replacement) &&
      lstatSync(replacement).isDirectory()
    )
      replacement = join(replacement, "index.ts");
    return `{find:new RegExp(${JSON.stringify("^" + pattern + (wildcard ? "" : "$"))}),replacement:${JSON.stringify(replacement + (wildcard ? "/" : ""))}}`;
  });
const config = join(output, "vitest.config.mjs");
writeFileSync(
  config,
  `export default {cacheDir:${JSON.stringify(join(output, "vite-cache"))},resolve:{alias:[${aliases.join(",")}]},test:{environment:"node",include:["src/**/*.spec.ts"],testTimeout:30000,hookTimeout:60000}};`,
);
const typeConfig = join(output, "paths.json");
writeFileSync(typeConfig, JSON.stringify(paths));
const typeRunner = join(output, "typecheck.cjs");
writeFileSync(
  typeRunner,
  `
const {createRequire} = require('node:module');
const ts = createRequire(${JSON.stringify(join(snapshot, "package.json"))})('typescript');
const path = require('node:path');
const config = ts.readConfigFile(path.join(process.argv[2],'tsconfig.json'), ts.sys.readFile);
if(config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\\n'));
const parsed = ts.parseJsonConfigFileContent(config.config,ts.sys,process.argv[2]);
// Source-alias BFF checks match the existing voucher runners and the SDK's own libs.
const sourceLibraries = ["console-bff", "admin-bff"].includes(path.basename(process.argv[2]));
const libraryOptions = sourceLibraries
  ? {lib:['lib.es2023.d.ts','lib.dom.d.ts']} : {};
const program = ts.createProgram(parsed.fileNames,{...parsed.options,...libraryOptions,noEmit:true,incremental:false,paths:require(${JSON.stringify(typeConfig)})});
const diagnostics = [...parsed.errors,...ts.getPreEmitDiagnostics(program)];
console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:ts.sys.getCurrentDirectory,getNewLine:()=>ts.sys.newLine}));
console.log(JSON.stringify({strict:program.getCompilerOptions().strict,files:program.getSourceFiles().length,errors:diagnostics.length}));
process.exitCode = diagnostics.length ? 1 : 0;
`,
);

// ============================================================================
// Bounded stages and strict test accounting (no selected skips count as passed).
// ============================================================================
async function run(
  name,
  command,
  commandArgs,
  cwd = snapshot,
  verify = () => true,
) {
  console.log(`[${batch}] ${name}`);
  const log = createWriteStream(join(output, name + ".log"));
  const startedAt = new Date().toISOString();
  let result;
  try {
    result = await new Promise((accept, reject) => {
      const child = spawn(command, commandArgs, {
        cwd,
        env,
        windowsHide: true,
        timeout: 240000,
      });
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
      child.once("error", reject);
      child.once("close", (code, signal) => accept({ code, signal }));
    });
  } finally {
    await new Promise((done) => log.end(done));
  }
  const evidence = verify();
  report.stages.push({
    name,
    ...result,
    startedAt,
    finishedAt: new Date().toISOString(),
    evidence,
    ok: result.code === 0 && Boolean(evidence),
  });
  save();
  if (!report.stages.at(-1).ok)
    throw new Error(`Stage failed: ${name}; see ${output}`);
}
const vitest = join(
  dirname(serviceRequire.resolve("vitest/package.json")),
  "vitest.mjs",
);
async function group(name, directory, selected) {
  const resultFile = join(output, name + ".json");
  await run(
    name,
    process.execPath,
    [
      vitest,
      "run",
      ...selected,
      "--config",
      config,
      "--maxWorkers=1",
      "--reporter=default",
      "--reporter=json",
      "--outputFile",
      resultFile,
    ],
    join(snapshot, directory),
    () => {
      if (!existsSync(resultFile)) return false;
      const result = JSON.parse(readFileSync(resultFile, "utf8"));
      const present = selected.every((file) =>
        result.testResults.some((item) =>
          item.name.replaceAll("\\", "/").endsWith(file),
        ),
      );
      return (
        result.success &&
        present &&
        result.numPassedTests > 0 &&
        result.numPendingTests === 0 &&
        result.testResults.every(
          (suite) =>
            suite.assertionResults.length > 0 &&
            suite.assertionResults.every((test) => test.status === "passed"),
        ) && {
          passed: result.numPassedTests,
          skipped: result.numPendingTests,
          files: selected.length,
        }
      );
    },
  );
}
try {
  for (const directory of [
    "subscription",
    "provisioning",
    "billing",
    "promotion",
  ]) {
    const path = `services/commerce/${directory}`;
    const selected = files
      .filter(
        (file) =>
          file.startsWith(path + "/src/") &&
          file.endsWith(".spec.ts") &&
          !file.endsWith(".itest.spec.ts"),
      )
      .map((file) => file.slice(path.length + 1));
    await group(directory + "-regression", path, selected);
  }
  await group("console-voucher-atomic", "bff/console-bff", [
    "src/lib/voucher-notification-atomic.spec.ts",
  ]);
  if (batch === "N01-A2d")
    await group("admin-operator-atomic", "bff/admin-bff", adminSpecs);
  const eslint = join(
    dirname(require.resolve("eslint/package.json")),
    "bin/eslint.js",
  );
  for (const [directory, packagePath] of [
    ["subscription", "services/commerce/subscription"],
    ["provisioning", "services/commerce/provisioning"],
    ["console-bff", "bff/console-bff"],
    ...(batch === "N01-A2d" ? [["admin-bff", "bff/admin-bff"]] : []),
  ]) {
    await run(directory + "-types", process.execPath, [
      typeRunner,
      join(snapshot, packagePath),
    ]);
    await run(directory + "-lint", process.execPath, [
      eslint,
      `${packagePath}/src`,
      "--max-warnings=0",
    ]);
  }
  const prettier = join(
    dirname(require.resolve("prettier/package.json")),
    "bin/prettier.cjs",
  );
  await run("format", process.execPath, [prettier, "--check", ...scope]);
  await run("script-syntax", process.execPath, [
    "--check",
    join(snapshot, scope.at(-1)),
  ]);
  const scan = join(output, "secret-scan-source");
  mkdirSync(scan);
  for (const file of scope) {
    const destination = join(scan, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(snapshot, file), destination);
  }
  const findings = join(output, "gitleaks-redacted.json");
  await run(
    "secret-scan",
    "gitleaks",
    [
      "dir",
      scan,
      "--config",
      join(snapshot, ".gitleaks.toml"),
      "--redact",
      "--report-format",
      "json",
      "--report-path",
      findings,
      "--no-banner",
    ],
    snapshot,
    () =>
      existsSync(findings) &&
      JSON.parse(readFileSync(findings, "utf8")).length === 0,
  );
  report.complete = true;
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
} finally {
  report.sourceAfter = fingerprint(root);
  report.snapshotAfter = fingerprint(snapshot);
  report.dependencySourceAfter = fingerprint(dependencies);
  report.sourceStable =
    JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
  report.snapshotStable =
    JSON.stringify(report.sourceBefore) ===
    JSON.stringify(report.snapshotAfter);
  report.dependenciesStable =
    JSON.stringify(report.dependencySourceBefore) ===
    JSON.stringify(report.dependencySourceAfter);
  report.networkAttempts = existsSync(networkLog)
    ? readFileSync(networkLog, "utf8").trim().split("\n").filter(Boolean).length
    : 0;
  report.complete &&=
    report.sourceStable &&
    report.snapshotStable &&
    report.dependenciesStable &&
    report.networkAttempts === 0;
  if (!report.complete) process.exitCode = 1;
  report.finishedAt = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      complete: report.complete,
      report: join(output, "report.json"),
    }),
  );
}
