/**
 * promotion-ownership.test.mjs - B02/B10/B11 upgrade and recovery rehearsal.
 * @package vxture-platform
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 *
 * Run: node --test deploy/database/verify/promotion-ownership.test.mjs
 * Uses a disposable, network-isolated container from an already installed image.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";

// ===========================================================================
// Isolated PostgreSQL runner: no host ports, mounts, or existing database access.
// ===========================================================================
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runId = randomUUID();
const container = `codex-voucher-b13-${runId.slice(0, 12)}`;
const migrationFiles = [
  "2026-12-09-promotion-ownership-foundation.sql",
  "2026-12-10-wallet-source-ledger.sql",
  "2026-12-11-recharge-card-funding.sql",
  "2026-12-12-payment-source-compatibility.sql",
];
const migrations = migrationFiles.map((name) =>
  read(`deploy/database/migrations/${name}`),
);
const migration = migrations[0];
const roles = [
  "platform_svc",
  "svc_admin_bff",
  "svc_console_bff",
  "svc_platform_api",
];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}
function docker(args, input) {
  return spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
}
function sql(db, source, expectedError) {
  const result = docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      db,
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=verbose",
    ],
    source,
  );
  if (expectedError) {
    assert.notEqual(
      result.status,
      0,
      "expected PostgreSQL to reject the operation",
    );
    assert.match(result.stderr, new RegExp(expectedError));
  } else {
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  }
  return result.stdout.trim();
}
function check(db, source, error) {
  return sql(db, `BEGIN;\n${source}\nROLLBACK;`, error);
}

/** Compare business facts using their original columns, without inferred new links. */
function legacyFacts(db) {
  return JSON.parse(
    sql(
      db,
      `SELECT jsonb_build_object(
    'batches', (SELECT jsonb_agg(to_jsonb(b)-ARRAY['policy_snapshot','claim_until','use_valid_days','per_workspace_limit','per_tenant_limit','reviewed_by','reviewed_at','frozen_at'] ORDER BY id) FROM promotion.voucher_batches b),
    'vouchers', (SELECT jsonb_agg(to_jsonb(v)-ARRAY['assigned_tenant_id','claimed_at','claim_token_digest','claim_key_version','replacement_of_redemption_id','funding_order_id','funding_payment_id'] ORDER BY id) FROM promotion.vouchers v),
    'redemptions', (SELECT jsonb_agg(to_jsonb(r)-ARRAY['reservation_id','order_id','operation_id','principal_wallet_operation_id','bonus_wallet_operation_id'] ORDER BY id) FROM promotion.voucher_redemptions r),
    'refunds', (SELECT jsonb_agg(to_jsonb(r)-'calculation_snapshot' ORDER BY id) FROM billing.refunds r),
    'credits', (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM billing.credits c),
    'transactions', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.transactions t),
    'payments', (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM billing.payments p),
    'invoices', (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM billing.invoices i));`,
    ),
  );
}

/** Compare behavior-bearing catalog definitions and effective service privileges. */
function shape(db) {
  const result = JSON.parse(
    sql(
      db,
      `WITH tables AS (
    SELECT c.oid,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND (n.nspname='promotion' OR (n.nspname='billing' AND
      c.relname IN ('credits','payments','transactions','refunds','refund_allocations','wallet_accounts','wallet_operations','wallet_lots','wallet_entries','wallet_card_allocations')))
  ) SELECT jsonb_build_object(
    'columns', (SELECT jsonb_agg(to_jsonb(x) ORDER BY table_schema,table_name,column_name) FROM (
      SELECT c.table_schema,c.table_name,c.column_name,c.data_type,c.is_nullable,c.column_default,c.character_maximum_length,c.numeric_precision,c.numeric_scale
      FROM information_schema.columns c JOIN tables t ON t.nspname=c.table_schema AND t.relname=c.table_name) x),
    'constraints', (SELECT jsonb_agg(jsonb_build_array(t.nspname,t.relname,c.conname,pg_get_constraintdef(c.oid)) ORDER BY t.nspname,t.relname,c.conname) FROM pg_constraint c JOIN tables t ON t.oid=c.conrelid),
    'indexes', (SELECT jsonb_agg(jsonb_build_array(i.schemaname,i.tablename,i.indexname,i.indexdef) ORDER BY i.schemaname,i.tablename,i.indexname) FROM pg_indexes i JOIN tables t ON t.nspname=i.schemaname AND t.relname=i.tablename),
    'triggers', (SELECT jsonb_agg(jsonb_build_array(t.nspname,t.relname,g.tgname,pg_get_triggerdef(g.oid),g.tgenabled) ORDER BY t.nspname,t.relname,g.tgname) FROM pg_trigger g JOIN tables t ON t.oid=g.tgrelid WHERE NOT g.tgisinternal),
    'functions', (SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_functiondef(p.oid),p.prosecdef,p.proconfig) ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='billing' AND p.proname IN ('reject_wallet_mutation','check_wallet_balance','check_wallet_funding_capacity','guard_wallet_card_transition','check_wallet_card_evidence','check_card_redemption_evidence')),
    'table_privileges', (SELECT jsonb_agg(jsonb_build_array(r.rolname,t.nspname,t.relname,a.privilege,has_table_privilege(r.oid,t.oid,a.privilege)) ORDER BY r.rolname,t.nspname,t.relname,a.privilege) FROM tables t CROSS JOIN pg_roles r CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE')) a(privilege) WHERE r.rolname IN ('platform_svc','svc_admin_bff','svc_console_bff','svc_platform_api','svc_auth_bff','reporting_ro')),
    'column_updates', (SELECT jsonb_agg(jsonb_build_array(r.rolname,t.nspname,t.relname,a.attname,has_column_privilege(r.oid,t.oid,a.attnum,'UPDATE')) ORDER BY r.rolname,t.nspname,t.relname,a.attname) FROM tables t JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped CROSS JOIN pg_roles r WHERE r.rolname IN ('platform_svc','svc_admin_bff','svc_console_bff','svc_platform_api','svc_auth_bff','reporting_ro')));`,
    ),
  );
  // PG18 dump/restore pushes a varchar[] -> text[] cast onto each constant.
  // Canonicalize only that equivalent rewrite, retaining every literal and cast.
  result.constraints = result.constraints.map(
    ([schema, table, name, definition]) => [
      schema,
      table,
      name,
      definition.replace(
        /\(ARRAY\[((?:'(?:''|[^'])*'::character varying)(?:, '(?:''|[^'])*'::character varying)*)\]\)::text\[\]/g,
        (_match, values) =>
          `ARRAY[${values.replace(/('(?:''|[^'])*'::character varying)/g, "($1)::text")}]`,
      ),
    ],
  );
  return result;
}

