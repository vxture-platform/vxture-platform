/**
 * 39-audit-env.test.mjs - Exercise the host audit with isolated deployment files.
 * @package @vxture/repo
 * @layer Infrastructure
 * @category guardrail-test
 * @author AI-Generated
 * @date 2026-10-20
 * Run: node --test deploy/guardrails/39-audit-env.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ============================================================================
// Isolated strict-runtime fixtures
// ============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOY = resolve(HERE, "..");
const SCRIPT = join(HERE, "39-audit-env.mjs");
const CLIENT_SECRET = "fixture-platform-api-client-secret";

/** Create synthetic runtime files from examples without reading local secrets. */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vxture-host-env-audit-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  for (const dir of ["deploy/scripts", "deploy/secrets", "runtime/secrets"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  copyFileSync(resolve(DEPLOY, "../.env.example"), join(root, ".env.example"));
  for (const subdir of ["", "secrets"]) {
    for (const name of readdirSync(join(DEPLOY, subdir))) {
      if (!name.endsWith(".example")) continue;
      const relative = join(subdir, name);
      const example = readFileSync(join(DEPLOY, relative), "utf8");
      writeFileSync(join(root, "deploy", relative), example);
      const runtime = example.replace(
        /^([A-Z][A-Z0-9_]*)=.*$/gmu,
        (_line, key) => {
          const value =
            {
              DATABASE_URL: "postgresql://fixture:fixture-db@db.invalid/db",
              REDIS_URL: "redis://:fixture-redis@cache.invalid:6379",
              OIDC_CLIENT_ID: "platform-api",
              OIDC_CLIENT_SECRET: CLIENT_SECRET,
            }[key] ?? `fixture-${key.toLowerCase()}`;
          return `${key}=${value}`;
        },
      );
      writeFileSync(
        join(root, "runtime", relative.slice(0, -".example".length)),
        runtime,
      );
    }
  }
  for (const [name, value] of Object.entries({
    "rds-owner.env": "DATABASE_URL=postgresql://fixture@db.invalid/db\n",
    "rds-pw-platform_svc": "fixture-db\n",
    "rds-pw-reporting_ro": "fixture-reporting\n",
    "tair-pw-default": "fixture-redis\n",
  })) {
    writeFileSync(join(root, "runtime/secrets", name), value);
  }
  for (const name of [
    "compose.platform.yml",
    "scripts/12-generate-env-files.sh",
  ]) {
    copyFileSync(join(DEPLOY, name), join(root, "deploy", name));
  }
  return root;
}

/** Run the real CLI in strict host mode; diagnostics must never contain values. */
function audit(root) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      VX_WORKER_DIR: "deploy",
      VX_RUNTIME_DIR: "runtime",
      VX_ENV_AUDIT_STRICT_RUNTIME: "1",
      VX_ENV_AUDIT_FAIL_WARNINGS: "1",
      VX_ENV_AUDIT_SHOW_OK: "0",
    },
  });
  assert.ifError(result.error);
  const output = result.stdout + result.stderr;
  assert.equal(output.includes(CLIENT_SECRET), false, output);
  return { status: result.status, output };
}

/** Replace or append exactly one synthetic environment key. */
function setKey(root, relative, key, value) {
  const file = join(root, relative);
  const original = readFileSync(file, "utf8");
  const pattern = new RegExp(`^${key}=.*$`, "mu");
  writeFileSync(
    file,
    pattern.test(original)
      ? original.replace(pattern, () => `${key}=${value}`)
      : `${original}\n${key}=${value}\n`,
  );
}

// ============================================================================
// Supported credentials and optional seed projection
// ============================================================================

test("strict host audit accepts platform-api credentials and deployed templates", (t) => {
  const result = audit(fixture(t));
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /\[env-audit\] OK/u);
});

test("platform-api hash projection may be blank without blocking deployment", (t) => {
  const root = fixture(t);
  setKey(
    root,
    "runtime/.env.auth-bff",
    "OIDC_CLIENT_SECRET_HASH_PLATFORM_API",
    "",
  );
  const result = audit(root);
  assert.equal(result.status, 0, result.output);
});

test("strict audit still rejects an unprovisioned platform-api plaintext secret", (t) => {
  const root = fixture(t);
  setKey(root, "runtime/.env.platform-api", "OIDC_CLIENT_SECRET", "");
  const result = audit(root);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Found 1 issue\(s\)/u);
  assert.match(
    result.output,
    /ERROR env\/runtime-placeholder .*OIDC_CLIENT_SECRET/u,
  );
});

// ============================================================================
// Credential separation remains enforced for runtime and templates
// ============================================================================

for (const relative of [
  "runtime/.env.platform-api",
  "deploy/.env.platform-api.example",
]) {
  for (const key of [
    "OIDC_CLIENT_SECRET_HASH_PLATFORM_API",
    "OIDC_CLIENT_SECRET_HASH_UNREGISTERED_CLIENT",
    "OIDC_SIGNING_PRIVATE_KEY",
    "OIDC_ACTIVE_KID",
    "DATABASE_URL",
  ]) {
    test(`${relative} rejects misplaced ${key}`, (t) => {
      const root = fixture(t);
      setKey(root, relative, key, "fixture-misplaced-value");
      const result = audit(root);
      assert.equal(result.status, 1, result.output);
      assert.ok(
        result.output
          .split(/\r?\n/u)
          .some(
            (line) =>
              line.includes("ERROR env/forbidden-key") &&
              line.includes(relative) &&
              line.includes(`${key} belongs to another env scope.`),
          ),
        result.output,
      );
      assert.equal(result.output.includes("fixture-misplaced-value"), false);
    });
  }
}

test("auth-bff still rejects a plaintext client secret", (t) => {
  const root = fixture(t);
  setKey(root, "runtime/.env.auth-bff", "OIDC_CLIENT_SECRET", CLIENT_SECRET);
  const result = audit(root);
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /ERROR env\/forbidden-key .*OIDC_CLIENT_SECRET belongs/u,
  );
});

test("the optional platform-api hash does not relax required RP hashes", (t) => {
  const root = fixture(t);
  setKey(root, "runtime/.env.auth-bff", "OIDC_CLIENT_SECRET_HASH_WEBSITE", "");
  const result = audit(root);
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /ERROR env\/runtime-placeholder .*OIDC_CLIENT_SECRET_HASH_WEBSITE/u,
  );
});

test("strict audit still rejects duplicate plaintext client secrets", (t) => {
  const root = fixture(t);
  const file = join(root, "runtime/.env.platform-api");
  writeFileSync(
    file,
    `${readFileSync(file, "utf8")}\nOIDC_CLIENT_SECRET=${CLIENT_SECRET}\n`,
  );
  const result = audit(root);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /ERROR env\/duplicate-key .*OIDC_CLIENT_SECRET/u);
});
