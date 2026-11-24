/**
 * Compile reviewed non-secret scopes into an inert registration SQL artifact.
 * @package @vxture/repo
 * @layer Application
 * @category operations
 * @author AI-Generated
 * @date 2026-11-25
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBatch } from "./collect-sync.mjs";

/** Prepare disabled registrations without opening a database connection. @param value - Explicit batch config. @returns Transactional SQL for separate review/application. @throws Error On invalid or conflicting scope identities. */
export function registrationSql(value) {
  const scopes = validateBatch(value);
  if (new Set(scopes.map((scope) => scope.clientId)).size !== scopes.length)
    throw new Error("One immutable binding per client is required");
  const payload = Buffer.from(JSON.stringify(scopes), "utf8").toString("hex");
  // Hex data cannot terminate either the SQL string or the outer DO delimiter.
  return `-- Generated disabled registrations; review target scopes before applying.
-- Existing enabled rows remain unchanged; this does not activate event delivery.
${scopes.map((scope) => "-- " + JSON.stringify(scope)).join("\n")}
BEGIN;
SET LOCAL standard_conforming_strings=on;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $registration$
DECLARE target jsonb; client appoidc.oidc_clients%ROWTYPE;
        stream session.identity_recovery_streams%ROWTYPE;
        receiver session.identity_change_receivers%ROWTYPE;
BEGIN
  FOR target IN SELECT value FROM jsonb_array_elements(convert_from(decode('${payload}','hex'),'UTF8')::jsonb) LOOP
    SELECT * INTO client FROM appoidc.oidc_clients WHERE client_id=target->>'clientId' FOR SHARE;
    IF NOT FOUND OR client.realm IS DISTINCT FROM target->>'realm'
      OR client.client_kind IS DISTINCT FROM 'platform' OR client.status IS DISTINCT FROM 'active'
      OR client.token_endpoint_auth_method IS DISTINCT FROM 'client_secret_basic'
      OR client.slo_participation IS DISTINCT FROM 'back_channel'
      OR client.release_channel IS DISTINCT FROM target->>'releaseChannel'
      OR client.back_channel_logout_uri IS DISTINCT FROM target->>'logoutUri' THEN
      RAISE EXCEPTION 'Client binding mismatch: %', target->>'clientId';
    END IF;
    INSERT INTO session.identity_recovery_streams(client_id,issuer,realm,environment,release_channel,logout_uri,enabled)
      VALUES(target->>'clientId',target->>'issuer',target->>'realm',target->>'environment',target->>'releaseChannel',target->>'logoutUri',false)
      ON CONFLICT(client_id) DO NOTHING;
    SELECT * INTO stream FROM session.identity_recovery_streams WHERE client_id=target->>'clientId' FOR UPDATE;
    IF stream.issuer IS DISTINCT FROM target->>'issuer' OR stream.realm IS DISTINCT FROM target->>'realm'
      OR stream.environment IS DISTINCT FROM target->>'environment' OR stream.release_channel IS DISTINCT FROM target->>'releaseChannel'
      OR stream.logout_uri IS DISTINCT FROM target->>'logoutUri' THEN
      RAISE EXCEPTION 'Immutable recovery binding mismatch: %', target->>'clientId';
    END IF;
    INSERT INTO session.identity_change_streams(stream_id,enabled) VALUES(stream.stream_id,false)
      ON CONFLICT(stream_id) DO NOTHING;
    INSERT INTO session.identity_change_receivers(stream_id,receiver_uri,enabled) VALUES(stream.stream_id,target->>'receiverUri',false)
      ON CONFLICT(stream_id) DO NOTHING;
    SELECT * INTO receiver FROM session.identity_change_receivers WHERE stream_id=stream.stream_id FOR UPDATE;
    IF receiver.receiver_uri IS DISTINCT FROM target->>'receiverUri' THEN
      RAISE EXCEPTION 'Immutable receiver binding mismatch: %', target->>'clientId';
    END IF;
  END LOOP;
END;
$registration$;
COMMIT;
`;
}

// ===========================================================================
// stdout is a review artifact; this command never connects or applies SQL.
// ===========================================================================
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--config")
      throw new Error("Use --config <batch.json>");
    process.stdout.write(
      registrationSql(JSON.parse(await readFile(process.argv[3], "utf8"))),
    );
  } catch {
    process.stderr.write(
      "Registration plan rejected: invalid or conflicting non-secret scopes.\n",
    );
    process.exitCode = 1;
  }
}
