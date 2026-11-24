/**
 * Consistent customer snapshots and commit-ordered logout recovery.
 * @package @vxture/bff-auth
 * @layer Application
 * @category repository
 * @author AI-Generated
 * @date 2026-11-24
 */
import { Inject, Injectable, HttpException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { SESSION_PG_POOL } from "./tokens";

// ============================================================================
// Explicit client scope and opaque authenticated cursors
// ============================================================================
export type RecoveryProfile = "logout-v1" | "changes-v1";
interface Stream {
  profile: RecoveryProfile;
  stream_id: string;
  client_id: string;
  issuer: string;
  environment: string;
  realm: "customer" | "workforce";
  release_channel: string;
  logout_uri: string;
  cursor_key: string;
  last_sequence: string;
}
const WINDOW = 7 * 86400;

/** @returns A protocol error without leaking identifiers or database details. */
export function recoveryError(code: string, status = 400): HttpException {
  return new HttpException(
    {
      code,
      message: "Identity recovery request could not be completed",
      retryable: status >= 500 || status === 429,
    },
    status,
  );
}
function binding(stream: Stream) {
  return {
    issuer: stream.issuer,
    audience: stream.client_id,
    realm: stream.realm,
    environment: stream.environment,
    profile: stream.profile,
  };
}
function mac(stream: Stream, payload: string): Buffer {
  return createHmac("sha256", stream.cursor_key)
    .update(JSON.stringify(binding(stream)))
    .update(".")
    .update(payload)
    .digest();
}
function cursor(stream: Stream, sequence: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      s: stream.stream_id,
      p: sequence,
      t: Math.floor(Date.now() / 1000),
    }),
  ).toString("base64url");
  return `${payload}.${mac(stream, payload).toString("base64url")}`;
}
function position(stream: Stream, token: string): string {
  const parts = token.split(".");
  const payload = parts[0] ?? "";
  const signature = parts[1] ?? "";
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]+$/.test(payload) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  )
    throw recoveryError("SCOPE_MISMATCH", 403);
  const supplied = Buffer.from(signature, "base64url");
  const expected = mac(stream, payload);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw recoveryError("SCOPE_MISMATCH", 403);
  let data: { s?: unknown; p?: unknown; t?: unknown };
  try {
    data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as typeof data;
  } catch {
    throw recoveryError("INVALID_REQUEST");
  }
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    data.s !== stream.stream_id ||
    typeof data.p !== "string" ||
    !/^\d{1,19}$/.test(data.p) ||
    BigInt(data.p) > BigInt(stream.last_sequence) ||
    typeof data.t !== "number" ||
    !Number.isSafeInteger(data.t)
  )
    throw recoveryError("SCOPE_MISMATCH", 403);
  const age = Math.floor(Date.now() / 1000) - data.t;
  if (age < -60) throw recoveryError("INVALID_REQUEST");
  if (age > WINDOW) throw recoveryError("CURSOR_EXPIRED", 410);
  return data.p;
}

// ============================================================================
// MVCC snapshot sees both a committed status transition and its stream position.
// ============================================================================
@Injectable()
export class IdentityRecoveryRepository {
  constructor(@Inject(SESSION_PG_POOL) private readonly pool: Pool) {}

