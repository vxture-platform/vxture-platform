/**
 * voucher-release-runtime.mjs - Verify real release artifacts with owned local fixtures.
 * @package vxture-platform
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  createWriteStream,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// ============================================================================
// Run only from a successful environment-free frozen-build snapshot.
// ============================================================================
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const sha = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const buildReport = resolve(process.argv[2] ?? "missing-build-report");
const build = read(buildReport);
assert.equal(build.ok, true, "A successful standard build is required");
assert.equal(
  resolve(build.source.directory),
  root,
  "Runtime must execute the exact built source copy",
);
const manifest = read(join(dirname(buildReport), "source-manifest.json"));
assert.ok(
  Object.entries(manifest).every(
    ([file, hash]) => sha(join(root, file)) === hash,
  ),
  "Built source changed before startup",
);
const id =
  new Date().toISOString().replaceAll(/[:.]/g, "-") +
  "-" +
  randomUUID().slice(0, 8);
const output = join(root, "output/voucher-release-runtime", id);
mkdirSync(output, { recursive: true });
const require = createRequire(join(root, "bff/admin-bff/package.json"));
const ts = require("typescript");
const { Pool } = require("pg");
const env = {
  CI: "1",
  NODE_ENV: "test",
  TZ: "UTC",
  NO_COLOR: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  DO_NOT_TRACK: "1",
};
for (const [key, value] of Object.entries(process.env))
  if (
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata)$/i.test(
      key,
    )
  )
    env[key] = value;
const report = {
  batch: "S07-R5b",
  runId: id,
  startedAt: new Date().toISOString(),
  checks: [],
  groups: [],
  containers: [],
  portals: [],
  buildReport,
  releaseReady: false,
};
const children = new Set();
const owners = [];
const pools = [];
let failure;
const docker = (args) =>
  execFileSync("docker", args, {
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
function check(name, ok, evidence = {}) {
  report.checks.push({ name, ok, ...evidence });
  console.log(JSON.stringify(report.checks.at(-1)));
}
function events() {
  return existsSync(join(output, "network.jsonl"))
    ? readFileSync(join(output, "network.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
    : [];
}

// ============================================================================
// Node children may connect only to this run's owned fixture ports or receivers.
// ============================================================================
const guard = join(output, "owned-network.cjs");
writeFileSync(
  guard,
  `
const fs=require('node:fs'),net=require('node:net'),tls=require('node:tls');
const {syncBuiltinESMExports}=require('node:module');
const log=${JSON.stringify(join(output, "network.jsonl"))};
const emit=data=>fs.appendFileSync(log,JSON.stringify({pid:process.pid,...data})+'\\n');
const ports=new Set((process.env.VOUCHER_RUNTIME_PORTS||'').split(',').filter(Boolean).map(Number));
const local=(host,port)=>(host==='127.0.0.1'||host==='::ffff:127.0.0.1')&&ports.has(Number(port));
const deny=operation=>{emit({event:'denied',operation});throw new Error('Runtime fixture boundary denied '+operation)};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){let v=Array.isArray(args[0])?args[0]:args;let o=typeof v[0]==='object'?v[0]:{port:v[0],host:typeof v[1]==='string'?v[1]:'localhost'};if(!local(o.host||'localhost',o.port))return deny('connect '+(o.host||'localhost')+':'+o.port);return connect.apply(this,args)};
tls.connect=()=>deny('TLS');
const listen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){const o=typeof args[0]==='object'?args[0]:{port:args[0],host:args[1]};if(process.env.VOUCHER_RUNTIME_LISTEN!=='1'||o.host!=='127.0.0.1'||Number(o.port)!==0)return deny('listen');this.once('listening',()=>{const a=this.address();ports.add(a.port);emit({event:'listening',host:a.address,port:a.port})});return listen.apply(this,args)};
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,...args){const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(u.protocol!=='http:'||!local(u.hostname,u.port||80))return deny('fetch '+u.origin);return originalFetch.call(this,input,...args)};
syncBuiltinESMExports();
`,
);
function childEnv(extra = {}) {
  return {
    ...env,
    NODE_OPTIONS: `--require="${guard.replaceAll("\\", "/")}"`,
    ...extra,
  };
}
/** Spawn a tracked Node process. @param name - Log name. @param args - Exact argv. @param cwd - Snapshot cwd. @param extra - Synthetic settings. @returns Child, completion and bounded output. */
function start(name, args, cwd, extra = {}) {
  const stream = createWriteStream(join(output, name + ".log"));
  let tail = "";
  const child = spawn(process.execPath, args, {
    cwd,
    env: childEnv(extra),
    windowsHide: true,
  });
  children.add(child);
  for (const pipe of [child.stdout, child.stderr]) {
    pipe.pipe(stream, { end: false });
    pipe.on("data", (chunk) => {
      tail = (tail + chunk).slice(-16000);
    });
  }
  const done = new Promise((accept) => {
    let error;
    child.once("error", (value) => {
      error = value.message;
    });
    child.once("close", (code) => {
      children.delete(child);
      stream.end(() => accept({ code, error }));
    });
  });
  return { child, done, tail: () => tail };
}
/** Bound a tracked child and wait for its log to close. @param name - Check label. @param args - Node argv. @param cwd - Working directory. @param extra - Synthetic env. @returns Exit code and text. */
async function run(name, args, cwd = root, extra = {}) {
  const task = start(name, args, cwd, extra);
  const timer = setTimeout(() => task.child.kill("SIGKILL"), 120000);
  const result = await task.done;
  clearTimeout(timer);
  return { ...result, text: task.tail() };
}
/** Allocate only a new labeled container, never an existing target. @param kind - Fixture kind. @param image - Already cached image. @param port - Internal service port. @returns Verified container and loopback port. */
async function allocate(kind, image, port) {
  const runId = randomUUID(),
    name = "codex-voucher-runtime-" + kind + "-" + runId.slice(0, 12);
  const containerId = docker([
    "run",
    "--detach",
    "--pull=never",
    "--name",
    name,
    "--label",
    "codex.run=" + runId,
    "--publish",
    "127.0.0.1::" + port,
    ...(kind === "pg" ? ["--env", "POSTGRES_HOST_AUTH_METHOD=trust"] : []),
    image,
  ]);
  const owner = {
    id: containerId,
    name,
    runId,
    port: 0,
    cleaned: false,
    remaining: true,
  };
  owners.push(owner);
  assert.match(owner.id, /^[a-f0-9]{64}$/);
  const info = JSON.parse(docker(["inspect", owner.id]))[0];
  assert.equal(info.Id, owner.id);
  assert.equal(info.Name, "/" + name);
  assert.equal(info.Config.Labels["codex.run"], runId);
  assert.equal(
    info.HostConfig.PortBindings[port + "/tcp"][0].HostIp,
    "127.0.0.1",
  );
  owner.port = Number(
    docker(["port", owner.id, port + "/tcp"])
      .split(":")
      .at(-1),
  );
  writeFileSync(
    join(output, "container-ownership.json"),
    JSON.stringify(owners, null, 2),
  );
  for (let attempt = 0; ; attempt++) {
    try {
      docker([
        "exec",
        owner.id,
        ...(kind === "pg"
          ? ["pg_isready", "-U", "postgres"]
          : ["redis-cli", "ping"]),
      ]);
      break;
    } catch (error) {
      if (attempt >= 40) throw error;
      await delay(250);
    }
  }
  return owner;
}

