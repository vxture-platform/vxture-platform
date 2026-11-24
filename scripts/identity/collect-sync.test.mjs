/**
 * Collector isolation, complete snapshots and concurrent-writer regressions.
 * @package @vxture/repo
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-25
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  batchPrometheus,
  collectScopes,
  publishBatch,
  validateBatch,
} from "./collect-sync.mjs";

const scope = {
  clientId: "console",
  issuer: "https://accounts.test",
  realm: "customer",
  environment: "prod",
  releaseChannel: "stable",
  logoutUri: "https://console.test/auth/backchannel-logout",
  receiverUri: "https://console.test/auth/identity-events",
};
const ready = (supplied) => ({
  scope: {
    clientId: supplied.clientId,
    realm: supplied.realm,
    environment: supplied.environment,
    releaseChannel: supplied.releaseChannel,
  },
  observedAt: new Date().toISOString(),
  databaseReady: true,
  checks: [],
  metrics: { changes_pending: 7 },
});

// ===========================================================================
// Invalid configuration cannot select a target or inject metric dimensions.
// ===========================================================================
test("batch validates bounds, duplicate label identities, and unknown fields", () => {
  assert.throws(() => validateBatch({ scopes: [] }));
  assert.throws(() => validateBatch({ scopes: Array(33).fill(scope) }));
  assert.throws(() =>
    validateBatch({
      scopes: [scope, { ...scope, issuer: "https://other.test" }],
    }),
  );
  assert.throws(() =>
    validateBatch({ scopes: [{ ...scope, secret: "never" }] }),
  );
  assert.throws(() => validateBatch({ scopes: [scope], secret: "never" }));
  assert.equal(
    validateBatch({ scopes: [scope, { ...scope, realm: "workforce" }] }).length,
    2,
  );
});

test("sample covers all seven RPs with explicit customer/workforce scopes", async () => {
  const config = JSON.parse(
    await readFile(
      new URL(
        "../../deploy/identity-sync/platform.example.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const scopes = validateBatch(config);
  assert.deepEqual(scopes.map((s) => s.clientId).sort(), [
    "admin",
    "arche",
    "console",
    "customer-portal",
    "opera",
    "website",
    "workbench",
  ]);
  assert.deepEqual(
    scopes
      .filter((s) => s.realm === "workforce")
      .map((s) => s.clientId)
      .sort(),
    ["admin", "arche", "opera"],
  );
});

test("partial outage stays explicit without false zero queues or raw errors", async () => {
  const scopes = validateBatch({
    scopes: [scope, { ...scope, clientId: "admin", realm: "workforce" }],
  });
  const batch = await collectScopes(scopes, async (s) => {
    if (s.clientId === "admin")
      throw new Error("postgres://user:secret@private/session-data");
    return ready(s);
  });
  const metrics = batchPrometheus(batch);
  assert.equal(batch.results[0].available, true);
  assert.equal(batch.results[1].available, false);
  assert.match(metrics, /collection_success\{client_id="admin"[^\n]+ 0/);
  assert.match(metrics, /changes_pending\{client_id="console"[^\n]+ 7/);
  assert.doesNotMatch(metrics, /changes_pending\{client_id="admin"/);
  assert.doesNotMatch(JSON.stringify(batch), /postgres|secret|session-data/);
  const declarations = metrics
    .split("\n")
    .filter((line) => line.startsWith("# TYPE"));
  assert.equal(new Set(declarations).size, declarations.length);
});

test("wrong-scope results cannot publish as another receiver's healthy state", async () => {
  const batch = await collectScopes([scope], async () =>
    ready({ ...scope, realm: "workforce" }),
  );
  assert.equal(batch.results[0].available, false);
});

// ===========================================================================
// File-system checks exercise real lock creation, rename and cleanup.
// ===========================================================================
test("atomic publication distinguishes readiness and outage exit codes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "identity-collector-"));
  const output = join(directory, "identity.prom");
  try {
    for (const [expected, inspect] of [
      [0, async (s) => ready(s)],
      [2, async (s) => ({ ...ready(s), databaseReady: false })],
      [
        1,
        async () => {
          throw new Error("offline");
        },
      ],
    ]) {
      const result = await publishBatch(output, () =>
        collectScopes([scope], inspect),
      );
      assert.equal(result.exitCode, expected);
      assert.match(await readFile(output, "utf8"), /scope_expected/);
      assert.deepEqual(await readdir(directory), ["identity.prom"]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent writers fail without stealing a lock; incomplete writes preserve prior bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "identity-collector-"));
  const output = join(directory, "identity.prom");
  let finish, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const wait = new Promise((resolve) => {
    finish = resolve;
  });
  try {
    await writeFile(output, "previous snapshot\n");
    const first = publishBatch(output, async () => {
      started();
      await wait;
      return collectScopes([scope], async (s) => ready(s));
    });
    await entered;
    await assert.rejects(
      publishBatch(output, () => collectScopes([scope], async (s) => ready(s))),
      { code: "EEXIST" },
    );
    assert.equal(await readFile(output, "utf8"), "previous snapshot\n");
    finish();
    await first;
    const complete = await readFile(output, "utf8");
    await assert.rejects(
      publishBatch(output, async () => {
        throw new Error("failed before publication");
      }),
    );
    assert.equal(await readFile(output, "utf8"), complete);
    assert.deepEqual(await readdir(directory), ["identity.prom"]);
  } finally {
    finish?.();
    await rm(directory, { recursive: true, force: true });
  }
});
