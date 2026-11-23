/**
 * ruyin-desktop-registration.test.mjs - Opt-in platform-client registration contracts.
 * @package @vxture/repo
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-22
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { seedRuyinDesktopClient } from "../seed/seed-catalog.mjs";
import { loadPg } from "../seed/seed-lib.mjs";

const hash = "$2b$10$" + "a".repeat(53);
const env = {
  RUYIN_BFF_BASE: "https://desktop.example.test/",
  OIDC_CLIENT_SECRET_HASH_RUYIN_DESKTOP: hash,
};
const recorder = (result = 1, conflicts = []) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return /^\s*select/.test(sql)
        ? { rows: conflicts }
        : { rows: [], rowCount: result };
    },
  };
};

// ============================================================================
// Real CLI rejection occurs before database configuration or any seed writes.
// ============================================================================
for (const args of [
  ["--ruyin-desktop-ony"],
  ["--unknown"],
  ["--ruyin-desktop-only", "extra"],
  ["--customer-portal-only", "extra"],
]) {
  test(`catalog CLI rejects unsupported arguments before connecting: ${args.join(" ")}`, () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../seed/seed-catalog.mjs", import.meta.url)),
        ...args,
      ],
      {
        encoding: "utf8",
        timeout: 5000,
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://fixture@127.0.0.1:1/never_connect",
          NODE_OPTIONS: "",
        },
      },
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Unknown catalog seed option/);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /Connected to|Seed failed|ECONNREFUSED|fixture@/,
    );
  });
}

test("missing explicit desktop origin leaves the existing catalog untouched", async () => {
  const db = recorder();
  await seedRuyinDesktopClient(db, {});
  await seedRuyinDesktopClient(db, { RUYIN_BFF_BASE: " " });
  assert.equal(db.calls.length, 0);
});

test("configured registration is platform/customer, exact callback, PKCE and back-channel only", async () => {
  const db = recorder();
  await seedRuyinDesktopClient(db, env);
  assert.equal(db.calls.length, 2);
  assert.deepEqual(db.calls[0].params, [
    "https://desktop.example.test/auth/callback",
  ]);
  assert.deepEqual(db.calls[1].params, [
    hash,
    ["https://desktop.example.test/auth/callback"],
    "https://desktop.example.test/auth/backchannel-logout",
  ]);
  assert.match(
    db.calls[1].sql,
    /'ruyin-desktop', 'customer', 'platform', null, 'stable'/,
  );
  assert.match(db.calls[1].sql, /true, 'client_secret_basic', 'back_channel'/);
  assert.doesNotMatch(db.calls[1].sql, /update set\s+status/i);
});

for (const origin of [
  "bad-url",
  "http://remote.test",
  "https://u:p@desktop.test",
  "https://desktop.test/api",
  "https://desktop.test/?x=1",
  "https://desktop.test/#x",
  "file:///tmp",
])
  test(`invalid origin is refused before any catalog write: ${origin}`, async () => {
    const db = recorder();
    await assert.rejects(
      seedRuyinDesktopClient(db, { ...env, RUYIN_BFF_BASE: origin }),
    );
    assert.equal(db.calls.length, 0);
  });
for (const value of ["plaintext-secret", "$2b$10$short", "not-bcrypt"])
  test(`missing or non-bcrypt desktop hash is refused: ${String(value)}`, async () => {
    const db = recorder();
    await assert.rejects(
      seedRuyinDesktopClient(db, {
        ...env,
        OIDC_CLIENT_SECRET_HASH_RUYIN_DESKTOP: value,
      }),
    );
    assert.equal(db.calls.length, 0);
  });
test("loopback HTTP is available for an isolated test without allocating a default", async () => {
  const db = recorder();
  await seedRuyinDesktopClient(db, {
    ...env,
    RUYIN_BFF_BASE: "http://127.0.0.1:4567",
  });
  assert.equal(db.calls[0].params[0], "http://127.0.0.1:4567/auth/callback");
});
test("bootstrap without a hash is uncredentialed and reseed cannot erase a provisioned hash", async () => {
  const db = recorder();
  await seedRuyinDesktopClient(db, { RUYIN_BFF_BASE: env.RUYIN_BFF_BASE });
  assert.equal(db.calls[1].params[0], null);
  assert.match(
    db.calls[1].sql,
    /coalesce\(excluded.client_secret_hash, existing.client_secret_hash\)/,
  );
});
test("another client's callback is never reassigned", async () => {
  const db = recorder(1, [{ client_id: "workbench" }]);
  await assert.rejects(seedRuyinDesktopClient(db, env), /already registered/);
  assert.equal(db.calls.length, 1);
});
test("a conflicting client kind/realm/auth method is rejected instead of overwritten", async () => {
  await assert.rejects(seedRuyinDesktopClient(recorder(0), env), /conflicts/);
});

// ============================================================================
// Dedicated synthetic PostgreSQL only; no ambient application URL and no reset
// ============================================================================

test(
  "real PostgreSQL: repeatability, public-client preservation, conflicts and browser registration preservation",
  { skip: process.env.RUYIN_REGISTRATION_ITEST !== "1" },
  async () => {
    let target;
    try {
      target = new URL(process.env.RUYIN_REGISTRATION_TEST_URL ?? "");
    } catch {
      throw new Error("An isolated loopback registration test URL is required");
    }
    assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
    assert.match(target.pathname, /^\/workbench_desktop_itest_[a-z0-9]+$/);
    const pg = await loadPg(),
      { Client } = pg.default ?? pg;
    const db = new Client({ connectionString: target.href });
    await db.connect();
    try {
      await db.query("BEGIN");
      assert.equal(
        Number(
          (await db.query("select count(*) from appoidc.oidc_clients")).rows[0]
            .count,
        ),
        0,
        "registration tests require an empty isolated client catalog",
      );
      for (const name of ["ruyin", "ruyin-beta"])
        await db.query(
          "insert into appoidc.oidc_clients(client_id,client_kind,realm,redirect_uris,token_endpoint_auth_method,pkce_required) values($1,'platform','customer',array['http://127.0.0.1/oauth/callback'],'none',true)",
          [name],
        );
      await db.query(
        "insert into appoidc.oidc_clients(client_id,client_kind,realm,redirect_uris,client_secret_hash,token_endpoint_auth_method,pkce_required) values('workbench','platform','customer',array['https://ruyin.work/auth/callback'],$1,'client_secret_basic',true)",
        ["$2b$12$" + "b".repeat(53)],
      );
      const previous = (
        await db.query("select * from appoidc.oidc_clients order by client_id")
      ).rows;
      await seedRuyinDesktopClient(db, env);
      const first = (
        await db.query(
          "select * from appoidc.oidc_clients where client_id='ruyin-desktop'",
        )
      ).rows[0];
      await seedRuyinDesktopClient(db, env);
      const second = (
        await db.query(
          "select * from appoidc.oidc_clients where client_id='ruyin-desktop'",
        )
      ).rows[0];
      assert.equal(first.id, second.id);
      assert.equal(second.product_id, null);
      assert.equal(second.client_secret_hash, hash);
      assert.equal(second.pkce_required, true);
      await seedRuyinDesktopClient(db, { RUYIN_BFF_BASE: env.RUYIN_BFF_BASE });
      assert.equal(
        (
          await db.query(
            "select client_secret_hash from appoidc.oidc_clients where client_id='ruyin-desktop'",
          )
        ).rows[0].client_secret_hash,
        hash,
      );
      assert.equal(
        Number(
          (await db.query("select count(*) from product.products")).rows[0]
            .count,
        ),
        0,
      );
      assert.deepEqual(
        (
          await db.query(
            "select * from appoidc.oidc_clients where client_id in ('ruyin','ruyin-beta','workbench') order by client_id",
          )
        ).rows,
        previous,
      );
      await db.query(
        "update appoidc.oidc_clients set status='inactive' where client_id='ruyin-desktop'",
      );
      await seedRuyinDesktopClient(db, env);
      assert.equal(
        (
          await db.query(
            "select status from appoidc.oidc_clients where client_id='ruyin-desktop'",
          )
        ).rows[0].status,
        "inactive",
      );
      await db.query(
        "update appoidc.oidc_clients set realm='workforce' where client_id='ruyin-desktop'",
      );
      await assert.rejects(seedRuyinDesktopClient(db, env), /conflicts/);
      assert.equal(
        (
          await db.query(
            "select realm from appoidc.oidc_clients where client_id='ruyin-desktop'",
          )
        ).rows[0].realm,
        "workforce",
      );
      await db.query("ROLLBACK");
    } finally {
      await db.query("ROLLBACK").catch(() => {});
      await db.end();
    }
  },
);
