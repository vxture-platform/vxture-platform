/**
 * voucher-release-build.mjs - Reproduce standard release builds from saved sources offline.
 * @package vxture-platform
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  realpathSync,
  copyFileSync,
  createWriteStream,
  readdirSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Exact saved sources, a fresh dependency tree and no configured service access.
// ============================================================================
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const runId =
  new Date().toISOString().replaceAll(/[:.]/g, "-") +
  "-" +
  randomUUID().slice(0, 8);
const output = join(root, "output/voucher-release-build", runId);
const snapshot = join(output, "source");
const cli = process.argv.slice(2);
if (cli.length !== 2 || cli[0] !== "--ip-asset-cache" || !cli[1])
  throw new Error(
    "Usage: node scripts/tests/voucher-release-build.mjs --ip-asset-cache <existing local IP data directory>",
  );
const ipAssetCache = realpathSync(resolve(cli[1]));
mkdirSync(output, { recursive: true });
mkdirSync(snapshot);
const hash = (file) =>
  existsSync(file)
    ? createHash("sha256").update(readFileSync(file)).digest("hex")
    : null;
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const report = {
  batch: "S07-R5a",
  runId,
  startedAt: new Date().toISOString(),
  checks: [],
  stages: [],
  source: { directory: snapshot, files: 0, unchanged: false },
  offline: true,
  installScripts: false,
  releaseReady: false,
  limitations: [
    "The fresh snapshot contains saved uncommitted source. It is not a committed clean Git checkout; final-commit CI remains a separate gate.",
    "Only local cached packages are allowed. An offline cache miss blocks all dependent builds; an existing node_modules tree is never substituted for a successful frozen installation.",
    "Builds and static checks do not start BFFs, Redis, PostgreSQL, listeners or containers. Isolated runtime and full business delivery acceptance remain separate.",
    "No temporary source aliases, lint loaders, crypto resolvers, ignored type errors or disabled lint rules are used for standard builds.",
  ],
};
const env = {
  CI: "1",
  TZ: "UTC",
  NO_COLOR: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  // The snapshot lives below another checkout; restrict normal Next tracing to it.
  NEXT_PRIVATE_OUTPUT_TRACE_ROOT: snapshot,
  DO_NOT_TRACK: "1",
  COREPACK_ENABLE_NETWORK: "0",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  COREPACK_ENABLE_PROJECT_SPEC: "1",
  NO_UPDATE_NOTIFIER: "1",
  npm_config_offline: "true",
  npm_config_update_notifier: "false",
  NODE_AUTH_TOKEN: "",
  HUSKY: "0",
  NEXT_PUBLIC_CONSOLE_BFF_URL: "https://voucher-release.invalid",
  NEXT_PUBLIC_ADMIN_BFF_URL: "https://voucher-release.invalid",
  NEXT_PUBLIC_WEBSITE_URL: "https://voucher-release.invalid",
};
for (const [key, value] of Object.entries(process.env))
  if (
    /^(path|pathext|systemroot|windir|comspec|home|userprofile|appdata|localappdata)$/i.test(
      key,
    )
  )
    env[key] = value;
for (const [key, name] of Object.entries({
  TEMP: "tmp",
  TMP: "tmp",
  XDG_CACHE_HOME: "cache",
  XDG_CONFIG_HOME: "config",
  XDG_DATA_HOME: "data",
  npm_config_cache: "npm-cache",
})) {
  env[key] = join(output, name);
  mkdirSync(env[key], { recursive: true });
}
const forbiddenParts = new Set([
  ".git",
  "node_modules",
  "output",
  "dist",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "playwright-report",
  "test-results",
]);
const include = (file) =>
  !file
    .split("/")
    .some(
      (part) => forbiddenParts.has(part) || /^\.env(?:$|[.-])/.test(part),
    ) && !/\.(?:tsbuildinfo|pem|key|p12|pfx)$/i.test(file);
const metadata = [
  "node_modules/.modules.yaml",
  "node_modules/.pnpm/lock.yaml",
  ...["admin", "console"].flatMap((p) => [
    `portals/${p}/node_modules/.modules.yaml`,
  ]),
];
const originalDependencyMetadata = Object.fromEntries(
  metadata.map((file) => [file, hash(join(root, file))]),
);
let manifest;
let failure;
let cachedAssets = [];

/** Check that a filesystem target remains in its intended tree. @param base - Allowed root. @param target - Candidate path. @returns Whether the target is contained. */
function within(base, target) {
  const rest = relative(base, target);
  return (
    rest === "" ||
    (!rest.startsWith(".." + sep) && rest !== ".." && !isAbsolute(rest))
  );
}
/** Record a mandatory check. @param name - Stable evidence name. @param ok - Verified result. @param evidence - Safe supporting facts. */
function check(name, ok, evidence = {}) {
  report.checks.push({ name, ok, ...evidence });
  console.log(JSON.stringify(report.checks.at(-1)));
}

