/**
 * Durable invalidation receipts and finite reconstruction of trusted RP context.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category auth
 * @author AI-Generated
 * @date 2026-11-24
 */
import type {
  IdentitySqlPool,
  IdentitySqlTransaction,
} from "./identity-persistence";
import {
  parseIdentityChange,
  type IdentityChangeEvent,
  type IdentityChangeScope,
  type IdentityChangeSnapshot,
  type IdentityChangesClient,
} from "./identity-changes.client";
import type { RpSession } from "./types";
import type { SessionRecoveryAuthority } from "./session-recovery.authority";

export class IdentityChangeConflict extends Error {}
type ActiveSnapshot = Extract<
  IdentityChangeSnapshot["sessions"][number],
  { state: "active" }
>;
type Identity = Pick<RpSession, "sid" | "sub">;
type VersionState = { context: string; access: string };

// ============================================================================
// Event cursors are transport positions, never a contiguous applied watermark.
// ============================================================================
export class IdentityChangesAuthority {
  private generation = 0;
  private readonly confirmed = new Map<string, ActiveSnapshot>();
  private readonly pending = new Map<string, Promise<ActiveSnapshot | null>>();
  constructor(
    private readonly pool: IdentitySqlPool,
    private readonly client: IdentityChangesClient,
    private readonly scope: IdentityChangeScope,
    private readonly logout: SessionRecoveryAuthority,
  ) {}

  /** Invalidate only process confirmations; durable versions and logout survive. */
  reset(): void {
    this.generation++;
    this.confirmed.clear();
    this.pending.clear();
  }
  /** @returns Completion of owned pool shutdown. */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
  private get binding() {
    return [this.scope.issuer, this.scope.clientId, this.scope.environment];
  }

  /** @param event Verified signed event or authenticated recovery message. @returns Only after durable atomic application. @throws IdentityChangeConflict On changed logical content. */
  async apply(event: IdentityChangeEvent): Promise<void> {
    const validated = parseIdentityChange(event, this.scope);
    // Recovery refreshes cursor issue time. Only immutable fact content is compared.
    const fact: Partial<IdentityChangeEvent> = { ...validated };
    delete fact.cursor;
    const tx = await this.pool.connect();
    try {
      await tx.query("begin");
      const inserted = await tx.query(
        `insert into session.rp_identity_inbox(issuer,client_id,environment,event_id,fact,realm)
        values($1,$2,$3,$4,$5::jsonb,$6) on conflict do nothing returning event_id`,
        [
          ...this.binding,
          validated.event_id,
          JSON.stringify(fact),
          this.scope.realm ?? "customer",
        ],
      );
      if (!inserted.rowCount) {
        const same = await tx.query(
          `select 1 from session.rp_identity_inbox where issuer=$1 and client_id=$2 and environment=$3
          and realm=$6 and event_id=$4 and fact=$5::jsonb`,
          [
            ...this.binding,
            validated.event_id,
            JSON.stringify(fact),
            this.scope.realm ?? "customer",
          ],
        );
        if (!same.rowCount)
          throw new IdentityChangeConflict("Identity event content changed");
      } else {
        await this.advance(
          tx,
          validated.type === "session.context_changed" ? "context" : "access",
          validated.subject.sid ?? validated.subject.sub,
          validated.subject.sub,
          validated.version,
        );
      }
      await tx.query("commit");
    } catch (error) {
      await tx.query("rollback");
      throw error;
    } finally {
      tx.release();
    }
  }
  private async advance(
    tx: IdentitySqlTransaction,
    kind: "context" | "access",
    key: string,
    sub: string,
    version: string,
  ) {
    const result = await tx.query(
      `insert into session.rp_identity_versions(issuer,client_id,environment,kind,subject_key,sub,version,realm)
      values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(issuer,client_id,environment,realm,kind,subject_key)
      do update set version=greatest(session.rp_identity_versions.version,excluded.version)
      where session.rp_identity_versions.sub=excluded.sub returning version`,
      [
        ...this.binding,
        kind,
        key,
        sub,
        version,
        this.scope.realm ?? "customer",
      ],
    );
    if (!result.rowCount)
      throw new IdentityChangeConflict("Identity subject changed");
  }
  /** @param subject Verified protocol subject. @returns Durable broad invalidation version for every capability cache read. */
  async authorizationVersion(subject: string): Promise<string> {
    const result = await this.pool.query<{ version: string }>(
      `select version from session.rp_identity_versions
      where issuer=$1 and client_id=$2 and environment=$3 and realm=$5 and kind='access' and subject_key=$4`,
      [...this.binding, subject, this.scope.realm ?? "customer"],
    );
    return result.rows[0]?.version ?? "0";
  }
  /** @param identity Existing RP identity. @returns Durable barriers; notification bodies never supply versions. */
  async versions(identity: Identity): Promise<VersionState> {
    const result = await this.pool.query<{
      kind: "context" | "access";
      sub: string;
      version: string;
    }>(
      `select kind,sub,version from session.rp_identity_versions
      where issuer=$1 and client_id=$2 and environment=$3 and realm=$6
      and ((kind='context' and subject_key=$4) or (kind='access' and subject_key=$5))`,
      [
        ...this.binding,
        identity.sid,
        identity.sub,
        this.scope.realm ?? "customer",
      ],
    );
    const state: VersionState = { context: "0", access: "0" };
    for (const row of result.rows) {
      if (row.sub !== identity.sub)
        throw new IdentityChangeConflict("Identity subject changed");
      state[row.kind] = row.version;
    }
    return state;
  }
  /** @param identity Session resolved by the RP store. @returns Fresh central context, or terminal/nonbound state. @throws Error Until bounded recovery succeeds. */
  async view(identity: Identity): Promise<ActiveSnapshot | null> {
    const barriers = await this.versions(identity),
      known = this.confirmed.get(identity.sid);
    if (
      known?.sub === identity.sub &&
      Date.parse(known.absolute_expires_at) > Date.now() &&
      this.covers(known, barriers)
    )
      return known;
    const key = `${this.generation}:${identity.sid}:${identity.sub}`;
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.recover(identity, this.generation);
      this.pending.set(key, pending);
    }
    try {
      return await pending;
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }
  private covers(snapshot: ActiveSnapshot, barriers: VersionState) {
    return (
      BigInt(snapshot.context_version) >= BigInt(barriers.context) &&
      BigInt(snapshot.authorization_version) >= BigInt(barriers.access)
    );
  }