/** Snapshot all append-only wallet evidence, not only the aggregate balance. */
function walletFacts(db) {
  return JSON.parse(
    sql(
      db,
      "SELECT jsonb_build_object('accounts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY credit_id) FROM billing.wallet_accounts a),'operations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM billing.wallet_operations o),'lots',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM billing.wallet_lots l),'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM billing.wallet_entries e),'cards',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM billing.wallet_card_allocations c));",
    ),
  );
}

/** Preserve PostgreSQL's own backup format and restore only into a new test database. */
function dump(db) {
  const result = docker([
    "exec",
    container,
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    db,
    "--no-owner",
    "--no-comments",
  ]);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

/** Exercise a real competing DDL lock; release only this test's named session. */
async function blockedExpansion() {
  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "upgraded",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] },
  );
  const closed = new Promise((resolve) => {
    child.once("error", () => resolve());
    child.once("close", () => resolve());
  });
  child.stdin.on("error", () => {});
  child.stdin.end(
    "SET application_name='b13-ddl-lock';BEGIN;LOCK TABLE promotion.voucher_batches IN ACCESS EXCLUSIVE MODE;SELECT pg_sleep(30);ROLLBACK;",
  );
  try {
    let locked = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      locked =
        sql(
          "upgraded",
          "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='b13-ddl-lock' AND l.granted AND l.mode='AccessExclusiveLock';",
        ) === "1";
      if (locked) break;
      await setTimeout(100);
    }
    assert.ok(locked, "competing DDL lock did not become visible");
    sql("upgraded", migration, "55P03");
  } finally {
    sql(
      "upgraded",
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='b13-ddl-lock' AND datname=current_database();",
    );
    await closed;
  }
  assert.equal(
    sql(
      "upgraded",
      "SELECT count(*) FROM information_schema.columns WHERE table_schema='billing' AND table_name='refunds' AND column_name='calculation_snapshot';",
    ),
    "0",
  );
  assert.equal(
    sql(
      "upgraded",
      "SELECT to_regclass('promotion.voucher_operations') IS NULL;",
    ),
    "t",
  );
}