/** Copy only pinned static data, never cached JavaScript. @param require - Local module resolver. @throws When cache integrity or the pin declaration is invalid. */
function prepareIpAssets(require) {
  const ts = require(join(snapshot, "node_modules/typescript"));
  const preparer = join(
    snapshot,
    "bff/auth-bff/scripts/prepare-ip-geolocation.mjs",
  );
  const ast = ts.createSourceFile(
    preparer,
    readFileSync(preparer, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let pins;
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== "FILES"
      )
        continue;
      if (
        !declaration.initializer ||
        !ts.isArrayLiteralExpression(declaration.initializer)
      )
        throw new Error("IP resource pins must remain a literal array");
      pins = declaration.initializer.elements.map((element) => {
        if (!ts.isObjectLiteralExpression(element))
          throw new Error("Invalid IP pin object");
        return Object.fromEntries(
          element.properties.map((property) => {
            if (
              !ts.isPropertyAssignment(property) ||
              !ts.isIdentifier(property.name)
            )
              throw new Error("Invalid IP pin property");
            const value = property.initializer;
            if (!ts.isStringLiteral(value) && !ts.isNumericLiteral(value))
              throw new Error("Nonliteral IP pin value");
            return [
              property.name.text,
              ts.isNumericLiteral(value) ? Number(value.text) : value.text,
            ];
          }),
        );
      });
    }
  }
  if (
    !pins ||
    pins.length !== 3 ||
    new Set(pins.map((pin) => pin.name)).size !== 3
  )
    throw new Error("Expected exactly three pinned IP data resources");
  const destination = join(snapshot, "bff/auth-bff/dist/assets/ip-geolocation");
  mkdirSync(destination, { recursive: true });
  cachedAssets = pins.map((pin) => {
    if (
      !/^(?:ip2region_v[46]\.xdb|LICENSE)$/.test(pin.name) ||
      !/^[a-f0-9]{64}$/.test(pin.sha256) ||
      !Number.isSafeInteger(pin.size) ||
      pin.size <= 0
    )
      throw new Error("Invalid fixed IP data resource");
    const source = join(ipAssetCache, pin.name);
    if (
      !lstatSync(source).isFile() ||
      !within(ipAssetCache, realpathSync(source)) ||
      lstatSync(source).size !== pin.size ||
      hash(source) !== pin.sha256
    )
      throw new Error("Local IP asset integrity mismatch: " + pin.name);
    const target = join(destination, pin.name);
    copyFileSync(source, target);
    if (hash(target) !== pin.sha256) throw new Error("IP asset copy mismatch");
    return { name: pin.name, source, size: pin.size, sha256: pin.sha256 };
  });
  check("pinned-local-ip-assets", true, {
    authority: relative(snapshot, preparer),
    files: cachedAssets,
  });
}

