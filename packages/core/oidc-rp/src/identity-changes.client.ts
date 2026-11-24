/**
 * Strict changes-v1 recovery and signed invalidation transport.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category client
 * @author AI-Generated
 * @date 2026-11-24
 */
import {
  createPublicKey,
  verify,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import {
  HttpIdentityRecoveryClient,
  type IdentityEnvironment,
  type IdentityRealm,
} from "./identity-recovery.client";
import type { OidcRpConfig } from "./types";

// ============================================================================
// Protocol parsing: no event grants access or carries a replacement context.
// ============================================================================
export interface IdentityChangeScope {
  realm?: IdentityRealm;
  issuer: string;
  clientId: string;
  environment: IdentityEnvironment;
}
export interface IdentityChangeEvent {
  schema_version: 1;
  type: "session.context_changed" | "identity.access_changed";
  event_id: string;
  occurred_at: string;
  issuer: string;
  audience: string;
  realm: IdentityRealm;
  environment: IdentityEnvironment;
  cursor: string;
  subject: { sub: string; sid?: string };
  version: string;
  scope?: {
    org_id: string | null;
    workspace_id: string | null;
    product_id: string | null;
  };
}
export interface IdentityChangeSnapshot {
  watermark: string;
  sessions: (
    | { sid: string; state: "inactive" | "not_bound" }
    | {
        sid: string;
        state: "active";
        sub: string;
        absolute_expires_at: string;
        context_version: string;
        authorization_version: string;
        context: { org_id: string; workspace_id: string | null } | null;
      }
  )[];
}
export interface IdentityChangesClient {
  snapshot(sids: string[]): Promise<IdentityChangeSnapshot>;
  events(cursor: string): Promise<{
    events: IdentityChangeEvent[];
    next_cursor: string;
    has_more: boolean;
  }>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid identity object");
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 512): string {
  if (typeof value !== "string" || !value.length || value.length > max)
    throw new Error("Invalid identity field");
  return value;
}
function version(value: unknown, zero = true): string {
  const result = string(value, 19);
  if (
    !/^(0|[1-9][0-9]*)$/.test(result) ||
    BigInt(result) > 9223372036854775807n ||
    (!zero && result === "0")
  )
    throw new Error("Invalid identity version");
  return result;
}
function id(value: unknown): string {
  const result = string(value, 36);
  if (!uuid.test(result)) throw new Error("Invalid identity UUID");
  return result;
}
function subject(value: unknown, realm: IdentityRealm = "customer"): string {
  const result = string(value, 128);
  if (
    !result.startsWith(realm === "customer" ? "usr_" : "opr_") ||
    !uuid.test(result.slice(4))
  )
    throw new Error("Invalid realm subject");
  return result;
}
function sid(value: unknown): string {
  const result = string(value, 64);
  if (!/^[A-Za-z0-9_-]+$/.test(result))
    throw new Error("Invalid session identity");
  return result;
}
function timestamp(value: unknown): string {
  const result = string(value, 40);
  if (
    !/^\d{4}-\d\d-\d\dT.*Z$/.test(result) ||
    !Number.isFinite(Date.parse(result))
  )
    throw new Error("Invalid identity timestamp");
  return result;
}

/** @param value Untrusted event. @param scope Trusted registration. @returns Validated event. @throws Error On malformed or mismatched data. */
export function parseIdentityChange(
  value: unknown,
  scope: IdentityChangeScope,
): IdentityChangeEvent {
  const row = object(value),
    who = object(row.subject);
  if (
    row.schema_version !== 1 ||
    row.issuer !== scope.issuer ||
    row.audience !== scope.clientId ||
    row.realm !== (scope.realm ?? "customer") ||
    row.environment !== scope.environment ||
    !["session.context_changed", "identity.access_changed"].includes(
      String(row.type),
    )
  )
    throw new Error("Identity event scope mismatch");
  const type = row.type as IdentityChangeEvent["type"];
  const event: IdentityChangeEvent = {
    schema_version: 1,
    type,
    event_id: id(row.event_id),
    occurred_at: timestamp(row.occurred_at),
    issuer: scope.issuer,
    audience: scope.clientId,
    realm: scope.realm ?? "customer",
    environment: scope.environment,
    cursor: string(row.cursor),
    version: version(row.version, false),
    subject: {
      sub: subject(who.sub, scope.realm),
      ...(type === "session.context_changed" ? { sid: sid(who.sid) } : {}),
    },
  };
  const allowed = new Set([
    "schema_version",
    "type",
    "event_id",
    "occurred_at",
    "issuer",
    "audience",
    "realm",
    "environment",
    "cursor",
    "subject",
    "version",
    ...(type === "identity.access_changed" ? ["scope"] : []),
  ]);
  if (
    Object.keys(row).some((k) => !allowed.has(k)) ||
    Object.keys(who).some(
      (k) =>
        k !== "sub" && !(k === "sid" && type === "session.context_changed"),
    )
  )
    throw new Error("Unsupported identity event field");
  if (type === "identity.access_changed") {
    const range = object(row.scope);
    if (
      Object.keys(range).some(
        (k) => !["org_id", "workspace_id", "product_id"].includes(k),
      )
    )
      throw new Error("Unsupported identity scope");
    event.scope = {
      org_id: range.org_id === null ? null : id(range.org_id),
      workspace_id: range.workspace_id === null ? null : id(range.workspace_id),
      product_id: range.product_id === null ? null : id(range.product_id),
    };
  }
  if (
    event.realm === "workforce" &&
    (event.type !== "identity.access_changed" ||
      Object.values(event.scope ?? {}).some((value) => value !== null))
  )
    throw new Error("Workforce events cannot contain customer context");
  return event;
}

// ============================================================================
// Finite snapshot/replay runs share the bounded confidential HTTP transport.
// ============================================================================
export class HttpIdentityChangesClient implements IdentityChangesClient {
  private readonly transport: ChangesTransport;
  private readonly scope: IdentityChangeScope;
  constructor(
    config: OidcRpConfig,
    environment: IdentityEnvironment,
    realm: IdentityRealm = "customer",
  ) {
    this.transport = new ChangesTransport(
      config,
      environment,
      "changes-v1",
      realm,
    );
    this.scope = {
      issuer: config.issuer,
      clientId: config.clientId,
      environment,
      realm,
    };
  }
  /** @param sids Bound sessions. @returns Consistent context and version baseline. @throws Error On transport or shape errors. */
  async snapshot(sids: string[]): Promise<IdentityChangeSnapshot> {
    if (sids.length > 100 || new Set(sids).size !== sids.length)
      throw new Error("Invalid snapshot request");
    sids.forEach(sid);
    const data = await this.transport.read("changes/snapshot", { sids });
    if (!Array.isArray(data.sessions) || data.sessions.length !== sids.length)
      throw new Error("Incomplete changes snapshot");
    const seen = new Set<string>();
    const sessions = data.sessions.map(
      (value: unknown): IdentityChangeSnapshot["sessions"][number] => {
        const row = object(value),
          sessionId = sid(row.sid);
        if (!sids.includes(sessionId) || seen.has(sessionId))
          throw new Error("Unexpected snapshot session");
        seen.add(sessionId);
        if (row.state === "inactive" || row.state === "not_bound")
          return { sid: sessionId, state: row.state };
        if (row.state !== "active" || row.session_version !== "1")
          throw new Error("Invalid snapshot state");
        const context = row.context === null ? null : object(row.context);
        if (
          this.scope.realm === "workforce" &&
          (context !== null || row.context_version !== "0")
        )
          throw new Error("Invalid workforce context");
        return {
          sid: sessionId,
          state: "active",
          sub: subject(row.sub, this.scope.realm),
          absolute_expires_at: timestamp(row.absolute_expires_at),
          context_version: version(row.context_version),
          authorization_version: version(row.authorization_version),
          context: context
            ? {
                org_id: id(context.org_id),
                workspace_id:
                  context.workspace_id === null
                    ? null
                    : id(context.workspace_id),
              }
            : null,
        };
      },
    );
    return { watermark: string(data.watermark), sessions };
  }
  /** @param cursor Trusted recovery position. @returns One bounded page. @throws Error On transport or validation errors. */
  async events(cursor: string) {
    const data = await this.transport.read("changes/events", {
      cursor: string(cursor),
      limit: 100,
    });
    if (
      !Array.isArray(data.events) ||
      data.events.length > 100 ||
      typeof data.has_more !== "boolean"
    )
      throw new Error("Invalid changes page");
    return {
      events: data.events.map((event) =>
        parseIdentityChange(event, this.scope),
      ),
      next_cursor: string(data.next_cursor),
      has_more: data.has_more,
    };
  }
}
class ChangesTransport extends HttpIdentityRecoveryClient {
  read(path: string, body: unknown) {
    return this.request(path, body);
  }
}

// ============================================================================
// The event verifier never accepts JWT-provided key URLs or OIDC token types.
// ============================================================================
export class IdentityEventVerificationError extends Error {
  constructor(readonly unavailable: boolean) {
    super(
      unavailable ? "Identity keys unavailable" : "Invalid identity envelope",
    );
  }
}
export class IdentityEventVerifier {
  private keys = new Map<string, KeyObject>();
  private pending: Promise<void> | undefined;
  private refreshedAt = 0;
  private jwksUnavailable = true;
  constructor(
    private readonly config: OidcRpConfig,
    private readonly environment: IdentityEnvironment,
    private readonly realm: IdentityRealm = "customer",
  ) {}

  private async refresh(): Promise<void> {
    if (this.pending) return this.pending;
    // Unknown-kid floods cannot create an unbounded JWKS request stream.
    if (Date.now() - this.refreshedAt < 5000)
      throw new IdentityEventVerificationError(true);
    this.refreshedAt = Date.now();
    this.pending = (async () => {
      const response = await fetch(
        new URL(
          "/oidc/jwks",
          this.config.backchannelIssuer ?? this.config.issuer,
        ),
        { redirect: "error", signal: AbortSignal.timeout(4000) },
      );
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error("JWKS unavailable");
      }
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > 65536) throw new Error("JWKS too large");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      const data = object(
        JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
      );
      if (!Array.isArray(data.keys) || data.keys.length > 32)
        throw new Error("Invalid JWKS");
      const next = new Map<string, KeyObject>();
      for (const value of data.keys) {
        const key = object(value);
        if (
          key.kty !== "RSA" ||
          (key.alg !== undefined && key.alg !== "RS256") ||
          (key.use !== undefined && key.use !== "sig")
        )
          continue;
        next.set(
          string(key.kid, 128),
          createPublicKey({ key: key as JsonWebKey, format: "jwk" }),
        );
      }
      this.keys = next;
      this.jwksUnavailable = false;
    })().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  /** @param token Compact event JWS. @returns Verified invalidation. @throws IdentityEventVerificationError For rejection or temporary key failure. */
  async verify(token: string): Promise<IdentityChangeEvent> {
    try {
      if (
        token.length > 65536 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
      )
        throw new Error("Invalid JWS");
      const [head, body, signature] = token.split(".") as [
        string,
        string,
        string,
      ];
      const header = object(
        JSON.parse(Buffer.from(head, "base64url").toString()) as unknown,
      );
      if (
        header.alg !== "RS256" ||
        header.typ !== "vxture-identity-event+jwt" ||
        Object.keys(header).some((k) => !["alg", "kid", "typ"].includes(k))
      )
        throw new Error("Invalid protected header");
      const kid = string(header.kid, 128);
      if (!this.keys.has(kid)) {
        try {
          await this.refresh();
        } catch {
          this.jwksUnavailable = true;
          throw new IdentityEventVerificationError(true);
        }
      }
      const key = this.keys.get(kid);
      if (!key && this.jwksUnavailable)
        throw new IdentityEventVerificationError(true);
      if (
        !key ||
        !verify(
          "RSA-SHA256",
          Buffer.from(`${head}.${body}`),
          key,
          Buffer.from(signature, "base64url"),
        )
      )
        throw new Error("Invalid signature");
      const claims = object(
        JSON.parse(Buffer.from(body, "base64url").toString()) as unknown,
      );
      const now = Math.floor(Date.now() / 1000);
      if (
        claims.iss !== this.config.issuer ||
        claims.aud !== this.config.clientId ||
        typeof claims.iat !== "number" ||
        typeof claims.exp !== "number" ||
        !Number.isSafeInteger(claims.iat) ||
        !Number.isSafeInteger(claims.exp) ||
        claims.iat > now + 60 ||
        claims.exp <= now - 60 ||
        claims.exp <= claims.iat ||
        claims.exp - claims.iat > 120 ||
        Object.keys(claims).some(
          (k) => !["iss", "aud", "iat", "exp", "jti", "event"].includes(k),
        )
      )
        throw new Error("Invalid envelope claims");
      id(claims.jti);
      return parseIdentityChange(claims.event, {
        issuer: this.config.issuer,
        clientId: this.config.clientId,
        environment: this.environment,
        realm: this.realm,
      });
    } catch (error) {
      if (error instanceof IdentityEventVerificationError) throw error;
      throw new IdentityEventVerificationError(false);
    }
  }
}