  /** @returns A signed-cursor event for one leased delivery under current registration. */
  deliveryEvent(clientId: string, issuer: string, sequence: string) {
    return this.read(
      clientId,
      issuer,
      async (tx, stream) => {
        const result = await tx.query<{
          event_id: string;
          type: string;
          user_id: string;
          sid: string | null;
          version: string;
          occurred_at: Date;
          org_id: string | null;
          workspace_id: string | null;
          product_id: string | null;
        }>(
          `select f.* from session.identity_change_events e
        join session.identity_change_outbox f on f.event_id=e.event_id
        where e.stream_id=$1 and e.sequence=$2 and f.realm=$3`,
          [stream.stream_id, sequence, stream.realm],
        );
        const row = result.rows[0];
        if (!row) throw recoveryError("CURSOR_EXPIRED", 410);
        return {
          schema_version: 1,
          type: row.type,
          event_id: row.event_id,
          occurred_at: row.occurred_at.toISOString(),
          issuer: stream.issuer,
          audience: stream.client_id,
          realm: stream.realm,
          environment: stream.environment,
          cursor: cursor(stream, sequence),
          version: row.version,
          subject:
            row.type === "identity.access_changed"
              ? {
                  sub: `${stream.realm === "workforce" ? "opr_" : "usr_"}${row.user_id}`,
                }
              : {
                  sub: `${stream.realm === "workforce" ? "opr_" : "usr_"}${row.user_id}`,
                  sid: row.sid,
                },
          ...(row.type === "identity.access_changed"
            ? {
                scope: {
                  org_id: row.org_id,
                  workspace_id: row.workspace_id,
                  product_id: row.product_id,
                },
              }
            : {}),
        };
      },
      "changes-v1",
    );
  }

