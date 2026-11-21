/**
 * migration-channel.test.mjs - Full history replay and cutover gates on private PostgreSQL.
 * @package @vxture/repo
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Duplex } from "node:stream";
import {
  readdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";

// ===========================================================================
// Never inherit connection strings or connect to an existing Docker network.
// ===========================================================================
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runId = randomUUID();
const container = `codex-voucher-s04-${runId.slice(0, 12)}`;
const env = { NODE_ENV: "test", TZ: "UTC", LC_ALL: "C" };
for (const [key, value] of Object.entries(process.env))
  if (
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata)$/i.test(
      key,
    )
  )
    env[key] = value;
const bash =
  process.platform === "win32"
    ? [
        "D:/Program Files/Git/bin/bash.exe",
        "C:/Program Files/Git/bin/bash.exe",
      ].find(existsSync)
    : "bash";
assert.ok(
  bash,
  "Git Bash is required for the real migration planner on Windows",
);
const read = (path) => readFileSync(resolve(root, path), "utf8");
function command(program, args, input, timeout = 60000, extraEnv = {}) {
  return spawnSync(program, args, {
    cwd: root,
    env: { ...env, ...extraEnv },
    input,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}
function docker(args, input) {
  return command("docker", args, input);
}
function ok(result) {
  assert.equal(
    result.status,
    0,
    (result.stderr.slice(-12000) + "\n" + result.stdout.slice(-6000)).trim() ||
      result.error?.message,
  );
  return result.stdout.trim();
}
function sql(db, input, extra = []) {
  return docker(
    [
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
      ...extra,
    ],
    input,
  );
}
const identitySql =
  "SELECT encode(sha256(convert_to(current_database() || E'\\n' || coalesce(inet_server_addr()::text,'local') || E'\\n' || coalesce(inet_server_port()::text,'local') || E'\\n' || current_user,'UTF8')),'hex');";
const migrations = readdirSync(resolve(root, "deploy/database/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function facts(db) {
  return JSON.parse(
    ok(
      sql(
        db,
        `SELECT jsonb_build_object(
    'cospace_capacities',(SELECT jsonb_agg(jsonb_build_object('plan',p.plan_code,'quota',pc.quota,'tier',pc.tier) ORDER BY p.plan_code)
      FROM product.plan_components pc JOIN product.plan_versions pv ON pv.id=pc.plan_version_id
      JOIN product.plans p ON p.id=pv.plan_id WHERE p.plan_code IN ('cospace-pro','cospace-business')),
    'credits',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.credits t),
    'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.payments t),
    'invoices',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.invoices t),
    'transactions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing.transactions t),
    'vouchers',(SELECT jsonb_agg(to_jsonb(t)-ARRAY['assigned_tenant_id','claimed_at','claim_token_digest','claim_key_version','replacement_of_redemption_id','funding_order_id','funding_payment_id'] ORDER BY id) FROM promotion.vouchers t));`,
      ),
    ),
  );
}

// ===========================================================================
// Exercise the invitation upgrade on clones inside this run's private container.
// ===========================================================================
async function invitationMigrationRegression(t) {
  const migration = read(
    "deploy/database/migrations/2026-11-17-invitation-recipient-uniqueness.sql",
  );
  const db = "invitation_upgrade";
  const snapshot = (name) =>
    JSON.parse(
      ok(
        sql(
          name,
          "SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM tenancy.invitations i;",
        ),
      ),
    );
  const reject = (result, error) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, new RegExp(error));
  };
  const invite = (n, type, target) => `
    INSERT INTO tenancy.invitations(id,scope,tenant_id,workspace_id,target_type,target,
      role_id,role_scope,token_hash,expires_at,created_by,created_at,updated_at)
    VALUES('${id(n)}','org','${id(2)}','${id(3)}','${type}',${target},
      '${id(110010)}','tenant','s07-invitation-${n}',now()+interval '1 day','${id(1)}',
      '2026-01-01T00:00:00Z','2026-02-01T00:00:00Z');`;
  ok(sql("postgres", `CREATE DATABASE ${db} TEMPLATE upgraded;`));
  ok(
    sql(
      db,
      `
    DROP TRIGGER guard_invitation_recipient ON tenancy.invitations;
    DROP FUNCTION tenancy.guard_invitation_recipient();
    DROP INDEX tenancy.uq_invitations_pending_recipient;
    DROP INDEX tenancy.uq_invitations_pending_target;
    ALTER TABLE tenancy.invitations DROP COLUMN recipient_user_id, DROP COLUMN last_sent_at;
    INSERT INTO access.roles(id,role_code,scope) VALUES('${id(110010)}','s07-invite-qa','tenant');
    INSERT INTO account.users(id,account,email,email_verified_at,phone,phone_verified_at) VALUES
      ('${id(110001)}','s07-verified','s07-verified@example.test',now(),'+8613900110001',now()),
      ('${id(110002)}','s07-unverified','s07-unverified@example.test',NULL,'+8613900110002',now());
    ${invite(110101, "email", "' S07-Verified@Example.Test '")}
    ${invite(110102, "email", "' S07-Unverified@Example.Test '")}
  `,
    ),
  );
  const legacy = snapshot(db);
  for (const [name, type, target] of [
    ["recipient", "phone", "'+8613900110001'"],
    ["target", "email", "'s07-unverified@example.test'"],
  ]) {
    await t.test(
      `conflicting historical ${name} rolls back all schema and row changes`,
      () => {
        const conflictDb = `invitation_conflict_${name}`;
        ok(sql("postgres", `CREATE DATABASE ${conflictDb} TEMPLATE ${db};`));
        ok(sql(conflictDb, invite(110103, type, target)));
        const before = snapshot(conflictDb);
        reject(
          sql(conflictDb, migration),
          "invitation_duplicates_require_review",
        );
        assert.deepEqual(snapshot(conflictDb), before);
        assert.equal(
          ok(
            sql(
              conflictDb,
              `SELECT
        NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='tenancy.invitations'::regclass
          AND attname IN ('recipient_user_id','last_sent_at') AND NOT attisdropped)
        AND to_regclass('tenancy.uq_invitations_pending_recipient') IS NULL
        AND to_regclass('tenancy.uq_invitations_pending_target') IS NULL
        AND to_regprocedure('tenancy.guard_invitation_recipient()') IS NULL
        AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='tenancy.invitations'::regclass
          AND tgname='guard_invitation_recipient');`,
            ),
          ),
          "t",
        );
      },
    );
  }
  await t.test(
    "first installation normalizes contacts and only binds verified owners",
    () => {
      ok(sql(db, migration));
      const rows = snapshot(db);
      assert.equal(rows[0].target, "s07-verified@example.test");
      assert.equal(rows[0].recipient_user_id, id(110001));
      assert.equal(rows[1].target, "s07-unverified@example.test");
      assert.equal(rows[1].recipient_user_id, null);
      for (let i = 0; i < rows.length; i++)
        assert.equal(rows[i].last_sent_at, legacy[i].updated_at);
    },
  );
  await t.test(
    "two replays preserve every row, delivery time and installed guard",
    () => {
      // Newly verified ownership must not retroactively rebind an old invitation.
      ok(
        sql(
          db,
          `UPDATE account.users SET email_verified_at=now() WHERE id='${id(110002)}';`,
        ),
      );
      // An actual resend gives last_sent_at a different value from updated_at.
      ok(
        sql(
          db,
          `UPDATE tenancy.invitations SET token_hash='s07-resent' WHERE id='${id(110101)}';`,
        ),
      );
      const before = snapshot(db);
      assert.notEqual(before[0].last_sent_at, before[0].updated_at);
      const guardSql =
        "SELECT pg_get_functiondef('tenancy.guard_invitation_recipient()'::regprocedure);";
      const guard = ok(sql(db, guardSql));
      ok(sql(db, migration));
      ok(sql(db, migration));
      assert.deepEqual(snapshot(db), before);
      assert.equal(ok(sql(db, guardSql)), guard);
    },
  );
  const beforeDenials = snapshot(db);
  for (const [name, statement, error] of [
    [
      "cross-channel duplicate",
      invite(110104, "phone", "'+8613900110001'"),
      "invitation_pending",
    ],
    [
      "target rewrite",
      `UPDATE tenancy.invitations SET target='other@example.test' WHERE id='${id(110101)}';`,
      "invitation_target_immutable",
    ],
    [
      "recipient rewrite",
      `UPDATE tenancy.invitations SET recipient_user_id='${id(110002)}' WHERE id='${id(110101)}';`,
      "invitation_identity_changed",
    ],
    [
      "resend cooldown",
      `UPDATE tenancy.invitations SET token_hash='s07-too-soon' WHERE id='${id(110101)}';`,
      "invitation_resend_cooldown",
    ],
    [
      "unavailable workspace",
      "BEGIN; UPDATE tenancy.workspaces SET status='archived'; " +
        invite(110105, "email", "'new@example.test'") +
        " COMMIT;",
      "workspace_unavailable",
    ],
  ])
    await t.test(`installed guard still rejects ${name}`, () => {
      reject(sql(db, statement), error);
      assert.deepEqual(snapshot(db), beforeDenials);
    });
  const drifts = [
    [
      "partial installation",
      "DROP TRIGGER guard_invitation_recipient ON tenancy.invitations;",
      "partial_state",
    ],
    [
      "wrong recipient type",
      "ALTER TABLE tenancy.invitations DROP CONSTRAINT invitations_recipient_user_id_fkey; ALTER TABLE tenancy.invitations ALTER COLUMN recipient_user_id TYPE text USING recipient_user_id::text;",
      "column_drift",
    ],
    [
      "nullable send time",
      "ALTER TABLE tenancy.invitations ALTER COLUMN last_sent_at DROP NOT NULL;",
      "column_drift",
    ],
    [
      "wrong send default",
      "ALTER TABLE tenancy.invitations ALTER COLUMN last_sent_at SET DEFAULT clock_timestamp();",
      "column_drift",
    ],
    [
      "missing recipient FK",
      "ALTER TABLE tenancy.invitations DROP CONSTRAINT invitations_recipient_user_id_fkey;",
      "recipient_fk_drift",
    ],
    [
      "unsafe recipient FK",
      "ALTER TABLE tenancy.invitations DROP CONSTRAINT invitations_recipient_user_id_fkey; ALTER TABLE tenancy.invitations ADD FOREIGN KEY(recipient_user_id) REFERENCES account.users(id) ON DELETE SET NULL;",
      "recipient_fk_drift",
    ],
    [
      "nonunique index",
      "DROP INDEX tenancy.uq_invitations_pending_target; CREATE INDEX uq_invitations_pending_target ON tenancy.invitations(target);",
      "index_drift",
    ],
    [
      "wrong index predicate",
      "DROP INDEX tenancy.uq_invitations_pending_target; CREATE UNIQUE INDEX uq_invitations_pending_target ON tenancy.invitations(tenant_id,scope,coalesce(CASE WHEN scope='workspace' THEN workspace_id END,'00000000-0000-0000-0000-000000000000'::uuid),target_type,lower(trim(target))) WHERE status='accepted';",
      "index_drift",
    ],
    [
      "disabled trigger",
      "ALTER TABLE tenancy.invitations DISABLE TRIGGER guard_invitation_recipient;",
      "trigger_drift",
    ],
    [
      "wrong trigger event",
      "DROP TRIGGER guard_invitation_recipient ON tenancy.invitations; CREATE TRIGGER guard_invitation_recipient BEFORE INSERT ON tenancy.invitations FOR EACH ROW EXECUTE FUNCTION tenancy.guard_invitation_recipient();",
      "trigger_drift",
    ],
    [
      "changed guard body",
      "CREATE OR REPLACE FUNCTION tenancy.guard_invitation_recipient() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;",
      "guard_drift",
    ],
    [
      "definer guard",
      "ALTER FUNCTION tenancy.guard_invitation_recipient() SECURITY DEFINER;",
      "guard_drift",
    ],
  ];
  for (const [name, mutation, error] of drifts)
    await t.test(
      `rejects ${name} without rewriting rows or the conflicting structure`,
      () => {
        const probeDb = "invitation_drift";
        ok(sql("postgres", `CREATE DATABASE ${probeDb} TEMPLATE ${db};`));
        try {
          ok(sql(probeDb, mutation));
          const driftRows = snapshot(probeDb);
          const structure = () =>
            ok(
              sql(
                probeDb,
                `SELECT jsonb_build_object(
          'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attnum) FROM pg_attribute a WHERE attrelid='tenancy.invitations'::regclass AND attnum>0),
          'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_constraint c WHERE conrelid='tenancy.invitations'::regclass),
          'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY indexrelid) FROM pg_index i WHERE indrelid='tenancy.invitations'::regclass),
          'trigger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_trigger t WHERE tgrelid='tenancy.invitations'::regclass AND NOT tgisinternal),
          'guard',pg_get_functiondef('tenancy.guard_invitation_recipient()'::regprocedure));`,
              ),
            );
          const driftShape = structure();
          reject(sql(probeDb, migration), `invitation_migration_${error}`);
          assert.deepEqual(snapshot(probeDb), driftRows);
          assert.equal(structure(), driftShape);
        } finally {
          ok(sql("postgres", `DROP DATABASE ${probeDb};`));
        }
      },
    );
}

// Project the checked-in platform column policy onto columns present before
// B02/B10/B11. Missing expansion tables/columns must not be invented by fixtures.
function baselineColumnLocks() {
  const policy = read("deploy/database/ddl/98_column_locks.sql");
  let source = "";
  for (const [, table] of policy.matchAll(
    /REVOKE UPDATE ON ([a-z_]+\.[a-z_]+) FROM platform_svc;/g,
  ))
    source += `DO $$ BEGIN IF to_regclass('${table}') IS NOT NULL THEN REVOKE UPDATE ON ${table} FROM platform_svc; END IF; END $$;\n`;
  for (const [, columns, table] of policy.matchAll(
    /GRANT UPDATE\s*\(([^)]+)\) ON ([a-z_]+\.[a-z_]+) TO platform_svc;/g,
  )) {
    const names = columns.split(",").map((c) => c.trim());
    assert.ok(names.every((c) => /^[a-z_][a-z0-9_]*$/.test(c)));
    source += `DO $$ DECLARE cols text; BEGIN
      SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO cols FROM pg_attribute
      WHERE attrelid=to_regclass('${table}') AND attnum>0 AND NOT attisdropped AND attname=ANY(ARRAY[${names.map((c) => `'${c}'`).join(",")}]);
      IF cols IS NOT NULL THEN EXECUTE 'GRANT UPDATE (' || cols || ') ON ${table} TO platform_svc'; END IF; END $$;\n`;
  }
  return source;
}

// Seed through a PostgreSQL wire tunnel inside this test container. No published
// port, host database URL, seed runner or environment-file loader is used.
async function seedPrivateCatalog(name, label) {
  assert.match(name, /^codex-voucher-s04-[a-f0-9-]+$/);
  const info = JSON.parse(ok(docker(["inspect", name])))[0];
  assert.equal(info.Config.Labels["codex.run"], label);
  assert.equal(info.HostConfig.NetworkMode, "none");
  const { Client } = createRequire(
    resolve(root, "bff/console-bff/package.json"),
  )("pg");
  const child = spawn(
    "docker",
    ["exec", "-i", name, "nc", "127.0.0.1", "5432"],
    { env, windowsHide: true, stdio: ["pipe", "pipe", "inherit"] },
  );
  const closed = new Promise((done) => child.once("close", done));
  const wire = Duplex.from({ writable: child.stdin, readable: child.stdout });
  wire.setNoDelay = () => {};
  wire.connect = () => queueMicrotask(() => wire.emit("connect"));
  child.once("error", (error) => wire.destroy(error));
  const client = new Client({
    user: "postgres",
    database: "upgraded",
    host: "127.0.0.1",
    port: 5432,
    ssl: false,
    password: "",
    stream: wire,
    connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    const { seedCatalog } = await import("../seed/seed-catalog.mjs");
    await client.query("BEGIN");
    await seedCatalog(client);
    await client.query("COMMIT");
  } finally {
    await client.end();
    child.kill();
    await closed;
  }
}

if (process.argv[2] === "--seed-catalog") {
  // This branch is spawned only with the allowlisted test environment above.
  await seedPrivateCatalog(process.argv[3], process.argv[4]);
} else {
  test(
    "S04 offline entry and workflow gates",
    { timeout: 60000 },
    async (t) => {
      await t.test(
        "real entry rejects unsafe plans and evidence without real Docker",
        () => {
          const result = ok(
            command(bash, ["deploy/scripts/lib/migration-plan.test.sh"]),
          );
          assert.match(result, /S04_GATE_TESTS_PASSED=16/);
          t.diagnostic("S04_GATE_TESTS_PASSED=16");
        },
      );
      const workflow = read(".github/workflows/db-init.yml");
      await t.test(
        "existing opener seat actions keep their staged execution and write gate",
        () => {
          const branch = workflow.match(
            /case "\$DB_ACTION" in\n              opener-seats-preflight\|opener-seats-repair\)([\s\S]+?)\n            esac/,
          )?.[0];
          assert.ok(branch, "missing targeted opener-seat workflow branch");
          assert.ok(
            workflow.indexOf(branch) <
              workflow.indexOf('mkdir -p "$DEPLOY_DIR"'),
          );
          assert.match(workflow, /- opener-seats-preflight\n/);
          assert.match(workflow, /- opener-seats-repair\n/);
          assert.match(
            workflow,
            /reset\|migrate\|[^\n]*\|opener-seats-repair\)/,
          );
          for (const action of [
            "opener-seats-preflight",
            "opener-seats-repair",
          ]) {
            const result = ok(
              command(
                bash,
                ["-s"],
                `set -eu\nls() { :; }\nbash() {\n  [ "$RUNTIME_DIR" = /s07-runtime ]\n  case "$1" in\n    "$SRC/scripts/32-subscription-opener-seats.sh")\n      [ "$2" = preflight ] || { [ "$2" = repair ] && [ "$CONFIRM_OPENER_SEATS" = yes ]; };;\n    "$SRC/scripts/28c-restamp-ddl-baseline.sh") [ "$CONFIRM_RESTAMP" = yes ];;\n    "$SRC/scripts/30-verify-platform-baseline.sh") :;;\n    *) return 90;;\n  esac\n  printf 'S07_STAGED_CALL=%s\\n' "\${1##*/}"\n}\n${branch}\nprintf 'UNREACHABLE_SHARED_SYNC\\n'\n`,
                10000,
                {
                  DB_ACTION: action,
                  SRC: "/s07-staged/deploy",
                  DEPLOY_RUNTIME_DIR: "/s07-runtime",
                },
              ),
            );
            const calls = [...result.matchAll(/S07_STAGED_CALL=(.+)/g)].map(
              (match) => match[1],
            );
            assert.deepEqual(
              calls,
              action === "opener-seats-preflight"
                ? ["32-subscription-opener-seats.sh"]
                : [
                    "32-subscription-opener-seats.sh",
                    "28c-restamp-ddl-baseline.sh",
                    "30-verify-platform-baseline.sh",
                  ],
            );
            assert.doesNotMatch(result, /UNREACHABLE_SHARED_SYNC/);
          }
        },
      );
      await t.test(
        "verify exits from the staged bundle before shared files or env shims",
        () => {
          const branch = workflow.match(
            /if \[ "\$DB_ACTION" = verify \]; then([\s\S]+?)\n            fi/,
          )[0];
          assert.ok(
            workflow.indexOf(branch) <
              workflow.indexOf('mkdir -p "$DEPLOY_DIR"'),
          );
          assert.match(
            branch,
            /bash "\$SRC\/scripts\/30-verify-platform-baseline.sh"/,
          );
          assert.doesNotMatch(branch, /cp |sed |mkdir|CONFIRM_|28c-|29-seed/);
          const result = ok(
            command(
              bash,
              ["-s"],
              `set -eu\nbash() {\n  [ "$1" = "$SRC/scripts/30-verify-platform-baseline.sh" ]\n  [ "$RUNTIME_DIR" = /s05-runtime ]\n  printf 'S05_STAGED_VERIFY_OK\\n'\n}\n${branch}\nprintf 'UNREACHABLE_SHARED_SYNC\\n'\n`,
              10000,
              {
                DB_ACTION: "verify",
                SRC: "/s05-staged/deploy",
                DEPLOY_RUNTIME_DIR: "/s05-runtime",
              },
            ),
          );
          assert.match(result, /S05_STAGED_VERIFY_OK/);
          assert.doesNotMatch(result, /UNREACHABLE_SHARED_SYNC/);
        },
      );
      await t.test(
        "offline preview cannot reach tailnet, upload, SSH or automatic restamp",
        () => {
          for (const name of [
            "Join tailnet",
            "Upload DB scripts to worker-01",
            "Run DB action via SSH",
          ])
            assert.ok(
              workflow.includes(
                `- name: ${name}\n        if: \${{ inputs.action != 'migration-plan' }}`,
              ),
            );
          const branch = workflow.match(
            /if \[ "\$DB_ACTION" = migrate \]; then([\s\S]+?)\n            fi/,
          )[1];
          assert.match(
            branch,
            /CONFIRM_MIGRATE=yes bash "\$SRC\/scripts\/28d-apply-migrations.sh"/,
          );
          assert.match(branch, /exit 0/);
          assert.doesNotMatch(
            branch,
            /CONFIRM_RESTAMP|29-seed|sed -i|30-verify/,
          );
        },
      );
      const python = workflow
        .match(/          python3 - <<'PY'\r?\n([\s\S]*?)          PY\r?\n/)[1]
        .replace(/^ {10}/gm, "");
      const output = resolve(tmpdir(), `vx-migration-evidence-${runId}.env`);
      const evidence = {
        target_sha256: "a".repeat(64),
        backup_sha256: "b".repeat(64),
        restore_evidence: "s04-restore",
        cutover_evidence: "s04-cutover",
        quiesced_at: Math.floor(Date.now() / 1000),
        writes_stopped: true,
        restore_verified: true,
      };
      function validate(value) {
        writeFileSync(output, "");
        return command(
          process.platform === "win32" ? "python" : "python3",
          ["-c", python],
          undefined,
          10000,
          {
            GITHUB_ENV: output,
            MIGRATION_EVIDENCE:
              typeof value === "string" ? value : JSON.stringify(value),
          },
        );
      }
      try {
        await t.test(
          "the actual workflow Python exports only validated attestations",
          () => {
            ok(validate(evidence));
            const lines = readFileSync(output, "utf8").trim().split(/\r?\n/);
            assert.equal(lines.length, 7);
            assert.ok(lines.includes("MIGRATE_WRITES_STOPPED=yes"));
            assert.ok(lines.includes("MIGRATE_RESTORE_VERIFIED=yes"));
          },
        );
        const invalid = [
          ["missing field", { ...evidence, target_sha256: undefined }],
          ["unexpected field", { ...evidence, password: "forbidden" }],
          ["malformed hash", { ...evidence, backup_sha256: "invalid" }],
          [
            "newline injection",
            { ...evidence, cutover_evidence: "safe\nINJECTED=yes" },
          ],
          ["unattested writes", { ...evidence, writes_stopped: false }],
          ["string boolean", { ...evidence, restore_verified: "true" }],
          [
            "stale timestamp",
            { ...evidence, quiesced_at: evidence.quiesced_at - 3601 },
          ],
          [
            "future timestamp",
            { ...evidence, quiesced_at: evidence.quiesced_at + 120 },
          ],
          [
            "duplicate keys",
            JSON.stringify(evidence).replace("{", '{"writes_stopped":false,'),
          ],
        ];
        for (const [name, value] of invalid)
          await t.test(
            `workflow rejects ${name} without exporting evidence`,
            () => {
              assert.notEqual(validate(value).status, 0);
              assert.equal(readFileSync(output, "utf8"), "");
            },
          );
      } finally {
        unlinkSync(output);
      }
    },
  );

  test("S04 full-history migration channel", { timeout: 240000 }, async (t) => {
    let containerId = "";
    let stream;
    const target = (db) => ok(sql(db, identitySql));
    const apply = (
      db,
      source = stream,
      hash = target(db),
      at = Math.floor(Date.now() / 1000),
    ) =>
      sql(db, source, [
        "-v",
        `target_sha256=${hash}`,
        "-v",
        `quiesced_at=${at}`,
      ]);
    const denied = (result, message) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr + result.stdout, new RegExp(message));
      assert.doesNotMatch(
        result.stdout,
        /MIGRATION_DONE=|MIGRATION_CHANNEL_COMPLETE=/,
      );
    };
    async function held(source, observed, work) {
      const child = spawn(
        "docker",
        [
          "exec",
          "-i",
          container,
          "psql",
          "-X",
          "-qAt",
          "-U",
          "postgres",
          "-d",
          "upgraded",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        {
          cwd: root,
          env,
          windowsHide: true,
          stdio: ["pipe", "ignore", "ignore"],
        },
      );
      const closed = new Promise((done) => {
        child.once("error", done);
        child.once("close", done);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(
        `SET application_name='s04-${runId}'; ${source}; SELECT pg_sleep(30);`,
      );
      try {
        let ready = false;
        for (let i = 0; i < 40; i++) {
          if (ok(sql("upgraded", observed)) === "t") {
            ready = true;
            break;
          }
          await setTimeout(100);
        }
        assert.ok(ready, "isolated competing session did not become ready");
        await work();
      } finally {
        ok(
          sql(
            "upgraded",
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='s04-${runId}' AND datname=current_database();`,
          ),
        );
        await closed;
      }
    }
    try {
      containerId = ok(
        docker([
          "run",
          "--detach",
          "--pull=never",
          "--network",
          "none",
          "--name",
          container,
          "--label",
          `codex.run=${runId}`,
          "--env",
          "POSTGRES_HOST_AUTH_METHOD=trust",
          "postgres:18-alpine",
          "-c",
          "max_prepared_transactions=10",
        ]),
      );
      t.diagnostic(`S04_CONTAINER_CREATED=${container}`);
      for (let i = 0; ; i++) {
        if (
          docker(["exec", container, "pg_isready", "-U", "postgres"]).status ===
          0
        )
          break;
        assert.ok(i < 40, "isolated PostgreSQL did not start");
        await setTimeout(250);
      }
      ok(
        docker([
          "cp",
          resolve(root, "deploy/database/migrations"),
          `${container}:/migrations`,
        ]),
      );
      ok(docker(["exec", container, "mkdir", "-p", "/verify"]));
      ok(
        docker([
          "cp",
          resolve(
            root,
            "deploy/database/verify/migration-cutover-preflight.sql",
          ),
          `${container}:/verify/migration-cutover-preflight.sql`,
        ]),
      );
      ok(
        docker([
          "cp",
          resolve(root, "deploy/database/ddl/98_column_locks.sql"),
          `${container}:/column_locks.sql`,
        ]),
      );
      ok(docker(["exec", container, "mkdir", "-p", "/ddl"]));
      ok(
        docker([
          "cp",
          resolve(root, "deploy/database/ddl/98_column_locks.sql"),
          `${container}:/ddl/98_column_locks.sql`,
        ]),
      );
      stream = ok(
        command(bash, [
          "deploy/scripts/lib/migration-plan.sh",
          "sql",
          "deploy",
        ]),
      );
      ok(sql("postgres", "CREATE DATABASE upgraded;"));
      let ddl = "";
      for (const file of readdirSync(resolve(root, "deploy/database/ddl"))
        .filter((n) => /^\d+_.*\.sql$/.test(n))
        .sort()) {
        if (
          [
            "53_wallet.sql",
            "54_wallet_cards.sql",
            "98_column_locks.sql",
          ].includes(file)
        )
          continue;
        let source = read(`deploy/database/ddl/${file}`);
        if (file === "52_billing.sql")
          source = source
            .split("-- B02 refund allocation foundation:")[0]
            .replace(/^    calculation_snapshot jsonb,\r?\n/m, "")
            .replace(
              /^    CONSTRAINT chk_refunds_calculation_object[^\n]*\n/m,
              "",
            );
        if (file === "56_promotion.sql")
          source = read(
            "deploy/database/verify/fixtures/promotion-before-ownership.sql",
          );
        if (file === "90_cross_schema_fk.sql")
          source = source.split("-- Promotion B02 expansion:")[0];
        ddl += source + "\n";
      }
      ok(sql("upgraded", ddl));
      ok(sql("upgraded", baselineColumnLocks()));
      ok(
        command(process.execPath, [
          fileURLToPath(import.meta.url),
          "--seed-catalog",
          container,
          runId,
        ]),
      );
      // The general seed has no CoSpace catalog. Full history requires the two
      // published v1 capacities checked by its narrowly scoped seat migration.
      // Model an already-canonical catalog; do not rewrite that historical SQL.
      ok(
        sql(
          "upgraded",
          `BEGIN;
           INSERT INTO product.products(id,product_code,product_name,product_type,layer)
             VALUES('${id(100201)}','cospace','CoSpace QA','collaboration_platform','L2');
           INSERT INTO product.plans(id,plan_code,plan_name) VALUES
             ('${id(100202)}','cospace-pro','CoSpace Pro QA'),
             ('${id(100203)}','cospace-business','CoSpace Business QA');
           INSERT INTO product.plan_versions(id,plan_id,version_no) VALUES
             ('${id(100204)}','${id(100202)}',1),
             ('${id(100205)}','${id(100203)}',1);
           INSERT INTO product.plan_components(plan_version_id,product_id,tier,quota) VALUES
             ('${id(100204)}','${id(100201)}','pro','{"seat.max":1}'),
             ('${id(100205)}','${id(100201)}','business','{"seat.max":5}');
           UPDATE product.plan_versions SET status='published',is_locked=true,published_at=now()
             WHERE id IN ('${id(100204)}','${id(100205)}');
           UPDATE product.plans SET current_version_id='${id(100204)}' WHERE id='${id(100202)}';
           UPDATE product.plans SET current_version_id='${id(100205)}' WHERE id='${id(100203)}';
           COMMIT;`,
        ),
      );
      // The observed pre-upgrade database already permits legacy balance rows.
      // Model that catalog state independently of the current seed implementation.
      ok(
        sql(
          "upgraded",
          "ALTER TABLE billing.payments DROP CONSTRAINT chk_payments_pay_source; ALTER TABLE billing.payments ADD CONSTRAINT chk_payments_pay_source CHECK(pay_source IN ('online','offline','voucher','balance'));",
        ),
      );
      ok(
        sql(
          "upgraded",
          `INSERT INTO account.users(id,account,phone,phone_verified_at) VALUES('${id(1)}','s04-private','+8613900004004',now());
      INSERT INTO tenancy.tenants(id,name,type,owner_user_id) VALUES('${id(2)}','S04','organization','${id(1)}');
      INSERT INTO tenancy.workspaces(id,tenant_id,name) VALUES('${id(3)}','${id(2)}','S04');\n` +
            read(
              "deploy/database/verify/fixtures/voucher-migration-legacy.sql",
            ),
        ),
      );
      const before = facts("upgraded");
      await t.test(
        "S07-R1a invitation migration safety",
        invitationMigrationRegression,
      );
      await t.test(
        "catalog reseed preserves legacy balance payment evidence",
        () => {
          ok(
            command(process.execPath, [
              fileURLToPath(import.meta.url),
              "--seed-catalog",
              container,
              runId,
            ]),
          );
          assert.deepEqual(facts("upgraded"), before);
        },
      );
      await t.test(
        "owner verification is read-only for every audit file",
        async (t) => {
          // Run the actual checker inside this private container. The Docker shim
          // reuses it instead of creating a connection to the production network.
          ok(
            docker([
              "exec",
              container,
              "mkdir",
              "-p",
              "/s05-checker/scripts",
              "/s05-checker/database/ddl",
              "/s05-checker/database/verify",
              "/s05-runtime/secrets",
            ]),
          );
          const put = (path, value) =>
            ok(docker(["exec", "-i", container, "tee", path], value));
          put(
            "/s05-runtime/secrets/rds-owner.env",
            "DATABASE_URL=unused-by-private-test\n",
          );
          put(
            "/s05-checker/database/ddl/00_s05.sql",
            "CREATE TABLE s05_private_fixture(id int);\n",
          );
          const shim = `docker() {
  [ "$1" = run ] || return 90
  shift
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --rm) shift ;;
      --network|--env-file|-v) shift 2 ;;
      --env) export "$2"; shift 2 ;;
      postgres:18-alpine) shift; "$@"; return $? ;;
      *) return 91 ;;
    esac
  done
}
export RUNTIME_DIR=/s05-runtime
# The URL deliberately overrides the startup default. BEGIN READ ONLY must win.
export DATABASE_URL='postgresql://postgres@127.0.0.1/upgraded?options=-c%20default_transaction_read_only%3Doff'
`;
          put(
            "/s05-checker/scripts/check.sh",
            shim + read("deploy/scripts/30-verify-platform-baseline.sh"),
          );
          const auditFiles = [
            "baseline-assertions.sql",
            "column-locks-drift.sql",
            "database-timezone.sql",
          ];
          const assertion = `DO $$ BEGIN
          IF current_user<>'postgres' OR current_setting('transaction_read_only')<>'on'
            OR current_setting('statement_timeout')<>'20s' OR current_setting('lock_timeout')<>'1s'
          THEN RAISE EXCEPTION 'S05_READONLY_POLICY_MISSING'; END IF;
        END $$; SELECT 'S05_READONLY_OK';\n`;
          for (const file of auditFiles) {
            put(`/s05-checker/database/verify/${file}`, assertion);
            ok(
              docker([
                "exec",
                container,
                "ln",
                "-s",
                `/s05-checker/database/verify/${file}`,
                `/verify/${file}`,
              ]),
            );
          }
          ok(sql("upgraded", "CREATE TABLE public.s05_write_probe(id int);"));
          const run = () =>
            docker(["exec", container, "sh", "/s05-checker/scripts/check.sh"]);
          await t.test(
            "all three audits observe owner, read-only and bounded timeouts",
            () => {
              const output = ok(run());
              assert.equal([...output.matchAll(/S05_READONLY_OK/g)].length, 3);
              assert.match(output, /baseline audit PASSED/);
            },
          );
          for (const file of auditFiles)
            await t.test(`rejects a write injected into ${file}`, () => {
              put(
                `/s05-checker/database/verify/${file}`,
                "INSERT INTO public.s05_write_probe VALUES(1);\n",
              );
              try {
                const result = run();
                assert.notEqual(result.status, 0);
                assert.match(result.stderr, /read-only transaction/);
                assert.doesNotMatch(result.stdout, /baseline audit PASSED/);
                assert.equal(
                  ok(
                    sql(
                      "upgraded",
                      "SELECT count(*) FROM public.s05_write_probe;",
                    ),
                  ),
                  "0",
                );
              } finally {
                put(`/s05-checker/database/verify/${file}`, assertion);
              }
            });
          assert.deepEqual(facts("upgraded"), before);
          t.diagnostic("S05_READONLY_TESTS_PASSED=4");
        },
      );
      const backup = ok(
        docker([
          "exec",
          container,
          "pg_dump",
          "-U",
          "postgres",
          "-d",
          "upgraded",
          "--no-owner",
          "--no-comments",
        ]),
      );
      await t.test("rejects another database identity before DDL", () =>
        denied(
          apply("upgraded", stream, "0".repeat(64)),
          "MIGRATION_TARGET_MISMATCH",
        ),
      );
      await t.test("rejects stale cutover evidence before DDL", () =>
        denied(
          apply(
            "upgraded",
            stream,
            target("upgraded"),
            Math.floor(Date.now() / 1000) - 3601,
          ),
          "MIGRATION_CUTOVER_EVIDENCE_EXPIRED",
        ),
      );
      await t.test(
        "refuses an owner without complete transaction visibility",
        () => {
          ok(sql("upgraded", "CREATE ROLE s04_limited;"));
          const source = "SET ROLE s04_limited;\n" + stream;
          const hash = ok(
            sql("upgraded", "SET ROLE s04_limited;\n" + identitySql),
          );
          denied(
            apply("upgraded", source, hash),
            "MIGRATION_ACTIVITY_VISIBILITY_REQUIRED",
          );
        },
      );
      await t.test("rejects active transactions without terminating them", () =>
        held(
          "BEGIN",
          `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='s04-${runId}' AND xact_start IS NOT NULL);`,
          () => denied(apply("upgraded"), "MIGRATION_TRANSACTIONS_NOT_DRAINED"),
        ),
      );
      await t.test("rejects a competing migration session", () =>
        held(
          "SELECT pg_advisory_lock(742138660,1)",
          "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted);",
          () => denied(apply("upgraded"), "MIGRATION_LOCK_BUSY"),
        ),
      );
      await t.test("rejects prepared transactions", () => {
        ok(
          sql(
            "upgraded",
            "BEGIN; SELECT 1; PREPARE TRANSACTION 's04-prepared';",
          ),
        );
        try {
          denied(
            apply("upgraded"),
            "MIGRATION_PREPARED_TRANSACTIONS_NOT_DRAINED",
          );
        } finally {
          ok(sql("upgraded", "ROLLBACK PREPARED 's04-prepared';"));
        }
      });
      await t.test(
        "rolls back a failed transaction and does not start later files",
        () => {
          const failing = stream.replace(
            `\\i /migrations/${migrations[0]}`,
            "BEGIN; CREATE TABLE public.s04_probe(id int); SELECT 1/0; COMMIT;",
          );
          denied(apply("upgraded", failing), "division by zero");
          assert.equal(
            ok(
              sql(
                "upgraded",
                "SELECT to_regclass('public.s04_probe') IS NULL;",
              ),
            ),
            "t",
          );
          assert.deepEqual(facts("upgraded"), before);
        },
      );
      let fullPassed = false;
      await t.test(
        `replays all ${migrations.length} historical files through the real session`,
        () => {
          const result = apply("upgraded");
          ok(result);
          const done = [
            ...result.stdout.matchAll(/^MIGRATION_DONE=(.+)$/gm),
          ].map((m) => m[1].trim());
          assert.deepEqual(done, migrations);
          assert.match(result.stdout, /COLUMN_LOCKS_DONE/);
          assert.match(result.stdout, /MIGRATION_CHANNEL_COMPLETE=/);
          assert.deepEqual(facts("upgraded"), before);
          fullPassed = true;
        },
      );
      if (fullPassed) {
        await t.test(
          "full-history repeat preserves money and final wallet guards",
          () => {
            const guardSql =
              "SELECT pg_get_functiondef('billing.check_wallet_funding_capacity()'::regprocedure);";
            const guard = ok(sql("upgraded", guardSql));
            ok(apply("upgraded"));
            assert.deepEqual(facts("upgraded"), before);
            assert.equal(ok(sql("upgraded", guardSql)), guard);
            ok(
              sql(
                "upgraded",
                read("deploy/database/verify/column-locks-drift.sql"),
              ),
            );
          },
        );
        await t.test(
          "restores the upgraded backup with final guards and grants",
          () => {
            const guardSql =
              "SELECT pg_get_functiondef('billing.check_wallet_funding_capacity()'::regprocedure);";
            const upgradedBackup = ok(
              docker([
                "exec",
                container,
                "pg_dump",
                "-U",
                "postgres",
                "-d",
                "upgraded",
                "--no-owner",
                "--no-comments",
              ]),
            );
            ok(sql("postgres", "CREATE DATABASE recovered_after;"));
            ok(sql("recovered_after", upgradedBackup));
            assert.deepEqual(facts("recovered_after"), facts("upgraded"));
            assert.equal(
              ok(sql("recovered_after", guardSql)),
              ok(sql("upgraded", guardSql)),
            );
            assert.equal(
              ok(
                sql(
                  "recovered_after",
                  "SELECT has_table_privilege('platform_svc','billing.wallet_entries','UPDATE') OR has_column_privilege('platform_svc','promotion.vouchers','id','UPDATE');",
                ),
              ),
              "f",
            );
          },
        );
      }
      await t.test(
        "restores the pre-upgrade backup only into a separate database",
        () => {
          ok(sql("postgres", "CREATE DATABASE recovered;"));
          ok(sql("recovered", backup));
          assert.deepEqual(facts("recovered"), before);
          assert.equal(
            ok(
              sql(
                "recovered",
                "SELECT to_regclass('billing.wallet_accounts') IS NULL;",
              ),
            ),
            "t",
          );
          assert.deepEqual(facts("upgraded"), before);
        },
      );
    } finally {
      if (containerId) {
        assert.match(containerId, /^[a-f0-9]{64}$/);
        const info = JSON.parse(ok(docker(["inspect", containerId])))[0];
        assert.equal(info.Id, containerId);
        assert.equal(info.Name, "/" + container);
        assert.equal(info.Config.Labels["codex.run"], runId);
        ok(docker(["rm", "--force", "--volumes", containerId]));
        assert.equal(
          ok(
            docker([
              "ps",
              "-aq",
              "--no-trunc",
              "--filter",
              "id=" + containerId,
            ]),
          ),
          "",
        );
        t.diagnostic(
          `VOUCHER_CONTAINER_CLEANUP=${JSON.stringify({ id: containerId, name: container, runId, cleaned: true, remaining: false })}`,
        );
        t.diagnostic(`S04_CONTAINER_CLEANED=${container}`);
      }
    }
  });
}
