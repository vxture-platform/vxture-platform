/**
 * Inspection scope and unavailable-state guarantees.
 * @package @vxture/repo
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectSync, prometheus, validateScope } from "./inspect-sync.mjs";
const scope = {
  clientId: "console",
  issuer: "https://accounts.test",
  environment: "prod",
  releaseChannel: "stable",
  logoutUri: "https://console.test/auth/backchannel-logout",
  receiverUri: "https://console.test/auth/identity-events",
};

// ===========================================================================
// Invalid or unavailable observations must never look like healthy zero work.
// ===========================================================================
test("scope validation rejects label injection, insecure production and endpoint credentials", () => {
  assert.equal(validateScope(scope).realm, "customer");
  assert.equal(
    validateScope({ ...scope, realm: "workforce" }).realm,
    "workforce",
  );
  assert.throws(() => validateScope({ ...scope, realm: "other" }));
  assert.throws(() => validateScope({ ...scope, clientId: 'console"' }));
  assert.throws(() => validateScope({ ...scope, environment: "unknown" }));
  assert.throws(() =>
    validateScope({ ...scope, receiverUri: "http://127.0.0.1/events" }),
  );
  assert.throws(() =>
    validateScope({
      ...scope,
      receiverUri: "https://secret@example.test/events",
    }),
  );
  assert.throws(() =>
    validateScope({
      ...scope,
      receiverUri: "https://console.test/events?token=secret",
    }),
  );
  assert.equal(
    validateScope({
      ...scope,
      environment: "dev",
      receiverUri: "http://127.0.0.1/events",
    }).environment,
    "dev",
  );
});

test("missing schema reports failed checks without misleading zero gauges", async () => {
  const queries = [];
  let released = false;
  const tx = {
    query: async (sql, values) => {
      queries.push(sql);
      return {
        rows: values ? values[0].map((name) => ({ name, present: false })) : [],
      };
    },
    release: () => {
      released = true;
    },
  };
  const report = await inspectSync({ connect: async () => tx }, scope);
  assert.equal(report.databaseReady, false);
  assert.deepEqual(report.metrics, {});
  assert.ok(queries[0].endsWith("read only"));
  assert.equal(queries.at(-1), "commit");
  assert.equal(released, true);
});

test("query outage rolls back and rejects instead of emitting healthy state", async () => {
  const queries = [];
  let released = false;
  const tx = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.startsWith("select")) throw new Error("offline");
      return { rows: [] };
    },
    release: () => {
      released = true;
    },
  };
  await assert.rejects(
    inspectSync({ connect: async () => tx }, scope),
    /offline/,
  );
  assert.equal(queries.at(-1), "rollback");
  assert.equal(released, true);
});

test("collector output contains freshness and bounded labels without identity data", () => {
  const text = prometheus({
    scope: validateScope(scope),
    observedAt: "2026-11-24T00:00:00Z",
    databaseReady: false,
    metrics: { changes_pending: 3 },
  });
  assert.match(
    text,
    /vxture_identity_database_ready\{client_id="console",environment="prod",realm="customer",release_channel="stable"\} 0/,
  );
  assert.match(text, /vxture_identity_inspection_timestamp_seconds/);
  assert.doesNotMatch(text, /accounts\.test|receiver|sid=|sub=|token/);
});

test("issuer and metric validation reject ambiguous or misleading observations", () => {
  assert.throws(() => validateScope({ ...scope, issuer: scope.issuer + "/" }));
  assert.throws(() =>
    validateScope({ ...scope, issuer: scope.issuer + "/oidc" }),
  );
  const report = {
    scope: validateScope(scope),
    observedAt: new Date().toISOString(),
    databaseReady: true,
    metrics: {},
  };
  assert.throws(() =>
    prometheus({ ...report, metrics: { changes_pending: NaN } }),
  );
  assert.throws(() =>
    prometheus({ ...report, metrics: { changes_pending: -1 } }),
  );
  assert.throws(() =>
    prometheus({ ...report, scope: { ...report.scope, realm: 'bad"' } }),
  );
});

test("workforce queues bind realm and channel; missing migration columns stop queue reads", async () => {
  const queries = [];
  let columnsPresent = true;
  const tx = {
    query: async (sql, values) => {
      queries.push({ sql, values });
      if (sql.includes("from unnest"))
        return {
          rows: values[0].map((name) => ({
            name,
            present: !sql.includes("pg_attribute") || columnsPresent,
          })),
        };
      if (sql.includes("pg_trigger"))
        return {
          rows: [
            {
              definition:
                "account,email,phone name,display_name,tenant_no name,workspace_no",
            },
          ],
        };
      if (sql.includes("client_matches"))
        return {
          rows: [
            {
              client_matches: true,
              recovery_matches: true,
              changes_enabled: true,
              receiver_matches: true,
            },
          ],
        };
      if (sql.startsWith("with scope"))
        return { rows: [{ pending: 0, quarantined: 0, exhausted: 0 }] };
      if (sql.includes("identity_time_boundaries"))
        return { rows: [{ pending: 0, oldest: 0 }] };
      return { rows: [] };
    },
    release() {},
  };
  const workforce = { ...scope, realm: "workforce", releaseChannel: "canary" };
  const ready = await inspectSync({ connect: async () => tx }, workforce);
  assert.equal(ready.databaseReady, true);
  assert.equal(ready.scope.realm, "workforce");
  assert.equal(ready.scope.releaseChannel, "canary");
  const queues = queries.filter((q) => q.sql.startsWith("with scope"));
  assert.equal(queues.length, 2);
  for (const q of queues) {
    assert.equal(q.values[6], "workforce");
    assert.equal(q.values[3], "canary");
    assert.match(q.sql, /realm=\$7/);
    assert.match(q.sql, /release_channel=\$4/);
  }
  columnsPresent = false;
  queries.length = 0;
  const missing = await inspectSync({ connect: async () => tx }, scope);
  assert.equal(missing.databaseReady, false);
  assert.deepEqual(missing.metrics, {});
  assert.equal(queries.filter((q) => q.sql.startsWith("with scope")).length, 0);
});