// ===========================================================================
// Fixtures exercise legacy rows with no new ownership columns populated.
// ===========================================================================
const fixtures = `
INSERT INTO account.users (id, account, phone, phone_verified_at)
  VALUES ('${id(1)}', 'promotion-b02', '+8613900001234', now());
INSERT INTO tenancy.tenants (id, name, type, owner_user_id)
  VALUES ('${id(2)}', 'Promotion QA', 'organization', '${id(1)}');
INSERT INTO tenancy.workspaces (id, tenant_id, name)
  VALUES ('${id(3)}', '${id(2)}', 'Promotion QA');
INSERT INTO product.products (id, product_code, product_name, product_type, status)
  VALUES ('${id(4)}', 'promotion-b02', 'Promotion QA', 'agent', 'active');
INSERT INTO product.plans (id, plan_code, plan_name)
  VALUES ('${id(5)}', 'promotion-b02', 'Promotion QA');
INSERT INTO product.plan_versions (id, plan_id, version_no)
  VALUES ('${id(6)}', '${id(5)}', 1);
INSERT INTO billing.orders (id, order_no, tenant_id, workspace_id, product_id, plan_version_id,
  intent, cycle_unit, list_amount, payable_amount, created_by_type)
  VALUES ('${id(7)}', 'ORD-B02', '${id(2)}', '${id(3)}', '${id(4)}', '${id(6)}',
    'new', 'month', 100, 100, 'customer');
INSERT INTO billing.invoices (id, tenant_id, bill_no, order_id, bill_cycle, cycle_start_date,
  cycle_end_date, created_by_type) VALUES
  ('${id(8)}', '${id(2)}', 'INV-B02', '${id(7)}', '202611', '2026-11-01', '2026-12-01', 'customer');
INSERT INTO billing.payments (id, tenant_id, bill_id, pay_order_no, total_amount, paid_amount, pay_status,
  channel_raw_data) VALUES ('${id(9)}', '${id(2)}', '${id(8)}', 'PAY-B02', 100, 100, 'pending_verify',
  '{"settlement":{"discountVoucherId":"${id(11)}","released":false}}');
INSERT INTO promotion.voucher_batches (id, kind, name, effect, total_count, valid_from, valid_until)
  VALUES ('${id(10)}', 'discount', 'Legacy QA', '{"discount_type":"fixed","value":100}', 10,
    '2026-01-01', '2027-01-01');
INSERT INTO promotion.vouchers (id, batch_id, code, status, assigned_user_id, used_count)
  VALUES ('${id(11)}', '${id(10)}', 'QA-RESERVED', 'reserved', '${id(1)}', 1),
         ('${id(12)}', '${id(10)}', 'QA-REDEEMED', 'redeemed', '${id(1)}', 1);
INSERT INTO promotion.voucher_redemptions (id, redemption_no, voucher_id, tenant_id,
  workspace_id, user_id, kind, effect_snapshot)
  VALUES ('${id(13)}', 'VR-B02', '${id(12)}', '${id(2)}', '${id(3)}', '${id(1)}', 'discount', '{}');
INSERT INTO billing.refunds (id, tenant_id, bill_id, pay_record_id, order_id, refund_no,
  refund_amount, created_by_type, created_by_id) VALUES
  ('${id(14)}','${id(2)}','${id(8)}','${id(9)}','${id(7)}','RF-B02',10,'customer','${id(1)}');
`;
const operation = `INSERT INTO promotion.voucher_operations (id, actor_realm, actor_id,
  operation_type, idempotency_key, request_hash, result)
  VALUES ('${id(20)}','customer','${id(1)}','reserve','key-1','hash-1','{}');`;
const allocation = `INSERT INTO billing.refund_allocations (id,refund_id,payment_id,currency,amount)
  VALUES ('${id(30)}','${id(14)}','${id(9)}','CNY',10);`;
const compensation = `INSERT INTO promotion.voucher_compensations (id,redemption_id,order_id,
  refund_id,compensation_type,amount_cents,policy_snapshot,reason)
  VALUES ('${id(31)}','${id(13)}','${id(7)}','${id(14)}','refund_replacement',1000,'{}','refund');`;
const reservation = `INSERT INTO promotion.voucher_reservations (id, voucher_id, order_id,
  invoice_id, tenant_id, workspace_id, user_id, operation_id, effect_snapshot, policy_snapshot)
  VALUES ('${id(21)}','${id(11)}','${id(7)}','${id(8)}','${id(2)}','${id(3)}','${id(1)}','${id(20)}','{}','{}');`;
const event = `INSERT INTO promotion.voucher_events (operation_id, batch_id, voucher_id,
  reservation_id, event_type, actor_realm, actor_id)
  VALUES ('${id(20)}','${id(10)}','${id(11)}','${id(21)}','reserved','customer','${id(1)}');`;

// ===========================================================================
// New facts after upgrade use real service roles and a proven cash source.
// ===========================================================================
const walletPosting = `BEGIN; SET LOCAL ROLE svc_console_bff;
INSERT INTO billing.wallet_accounts(credit_id) VALUES('${id(111)}');
INSERT INTO billing.transactions(id,tenant_id,transaction_no,trade_type,source_method,amount,balance_before,balance_after,actor_type,actor_id) VALUES
 ('${id(152)}','${id(100)}','TXN-B13-PRINCIPAL','recharge','recharge_card',30,0,30,'customer','${id(1)}'),
 ('${id(153)}','${id(100)}','TXN-B13-BONUS','grant','operator',5,30,35,'customer','${id(1)}');
INSERT INTO billing.wallet_operations(id,credit_id,idempotency_key,request_hash,action,actor_type,actor_id,transaction_id,result) VALUES
 ('${id(150)}','${id(111)}','b13-principal','hash-principal','principal','customer','${id(1)}','${id(152)}','{}'),
 ('${id(100151)}','${id(111)}','b13-bonus','hash-bonus','bonus','customer','${id(1)}','${id(153)}','{}');
INSERT INTO billing.wallet_lots(id,credit_id,operation_id,kind,amount,funding_payment_id,expires_at) VALUES
 ('${id(154)}','${id(111)}','${id(150)}','principal',30,'${id(142)}',NULL),
 ('${id(100155)}','${id(111)}','${id(100151)}','bonus',5,NULL,'2030-01-01');
INSERT INTO billing.wallet_entries(id,operation_id,lot_id,entry_type,amount) VALUES
 ('${id(156)}','${id(150)}','${id(154)}','credit',30),
 ('${id(157)}','${id(100151)}','${id(100155)}','credit',5);
UPDATE billing.credits SET balance=35,total_granted=35,version=2 WHERE id='${id(111)}';
COMMIT;`;
const cardReservation = `BEGIN; SET LOCAL ROLE svc_admin_bff;
INSERT INTO promotion.voucher_batches(id,tenant_id,kind,name,effect,total_count,issued_count,valid_from,valid_until)
 VALUES('${id(159)}','${id(100)}','recharge_card','B13 funded card','{"face_value_cents":2000,"bonus_cents":0}',1,1,'2026-01-01','2030-01-01');
INSERT INTO promotion.vouchers(id,batch_id,code,funding_payment_id)
 VALUES('${id(160)}','${id(159)}','B13-FUNDED','${id(142)}');
INSERT INTO billing.wallet_card_allocations(id,voucher_id,payment_id,amount)
 VALUES('${id(161)}','${id(160)}','${id(142)}',20);
COMMIT;`;

