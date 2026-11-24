/**
 * Isolated process-crash and capacity acceptance using the actual identity chain.
 * @package @vxture/repo
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID, generateKeyPairSync, createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { inspectSync, prometheus } from "../identity/inspect-sync.mjs";

// ===========================================================================
// Explicit loopback storage; random database and key prefix; owned children only.
// ===========================================================================
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(join(root, "bff/auth-bff/package.json"));
const { Pool } = require("pg");
const { build } = require("esbuild");
const { hash } = createRequire(
  join(root, "services/identity/iam/package.json"),
)("bcryptjs");
const Redis = require("ioredis");
const runId = randomUUID().replaceAll("-", "");
const output = join(root, "output/identity-acceptance", runId);
const database = `identity_acceptance_${runId}`;
const prefix = `identity-acceptance:${runId}:`;
const pgUrl = process.env.IDENTITY_ACCEPTANCE_PG_URL;
const redisUrl = process.env.IDENTITY_ACCEPTANCE_REDIS_URL;
const connectionCount = Number(
  process.env.IDENTITY_ACCEPTANCE_CONNECTIONS ?? 256,
);
const children = [],
  streams = [];
let admin,
  pool,
  redis,
  databaseCreated = false,
  config,
  scope;
const report = {
  runId,
  startedAt: new Date().toISOString(),
  groups: [],
  limitations: [
    "Local HTTP clients and loopback services; no target reverse proxy, browser, or external product is represented.",
    "Actual source modules run in minimal acceptance containers with temporary signing keys and explicitly seeded sessions; interactive OIDC login and MFA are not tested.",
    "Measured connection count and latency are observations on this host, not a production capacity or P95 guarantee.",
  ],
};
const env = { NODE_ENV: "test", TZ: "UTC", NO_COLOR: "1" };
for (const [key, value] of Object.entries(process.env))
  if (
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|userprofile|appdata|localappdata)$/i.test(
      key,
    )
  )
    env[key] = value;

/** Wait for observed state, never mutate leases to simulate elapsed time. @param predicate - Async observation. @param label - Safe error label. @param timeout - Bound in ms. @returns Last truthy observation. */
async function until(predicate, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Acceptance timed out: ${label}`);
}
/** Start an owned role; credentials travel over IPC only. @param kind - Bundle kind. @param settings - Explicit fixture config. @returns Child control. */
async function start(kind, settings) {
  const log = createWriteStream(
    join(output, `${settings.role}-${children.length}.log`),
  );
  const child = fork(join(output, `${kind}.cjs`), [], {
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const pending = new Map();
  let next = 0;
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Fixture startup timed out")),
      30000,
    );
    child.once("error", reject);
    child.on("message", (message) => {
      if (message.ready) {
        clearTimeout(timeout);
        resolve(message.ready);
      }
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        clearTimeout(request.timer);
        message.error
          ? request.reject(new Error(message.error))
          : request.resolve(message.result);
      }
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Fixture exited before readiness"));
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Owned fixture exited"));
      }
      pending.clear();
      log.end();
    });
  });
  const f = {
    child,
    ready: null,
    call(method, value) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Fixture command timed out: ${method}`));
        }, 30000);
        pending.set(id, { resolve, reject, timer });
        child.send({ id, method, value });
      });
    },
    async kill() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const done = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await done;
    },
  };
  children.push(f);
  child.send(settings);
  f.ready = await ready;
  return f;
}
/** Open a real Cookie-authenticated SSE connection. @param base - Loopback BFF. @param rpsid - Seeded opaque cookie. @returns Observed frames and stop handle. */
async function stream(base, rpsid) {
  const controller = new AbortController();
  const response = await fetch(base + "/auth/events", {
    headers: { cookie: `vx_rp_session_console=${rpsid}` },
    signal: controller.signal,
  });
  const item = {
    status: response.status,
    frames: [],
    closed: false,
    stop: () => controller.abort(),
    pump: Promise.resolve(),
  };
  streams.push(item);
  if (response.status !== 200) {
    await response.body?.cancel();
    item.closed = true;
    return item;
  }
  assert.equal(response.headers.get("x-vxture-session-sync"), "events-v1");
  item.pump = (async () => {
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const value = await reader.read();
        if (value.done) break;
        buffer += decoder.decode(value.value, { stream: true });
        let at;
        while ((at = buffer.indexOf("\n\n")) >= 0) {
          item.frames.push({ body: buffer.slice(0, at), at: Date.now() });
          buffer = buffer.slice(at + 2);
        }
      }
    } catch {
      /* Expected when an owned process or connection is killed. */
    } finally {
      item.closed = true;
      await reader.cancel().catch(() => undefined);
    }
  })();
  await until(
    () => item.frames.some((f) => f.body.includes("connected")),
    "initial SSE frame",
  );
  return item;
}
const result = (name, detail = {}) => {
  report.groups.push({ name, passed: true, ...detail });
  console.log(`PASS ${name}`);
};