/** Verify all standard Next runtime traces are self-contained. @param portal - Portal name. @throws When a trace is malformed. */
function verifyNextTraces(portal) {
  const next = join(snapshot, "portals", portal, ".next");
  const traces = [];
  function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) collect(target);
      else if (entry.isFile() && entry.name.endsWith(".nft.json"))
        traces.push(target);
    }
  }
  const escaped = [];
  let references = 0;
  if (existsSync(next)) collect(next);
  for (const trace of traces) {
    for (const file of json(trace).files) {
      references++;
      const target = resolve(dirname(trace), file);
      if (
        !within(snapshot, target) ||
        !existsSync(target) ||
        !within(snapshot, realpathSync(target))
      )
        escaped.push({ trace: relative(snapshot, trace), file });
    }
  }
  const required = join(next, "required-server-files.json");
  const configuredRoot = existsSync(required)
    ? json(required).config?.outputFileTracingRoot
    : null;
  check(
    portal + "-next-traces-contained",
    traces.length > 0 &&
      references > 0 &&
      escaped.length === 0 &&
      configuredRoot === snapshot,
    { traces: traces.length, references, escaped, configuredRoot },
  );
}
/** Run a bounded process without a shell or inherited credentials. @param name - Log label. @param args - Exact Node arguments. @param cwd - Snapshot working directory. @returns Exit status and bounded output tail. */
async function run(name, args, cwd = snapshot) {
  if (!within(snapshot, cwd))
    throw new Error("Child process escaped the snapshot");
  const startedAt = new Date().toISOString();
  const log = createWriteStream(join(output, name + ".log"));
  let tail = "";
  let spawnError;
  let code;
  try {
    code = await new Promise((accept) => {
      const child = spawn(process.execPath, args, {
        cwd,
        env,
        windowsHide: true,
        timeout: 600000,
      });
      for (const stream of [child.stdout, child.stderr]) {
        stream.pipe(log, { end: false });
        stream.on("data", (chunk) => {
          tail = (tail + chunk.toString()).slice(-12000);
        });
      }
      child.once("error", (error) => {
        spawnError = error.message;
      });
      child.once("close", (value) => accept(value ?? 1));
    });
  } finally {
    await new Promise((done) => log.end(done));
  }
  const result = {
    name,
    ok: code === 0 && !spawnError,
    code,
    startedAt,
    finishedAt: new Date().toISOString(),
    log: name + ".log",
    ...(spawnError ? { error: spawnError } : {}),
  };
  report.stages.push(result);
  console.log(JSON.stringify(result));
  return { ...result, tail };
}

// ============================================================================
// Child Node processes fail before making a network connection or opening a port.
// ============================================================================
const guard = join(output, "offline-network.cjs");
const networkLog = join(output, "network-attempts.jsonl");
writeFileSync(
  guard,
  `const fs=require('node:fs');const {syncBuiltinESMExports}=require('node:module');const log=${JSON.stringify(networkLog)};const deny=name=>function(){fs.appendFileSync(log,JSON.stringify({pid:process.pid,operation:name})+'\\n');throw new Error('Voucher release build forbids '+name)};const net=require('node:net');net.Socket.prototype.connect=deny('network connect');net.Server.prototype.listen=deny('port listen');const tls=require('node:tls');tls.connect=deny('TLS connect');for(const name of ['http','https']){const module=require('node:'+name);module.request=deny(name+' request');module.get=deny(name+' get');}const dgram=require('node:dgram');dgram.Socket.prototype.bind=deny('UDP bind');dgram.Socket.prototype.connect=deny('UDP connect');dgram.Socket.prototype.send=deny('UDP send');globalThis.fetch=deny('fetch');syncBuiltinESMExports();`,
);
env.NODE_OPTIONS = `--require="${guard.replaceAll("\\", "/")}"`;