// ===========================================================================
// End-to-end baseline, upgrade, replay, constraints and privilege assertions.
// ===========================================================================
test(
  "B13 voucher upgrade and recovery on PostgreSQL 18",
  { timeout: 480000 },
  async (t) => {
    let containerId;
    try {
      const run = docker([
        "run",
        "--detach",
        "--pull=never",
        "--network=none",
        "--name",
        container,
        "--label",
        `codex.run=${runId}`,
        "-e",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "postgres:18-alpine",
      ]);
      assert.equal(run.status, 0, run.stderr || run.error?.message);
      containerId = run.stdout.trim();
      assert.match(containerId, /^[a-f0-9]{64}$/);
      const created = JSON.parse(docker(["inspect", containerId]).stdout)[0];
      assert.equal(created.Id, containerId);
      assert.equal(created.Name, "/" + container);
      assert.equal(created.Config.Labels["codex.run"], runId);
      assert.equal(created.HostConfig.NetworkMode, "none");
      assert.equal(
        Object.keys(created.HostConfig.PortBindings ?? {}).length,
        0,
      );
      t.diagnostic(
        `VOUCHER_CONTAINER_OWNERSHIP=${JSON.stringify({ id: containerId, name: container, runId })}`,
      );
      t.diagnostic(`B13_CONTAINER_CREATED=${container}`);
      let ready = false;
      for (let n = 0; n < 60; n++) {
        if (
          docker(["exec", container, "pg_isready", "-U", "postgres"]).status ===
          0
        ) {
          ready = true;
          break;
        }
        await setTimeout(500);
      }
      assert.ok(ready, "temporary PostgreSQL did not become ready");
      sql("postgres", "CREATE DATABASE baseline; CREATE DATABASE upgraded;");
      const files = readdirSync(resolve(root, "deploy/database/ddl"))
        .filter((f) => /^\d+_.*\.sql$/.test(f))
        .sort();
      for (const db of ["baseline", "upgraded"]) {
        for (const file of files) {
          let source = read(`deploy/database/ddl/${file}`);
          if (db === "upgraded") {
            if (file === "53_wallet.sql" || file === "54_wallet_cards.sql")
              continue;
            if (file === "52_billing.sql") {
              source = source
                .split("-- B02 refund allocation foundation:")[0]
                .replace(/^    calculation_snapshot jsonb,\r?\n/m, "")
                .replace(
                  /^    CONSTRAINT chk_refunds_calculation_object[^\n]*\n/m,
                  "",
                );
            }
            if (file === "56_promotion.sql")
              source = read(
                "deploy/database/verify/fixtures/promotion-before-ownership.sql",
              );
            if (file === "90_cross_schema_fk.sql")
              source = source.split("-- Promotion B02 expansion:")[0];
            if (file === "98_column_locks.sql") continue;
          }
          sql(db, source);
        }
        sql(db, fixtures);
      }
      sql(
        "upgraded",
        read("deploy/database/verify/fixtures/voucher-migration-legacy.sql"),
      );
      const before = legacyFacts("upgraded");
      const beforeShape = shape("upgraded");
      const backup = dump("upgraded");
      await t.test(
        "locked expansion aborts atomically without partial columns",
        blockedExpansion,
      );
      await t.test(
        "B02 then B10 then B11 and S05 compatibility upgrade and replay twice",
        () => {
          for (let replay = 0; replay < 2; replay++)
            for (const source of migrations) sql("upgraded", source);
          sql("upgraded", read("deploy/database/ddl/98_column_locks.sql"));
          for (const source of migrations) sql("baseline", source);
        },
      );
      await t.test(
        "legacy facts survive without fabricated ownership or audit history",
        () => {
          assert.deepEqual(legacyFacts("upgraded"), before);
          assert.equal(
            sql(
              "upgraded",
              `SELECT
        (SELECT count(*) FROM promotion.voucher_operations) +
        (SELECT count(*) FROM promotion.voucher_reservations) +
        (SELECT count(*) FROM promotion.voucher_events) +
        (SELECT count(*) FROM promotion.voucher_compensations) +
        (SELECT count(*) FROM billing.refund_allocations) +
        (SELECT count(*) FROM billing.wallet_accounts) +
        (SELECT count(*) FROM billing.wallet_operations) +
        (SELECT count(*) FROM billing.wallet_lots) +
        (SELECT count(*) FROM billing.wallet_entries) +
        (SELECT count(*) FROM billing.wallet_card_allocations);`,
            ),
            "0",
          );
          assert.equal(
            sql(
              "upgraded",
              "SELECT count(*) FROM promotion.vouchers WHERE assigned_tenant_id IS NOT NULL;",
            ),
            "0",
          );
        },
      );
      await t.test("fresh baseline and migrated schema match", () => {
        assert.deepEqual(shape("upgraded"), shape("baseline"));
      });
      await t.test(
        "balance refund channel remains valid after the voucher upgrade",
        () => {
          for (const database of ["baseline", "upgraded"])
            assert.equal(
              check(
                database,
                `UPDATE billing.refunds SET transfer_channel='balance' WHERE id='${id(14)}';
                 SELECT transfer_channel FROM billing.refunds WHERE id='${id(14)}';`,
              ),
              "balance",
            );
          assert.deepEqual(legacyFacts("upgraded"), before);
        },
      );
      await t.test(
        "S05 compatibility widens a three-source constraint and replays without changing rows",
        () => {
          sql("postgres", "CREATE DATABASE source_compat;");
          sql(
            "source_compat",
            `CREATE SCHEMA billing; CREATE TABLE billing.payments(id int PRIMARY KEY, pay_source varchar(32), CONSTRAINT chk_payments_pay_source CHECK(pay_source IN ('online','offline','voucher'))); INSERT INTO billing.payments VALUES(1,'offline');`,
          );
          const source = migrations.at(-1);
          sql("source_compat", source);
          sql(
            "source_compat",
            "INSERT INTO billing.payments VALUES(2,'balance');",
          );
          const before = sql(
            "source_compat",
            "SELECT jsonb_agg(p ORDER BY id) FROM billing.payments p;",
          );
          sql("source_compat", source);
          sql("source_compat", source);
          assert.equal(
            sql(
              "source_compat",
              "SELECT jsonb_agg(p ORDER BY id) FROM billing.payments p;",
            ),
            before,
          );
          sql(
            "source_compat",
            "INSERT INTO billing.payments VALUES(3,'unknown');",
            "23514",
          );
          assert.equal(
            sql(
              "upgraded",
              `SELECT balance::text FROM billing.credits WHERE id='${id(100151)}';`,
            ),
            "532.62",
          );
          assert.equal(
            sql(
              "upgraded",
              `SELECT pay_source||':'||paid_amount::text FROM billing.payments WHERE id='${id(100155)}';`,
            ),
            "balance:1.00",
          );
        },
      );
      await t.test(
        "S05 compatibility rolls back the constraint replacement on unknown historical values",
        () => {
          sql("postgres", "CREATE DATABASE source_unknown;");
          sql(
            "source_unknown",
            `CREATE SCHEMA billing; CREATE TABLE billing.payments(id int PRIMARY KEY,pay_source varchar(32),CONSTRAINT chk_payments_pay_source CHECK(pay_source IN ('offline','custom'))); INSERT INTO billing.payments VALUES(1,'custom');`,
          );
          const before = sql(
            "source_unknown",
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='chk_payments_pay_source';",
          );
          sql("source_unknown", migrations.at(-1), "23514");
          assert.equal(
            sql(
              "source_unknown",
              "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='chk_payments_pay_source';",
            ),
            before,
          );
          assert.equal(
            sql("source_unknown", "SELECT pay_source FROM billing.payments;"),
            "custom",
          );
        },
      );
      await t.test(
        "pre-upgrade backup restores original facts and schema into a separate database",
        () => {
          sql("postgres", "CREATE DATABASE recovered;");
          sql("recovered", backup);
          assert.deepEqual(legacyFacts("recovered"), before);
          assert.deepEqual(shape("recovered"), beforeShape);
          assert.equal(
            sql(
              "recovered",
              "SELECT to_regclass('billing.wallet_accounts') IS NULL;",
            ),
            "t",
          );
        },
      );
      await t.test(
        "read-only adoption reports preserve ambiguous ownership and money",
        () => {
          const adoptionBefore = legacyFacts("upgraded");
          const wallet = sql(
            "upgraded",
            read("deploy/database/verify/wallet-source-preflight.sql"),
          );
          assert.match(wallet, /zero_balance_can_activate/);
          assert.match(wallet, /manual_source_reconciliation_required/);
          const cards = sql(
            "upgraded",
            read("deploy/database/verify/recharge-card-preflight.sql"),
          );
          assert.match(cards, /B13 legacy cards/);
          assert.match(cards, /\|3\|3\|1/);
          assert.deepEqual(legacyFacts("upgraded"), adoptionBefore);
        },
      );
      await t.test(
        "replay repairs an interrupted concurrent index build",
        () => {
          sql(
            "upgraded",
            `DROP INDEX promotion.uidx_vouchers_claim_digest; UPDATE promotion.vouchers SET claim_token_digest='duplicate',claim_key_version='v1' WHERE batch_id='${id(10)}';`,
          );
          sql(
            "upgraded",
            "CREATE UNIQUE INDEX CONCURRENTLY uidx_vouchers_claim_digest ON promotion.vouchers (claim_token_digest) WHERE claim_token_digest IS NOT NULL;",
            "23505",
          );
          assert.equal(
            sql(
              "upgraded",
              "SELECT indisvalid FROM pg_index WHERE indexrelid='promotion.uidx_vouchers_claim_digest'::regclass;",
            ),
            "f",
          );
          sql(
            "upgraded",
            `UPDATE promotion.vouchers SET claim_token_digest=NULL,claim_key_version=NULL WHERE batch_id='${id(10)}';`,
          );
          sql("upgraded", migration);
          assert.equal(
            sql(
              "upgraded",
              "SELECT indisvalid FROM pg_index WHERE indexrelid='promotion.uidx_vouchers_claim_digest'::regclass;",
            ),
            "t",
          );
        },
      );
      for (const db of ["baseline", "upgraded"]) {
        await t.test(`${db}: legacy defaults and draft batches coexist`, () => {
          assert.equal(
            sql(
              db,
              `SELECT status FROM promotion.voucher_batches WHERE id='${id(10)}';`,
            ),
            "active",
          );
          check(db, `UPDATE promotion.voucher_batches SET status='draft';`);
        });
        for (const assignment of [
          "use_valid_days=0",
          "per_workspace_limit=-1",
          "per_tenant_limit=0",
          "claim_until=valid_from",
          "claim_until=valid_until+interval '1 second'",
          "reviewed_by=gen_random_uuid()",
          "policy_snapshot='[]'",
        ]) {
          await t.test(`${db}: rejects batch ${assignment}`, () => {
            check(
              db,
              `UPDATE promotion.voucher_batches SET ${assignment};`,
              "23514",
            );
          });
        }
        await t.test(
          `${db}: claim credentials require a pair and unique digest`,
          () => {
            check(
              db,
              "UPDATE promotion.vouchers SET claim_token_digest='digest';",
              "23514",
            );
            check(
              db,
              "UPDATE promotion.vouchers SET claim_token_digest='digest',claim_key_version='v1';",
              "23505",
            );
          },
        );
        await t.test(
          `${db}: request key is unique within actor realm and operation`,
          () => {
            check(db, operation + operation.replace(id(20), id(22)), "23505");
            check(
              db,
              operation +
                operation
                  .replace(id(20), id(22))
                  .replace("'customer'", "'operator'"),
            );
            check(db, operation.replace("'customer'", "'unknown'"), "23514");
          },
        );
        await t.test(`${db}: one active reservation per voucher`, () => {
          check(
            db,
            operation +
              reservation +
              operation.replace(id(20), id(22)).replace("key-1", "key-2") +
              reservation.replace(id(21), id(23)).replace(id(20), id(22)),
            "23505",
          );
        });
        await t.test(
          `${db}: new operation may reserve after release; same operation may not`,
          () => {
            const release =
              "UPDATE promotion.voucher_reservations SET status='released',released_at=now(),release_reason='rejected';";
            check(
              db,
              operation +
                reservation +
                release +
                operation.replace(id(20), id(22)).replace("key-1", "key-2") +
                reservation.replace(id(21), id(23)).replace(id(20), id(22)),
            );
            check(
              db,
              operation +
                reservation +
                release +
                reservation.replace(id(21), id(23)),
              "23505",
            );
          },
        );
        for (const assignment of [
          "status='consumed'",
          "status='released',released_at=now()",
          "status='active',consumed_at=now()",
          "status='consumed',consumed_at=now(),released_at=now()",
          "status='released',released_at=reserved_at-interval '1 second',release_reason='rejected'",
        ]) {
          await t.test(`${db}: terminal state enforces ${assignment}`, () => {
            check(
              db,
              operation +
                reservation +
                `UPDATE promotion.voucher_reservations SET ${assignment};`,
              "23514",
            );
          });
        }
        for (const column of [
          "voucher_id",
          "order_id",
          "invoice_id",
          "declaration_payment_id",
          "tenant_id",
          "workspace_id",
          "user_id",
          "operation_id",
        ]) {
          await t.test(`${db}: reservation ${column} has a real FK`, () => {
            check(
              db,
              operation +
                reservation +
                `UPDATE promotion.voucher_reservations SET ${column}='${id(999)}';`,
              "23503",
            );
          });
        }
        await t.test(`${db}: one redemption per explicit reservation`, () => {
          check(
            db,
            operation +
              reservation +
              `UPDATE promotion.voucher_redemptions SET reservation_id='${id(21)}';
           INSERT INTO promotion.voucher_redemptions (redemption_no,voucher_id,tenant_id,workspace_id,user_id,kind,effect_snapshot,reservation_id)
           SELECT 'VR-DUP',voucher_id,tenant_id,workspace_id,user_id,kind,effect_snapshot,reservation_id FROM promotion.voucher_redemptions;`,
            "23505",
          );
        });
        for (const role of roles) {
          await t.test(
            `${db}: ${role} cannot rewrite receipts, events or ownership`,
            () => {
              for (const action of [
                "UPDATE promotion.voucher_operations SET result='{}';",
                "DELETE FROM promotion.voucher_operations;",
                "UPDATE promotion.voucher_events SET reason='changed';",
                "DELETE FROM promotion.voucher_events;",
                "UPDATE promotion.voucher_reservations SET order_id=order_id;",
                "DELETE FROM promotion.voucher_reservations;",
              ]) {
                check(
                  db,
                  operation +
                    reservation +
                    event +
                    `SET LOCAL ROLE ${role}; ${action}`,
                  "42501",
                );
              }
              check(
                db,
                operation +
                  reservation +
                  event +
                  `SET LOCAL ROLE ${role};
            UPDATE promotion.voucher_reservations SET status='released',released_at=now(),release_reason='rejected';`,
              );
            },
          );
        }
        await t.test(
          `${db}: reporting role can read but cannot create audit records`,
          () => {
            check(
              db,
              "SET LOCAL ROLE reporting_ro; SELECT * FROM promotion.voucher_events;",
            );
            check(db, `SET LOCAL ROLE reporting_ro; ${operation}`, "42501");
          },
        );
        await t.test(
          `${db}: refund allocations preserve source uniqueness and positive value`,
          () => {
            check(db, allocation + allocation.replace(id(30), id(32)), "23505");
            check(db, allocation.replace("'CNY',10", "'CNY',0"), "23514");
            check(
              db,
              allocation +
                "UPDATE billing.refund_allocations SET status='unknown';",
              "23514",
            );
            check(db, allocation.replace(id(9), id(999)), "23503");
            check(db, allocation.replace(id(14), id(999)), "23503");
          },
        );
        await t.test(
          `${db}: compensation has one durable intention per redemption`,
          () => {
            check(
              db,
              compensation + compensation.replace(id(31), id(32)),
              "23505",
            );
            check(db, compensation.replace(",1000,", ",-1,"), "23514");
            check(
              db,
              compensation.replace("'refund_replacement'", "'cash'"),
              "23514",
            );
            check(db, compensation.replace(id(7), id(999)), "23503");
            check(db, compensation.replace(id(14), id(999)), "23503");
            check(
              db,
              compensation +
                `UPDATE promotion.voucher_compensations SET replacement_voucher_id='${id(11)}';`,
              "23514",
            );
            check(
              db,
              compensation +
                "UPDATE promotion.voucher_compensations SET status='completed',amount_cents=0;",
            );
          },
        );
        for (const role of roles) {
          await t.test(
            `${db}: ${role} cannot rewrite financial source facts`,
            () => {
              for (const action of [
                "UPDATE billing.refund_allocations SET amount=20;",
                "DELETE FROM billing.refund_allocations;",
                "UPDATE promotion.voucher_compensations SET amount_cents=2000;",
                "DELETE FROM promotion.voucher_compensations;",
                "UPDATE billing.refunds SET calculation_snapshot='{}';",
              ]) {
                check(
                  db,
                  allocation +
                    compensation +
                    `SET LOCAL ROLE ${role}; ${action}`,
                  "42501",
                );
              }
              check(
                db,
                allocation +
                  compensation +
                  `SET LOCAL ROLE ${role};
              UPDATE billing.refund_allocations SET status='released',updated_at=now();
              UPDATE promotion.voucher_compensations SET status='manual_required',reason='requires review';`,
              );
            },
          );
        }

        await t.test(
          `${db}: preflight lists ambiguous legacy facts without writes`,
          () => {
            const output = sql(
              db,
              read("deploy/database/verify/promotion-ownership-preflight.sql"),
            );
            assert.match(output, /user_requires_explicit_tenant_selection/);
            assert.match(output, /requires_locked_financial_validation/);
            assert.equal(
              sql(db, "SELECT count(*) FROM promotion.voucher_reservations;"),
              "0",
            );
          },
        );
      }

      // =====================================================================
      // A replay must also preserve populated ledgers, guards and service grants.
      // =====================================================================
      await t.test(
        "unclassified positive and negative balances cannot activate",
        () => {
          for (const credit of [110, 112])
            sql(
              "upgraded",
              `BEGIN; SET LOCAL ROLE svc_console_bff; INSERT INTO billing.wallet_accounts(credit_id) VALUES('${id(credit)}'); COMMIT;`,
              "23514",
            );
        },
      );
      await t.test(
        "upgraded roles post principal and bonus and reserve a funded card",
        () => {
          sql("upgraded", walletPosting);
          sql("upgraded", cardReservation);
          assert.equal(
            sql(
              "upgraded",
              `SELECT balance FROM billing.credits WHERE id='${id(111)}';`,
            ),
            "35.00",
          );
          assert.equal(
            sql(
              "upgraded",
              `SELECT count(*) FROM billing.payments WHERE id='${id(142)}';`,
            ),
            "1",
          );
        },
      );
      await t.test(
        "populated B02/B10/B11 replay changes neither facts nor final guards",
        () => {
          const populated = legacyFacts("upgraded");
          const wallet = walletFacts("upgraded");
          const definitions = shape("upgraded");
          for (const source of migrations) sql("upgraded", source);
          sql("upgraded", read("deploy/database/ddl/98_column_locks.sql"));
          assert.deepEqual(legacyFacts("upgraded"), populated);
          assert.deepEqual(walletFacts("upgraded"), wallet);
          assert.deepEqual(shape("upgraded"), definitions);
        },
      );
      await t.test(
        "replayed B11 still counts both card reservations and wallet lots",
        () => {
          sql(
            "upgraded",
            `BEGIN; INSERT INTO billing.wallet_card_allocations(voucher_id,payment_id,amount) VALUES('${id(121)}','${id(142)}',80); COMMIT;`,
            "cash source already allocated to card, wallet or refund",
          );
        },
      );
      await t.test(
        "activated wallets reject unexplained balance changes at commit",
        () => {
          sql(
            "upgraded",
            `BEGIN; SET LOCAL ROLE svc_console_bff; UPDATE billing.credits SET balance=36 WHERE id='${id(111)}'; COMMIT;`,
            "23514",
          );
        },
      );
      await t.test(
        "historical principal cards cannot acquire invented claim evidence",
        () => {
          sql(
            "upgraded",
            `BEGIN; UPDATE promotion.vouchers SET claimed_at=now() WHERE id='${id(121)}'; COMMIT;`,
            "principal card requires a cash allocation",
          );
        },
      );
      for (const role of roles) {
        await t.test(
          `${role}: replay retains immutable wallet and cash source evidence`,
          () => {
            for (const table of [
              "wallet_accounts",
              "wallet_operations",
              "wallet_lots",
              "wallet_entries",
            ])
              check(
                "upgraded",
                `SET LOCAL ROLE ${role}; DELETE FROM billing.${table};`,
                "42501",
              );
            check(
              "upgraded",
              `SET LOCAL ROLE ${role}; UPDATE billing.wallet_card_allocations SET amount=21;`,
              "42501",
            );
            check(
              "upgraded",
              `SET LOCAL ROLE ${role}; DELETE FROM billing.wallet_card_allocations;`,
              "42501",
            );
          },
        );
      }
      await t.test(
        "owner writes cannot bypass immutable wallet evidence",
        () => {
          for (const table of [
            "wallet_accounts",
            "wallet_operations",
            "wallet_lots",
            "wallet_entries",
          ])
            check("upgraded", `DELETE FROM billing.${table};`, "23001");
          check(
            "upgraded",
            "UPDATE billing.wallet_card_allocations SET amount=21;",
            "23001",
          );
        },
      );
      await t.test(
        "post-upgrade backup restores populated wallet evidence and privileges",
        () => {
          const populatedBackup = dump("upgraded");
          sql("postgres", "CREATE DATABASE restored;");
          sql("restored", populatedBackup);
          assert.deepEqual(legacyFacts("restored"), legacyFacts("upgraded"));
          assert.deepEqual(walletFacts("restored"), walletFacts("upgraded"));
          assert.deepEqual(shape("restored"), shape("upgraded"));
          assert.equal(
            sql(
              "restored",
              `SELECT balance FROM billing.credits WHERE id='${id(111)}';`,
            ),
            "35.00",
          );
          sql(
            "restored",
            `BEGIN; UPDATE billing.credits SET balance=36 WHERE id='${id(111)}'; COMMIT;`,
            "23514",
          );
        },
      );
    } finally {
      if (containerId) {
        assert.match(containerId, /^[a-f0-9]{64}$/);
        const inspected = docker(["inspect", containerId]);
        assert.equal(inspected.status, 0, inspected.stderr);
        const info = JSON.parse(inspected.stdout)[0];
        assert.equal(info.Id, containerId);
        assert.equal(info.Name, "/" + container);
        assert.equal(info.Config.Labels["codex.run"], runId);
        const cleanup = docker(["rm", "--force", "--volumes", containerId]);
        assert.equal(cleanup.status, 0, cleanup.stderr);
        const remaining = docker([
          "ps",
          "-aq",
          "--no-trunc",
          "--filter",
          "id=" + containerId,
        ]);
        assert.equal(remaining.status, 0, remaining.stderr);
        assert.equal(remaining.stdout.trim(), "");
        t.diagnostic(
          `VOUCHER_CONTAINER_CLEANUP=${JSON.stringify({ id: containerId, name: container, runId, cleaned: true, remaining: false })}`,
        );
        t.diagnostic(`B13_CONTAINER_CLEANED=${container}`);
      }
    }
  },
);