// ===========================================================================
// Build actual source and seed an isolated schema without touching shared roles.
// ===========================================================================
try {
  for (const value of [pgUrl, redisUrl])
    assert.ok(
      value &&
        ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname),
      "Explicit loopback PG/Redis URLs required",
    );
  assert.ok(
    Number.isInteger(connectionCount) &&
      connectionCount >= 32 &&
      connectionCount <= 512 &&
      connectionCount % 32 === 0,
    "Connection count must be a multiple of 32 in [32,512]",
  );
  await mkdir(output, { recursive: true });
  for (const name of ["auth", "console"])
    await build({
      entryPoints: [join(root, `scripts/tests/fixtures/identity-${name}.ts`)],
      outfile: join(output, `${name}.cjs`),
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      tsconfig: join(root, "bff/auth-bff/tsconfig.json"),
      nodePaths: [
        join(root, "bff/auth-bff/node_modules"),
        join(root, "bff/console-bff/node_modules"),
      ],
      alias: {
        "@vxture/core-oidc-rp": join(
          root,
          "packages/core/oidc-rp/src/index.ts",
        ),
      },
      external: [
        "@nestjs/websockets/socket-module",
        "@nestjs/microservices",
        "@nestjs/microservices/microservices-module",
        "class-transformer/storage",
      ],
    });
  const privateKey = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey.export({ type: "pkcs8", format: "pem" });
  admin = new Pool({ connectionString: pgUrl, connectionTimeoutMillis: 5000 });
  await admin.query(`create database "${database}"`);
  databaseCreated = true;
  const url = new URL(pgUrl);
  url.pathname = `/${database}`;
  pool = new Pool({
    connectionString: url.href,
    max: 8,
    connectionTimeoutMillis: 5000,
  });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await redis.ping();
  const files = [
    "00_schemas.sql",
    "10_account.sql",
    "18_access.sql",
    "20_tenancy.sql",
    "22_appoidc.sql",
    "24_session.sql",
    "25_identity_recovery.sql",
    "26_rp_session_notifications.sql",
    "40_product.sql",
    "50_metering.sql",
    "96_identity_changes.sql",
    "96_identity_delivery.sql",
    "96_identity_extended_facts.sql",
    "96_identity_presentation.sql",
    "80_admin.sql",
    "96_identity_workforce.sql",
  ];
  report.ddlHashes = {};
  for (const file of files) {
    const sql = await readFile(join(root, "deploy/database/ddl", file), "utf8");
    await pool.query(sql);
    report.ddlHashes[file] = createHash("sha256").update(sql).digest("hex");
  }
  config = {
    databaseUrl: url.href,
    redisUrl,
    prefix,
    issuer: "https://accounts.acceptance.test",
    idpUrl: "",
    privateKey,
    secret: randomUUID(),
  };
  const authority = await start("auth", { ...config, role: "authority" });
  config.idpUrl = `http://127.0.0.1:${authority.ready.port}`;
  let a = await start("console", { ...config, role: "console" });
  const b = await start("console", { ...config, role: "console" });
  const baseA = `http://127.0.0.1:${a.ready.port}`,
    baseB = `http://127.0.0.1:${b.ready.port}`;
  scope = {
    clientId: "console",
    issuer: config.issuer,
    environment: "dev",
    releaseChannel: "stable",
    logoutUri: baseA + "/auth/backchannel-logout",
    receiverUri: baseA + "/auth/identity-events",
  };
  await writeFile(join(output, "scope.json"), JSON.stringify(scope, null, 2));
  await pool.query(
    "insert into appoidc.oidc_clients(client_id,client_secret_hash,client_kind,redirect_uris,slo_participation,back_channel_logout_uri) values('console',$1,'platform','{}','back_channel',$2)",
    [await hash(config.secret, 4), scope.logoutUri],
  );
  await pool.query(
    "insert into session.identity_recovery_streams(client_id,issuer,environment,release_channel,logout_uri,enabled) values('console',$1,'dev','stable',$2,true)",
    [scope.issuer, scope.logoutUri],
  );
  await pool.query(
    "insert into session.identity_change_streams(stream_id,enabled) select stream_id,true from session.identity_recovery_streams",
  );
  await pool.query(
    "insert into session.identity_change_receivers(stream_id,receiver_uri,enabled) select stream_id,$1,true from session.identity_recovery_streams",
    [scope.receiverUri],
  );
  const sessions = await authority.call("seed", 16);
  await a.call("seed", sessions);
  const inspection = await inspectSync(pool, scope);
  assert.equal(inspection.databaseReady, true);
  await writeFile(
    join(output, "inspection.json"),
    JSON.stringify(inspection, null, 2),
  );
  await writeFile(join(output, "metrics.prom"), prometheus(inspection));
  assert.equal(
    (
      await inspectSync(pool, {
        ...scope,
        issuer: "https://other.acceptance.test",
      })
    ).databaseReady,
    false,
  );
  await pool.query(
    "update session.identity_change_receivers set enabled=false",
  );
  try {
    const disabled = await inspectSync(pool, scope);
    assert.equal(disabled.databaseReady, false);
    assert.ok(
      disabled.checks.some((c) => c.code === "receiver_matches" && !c.passed),
    );
  } finally {
    await pool.query(
      "update session.identity_change_receivers set enabled=true",
    );
  }
  await pool.query(
    "alter table account.user_profiles disable trigger trg_identity_presentation",
  );
  try {
    const missing = await inspectSync(pool, scope);
    assert.equal(missing.databaseReady, false);
    assert.ok(
      missing.checks.some(
        (c) =>
          c.code ===
            "trigger:account.user_profiles:trg_identity_presentation" &&
          !c.passed,
      ),
    );
  } finally {
    await pool.query(
      "alter table account.user_profiles enable trigger trg_identity_presentation",
    );
  }
  result("read-only scope preflight and metrics", {
    wrongIssuerRejected: true,
    disabledReceiverRejected: true,
    disabledPresentationTriggerRejected: true,
  });
  let delivery = await start("auth", { ...config, role: "delivery" });

  // ========================================================================
  // Capacity is measured over real sockets, two processes and durable fanout.
  // ========================================================================
  const opening = Date.now(),
    active = [];
  for (let offset = 0; offset < connectionCount; offset += 16)
    active.push(
      ...(await Promise.all(
        Array.from({ length: 16 }, (_, i) => {
          const n = offset + i;
          return stream(
            n % 2 ? baseB : baseA,
            sessions[Math.floor(n / 2) % 16].rpsid,
          );
        }),
      )),
    );
  assert.ok(active.every((s) => s.status === 200));
  const centralBefore = (await authority.call("stats")).recoveryReads;
  await until(
    () =>
      active.every((s) =>
        s.frames.some((f) => f.body.startsWith(": keepalive")),
      ),
    "real heartbeat",
    35000,
  );
  assert.equal((await authority.call("stats")).recoveryReads, centralBefore);
  const started = Date.now();
  await pool.query(
    "update account.users set email=id::text||'@acceptance.test'",
  );
  await until(
    () =>
      active.every((s) =>
        s.frames.some((f) => f.body.includes("access-changed")),
      ),
    "signed delivery and fanout",
    30000,
  );
  const latencies = active
    .map(
      (s) =>
        s.frames.find((f) => f.body.includes("access-changed")).at - started,
    )
    .sort((x, y) => x - y);
  result("two-instance signed delivery capacity", {
    connections: connectionCount,
    openAndHeartbeatMs: started - opening,
    p50Ms: latencies[Math.floor(latencies.length * 0.5)],
    p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
    maxMs: latencies.at(-1),
    authorityReadsDuringHeartbeat: 0,
    processes: [await a.call("stats"), await b.call("stats")],
  });
  const perSid = connectionCount / 32,
    extras = [];
  for (let i = perSid; i < 32; i++)
    extras.push(await stream(baseA, sessions[0].rpsid));
  assert.equal((await stream(baseA, sessions[0].rpsid)).status, 429);
  for (const s of [...extras, ...active]) s.stop();
  await Promise.all([...extras, ...active].map((s) => s.pump));
  result("32-per-sid connection boundary");

  // ========================================================================
  // Kill sender after the receiver COMMIT but before its HTTP ACK reaches sender.
  // ========================================================================
  await until(
    async () =>
      Number(
        (
          await pool.query(
            "select count(*) from session.identity_change_deliveries where status='pending'",
          )
        ).rows[0].count,
      ) === 0,
    "initial deliveries drain",
  );
  await a.call("hold", true);
  await pool.query(
    "update account.users set email='crash@acceptance.test' where id=$1",
    [sessions[0].user],
  );
  await until(
    async () => (await a.call("stats")).heldAcks === 1,
    "commit before held ACK",
  );
  const leased = (
    await pool.query(
      "select id,lease_id,lease_until,attempts,sequence from session.identity_change_deliveries where status='pending' and lease_id is not null",
    )
  ).rows[0];
  assert.ok(leased);
  await delivery.kill();
  const inboxBefore = Number(
    (await pool.query("select count(*) from session.rp_identity_inbox")).rows[0]
      .count,
  );
  await a.call("hold", false);
  delivery = await start("auth", { ...config, role: "delivery" });
  await delivery.call("pass");
  assert.equal(
    (
      await pool.query(
        "select attempts from session.identity_change_deliveries where id=$1",
        [leased.id],
      )
    ).rows[0].attempts,
    leased.attempts,
  );
  await until(
    () => Date.now() > new Date(leased.lease_until).getTime() + 50,
    "real 60-second lease expiry",
    70000,
  );
  await delivery.call("pass");
  await until(
    async () =>
      (
        await pool.query(
          "select status from session.identity_change_deliveries where id=$1",
          [leased.id],
        )
      ).rows[0].status === "delivered",
    "redelivery after OS kill",
  );
  assert.equal(
    Number(
      (await pool.query("select count(*) from session.rp_identity_inbox"))
        .rows[0].count,
    ),
    inboxBefore,
  );
  const attempts = (
    await pool.query(
      "select attempts from session.identity_change_deliveries where id=$1",
      [leased.id],
    )
  ).rows[0].attempts;
  assert.ok(attempts > leased.attempts);
  result("sender OS kill after durable inbox commit", {
    realLeaseSeconds: 60,
    attempts,
    inboxDuplicates: 0,
  });

  const oldStream = await stream(baseA, sessions[0].rpsid);
  const port = a.ready.port;
  await delivery.kill();
  await a.kill();
  await until(() => oldStream.closed, "receiver process socket closure");
  await pool.query(
    "update account.users set email='receiver-restart@acceptance.test' where id=$1",
    [sessions[0].user],
  );
  const centralVersion = (
    await pool.query(
      "select version::text from session.identity_subject_versions where user_id=$1",
      [sessions[0].user],
    )
  ).rows[0].version;
  const recoveryReadsBeforeRestart = (await authority.call("stats"))
    .recoveryReads;
  a = await start("console", { ...config, role: "console", port });
  const reopened = await stream(baseA, sessions[0].rpsid);
  assert.equal(reopened.status, 200);
  const restoredVersion = (
    await pool.query(
      "select version::text from session.rp_identity_versions where issuer=$1 and client_id='console' and environment='dev' and realm='customer' and kind='access' and subject_key=$2",
      [scope.issuer, sessions[0].session.sub],
    )
  ).rows[0].version;
  assert.equal(restoredVersion, centralVersion);
  assert.ok(
    (await authority.call("stats")).recoveryReads > recoveryReadsBeforeRestart,
  );
  delivery = await start("auth", { ...config, role: "delivery" });
  await delivery.call("pass");
  await until(
    async () =>
      Number(
        (
          await pool.query(
            "select count(*) from session.identity_change_deliveries where status='pending'",
          )
        ).rows[0].count,
      ) === 0,
    "receiver restart delivery",
  );
  result("receiver OS kill and snapshot recovery", {
    versionRecoveredBeforeSenderRestart: true,
  });
  const logoutStream = await stream(baseB, sessions[0].rpsid);
  await authority.call("revoke", sessions[0].session.sid);
  await until(
    () =>
      [reopened, logoutStream].every((s) =>
        s.frames.some((f) => f.body.includes("session-ended")),
      ),
    "standard logout fanout",
  );
  assert.equal((await stream(baseA, sessions[0].rpsid)).status, 401);
  result("central logout to both RP processes and terminal fence");
  report.completedAt = new Date().toISOString();
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error instanceof Error ? error.message : "Acceptance failed";
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  for (const s of streams) s.stop();
  await Promise.allSettled(streams.map((s) => s.pump));
  for (const f of children.reverse()) {
    if (f.child.exitCode === null && f.child.signalCode === null) {
      await f.call("stop").catch(() => undefined);
      await f.kill();
    }
  }
  if (redis) {
    let cursor = "0";
    do {
      const page = await redis.scan(
        cursor,
        "MATCH",
        prefix + "*",
        "COUNT",
        100,
      );
      cursor = page[0];
      if (page[1].length) await redis.del(...page[1]);
    } while (cursor !== "0");
    await redis.quit();
  }
  await pool?.end();
  if (databaseCreated)
    await admin.query(`drop database "${database}" with (force)`);
  await admin?.end();
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(`Report: ${output}`);
}