  // ========================================================================
  // A cold process or invalidated version starts a bounded snapshot/replay run.
  // ========================================================================
  private async recover(
    identity: Identity,
    generation: number,
  ): Promise<ActiveSnapshot | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.client.snapshot([identity.sid]),
        central = snapshot.sessions[0];
      if (!central || central.sid !== identity.sid)
        throw new Error("Incomplete changes snapshot");
      if (central.state === "inactive") {
        await this.logout.revoke(identity.sid);
        return null;
      }
      if (central.state !== "active" || central.sub !== identity.sub)
        return null;
      let cursor = snapshot.watermark,
        caughtUp = false;
      for (let page = 0; page < 20; page++) {
        const changes = await this.client.events(cursor);
        for (const event of changes.events) await this.apply(event);
        if (!changes.has_more) {
          caughtUp = true;
          break;
        }
        if (!changes.events.length || cursor === changes.next_cursor)
          throw new Error("Changes recovery made no progress");
        cursor = changes.next_cursor;
      }
      if (!caughtUp) throw new Error("Changes recovery budget exhausted");
      const tx = await this.pool.connect();
      try {
        await tx.query("begin");
        // All paths take access before context to avoid a cross-session lock cycle.
        await this.advance(
          tx,
          "access",
          central.sub,
          central.sub,
          central.authorization_version,
        );
        await this.advance(
          tx,
          "context",
          central.sid,
          central.sub,
          central.context_version,
        );
        await tx.query("commit");
      } catch (error) {
        await tx.query("rollback");
        throw error;
      } finally {
        tx.release();
      }
      const latest = await this.versions(identity);
      if (generation !== this.generation)
        throw new Error("Identity transport changed during recovery");
      if (Date.parse(central.absolute_expires_at) <= Date.now()) return null;
      if (!this.covers(central, latest)) continue;
      if (this.confirmed.size >= 10000) this.confirmed.clear();
      this.confirmed.set(identity.sid, central);
      return central;
    }
    throw new Error("Identity continues changing during recovery");
  }
}
