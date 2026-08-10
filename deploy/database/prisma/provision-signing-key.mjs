/**
 * provision-signing-key.mjs — provision an RS256 signing key for the IdP.
 *
 * Identity Platform §6.3/§5.7: access tokens are RS256; the PUBLIC JWK lives in
 * appoidc.signing_keys (served via /oidc/jwks), the PRIVATE key lives in a secret
 * manager (never in the DB).
 *
 * Table name corrected 2026-08-10: this script still wrote `iam.signing_key`,
 * the pre-cutover 8-schema name. The 19-schema DDL (B15, 2026-07-02) renamed it
 * to `appoidc.signing_keys`, so every run since has failed with
 * `relation "iam.signing_key" does not exist`. Nothing noticed because the key
 * is provisioned once at bootstrap and production's predates the cutover — the
 * script would only have been reached again at a ROTATION, i.e. the one moment
 * when it must not fail. Found while bootstrapping a local stack, where the
 * missing key surfaces as `/oidc/jwks` → 500 and no login can complete. This script generates a keypair, stores the public
 * JWK as the active key, and prints the private key + kid for the auth-bff env.
 *
 * Idempotent: refuses to create a second active key (prints the existing kid).
 * Use --force to rotate (current active → retiring, new key → active).
 *
 * Usage:  DATABASE_URL=... node provision-signing-key.mjs [--force]
 *   then set in the auth-bff secret env:
 *     OIDC_ACTIVE_KID=<printed kid>
 *     OIDC_SIGNING_PRIVATE_KEY=<printed base64 PKCS8 PEM>
 */

import { generateKeyPairSync, createHash } from "node:crypto";
import { loadDatabaseUrl, loadPg } from "./seed-lib.mjs";

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7638 JWK thumbprint (canonical {e,kty,n}) → stable kid. */
function rfc7638Thumbprint(jwk) {
  const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
  return base64url(createHash("sha256").update(canonical).digest());
}

const force = process.argv.includes("--force");
const url = loadDatabaseUrl();
const pg = await loadPg();
const { Client } = pg.default ?? pg;
const c = new Client({ connectionString: url });
await c.connect();
try {
  const existing = await c.query(`select kid from appoidc.signing_keys where status='active' limit 1`);
  if (existing.rows[0] && !force) {
    console.log(`Signing key already provisioned (active kid=${existing.rows[0].kid}). Use --force to rotate.`);
    process.exit(0);
  }

  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }); // { kty, n, e }
  const kid = rfc7638Thumbprint(jwk);
  const publicJwk = { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", use: "sig", kid };
  const pkcs8Pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

  if (force) {
    await c.query(`update appoidc.signing_keys set status='retiring', retiring_at=now() where status='active'`);
  }
  await c.query(
    `insert into appoidc.signing_keys (kid, algorithm, public_jwk, status, activated_at, created_at)
     values ($1, 'RS256', $2, 'active', now(), now())
     on conflict (kid) do update set status='active', public_jwk=excluded.public_jwk, activated_at=now()`,
    [kid, JSON.stringify(publicJwk)],
  );

  const b64 = Buffer.from(pkcs8Pem).toString("base64");
  console.log("✓ Provisioned RS256 signing key into appoidc.signing_keys (status=active).");
  console.log("\nSet these in the auth-bff secret env (private key is NOT stored in the DB):\n");
  console.log(`OIDC_ACTIVE_KID=${kid}`);
  console.log(`OIDC_SIGNING_PRIVATE_KEY=${b64}`);
} finally {
  await c.end();
}
