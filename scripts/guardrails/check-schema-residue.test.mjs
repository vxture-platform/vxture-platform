/**
 * Exercise SQL references against authoritative DDL declarations.
 * @package @vxture/scripts
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-25
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const guard = fileURLToPath(
  new URL("./check-schema-residue.mjs", import.meta.url),
);

function check(ddl, query) {
  const root = mkdtempSync(join(tmpdir(), "schema-residue-"));
  try {
    mkdirSync(join(root, "deploy/database/ddl"), { recursive: true });
    mkdirSync(join(root, "bff"), { recursive: true });
    writeFileSync(join(root, "deploy/database/ddl/10_session.sql"), ddl);
    writeFileSync(join(root, "bff/query.ts"), query);
    return spawnSync(process.execPath, [guard], {
      cwd: root,
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts ordinary and idempotent DDL tables", () => {
  const result = check(
    "CREATE TABLE session.auth_sessions (id text);\n  create table if not exists session.identity_events2 (id text);",
    "SELECT * FROM session.auth_sessions JOIN session.identity_events2 USING (id)",
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("rejects missing tables in a schema introduced by idempotent DDL", () => {
  const result = check(
    "CREATE TABLE IF NOT EXISTS session.identity_events (id text);",
    "SELECT * FROM session.identity_missing",
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /session\.identity_missing/);
});

test("rejects retired schema references even with valid declarations", () => {
  const result = check(
    "CREATE TABLE IF NOT EXISTS session.identity_events (id text);",
    "SELECT * FROM iam.roles",
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /iam\.roles/);
});

test("does not allow verification tables in application code", () => {
  const result = check(
    "CREATE TABLE IF NOT EXISTS public.vx_principal_no_backup_v3 (id text);",
    "SELECT * FROM public.s05_write_probe",
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /public\.s05_write_probe/);
});
