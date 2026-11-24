/**
 * RP durable logout receipts and finite request-time recovery.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category auth
 * @author AI-Generated
 * @date 2026-11-24
 */
import type { IdentitySqlPool } from "./identity-persistence";
import type {
  IdentityEnvironment,
  IdentityRealm,
  IdentityRecoveryClient,
} from "./identity-recovery.client";
import type { RpSession } from "./types";
import type { RpSessionAuthority } from "./rp-session.store";

// ============================================================================
// Positive recovery confirmations are process-local; revocations are durable.
// ============================================================================
export class SessionRecoveryAuthority implements RpSessionAuthority {
  private generation = 0;
  private readonly confirmed = new Map<
    string,
    { sub: string; expires: number }
  >();
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(
    private readonly pool: IdentitySqlPool,
    private readonly recovery: IdentityRecoveryClient,
    private readonly scope: {
      realm?: IdentityRealm;
      issuer: string;
      clientId: string;
      environment: IdentityEnvironment;
    },
  ) {}

  /** Clear only confirmations after reconnect; never clear durable revocations. */
  reset(): void {
    this.generation += 1;
    this.confirmed.clear();
    this.pending.clear();
  }

  /** @returns The already recovered central deadline; never extends its lifetime. */
  confirmedUntil(session: RpSession): number {
    const known = this.confirmed.get(session.sid);
    if (known?.sub !== session.sub || known.expires <= Date.now())
      throw new Error("Session recovery confirmation required");
    return known.expires;
  }

  /** @returns Completion of owned pool cleanup during Nest shutdown. */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async revoked(sid: string): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from session.rp_revocation_receipts
      where issuer=$1 and client_id=$2 and realm=$5 and environment=$3 and sid=$4`,
      [
        this.scope.issuer,
        this.scope.clientId,
        this.scope.environment,
        sid,
        this.scope.realm ?? "customer",
      ],
    );
    return Boolean(result.rowCount);
  }

  /**
   * Persist a terminal sid receipt; repeat deliveries are harmless.
   * @param sid Identity from a verified standard logout or trusted recovery API.
   * @returns Only after durable commit, before Redis cleanup/HTTP ACK.
   */
  async revoke(sid: string): Promise<void> {
    await this.pool.query(
      `insert into session.rp_revocation_receipts(issuer,client_id,realm,environment,sid)
      values($1,$2,$5,$3,$4) on conflict do nothing`,
      [
        this.scope.issuer,
        this.scope.clientId,
        this.scope.environment,
        sid,
        this.scope.realm ?? "customer",
      ],
    );
    this.confirmed.delete(sid);
  }

  /**
   * Validate restored sessions once per process/Redis connection generation.
   * @param session Existing RP identity, never a browser-supplied sid.
   * @returns Whether the identity has recovered and remains unrevoked locally.
   * @throws Error While central/local authority is unavailable; caller returns 503.
   */
  async accepts(session: RpSession): Promise<boolean> {
    if (
      !session.sub.startsWith(
        this.scope.realm === "workforce" ? "opr_" : "usr_",
      ) ||
      (await this.revoked(session.sid))
    )
      return false;
    const known = this.confirmed.get(session.sid);
    if (known?.sub === session.sub && known.expires > Date.now()) return true;
    const key = `${this.generation}:${session.sid}:${session.sub}`;
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.recover(session, this.generation);
      this.pending.set(key, pending);
    }
    try {
      return await pending;
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }

  private async recover(
    session: RpSession,
    generation: number,
  ): Promise<boolean> {
    const snapshot = await this.recovery.snapshot([session.sid]);
    const central = snapshot.sessions[0];
    if (!central || central.sid !== session.sid)
      throw new Error("Incomplete identity recovery");
    if (central.state === "inactive") {
      await this.revoke(session.sid);
      return false;
    }
    if (central.state !== "active" || central.sub !== session.sub) return false;
    let cursor = snapshot.watermark;
    // Bounded catch-up. A busy or unavailable source keeps this request closed.
    for (let page = 0; page < 20; page += 1) {
      const changes = await this.recovery.events(cursor);
      for (const event of changes.events) await this.revoke(event.subject.sid);
      if (!changes.has_more) {
        if (await this.revoked(session.sid)) return false;
        if (generation !== this.generation)
          throw new Error("Redis reconnected during identity recovery");
        const expires = Date.parse(central.absolute_expires_at);
        if (expires <= Date.now()) return false;
        // Bound local memory; eviction only causes another finite recovery.
        if (this.confirmed.size >= 10000) this.confirmed.clear();
        this.confirmed.set(session.sid, { sub: session.sub, expires });
        return true;
      }
      if (cursor === changes.next_cursor || !changes.events.length)
        throw new Error("Identity recovery made no progress");
      cursor = changes.next_cursor;
    }
    throw new Error("Identity recovery backlog exceeds request budget");
  }
}