// ============================================================================
// Real notification queue test and real init/close of all bundled Nest graphs.
// ============================================================================
try {
  const pg = await allocate("pg", "postgres:18-alpine", 5432);
  const redis = await allocate("redis", "redis:7-alpine", 6379);
  const connection = `postgresql://postgres@127.0.0.1:${pg.port}`;
  const owner = new Pool({
    connectionString: connection + "/postgres",
    connectionTimeoutMillis: 5000,
  });
  pools.push(owner);
  await owner.query("create database voucher_notifications");
  await owner.query(
    `comment on database voucher_notifications is 'codex-voucher-notifications:${id}'`,
  );
  const url = connection + "/voucher_notifications";
  const db = new Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
  pools.push(db);
  for (const file of readdirSync(join(root, "deploy/database/ddl"))
    .filter((file) => /^\d.*\.sql$/.test(file))
    .sort())
    await db.query(
      readFileSync(join(root, "deploy/database/ddl", file), "utf8"),
    );
  await db.query(
    "alter role svc_console_bff login; alter role svc_admin_bff login; alter role svc_platform_api login; alter role platform_svc login",
  );
  const paths = ts.readConfigFile(
    join(root, "tsconfig.base.json"),
    ts.sys.readFile,
  ).config.compilerOptions.paths;
  const aliases = Object.entries(paths)
    .map(([name, targets]) => {
      const wildcard = name.endsWith("/*");
      return {
        find:
          "^" +
          name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*$/, "") +
          (wildcard ? "" : "$"),
        replacement:
          resolve(root, targets[0].replace(/\/\*$/, "")) +
          (wildcard ? "/" : ""),
      };
    })
    .sort((a, b) => b.find.length - a.find.length);
  const config = join(output, "notification.vitest.config.mjs");
  writeFileSync(
    config,
    `export default {resolve:{alias:[${aliases.map((a) => `{find:new RegExp(${JSON.stringify(a.find)}),replacement:${JSON.stringify(a.replacement)}}`).join(",")}]},test:{environment:'node',include:['src/**/*.spec.ts'],testTimeout:30000,hookTimeout:60000}};`,
  );
  const testResult = join(output, "notifications.json");
  const vitest = join(
    dirname(require.resolve("vitest/package.json")),
    "vitest.mjs",
  );
  const notification = await run(
    "notifications",
    [
      vitest,
      "run",
      "src/voucher-delivery.itest.spec.ts",
      "--config",
      config,
      "--maxWorkers=1",
      "--reporter=default",
      "--reporter=json",
      "--outputFile",
      testResult,
    ],
    join(root, "services/commerce/provisioning"),
    {
      VOUCHER_RUNTIME_PORTS: pg.port + "," + redis.port,
      VOUCHER_RUNTIME_LISTEN: "1",
      DATABASE_URL: url,
      VOUCHER_NOTIFICATION_ITEST: "1",
      VOUCHER_NOTIFICATION_RUN_ID: id,
    },
  );
  const tests = existsSync(testResult) ? read(testResult) : null;
  const notificationOk =
    notification.code === 0 &&
    tests?.success &&
    tests.numPassedTests > 0 &&
    tests.numPendingTests === 0 &&
    tests.testResults.length > 0 &&
    tests.testResults.every(
      (s) =>
        s.assertionResults.length > 0 &&
        s.assertionResults.every((a) => a.status === "passed"),
    );
  report.groups.push({
    name: "platform-notifications",
    ok: !!notificationOk,
    passed: tests?.numPassedTests,
    failed: tests?.numFailedTests,
    skipped: tests?.numPendingTests,
  });
  console.log(JSON.stringify(report.groups.at(-1)));

  // Read the existing CI smoke configuration as data; never execute its fixed-port launcher.
  const smokeSource = ts.createSourceFile(
    "smoke.mjs",
    readFileSync(join(root, "scripts/guardrails/boot-smoke.mjs"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const fake = {};
  for (const statement of smokeSource.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations)
      if (
        decl.name.getText(smokeSource) === "FAKE_ENV" &&
        decl.initializer &&
        ts.isObjectLiteralExpression(decl.initializer)
      )
        for (const property of decl.initializer.properties) {
          assert.ok(
            ts.isPropertyAssignment(property) &&
              ts.isStringLiteral(property.initializer),
          );
          fake[property.name.getText(smokeSource)] = property.initializer.text;
        }
  }
  assert.equal(fake.BOOT_SMOKE, "1");
  const synthetic = {
    ...fake,
    DATABASE_URL: url,
    DB_PORT: String(pg.port),
    DB_USER: "postgres",
    DB_PASSWORD: "",
    DB_NAME: "voucher_notifications",
    REDIS_URL: `redis://127.0.0.1:${redis.port}`,
    VOUCHER_RUNTIME_PORTS: pg.port + "," + redis.port,
    JWT_SECRET: randomBytes(32).toString("hex"),
    JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
    VOUCHER_CLAIM_ACTIVE_KEY: "runtime",
    VOUCHER_CLAIM_KEYS: JSON.stringify({
      runtime: randomBytes(32).toString("hex"),
    }),
  };
  for (const file of readdirSync(
    join(root, "bff/platform-api/src/jobs"),
  ).filter((file) => file.endsWith(".ts")))
    for (const match of readFileSync(
      join(root, "bff/platform-api/src/jobs", file),
      "utf8",
    ).matchAll(/process\.env\.([A-Z_]+INTERVAL_MS)/g))
      synthetic[match[1]] = "3600000";
  for (const bff of ["auth", "admin", "console", "platform-api"]) {
    const directory = join(
      root,
      "bff",
      bff === "platform-api" ? bff : bff + "-bff",
    );
    const bundle = join(directory, "dist/main.cjs");
    const result = await run(bff + "-boot", [bundle], directory, synthetic);
    check(
      bff + "-bundle-init-close",
      result.code === 0 &&
        new RegExp(
          "\\[boot-smoke\\] " +
            (bff === "platform-api" ? bff : bff + "-bff") +
            " DI graph resolved OK",
        ).test(result.text),
      { code: result.code, artifactSha256: sha(bundle) },
    );
  }

  // Real Next production servers bind random loopback ports; requests never follow redirects.
  for (const portal of ["admin", "console"]) {
    const portalDir = join(root, "portals", portal);
    const portalRequire = createRequire(join(portalDir, "package.json"));
    const next = join(
      dirname(portalRequire.resolve("next/package.json")),
      "dist/bin/next",
    );
    const task = start(
      portal + "-next-runtime",
      [next, "start", "--hostname", "127.0.0.1", "--port", "0"],
      portalDir,
      {
        NODE_ENV: "production",
        VOUCHER_RUNTIME_LISTEN: "1",
        NEXT_PRIVATE_OUTPUT_TRACE_ROOT: root,
      },
    );
    const record = {
      portal,
      pid: task.child.pid,
      ok: false,
      stopped: false,
      requests: [],
    };
    report.portals.push(record);
    try {
      let listener;
      for (let attempt = 0; attempt < 300; attempt++) {
        listener = events().find(
          (event) =>
            event.pid === task.child.pid && event.event === "listening",
        );
        if (listener) break;
        if (!children.has(task.child))
          throw new Error(portal + " Next exited before listening");
        await delay(100);
      }
      assert.ok(
        listener && listener.host === "127.0.0.1" && listener.port > 0,
        "Owned loopback listener required",
      );
      record.port = listener.port;
      for (const path of [
        portal === "admin" ? "/login" : "/zh-CN/signin",
        portal === "admin" ? "/promotions" : "/zh-CN/vouchers",
      ]) {
        const response = await fetch(
          `http://127.0.0.1:${listener.port}${path}`,
          { redirect: "manual", signal: AbortSignal.timeout(30000) },
        );
        const body = await response.text();
        const location = response.headers.get("location");
        const ok =
          response.status === 200
            ? body.includes("<html") && body.length > 500
            : [302, 303, 307, 308].includes(response.status) &&
              !!location &&
              /auth\/login|login|signin/.test(location);
        record.requests.push({
          path,
          status: response.status,
          htmlBytes: body.length,
          location,
          ok,
        });
      }
      record.ok =
        record.requests.length === 2 &&
        record.requests.every((item) => item.ok);
    } finally {
      if (children.has(task.child)) task.child.kill("SIGTERM");
      await task.done;
      record.stopped = !children.has(task.child);
    }
    check(portal + "-built-next-http", record.ok && record.stopped, {
      port: record.port,
      requests: record.requests,
    });
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  for (const child of children) child.kill("SIGKILL");
  for (const pool of pools.reverse()) await pool.end();
  for (const owner of owners.reverse()) {
    try {
      assert.match(owner.id, /^[a-f0-9]{64}$/);
      const info = JSON.parse(docker(["inspect", owner.id]))[0];
      assert.equal(info.Id, owner.id);
      assert.equal(info.Name, "/" + owner.name);
      assert.equal(info.Config.Labels["codex.run"], owner.runId);
      docker(["rm", "--force", "--volumes", owner.id]);
      owner.cleaned = true;
      owner.remaining =
        docker(["ps", "-aq", "--no-trunc", "--filter", "id=" + owner.id]) !==
        "";
    } catch (error) {
      owner.error = String(error);
    }
    report.containers.push(owner);
  }
  check(
    "runtime-network-boundary",
    !events().some((event) => event.event === "denied"),
    { denied: events().filter((event) => event.event === "denied") },
  );
  check(
    "built-sources-unchanged",
    Object.entries(manifest).every(
      ([file, hash]) => sha(join(root, file)) === hash,
    ),
  );
  report.error = failure ?? null;
  report.finishedAt = new Date().toISOString();
  report.ok =
    !failure &&
    report.groups.length === 1 &&
    report.groups.every((item) => item.ok) &&
    report.checks.length === 8 &&
    report.checks.every((item) => item.ok) &&
    report.portals.length === 2 &&
    report.portals.every((item) => item.stopped) &&
    report.containers.length === 2 &&
    report.containers.every(
      (item) => item.cleaned && !item.remaining && !item.error,
    );
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(root, "output/voucher-release-runtime-current.json"),
    JSON.stringify({ directory: output, ok: report.ok }, null, 2),
  );
  console.log(
    JSON.stringify({
      ok: report.ok,
      report: join(output, "report.json"),
      error: report.error,
    }),
  );
  if (!report.ok) process.exitCode = 1;
}