try {
  const listed = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
      ":!:output",
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  )
    .split("\0")
    .filter(Boolean);
  const sources = [...new Set(listed.filter(include))].sort();
  manifest = {};
  for (const file of sources) {
    const source = resolve(root, file),
      destination = resolve(snapshot, file);
    if (
      !within(root, source) ||
      !within(snapshot, destination) ||
      !lstatSync(source).isFile()
    )
      throw new Error("Invalid source entry: " + file);
    manifest[file] = hash(source);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    if (hash(destination) !== manifest[file])
      throw new Error("Snapshot copy mismatch: " + file);
  }
  report.source.files = sources.length;
  writeFileSync(
    join(output, "source-manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  check(
    "exact-environment-free-source-snapshot",
    sources.length > 1000 && sources.every(include),
    {
      files: sources.length,
      generatedArtifactsCopied: false,
      environmentFilesCopied: false,
    },
  );

  const store = join(root, "node_modules/.pnpm");
  const parser = readdirSync(store)
    .filter((name) => name.startsWith("yaml@2."))
    .sort()
    .at(-1);
  if (!parser)
    throw new Error(
      "Existing YAML parser unavailable; no installation attempted",
    );
  const require = createRequire(import.meta.url);
  const { parse } = require(join(store, parser, "node_modules/yaml"));
  const lock = parse(readFileSync(join(snapshot, "pnpm-lock.yaml"), "utf8"));
  const installedMetadata = parse(
    readFileSync(join(root, "node_modules/.modules.yaml"), "utf8"),
  );
  if (!installedMetadata.storeDir || !existsSync(installedMetadata.storeDir))
    throw new Error("Existing pnpm content cache is unavailable");
  const contentStore = dirname(installedMetadata.storeDir);
  const expected = [
    [
      "bff/admin-bff",
      "dependencies",
      "@vxture/service-billing",
      "workspace:*",
      "link:../../services/commerce/billing",
    ],
    ...["admin", "console"].flatMap((p) => [
      [
        `portals/${p}`,
        "devDependencies",
        "@next/eslint-plugin-next",
        "15.5.6",
        "15.5.6",
      ],
      [
        `portals/${p}`,
        "devDependencies",
        "eslint-plugin-react-hooks",
        "5.2.0",
        "5.2.0(eslint@9.39.3(jiti@2.6.1))",
      ],
    ]),
  ];
  const declarations = expected.map(
    ([importer, section, name, specifier, version]) => ({
      importer,
      name,
      ok:
        json(join(snapshot, importer, "package.json"))[section]?.[name] ===
          specifier &&
        lock.importers[importer]?.[section]?.[name]?.specifier === specifier &&
        lock.importers[importer]?.[section]?.[name]?.version === version,
    }),
  );
  check(
    "approved-dependencies-match-frozen-lock",
    declarations.every((x) => x.ok),
    { declarations },
  );
  if (!declarations.every((x) => x.ok))
    throw new Error("Approved dependency declaration mismatch");
  const packageManager = json(join(snapshot, "package.json")).packageManager;
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(packageManager))
    throw new Error("Unpinned package manager");
  const version = packageManager.slice("pnpm@".length);
  const corepackBase =
    process.env.COREPACK_HOME ||
    (process.platform === "win32" && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "node/corepack")
      : join(
          process.env.XDG_CACHE_HOME || join(process.env.HOME || "", ".cache"),
          "node/corepack",
        ));
  const pnpm = join(corepackBase, "v1/pnpm", version, "bin/pnpm.cjs");
  if (!existsSync(pnpm))
    throw new Error(
      "Pinned pnpm is absent from the local cache; downloads are forbidden",
    );
  env.COREPACK_HOME = corepackBase;
  const versionResult = await run("pinned-pnpm-version", [pnpm, "--version"]);
  check(
    "pinned-package-manager",
    versionResult.ok && versionResult.tail.trim() === version,
    { expected: version },
  );
  if (!versionResult.ok || versionResult.tail.trim() !== version)
    throw new Error("Pinned pnpm verification failed");

  const lockBeforeInstall = hash(join(snapshot, "pnpm-lock.yaml"));
  const install = await run("frozen-offline-install", [
    pnpm,
    "install",
    "--offline",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--package-import-method=copy",
    "--reporter=append-only",
    "--store-dir",
    contentStore,
    `--config.cache-dir=${join(output, "pnpm-cache")}`,
    `--config.state-dir=${join(output, "pnpm-state")}`,
  ]);
  check(
    "frozen-lock-unchanged",
    hash(join(snapshot, "pnpm-lock.yaml")) === lockBeforeInstall,
  );
  if (!install.ok) {
    report.blocker =
      /ERR_PNPM_(NO_OFFLINE_TARBALL|MISSING_PACKAGE_INDEX|OFFLINE_META)/.test(
        install.tail,
      )
        ? "local-package-cache-incomplete"
        : "frozen-offline-install-failed";
    throw new Error(report.blocker + "; inspect frozen-offline-install.log");
  }
  const resolutions = expected.map(([importer, , name]) => {
    const installed = join(snapshot, importer, "node_modules", name);
    return {
      importer,
      name,
      ok: existsSync(installed) && within(snapshot, realpathSync(installed)),
    };
  });
  check(
    "installed-dependencies-stay-in-snapshot",
    resolutions.every((x) => x.ok),
    { resolutions },
  );
  if (!resolutions.every((x) => x.ok))
    throw new Error("A dependency is missing or resolves outside the snapshot");

  prepareIpAssets(require);

  await run("design-guard-regression", [
    "--test",
    join(snapshot, "scripts/guardrails/check-design-system.test.mjs"),
  ]);

  // Standard scripts generate public package dist prerequisites before CI-style bundles.
  await run("standard-frontend-and-backend-dependencies", [
    pnpm,
    "run",
    "build:frontend-deps",
  ]);
  for (const name of ["auth", "admin", "console", "platform-api"])
    await run(`${name}-bff-bundle`, [
      pnpm,
      "--filter",
      `@vxture/bff-${name}`,
      "run",
      "build:bundle",
    ]);
  for (const portal of ["admin", "console"]) {
    await run(`${portal}-next-build`, [
      pnpm,
      "--filter",
      `@vxture/${portal}`,
      "run",
      "build",
    ]);
    verifyNextTraces(portal);
  }
  for (const portal of ["admin", "console"])
    await run(`${portal}-standard-lint`, [
      pnpm,
      "--filter",
      `@vxture/${portal}`,
      "run",
      "lint",
    ]);
  for (const script of [
    "lint:messages",
    "lint:message-usage",
    "lint:design",
    "lint:destructive",
    "lint:explicit-inject",
    "lint:route-policies",
  ])
    await run(script.replaceAll(":", "-"), [pnpm, "run", script]);
  check(
    "snapshot-lock-stable-after-builds",
    hash(join(snapshot, "pnpm-lock.yaml")) === lockBeforeInstall,
  );
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  report.source.unchanged =
    !!manifest &&
    Object.entries(manifest).every(
      ([file, value]) => hash(join(root, file)) === value,
    );
  check("original-sources-unchanged", report.source.unchanged);
  check(
    "local-ip-cache-unchanged",
    cachedAssets.length === 3 &&
      cachedAssets.every((file) => hash(file.source) === file.sha256),
  );
  check(
    "original-dependency-metadata-unchanged",
    metadata.every(
      (file) => hash(join(root, file)) === originalDependencyMetadata[file],
    ),
  );
  const attempts = existsSync(networkLog)
    ? readFileSync(networkLog, "utf8").trim().split("\n").filter(Boolean)
    : [];
  check("no-network-or-listener-attempts", attempts.length === 0, {
    attempts: attempts.length,
  });
  report.failure = failure ?? null;
  report.finishedAt = new Date().toISOString();
  // A partial run or missing stage never qualifies as successful release acceptance.
  const mandatory = [
    "pinned-pnpm-version",
    "frozen-offline-install",
    "design-guard-regression",
    "standard-frontend-and-backend-dependencies",
    ...["auth", "admin", "console", "platform-api"].map(
      (n) => n + "-bff-bundle",
    ),
    ...["admin", "console"].flatMap((n) => [
      n + "-next-build",
      n + "-standard-lint",
    ]),
    "lint-messages",
    "lint-message-usage",
    "lint-design",
    "lint-destructive",
    "lint-explicit-inject",
    "lint-route-policies",
  ];
  report.notRun = mandatory.filter(
    (name) => !report.stages.some((stage) => stage.name === name),
  );
  report.ok =
    !failure &&
    report.notRun.length === 0 &&
    report.stages.every((stage) => stage.ok) &&
    report.checks.every((item) => item.ok);
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(root, "output/voucher-release-build-current.json"),
    JSON.stringify({ directory: output, ok: report.ok }, null, 2),
  );
  console.log(
    JSON.stringify({
      batch: report.batch,
      ok: report.ok,
      report: join(output, "report.json"),
      failure: report.failure,
      notRun: report.notRun.length,
    }),
  );
  if (!report.ok) process.exitCode = 1;
}
