/**
 * legacy-test-wallet.test.mjs - Rehearse scoped legacy adoption on private PostgreSQL.
 * @package vxture-platform
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 * Run: node --test deploy/database/verify/legacy-test-wallet.test.mjs
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { Duplex } from "node:stream";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// ===========================================================================
// No host credentials, database URLs, published ports or persistent volumes.
// ===========================================================================
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runId = randomUUID();
const container = `codex-voucher-s05-adopt-${runId}`;
const database = "vxturestudio_platform_main";
const owner = "vxture_rds_default";
const tenant = "00000000-0000-4000-a000-000000000200";
const credit = "b7e90751-7726-4106-bc06-66b040897019";
const actor = "00000000-0000-4000-8000-000000000001";
const backupHash = "b".repeat(64);
const env = { NODE_ENV: "test", TZ: "UTC", LC_ALL: "C" };
for (const [key, value] of Object.entries(process.env))
  if (
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata)$/i.test(
      key,
    )
  )
    env[key] = value;
const read = (path) => readFileSync(resolve(root, path), "utf8");
const adoptionPath = "deploy/database/verify/adopt-legacy-test-wallet.sql";
const adoption = read(adoptionPath);
const migrationNames = [
  "2026-12-09-promotion-ownership-foundation.sql",
  "2026-12-10-wallet-source-ledger.sql",
  "2026-12-11-recharge-card-funding.sql",
  "2026-12-12-payment-source-compatibility.sql",
];
const report = {
  batch: "S05-R3b",
  runId,
  startedAt: new Date().toISOString(),
  status: "running",
  releaseReady: false,
  sourceDatabaseChanged: false,
  container,
  checks: [],
  cleanedUp: false,
  adoptionSha256: createHash("sha256").update(adoption).digest("hex"),
  testSha256: createHash("sha256")
    .update(read("deploy/database/verify/legacy-test-wallet.test.mjs"))
    .digest("hex"),
  walletRepositorySha256: createHash("sha256")
    .update(
      read("services/commerce/billing/src/repository/pg-wallet-ledger.ts"),
    )
    .digest("hex"),
  migrations: migrationNames.map((name) => ({
    name,
    sha256: createHash("sha256")
      .update(read(`deploy/database/migrations/${name}`))
      .digest("hex"),
  })),
  productBoundary:
    "Voucher rules and economic effects are platform-owned. Product applications consume the existing subscription/entitlement interfaces; unfinished Arda/Karda integrations are tracked separately.",
};

function command(args, input, timeout = 60000) {
  return spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    env,
    maxBuffer: 8 * 1024 * 1024,
  });
}
function ok(result) {
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
function args(db = database, variables = {}) {
  return [
    "exec",
    "-i",
    container,
    "psql",
    "-X",
    "-qAt",
    "-U",
    "postgres",
    "-d",
    db,
    "-v",
    "ON_ERROR_STOP=1",
    ...Object.entries(variables).flatMap(([key, value]) => [
      "-v",
      `${key}=${value}`,
    ]),
  ];
}
function sql(source, db = database) {
  return ok(command(args(db), `SET TIME ZONE 'UTC';\n${source}`));
}
function apply(variables = {}, prefix = "", db = database) {
  return command(
    args(db, {
      target_sha256: target(db),
      approval_ref: "s05-r3b-test-approved",
      backup_sha256: backupHash,
      test_data_ack: "SELF_CREATED_NO_EXTERNAL_PAYMENT",
      ...variables,
    }),
    `${prefix}\nSET ROLE ${owner};\n${adoption}`,
  );
}
function target(db = database, role = owner) {
  return sql(
    `SET ROLE ${role}; SELECT encode(sha256(convert_to(current_database() || E'\\n' ||
    coalesce(inet_server_addr()::text,'local') || E'\\n' || coalesce(inet_server_port()::text,'local') || E'\\n' || current_user,'UTF8')),'hex');`,
    db,
  );
}
function denied(result, code) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(code));
  assert.doesNotMatch(result.stdout, /S05_TEST_WALLET_COMMITTED/);
}
function originalFacts() {
  return sql(`SELECT jsonb_build_object(
    'credits',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.credits t),
    'transactions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.transactions t),
    'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.payments t),
    'invoices',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.invoices t),
    'orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.orders t),
    'refunds',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.refunds t));`);
}
function walletFacts() {
  return sql(`SELECT jsonb_build_object(
    'accounts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY credit_id) FROM billing.wallet_accounts t),
    'operations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.wallet_operations t),
    'lots',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.wallet_lots t),
    'entries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.wallet_entries t));`);
}
function walletEmpty() {
  assert.equal(
    sql(`SELECT (SELECT count(*) FROM billing.wallet_accounts)+
    (SELECT count(*) FROM billing.wallet_operations)+(SELECT count(*) FROM billing.wallet_lots)+
    (SELECT count(*) FROM billing.wallet_entries);`),
    "0",
  );
}
async function concurrentApply() {
  const parameters = args(database, {
    target_sha256: target(),
    approval_ref: "s05-r3b-test-approved",
    backup_sha256: backupHash,
    test_data_ack: "SELF_CREATED_NO_EXTERNAL_PAYMENT",
    commit_adoption: "yes",
  });
  return new Promise((done, reject) => {
    const child = spawn("docker", parameters, {
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => done({ status, stdout, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(`SET ROLE ${owner};\n${adoption}`);
  });
}

// ===========================================================================
// Synthetic copies of the exact scoped evidence; no source snapshot is loaded.
// ===========================================================================
const fixtures = `
INSERT INTO account.users(id,account,phone,phone_verified_at) VALUES ('${actor}','s05-adopt','+8613900005678',now());
INSERT INTO tenancy.tenants(id,name,type,owner_user_id) VALUES
 ('${tenant}','S05 self-created test','organization','${actor}'),
 ('00000000-0000-4000-a000-000000000299','S05 unrelated','organization','${actor}');
INSERT INTO tenancy.workspaces(id,tenant_id,name) VALUES
 ('00000000-0000-4000-a000-000000000210','${tenant}','S05 test workspace');
INSERT INTO access.roles(id,role_code,scope) VALUES
 ('00000000-0000-4000-8000-000000000021','s05-adopt-tenant','tenant'),
 ('00000000-0000-4000-8000-000000000022','s05-adopt-workspace','workspace');
INSERT INTO tenancy.tenant_memberships(tenant_id,user_id,role_id,role_scope,status) VALUES
 ('${tenant}','${actor}','00000000-0000-4000-8000-000000000021','tenant','active');
INSERT INTO tenancy.workspace_memberships(tenant_id,workspace_id,user_id,role_id,role_scope,status) VALUES
 ('${tenant}','00000000-0000-4000-a000-000000000210','${actor}',
 '00000000-0000-4000-8000-000000000022','workspace','active');
INSERT INTO product.products(id,product_code,product_name,product_type,status) VALUES
 ('00000000-0000-4000-8000-000000000004','s05-fixture','S05 fixture','agent','active');
INSERT INTO product.plans(id,plan_code,plan_name) VALUES
 ('00000000-0000-4000-8000-000000000005','s05-fixture','S05 fixture');
INSERT INTO product.plan_versions(id,plan_id,version_no) VALUES
 ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000005',1);
INSERT INTO metering.subscriptions(id,tenant_id,workspace_id,plan_version_id,product_id,
 subscription_kind,cycle_unit,start_at,end_at,created_by_type,created_by_id) VALUES
 ('00b65871-36bb-4a09-9398-04c716a79398','${tenant}','00000000-0000-4000-a000-000000000210',
 '00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000004',
 'paid','month','2026-11-11','2026-12-11','customer','${actor}');
INSERT INTO billing.orders(id,order_no,tenant_id,workspace_id,product_id,plan_version_id,intent,
 from_subscription_id,subscription_id,cycle_unit,list_amount,credit_amount,payable_amount,leftover_amount,
 status,fulfilled_at,created_by_type) VALUES
 ('646ef877-2795-4ed8-a3a9-b2c6ac2f4911','ORD-202611-B3135B0D48','${tenant}',
 '00000000-0000-4000-a000-000000000210','00000000-0000-4000-8000-000000000004',
 '00000000-0000-4000-8000-000000000006','upgrade','00b65871-36bb-4a09-9398-04c716a79398',
 '00b65871-36bb-4a09-9398-04c716a79398','month',399,932.62,0,533.62,'fulfilled','2026-11-11','customer');
INSERT INTO billing.invoices(id,tenant_id,bill_no,bill_status,bill_type,bill_cycle,cycle_start_date,
 cycle_end_date,total_amount,payable_amount,paid_amount,created_by_type) VALUES
 ('00000000-0000-4000-8000-000000000008','${tenant}','INV-S05-ADOPT','paid','normal',
 '202611','2026-11-01','2026-12-01',1,1,1,'customer');
INSERT INTO billing.credits(id,tenant_id,balance,total_granted,total_consumed,version) VALUES
 ('${credit}','${tenant}',532.62,533.62,1,2),
 ('00000000-0000-4000-8000-000000000299','00000000-0000-4000-a000-000000000299',7,7,0,1);
INSERT INTO billing.transactions(id,tenant_id,bill_id,transaction_no,trade_type,amount,
 balance_before,balance_after,actor_type,actor_id,related_no,created_at) VALUES
 ('295b8d57-3e4e-4154-843b-5471ab02f08a','${tenant}',NULL,'TXN-S05-GRANT','grant',
 533.62,0,533.62,'customer','${actor}','ORD-202611-B3135B0D48','2026-11-11 06:36:18.628+00'),
 ('fcb84583-9dd9-43aa-9fec-d944f76bc8c0','${tenant}','00000000-0000-4000-8000-000000000008',
 'TXN-S05-CONSUME','consume',-1,533.62,532.62,'customer','${actor}',NULL,'2026-11-11 16:49:05.018+00');
INSERT INTO billing.payments(id,tenant_id,bill_id,transaction_id,pay_order_no,pay_source,total_amount,
 paid_amount,pay_status,paid_at) VALUES ('9a54431d-fda3-41fa-9eb0-08d0ed90f054','${tenant}',
 '00000000-0000-4000-8000-000000000008','fcb84583-9dd9-43aa-9fec-d944f76bc8c0',
 'PAY-S05-ADOPT','balance',1,1,'paid','2026-11-11 16:49:05.018+00');
`;

// Execute the real wallet repository over a private stdin wire tunnel.
async function withWallet(work) {
  const req = createRequire(resolve(root, "bff/console-bff/package.json"));
  const { Client } = req("pg");
  const source = req("esbuild").buildSync({
    entryPoints: [
      resolve(
        root,
        "services/commerce/billing/src/repository/pg-wallet-ledger.ts",
      ),
    ],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["@nestjs/common", "pg"],
    logLevel: "silent",
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function("module", "exports", "require", source)(
    module,
    module.exports,
    createRequire(resolve(root, "services/commerce/billing/package.json")),
  );
  const child = spawn(
    "docker",
    ["exec", "-i", container, "nc", "127.0.0.1", "5432"],
    { env, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
  );
  const closed = new Promise((done) => child.once("close", done));
  const wire = Duplex.from({ writable: child.stdin, readable: child.stdout });
  wire.setNoDelay = () => {};
  wire.connect = () => queueMicrotask(() => wire.emit("connect"));
  child.once("error", (error) => wire.destroy(error));
  const client = new Client({
    user: "postgres",
    database,
    host: "127.0.0.1",
    port: 5432,
    ssl: false,
    password: "",
    stream: wire,
    connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    await client.query("SET ROLE platform_svc");
    client.release = () => {};
    const pool = {
      query: (...values) => client.query(...values),
      connect: async () => client,
    };
    await work(new module.exports.PgWalletLedger(pool));
  } finally {
    await client.end();
    child.kill();
    await closed;
  }
}

// ===========================================================================
// Default rollback, exact replay and adversarial failure paths.
// ===========================================================================
test("S05-R3b scoped test-wallet adoption", { timeout: 180000 }, async (t) => {
  let containerId;
  async function check(name, work) {
    await t.test(name, async () => {
      await work();
      report.checks.push({ name, passed: true });
    });
  }
  try {
    containerId = ok(
      command([
        "run",
        "-d",
        "--pull=never",
        "--name",
        container,
        "--label",
        `codex.run=${runId}`,
        "--network",
        "none",
        "--read-only",
        "--tmpfs",
        "/var/lib/postgresql:rw,size=512m",
        "--tmpfs",
        "/var/run/postgresql:rw,size=16m",
        "--tmpfs",
        "/tmp:rw,size=32m",
        "--memory",
        "768m",
        "--cpus",
        "1",
        "-e",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "postgres:18-alpine",
      ]),
    );
    assert.match(containerId, /^[a-f0-9]{64}$/);
    const info = JSON.parse(ok(command(["inspect", containerId])))[0];
    assert.equal(info.Id, containerId);
    assert.equal(info.Name, "/" + container);
    assert.equal(info.Config.Labels["codex.run"], runId);
    assert.equal(info.HostConfig.NetworkMode, "none");
    assert.equal(Object.keys(info.HostConfig.PortBindings ?? {}).length, 0);
    assert.equal(info.Mounts.length, 0);
    assert.equal(info.HostConfig.ReadonlyRootfs, true);
    for (let i = 0; ; i++) {
      if (
        command([
          "exec",
          container,
          "sh",
          "-c",
          'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres',
        ]).status === 0
      )
        break;
      assert.ok(i < 80, "isolated PostgreSQL did not start");
      await setTimeout(250);
    }
    sql(
      `CREATE ROLE ${owner} NOLOGIN NOSUPERUSER; CREATE DATABASE ${database};`,
      "postgres",
    );
    for (const file of readdirSync(resolve(root, "deploy/database/ddl"))
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort())
      sql(read(`deploy/database/ddl/${file}`));
    for (const name of migrationNames)
      sql(read(`deploy/database/migrations/${name}`));
    sql(`GRANT USAGE ON SCHEMA billing TO ${owner}; GRANT TEMP ON DATABASE ${database} TO ${owner};
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA billing TO ${owner};`);
    sql(fixtures);
    const before = originalFacts();

    await check(
      "default dry run validates every constraint and rolls back all adoption rows",
      () => {
        assert.match(ok(apply()), /S05_TEST_WALLET_DRY_RUN_ROLLED_BACK/);
        walletEmpty();
        assert.equal(originalFacts(), before);
      },
    );
    await check("missing target fingerprint refuses the operation", () => {
      denied(apply({ target_sha256: "" }), "S05_ADOPTION_TARGET_MISMATCH");
      walletEmpty();
    });
    await check("wrong target fingerprint refuses the operation", () => {
      denied(
        apply({ target_sha256: "a".repeat(64) }),
        "S05_ADOPTION_TARGET_MISMATCH",
      );
      walletEmpty();
    });
    await check(
      "wrong database is rejected even with its matching fingerprint",
      () => {
        denied(apply({}, "", "postgres"), "S05_ADOPTION_TARGET_MISMATCH");
        walletEmpty();
      },
    );
    await check(
      "runtime and superuser identities cannot execute adoption",
      () => {
        for (const role of ["platform_svc", "postgres"])
          denied(
            command(
              args(database, { target_sha256: target(database, role) }),
              `SET ROLE ${role};\n${adoption}`,
            ),
            "S05_ADOPTION_TARGET_MISMATCH",
          );
        walletEmpty();
      },
    );
    await check(
      "test-data declaration, approval reference and backup hash are mandatory",
      () => {
        for (const variables of [
          { test_data_ack: "" },
          { approval_ref: "" },
          { backup_sha256: "" },
        ])
          denied(apply(variables), "S05_ADOPTION_EVIDENCE_REQUIRED");
        walletEmpty();
      },
    );
    await check(
      "balance, cumulative totals, currency and version drift are rejected",
      () => {
        for (const update of [
          "balance=532.63",
          "total_granted=533.63",
          "total_consumed=2",
          "currency='USD'",
          "version=3",
        ])
          denied(
            apply(
              {},
              `BEGIN; UPDATE billing.credits SET ${update} WHERE id='${credit}';`,
            ),
            "S05_ADOPTION_WALLET_DRIFT",
          );
        denied(
          apply(
            {},
            `BEGIN; UPDATE billing.credits SET currency=NULL WHERE id='${credit}';`,
          ),
          'null value in column "currency"',
        );
        assert.equal(originalFacts(), before);
        walletEmpty();
      },
    );
    await check(
      "source order and payment drift abort without changing historical facts",
      () => {
        denied(
          apply(
            {},
            "BEGIN; UPDATE billing.orders SET leftover_amount=533.63 WHERE id='646ef877-2795-4ed8-a3a9-b2c6ac2f4911';",
          ),
          "S05_ADOPTION_ORDER_OR_PAYMENT_DRIFT",
        );
        denied(
          apply(
            {},
            "BEGIN; UPDATE billing.payments SET pay_source='offline' WHERE id='9a54431d-fda3-41fa-9eb0-08d0ed90f054';",
          ),
          "S05_ADOPTION_ORDER_OR_PAYMENT_DRIFT",
        );
        assert.equal(originalFacts(), before);
        walletEmpty();
      },
    );
    await check(
      "extra historical wallet postings cannot be silently omitted",
      () => {
        denied(
          apply(
            {},
            `BEGIN; INSERT INTO billing.transactions(tenant_id,transaction_no,trade_type,
            amount,balance_before,balance_after,actor_type,actor_id) VALUES
            ('${tenant}','TXN-S05-UNREVIEWED','grant',0.01,532.62,532.63,'customer','${actor}');`,
          ),
          "S05_ADOPTION_TRANSACTION_DRIFT",
        );
        assert.equal(originalFacts(), before);
        walletEmpty();
      },
    );
    await check(
      "partial existing adoption is rejected instead of filled or overwritten",
      () => {
        denied(
          apply(
            {},
            `BEGIN; INSERT INTO billing.wallet_accounts(credit_id) VALUES ('${credit}');`,
          ),
          "S05_ADOPTION_EXISTING_EVIDENCE_MISMATCH",
        );
        assert.equal(originalFacts(), before);
        walletEmpty();
      },
    );
    await check(
      "failure after the credit entry rolls back account, operations, lot and entries",
      () => {
        sql(`CREATE FUNCTION billing.s05_test_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'S05_INJECTED_FAILURE'; END $$;
        CREATE TRIGGER s05_test_failure BEFORE INSERT ON billing.wallet_entries FOR EACH ROW
        WHEN (NEW.entry_type='consume') EXECUTE FUNCTION billing.s05_test_injected_failure();`);
        try {
          denied(apply({ commit_adoption: "yes" }), "S05_INJECTED_FAILURE");
        } finally {
          sql(
            "DROP TRIGGER s05_test_failure ON billing.wallet_entries; DROP FUNCTION billing.s05_test_injected_failure();",
          );
        }
        walletEmpty();
        assert.equal(originalFacts(), before);
      },
    );
    await check(
      "concurrent commits converge to the same original evidence without double posting",
      async () => {
        for (const result of await Promise.all([
          concurrentApply(),
          concurrentApply(),
        ]))
          assert.match(ok(result), /S05_TEST_WALLET_COMMITTED/);
        assert.equal(originalFacts(), before);
        assert.equal(
          sql("SELECT count(*) FROM billing.wallet_operations;"),
          "2",
        );
        assert.equal(sql("SELECT count(*) FROM billing.wallet_entries;"), "2");
        assert.equal(
          sql("SELECT sum(amount)::text FROM billing.wallet_entries;"),
          "532.62",
        );
        assert.equal(
          sql(
            "SELECT count(*) FROM billing.wallet_lots WHERE kind='bonus' AND amount=533.62 AND funding_payment_id IS NULL AND expires_at IS NULL;",
          ),
          "1",
        );
        assert.equal(
          sql(
            "SELECT count(*) FROM billing.wallet_accounts WHERE credit_id<>'b7e90751-7726-4106-bc06-66b040897019';",
          ),
          "0",
        );
      },
    );
    const adopted = walletFacts();
    await check(
      "identical replay preserves every wallet and original row",
      () => {
        assert.match(
          ok(apply({ commit_adoption: "yes" })),
          /S05_TEST_WALLET_COMMITTED/,
        );
        assert.equal(walletFacts(), adopted);
        assert.equal(originalFacts(), before);
      },
    );
    await check(
      "changed approval or backup evidence cannot masquerade as a replay",
      () => {
        denied(
          apply({ commit_adoption: "yes", approval_ref: "different-approval" }),
          "S05_ADOPTION_EXISTING_EVIDENCE_MISMATCH",
        );
        denied(
          apply({ commit_adoption: "yes", backup_sha256: "c".repeat(64) }),
          "S05_ADOPTION_EXISTING_EVIDENCE_MISMATCH",
        );
        assert.equal(walletFacts(), adopted);
        assert.equal(originalFacts(), before);
      },
    );
    await check(
      "adopted balance is usable through the actual wallet repository without becoming principal",
      async () => {
        await withWallet(async (ledger) => {
          const summary = await ledger.summary(tenant);
          assert.equal(summary.status, "ready");
          assert.equal(summary.balance, "532.62");
          assert.equal(summary.bonusBalance, "532.62");
          assert.equal(summary.principalBalance, "0.00");
          const history = await ledger.history(tenant);
          assert.equal(history.total, 2);
          assert.ok(
            history.items.every(
              (item) => item.result.legacyAdoption.cashRefundable === false,
            ),
          );
          const scope = {
            tenantId: tenant,
            currency: "CNY",
            actorType: "customer",
            actorId: actor,
          };
          await assert.rejects(
            ledger.post(scope, {
              action: "principal",
              amountCents: 100,
              paymentId: "9a54431d-fda3-41fa-9eb0-08d0ed90f054",
              idempotencyKey: "s05-no-cash-conversion",
            }),
            /本金必须来自/,
          );
          const posting = await ledger.post(scope, {
            action: "consume",
            amountCents: 100,
            idempotencyKey: "s05-post-adoption",
          });
          assert.equal(posting.balance, "531.62");
          assert.deepEqual(
            await ledger.post(scope, {
              action: "consume",
              amountCents: 100,
              idempotencyKey: "s05-post-adoption",
            }),
            posting,
          );
          assert.equal((await ledger.summary(tenant)).principalBalance, "0.00");
        });
      },
    );
    await check(
      "later wallet activity makes the historical adoption plan stale",
      () => {
        const after = walletFacts(),
          originalAfter = originalFacts();
        denied(apply({ commit_adoption: "yes" }), "S05_ADOPTION_WALLET_DRIFT");
        assert.equal(walletFacts(), after);
        assert.equal(originalFacts(), originalAfter);
      },
    );
    report.status = report.checks.length === 16 ? "passed" : "failed";
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    throw error;
  } finally {
    if (containerId) {
      assert.match(containerId, /^[a-f0-9]{64}$/);
      const info = JSON.parse(ok(command(["inspect", containerId])))[0];
      assert.equal(info.Id, containerId);
      assert.equal(info.Name, "/" + container);
      assert.equal(info.Config.Labels["codex.run"], runId);
      ok(command(["rm", "-f", "--volumes", containerId]));
      assert.equal(
        ok(
          command(["ps", "-aq", "--no-trunc", "--filter", "id=" + containerId]),
        ),
        "",
      );
      report.cleanup = {
        id: containerId,
        name: container,
        runId,
        cleaned: true,
        remaining: false,
      };
      t.diagnostic(
        `VOUCHER_CONTAINER_CLEANUP=${JSON.stringify(report.cleanup)}`,
      );
      report.cleanedUp = true;
    }
    report.finishedAt = new Date().toISOString();
    report.passedChecks = report.checks.length;
    if (!report.cleanedUp) report.status = "failed";
    const output = resolve(
      root,
      "output/voucher-environment",
      `s05-r3b-${runId}`,
    );
    mkdirSync(output, { recursive: true });
    writeFileSync(
      resolve(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    t.diagnostic(`S05_R3B_REPORT=${resolve(output, "report.json")}`);
    assert.equal(report.status, "passed");
  }
});