  private async read<T>(
    clientId: string,
    issuer: string,
    action: (tx: PoolClient, stream: Stream) => Promise<T>,
    profile: RecoveryProfile = "logout-v1",
  ): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query("begin isolation level repeatable read read only");
      const result = await tx.query<Stream>(
        `select s.*${profile === "changes-v1" ? ",changes.last_sequence" : ""} from session.identity_recovery_streams s
        join appoidc.oidc_clients c on c.client_id=s.client_id
        ${profile === "changes-v1" ? "join session.identity_change_streams changes on changes.stream_id=s.stream_id and changes.enabled" : ""}
        where s.client_id=$1 and s.enabled and s.issuer=$2 and c.realm=s.realm AND s.realm IN ('customer','workforce')
          and c.status='active' and c.token_endpoint_auth_method='client_secret_basic'
          and c.release_channel=s.release_channel and c.slo_participation='back_channel'
          and c.back_channel_logout_uri=s.logout_uri
          ${profile === "changes-v1" ? "and c.client_kind='platform'" : ""}`,
        [clientId, issuer],
      );
      const stream = result.rows[0];
      if (
        !stream ||
        (stream.realm === "workforce" &&
          process.env.WORKFORCE_IDENTITY_SYNC_ENABLED !== "true")
      )
        throw recoveryError("CAPABILITY_NOT_ENABLED", 403);
      stream.profile = profile;
      const value = await action(tx, stream);
      await tx.query("commit");
      return value;
    } catch (error) {
      await tx.query("rollback");
      throw error;
    } finally {
      tx.release();
    }
  }

  /**
   * Read only sessions durably bound to this exact client registration.
   * @param clientId Authenticated confidential customer client.
   * @param issuer Trusted server issuer.
   * @param sids Bounded local session identities requested by the RP.
   * @returns Coherent central state and the same snapshot's committed watermark.
   */
  snapshot(
    clientId: string,
    issuer: string,
    sids: string[],
    profile: RecoveryProfile = "logout-v1",
  ) {
    return this.read(
      clientId,
      issuer,
      async (tx, stream) => {
        const result = await tx.query<{
          sid: string;
          user_id: string;
          active: boolean;
          expires_at: Date;
          active_org_id: string | null;
          active_workspace_id: string | null;
          context_version: string;
          authorization_version?: string;
        }>(
          `select s.sid,s.user_id,s.status='active' and s.expires_at>now() as active,
          s.expires_at,s.active_org_id,s.active_workspace_id,s.context_version
          ${profile === "changes-v1" ? ",coalesce(v.version,0)::text as authorization_version" : ""}
        from session.auth_sessions s join session.oidc_session_clients b on b.sid=s.sid
        ${profile === "changes-v1" ? (stream.realm === "workforce" ? "left join session.workforce_identity_versions v on v.operator_id=s.user_id" : "left join session.identity_subject_versions v on v.user_id=s.user_id") : ""}
        where s.sid=any($1::text[]) and s.realm=$5 and b.client_id=$2
          and b.release_channel=$3 and b.logout_uri=$4`,
          [
            sids,
            clientId,
            stream.release_channel,
            stream.logout_uri,
            stream.realm,
          ],
        );
        const bySid = new Map(result.rows.map((row) => [row.sid, row]));
        return {
          binding: binding(stream),
          watermark: cursor(stream, stream.last_sequence),
          sessions: sids.map((sid) => {
            const row = bySid.get(sid);
            if (!row) return { sid, state: "not_bound" as const };
            if (!row.active) return { sid, state: "inactive" as const };
            return {
              sid,
              state: "active" as const,
              sub: `${stream.realm === "workforce" ? "opr_" : "usr_"}${row.user_id}`,
              session_version: "1",
              context_version:
                stream.realm === "workforce" ? "0" : row.context_version,
              ...(profile === "changes-v1"
                ? { authorization_version: row.authorization_version! }
                : {}),
              absolute_expires_at: row.expires_at.toISOString(),
              context:
                stream.realm === "customer" && row.active_org_id
                  ? {
                      org_id: row.active_org_id,
                      workspace_id: row.active_workspace_id,
                    }
                  : null,
            };
          }),
        };
      },
      profile,
    );
  }

  /**
   * Recover committed logout events without turning recovery into scheduled polling.
   * @param clientId Authenticated client, never selected by request fields.
   * @param issuer Server issuer.
   * @param token Signed client/scope/epoch-bound cursor.
   * @param limit Maximum page size, validated by the HTTP boundary.
   * @returns Ordered events and a contiguous committed recovery cursor.
   */
  events(
    clientId: string,
    issuer: string,
    token: string,
    limit: number,
    profile: RecoveryProfile = "logout-v1",
  ) {
    return this.read(
      clientId,
      issuer,
      async (tx, stream) => {
        const from = position(stream, token);
        const result = await tx.query<{
          sequence: string;
          event_id: string;
          sid: string;
          sub: string;
          occurred_at: Date;
          type?: "session.context_changed" | "identity.access_changed";
          version?: string;
          org_id?: string | null;
          workspace_id?: string | null;
          product_id?: string | null;
        }>(
          profile === "changes-v1"
            ? `select e.sequence,f.*, CASE WHEN f.realm='workforce' THEN 'opr_' ELSE 'usr_' END||f.user_id as sub from session.identity_change_events e
              join session.identity_change_outbox f on f.event_id=e.event_id
              where e.stream_id=$1 and e.sequence>$2 and f.realm=$4 order by e.sequence limit $3`
            : `select * from session.identity_recovery_events where stream_id=$1 and sequence>$2
              order by sequence limit $3`,
          [
            stream.stream_id,
            from,
            limit + 1,
            ...(profile === "changes-v1" ? [stream.realm] : []),
          ],
        );
        const page = result.rows.slice(0, limit);
        // Missing retained events require a fresh snapshot; never skip a hole.
        let next = BigInt(from);
        for (const row of page) {
          if (BigInt(row.sequence) !== ++next)
            throw recoveryError("CURSOR_EXPIRED", 410);
        }
        if (
          result.rows.length <= limit &&
          next !== BigInt(stream.last_sequence)
        )
          throw recoveryError("CURSOR_EXPIRED", 410);
        return {
          binding: binding(stream),
          events: page.map((row) => ({
            schema_version: 1,
            type: row.type ?? "session.revoked",
            event_id: row.event_id,
            occurred_at: row.occurred_at.toISOString(),
            issuer: stream.issuer,
            audience: stream.client_id,
            realm: stream.realm,
            environment: stream.environment,
            cursor: cursor(stream, row.sequence),
            subject:
              row.type === "identity.access_changed"
                ? { sub: row.sub }
                : { sid: row.sid, sub: row.sub },
            version: row.version ?? "2",
            ...(row.type === "identity.access_changed"
              ? {
                  scope: {
                    org_id: row.org_id ?? null,
                    workspace_id: row.workspace_id ?? null,
                    product_id: row.product_id ?? null,
                  },
                }
              : {}),
          })),
          next_cursor: cursor(stream, next.toString()),
          has_more: result.rows.length > limit,
        };
      },
      profile,
    );
  }
}
