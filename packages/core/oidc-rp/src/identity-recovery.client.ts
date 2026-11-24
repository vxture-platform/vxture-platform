/**
 * Bounded logout-v1 recovery transport for confidential relying parties.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category client
 * @author AI-Generated
 * @date 2026-11-24
 */
import type { OidcRpConfig } from "./types";

// ============================================================================
// Only the implemented logout recovery profile is accepted by this client.
// ============================================================================
export type IdentityRealm = "customer" | "workforce";
export type IdentityEnvironment = "prod" | "beta" | "dev";
export type RecoverySession =
  | { sid: string; state: "inactive" | "not_bound" }
  | {
      sid: string;
      state: "active";
      sub: string;
      absolute_expires_at: string;
    };
export interface RecoverySnapshot {
  watermark: string;
  sessions: RecoverySession[];
}
export interface LogoutRecoveryPage {
  events: {
    event_id: string;
    subject: { sid: string; sub: string };
    cursor: string;
  }[];
  next_cursor: string;
  has_more: boolean;
}
export interface IdentityRecoveryClient {
  snapshot(sids: string[]): Promise<RecoverySnapshot>;
  events(cursor: string): Promise<LogoutRecoveryPage>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid identity recovery object");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 512): string {
  if (typeof value !== "string" || !value.length || value.length > max)
    throw new Error("Invalid identity recovery field");
  return value;
}

export class HttpIdentityRecoveryClient implements IdentityRecoveryClient {
  constructor(
    private readonly config: OidcRpConfig,
    private readonly environment: IdentityEnvironment,
    private readonly profile: "logout-v1" | "changes-v1" = "logout-v1",
    private readonly realm: IdentityRealm = "customer",
  ) {}

  protected async request(
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const url = new URL(
      `/oidc/identity/${path}`,
      this.config.backchannelIssuer ?? this.config.issuer,
    );
    const credentials = `${encodeURIComponent(this.config.clientId)}:${encodeURIComponent(this.config.clientSecret)}`;
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
      },
      body: JSON.stringify(body),
    });
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error("Identity recovery unavailable");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1048576)
          throw new Error("Identity recovery response exceeds limit");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const data = record(
      JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
    );
    const scope = record(data.binding);
    if (
      scope.issuer !== this.config.issuer ||
      scope.audience !== this.config.clientId ||
      scope.realm !== this.realm ||
      scope.environment !== this.environment ||
      scope.profile !== this.profile
    )
      throw new Error("Identity recovery scope mismatch");
    return data;
  }

  /**
   * Request a consistent snapshot without interpreting outages as revocation.
   * @param sids Central identities currently held by this RP.
   * @returns Validated snapshot for exactly the requested set.
   * @throws Error For transport, scope, shape or identity failures.
   */
  async snapshot(sids: string[]): Promise<RecoverySnapshot> {
    if (sids.length > 100 || new Set(sids).size !== sids.length)
      throw new Error("Invalid snapshot request");
    const data = await this.request("snapshot", { sids });
    if (!Array.isArray(data.sessions) || data.sessions.length !== sids.length)
      throw new Error("Incomplete snapshot");
    const seen = new Set<string>();
    const sessions = data.sessions.map((value: unknown): RecoverySession => {
      const row = record(value);
      const sid = text(row.sid, 64);
      if (!sids.includes(sid) || seen.has(sid))
        throw new Error("Unexpected snapshot identity");
      seen.add(sid);
      if (row.state === "inactive" || row.state === "not_bound")
        return { sid, state: row.state };
      if (
        row.state !== "active" ||
        row.session_version !== "1" ||
        typeof row.context_version !== "string" ||
        !/^\d{1,19}$/.test(row.context_version)
      )
        throw new Error("Invalid snapshot state");
      if (
        this.realm === "workforce" &&
        (row.context !== null || row.context_version !== "0")
      )
        throw new Error("Invalid workforce context");
      const sub = text(row.sub, 128);
      const expiry = text(row.absolute_expires_at, 40);
      if (
        !sub.startsWith(this.realm === "customer" ? "usr_" : "opr_") ||
        !Number.isFinite(Date.parse(expiry))
      )
        throw new Error("Invalid snapshot identity or expiry");
      return { sid, state: "active", sub, absolute_expires_at: expiry };
    });
    return { watermark: text(data.watermark), sessions };
  }

  /**
   * Continue a finite recovery run; callers must never schedule idle polling.
   * @param cursor Authenticated position returned by the recovery API.
   * @returns Validated irreversible logout events and continuation.
   * @throws Error On unknown event types, scopes, malformed data or failed transport.
   */
  async events(cursor: string): Promise<LogoutRecoveryPage> {
    const data = await this.request("events", { cursor, limit: 100 });
    if (
      !Array.isArray(data.events) ||
      data.events.length > 100 ||
      typeof data.has_more !== "boolean"
    )
      throw new Error("Invalid recovery page");
    return {
      next_cursor: text(data.next_cursor),
      has_more: data.has_more,
      events: data.events.map((value: unknown) => {
        const event = record(value);
        const subject = record(event.subject);
        if (
          event.schema_version !== 1 ||
          event.type !== "session.revoked" ||
          event.version !== "2" ||
          event.issuer !== this.config.issuer ||
          event.audience !== this.config.clientId ||
          event.realm !== this.realm ||
          event.environment !== this.environment
        )
          throw new Error("Invalid recovery event scope or type");
        const sub = text(subject.sub, 128);
        const sid = text(subject.sid, 64);
        const eventId = text(event.event_id, 36);
        if (
          !sub.startsWith(this.realm === "customer" ? "usr_" : "opr_") ||
          sub.length <= 4 ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(sid) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            eventId,
          )
        )
          throw new Error("Invalid recovery subject");
        return {
          event_id: eventId,
          subject: { sid, sub },
          cursor: text(event.cursor),
        };
      }),
    };
  }
}
