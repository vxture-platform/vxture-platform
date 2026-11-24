/**
 * Seven-receiver preflight against real DDL in an owned disposable database.
 * @package @vxture/repo
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-25
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { collectScopes, publishBatch, validateBatch } from "./collect-sync.mjs";
import { inspectSync } from "./inspect-sync.mjs";
import { registrationSql } from "./prepare-registration.mjs";

const connectionString = process.env.IDENTITY_INSPECT_TEST_DATABASE_URL;
test(
  "seven RP inspections use real schema, bindings and queue isolation",
  { skip: !connectionString },
  async (t) => {
    const url = new URL(connectionString);
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
      "Explicit loopback database required",
    );
    const { Pool } = createRequire(
      new URL("../../bff/auth-bff/package.json", import.meta.url),
    )("pg");
    const database = `identity_inspection_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    const directory = await mkdtemp(join(tmpdir(), "identity-inspection-"));
    let pool,
      created = false;
    try {
      await admin.query(`create database "${database}"`);
      created = true;
      url.pathname = `/${database}`;
      pool = new Pool({
        connectionString: url.href,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      for (const name of [
        "00_schemas",
        "10_account",
        "18_access",
        "20_tenancy",
        "22_appoidc",
        "24_session",
        "25_identity_recovery",
        "26_rp_session_notifications",
        "40_product",
        "50_metering",
        "96_identity_changes",
        "96_identity_delivery",
        "96_identity_extended_facts",
        "96_identity_presentation",
        "80_admin",
        "96_identity_workforce",
      ])
        await pool.query(
          await readFile(
            new URL(`../../deploy/database/ddl/${name}.sql`, import.meta.url),
            "utf8",
          ),
        );
      const scopes = validateBatch(
        JSON.parse(
          await readFile(
            new URL(
              "../../deploy/identity-sync/platform.example.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      );
      for (const scope of scopes) {
        await pool.query(
          `insert into appoidc.oidc_clients
        (client_id,client_secret_hash,client_kind,realm,redirect_uris,slo_participation,back_channel_logout_uri)
        values($1,'unused-local-fixture','platform',$2,'{}','back_channel',$3)`,
          [scope.clientId, scope.realm, scope.logoutUri],
        );
      }

      // =======================================================================
      // Read-only observation follows explicit fixtures; no shared roles change.
      // =======================================================================
      await t.test(
        "generated registration is repeatable, disabled and rejects rebinding atomically",
        async () => {
          const sql = registrationSql({ scopes });
          await pool.query(sql);
          await pool.query(sql);
          const result =
            await pool.query(`select count(*)::int as total,count(*) filter(where r.enabled or c.enabled or d.enabled)::int as enabled
        from session.identity_recovery_streams r join session.identity_change_streams c using(stream_id)
        join session.identity_change_receivers d using(stream_id)`);
          assert.equal(result.rows[0].total, 7);
          assert.equal(result.rows[0].enabled, 0);
          for (const change of [
            { issuer: "https://wrong.example.test" },
            { receiverUri: "https://console.example.test/other" },
          ]) {
            await assert.rejects(
              pool.query(
                registrationSql({ scopes: [{ ...scopes[0], ...change }] }),
              ),
            );
            await pool.query("rollback");
          }
          const quoted = {
            ...scopes[0],
            receiverUri: "https://console.example.test/$registration$'quoted",
          };
          await assert.rejects(
            pool.query(registrationSql({ scopes: [quoted] })),
            /Immutable receiver binding mismatch/,
          );
          await pool.query("rollback");
        },
      );
      await pool.query(
        "update session.identity_recovery_streams set enabled=true",
      );
      await pool.query(
        "update session.identity_change_streams set enabled=true",
      );
      await pool.query(
        "update session.identity_change_receivers set enabled=true",
      );
      await pool.query(registrationSql({ scopes }));
      await t.test(
        "all seven exact registrations publish one complete snapshot",
        async () => {
          const result = await publishBatch(
            join(directory, "identity.prom"),
            () => collectScopes(scopes, (scope) => inspectSync(pool, scope)),
          );
          assert.equal(result.exitCode, 0);
          assert.equal(
            result.batch.results.filter((item) => item.report?.databaseReady)
              .length,
            7,
          );
          const text = await readFile(join(directory, "identity.prom"), "utf8");
          assert.equal(
            (text.match(/^vxture_identity_database_ready\{/gm) || []).length,
            7,
          );
        },
      );
      await t.test(
        "disabled workforce receiver remains distinct from healthy customer clients",
        async () => {
          await pool.query(`update session.identity_change_receivers set enabled=false
        where stream_id=(select stream_id from session.identity_recovery_streams where client_id='admin')`);
          const batch = await collectScopes(scopes, (scope) =>
            inspectSync(pool, scope),
          );
          assert.equal(
            batch.results.find((item) => item.scope.clientId === "admin").report
              .databaseReady,
            false,
          );
          assert.equal(
            batch.results.filter((item) => item.report.databaseReady).length,
            6,
          );
        },
      );
      await t.test(
        "wrong realm, channel or issuer never passes the exact binding check",
        async () => {
          for (const change of [
            { realm: "workforce" },
            { releaseChannel: "canary" },
            { issuer: "https://different.example.test" },
          ]) {
            const result = await inspectSync(pool, { ...scopes[0], ...change });
            assert.equal(result.databaseReady, false);
          }
        },
      );
      await t.test(
        "older schema returns explicit column failures before querying realm-scoped work",
        async () => {
          await pool.query(
            "alter table session.logout_deliveries rename column realm to fixture_realm",
          );
          const result = await inspectSync(pool, scopes[0]);
          assert.equal(result.databaseReady, false);
          assert.deepEqual(result.metrics, {});
          assert.ok(
            result.checks.some(
              (check) =>
                check.code === "column:session.logout_deliveries:realm" &&
                !check.passed,
            ),
          );
        },
      );
    } finally {
      await pool?.end();
      if (created)
        await admin.query(`drop database "${database}" with (force)`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
