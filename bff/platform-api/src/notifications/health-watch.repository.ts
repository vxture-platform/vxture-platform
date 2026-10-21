/**
 * Durable event checkpoints, subject episodes and Admin notification updates.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category repository
 * @author AI-Generated
 * @date 2026-10-20
 */
import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import { PgNoticeRepository } from "@vxture/service-notice";
import type { HealthEvent, HealthSubject } from "./health-watch.types";
import { redactUuids } from "./ops-notice";

// ============================================================================
// Durable state and transaction boundary
// ============================================================================

export interface HealthCheckpoint {
  cursor: string | null;
  initialized: boolean;
  failures: number;
}

const REFERENCE_TYPE = "model_health";
const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

@Injectable()
export class HealthWatchRepository {
  private readonly notices: PgNoticeRepository;

  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {
    this.notices = new PgNoticeRepository(pool);
  }

  /**
   * Serialize all replicas for this watcher using one dedicated database session.
   * @param work - Work performed while holding the session advisory lock.
   * @returns Work result, or null when another replica owns the watcher.
   * @throws Error on database or work failure; the lock is released in all cases.
   */
  async exclusive<T>(
    work: (client: PoolClient, checkpoint: HealthCheckpoint) => Promise<T>,
  ): Promise<T | null> {
    const client = await this.pool.connect();
    let locked = false;
    try {
      const lock = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock(562, 1) as locked",
      );
      locked = lock.rows[0]?.locked === true;
      if (!locked) return null;
      await client.query(
        `insert into provisioning.health_watch_state (watcher) values ('atlas') on conflict do nothing`,
      );
      const result = await client.query<{
        event_cursor: string | null;
        initialized: boolean;
        consecutive_failures: number;
      }>(
        "select event_cursor, initialized, consecutive_failures from provisioning.health_watch_state where watcher = 'atlas'",
      );
      const row = result.rows[0];
      if (!row) throw new Error("Atlas health checkpoint is missing");
      return await work(client, {
        cursor: row.event_cursor,
        initialized: row.initialized,
        failures: row.consecutive_failures,
      });
    } finally {
      let unlockError: Error | undefined;
      try {
        if (locked) await client.query("select pg_advisory_unlock(562, 1)");
      } catch (error) {
        unlockError =
          error instanceof Error ? error : new Error("Watcher unlock failed");
        throw error;
      } finally {
        client.release(unlockError);
      }
    }
  }

  /**
   * Persist liveness separately so a broken feed cannot hide process failure.
   * @param client - Locked watcher session.
   * @param alive - Result of the independent /healthz probe.
   * @param checkpoint - Previously committed state.
   * @returns Newly inserted notices.
   * @throws Error on a failed write; the complete liveness transaction rolls back.
   */
  async liveness(
    client: PoolClient,
    alive: boolean,
    checkpoint: HealthCheckpoint,
  ): Promise<number> {
    await client.query("begin");
    try {
      const failures = alive ? 0 : Math.min(checkpoint.failures + 1, 3);
      let inserted = 0;
      if (alive || failures === 3)
        inserted = await this.subject(
          client,
          {
            kind: "service",
            key: "atlas",
            state: alive ? "ok" : "unreachable",
            severity: alive ? "info" : "critical",
            detail: alive
              ? "Atlas 存活探测已恢复。"
              : "Atlas 连续三次存活探测失败，请检查服务与网络。",
          },
          `liveness:${Date.now()}`,
          true,
        );
      await client.query(
        `update provisioning.health_watch_state
        set consecutive_failures = $1, updated_at = now() where watcher = 'atlas'`,
        [failures],
      );
      await client.query("commit");
      checkpoint.failures = failures;
      return inserted;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  /**
   * Apply a completely drained feed and the current snapshot atomically.
   * @param client - Locked watcher session.
   * @param checkpoint - Previously committed cursor and bootstrap state.
   * @param events - All pages drained in source order.
   * @param cursor - Final opaque source checkpoint.
   * @param subjects - Current snapshot projected into independent subjects.
   * @returns Newly inserted notices, excluding replayed or unchanged subjects.
   * @throws Error on any write; no event or cursor is committed partially.
   */
  async apply(
    client: PoolClient,
    checkpoint: HealthCheckpoint,
    events: readonly HealthEvent[],
    cursor: string | null,
    subjects: readonly HealthSubject[],
  ): Promise<number> {
    await client.query("begin");
    try {
      let inserted = 0;
      if (!checkpoint.initialized) {
        // Retire the old snapshot producer's permanent keys exactly once.
        await client.query(`update admin.operator_notices set expires_at = now(), updated_at = now()
          where source = 'system' and reference_type = 'model_health' and deleted_at is null
            and (expires_at is null or expires_at > now())`);
      }
      for (const event of events) {
        const accepted = await client.query(
          `insert into provisioning.health_watch_events (event_id)
          values ($1) on conflict do nothing returning event_id`,
          [event.id],
        );
        if (!accepted.rows.length) continue;
        // Bootstrap drains historical events quietly; current state is notified below.
        if (checkpoint.initialized)
          inserted += await this.subject(
            client,
            {
              kind: event.subjectKind,
              key: event.subjectKey,
              state: event.to,
              severity: event.severity,
              detail:
                `${event.from} → ${event.to}` +
                (event.upstreamStatus === null
                  ? ""
                  : ` · HTTP ${event.upstreamStatus}`) +
                (event.detail ? `\n${event.detail}` : "") +
                (event.affectedRoutes.length
                  ? `\n受影响路由：${event.affectedRoutes.join(", ")}`
                  : ""),
            },
            `event:${event.id}`,
            true,
          );
      }
      const latest = new Map(
        events.map((event) => [
          `${event.subjectKind}:${event.subjectKey}`,
          event,
        ]),
      );
      for (const subject of subjects) {
        const event = latest.get(`${subject.kind}:${subject.key}`);
        // Vendor snapshots omit the availability flag used to judge critical severity.
        const authoritative =
          subject.kind === "vendor" && event?.to === subject.state
            ? event
            : undefined;
        inserted += await this.subject(
          client,
          authoritative
            ? { ...subject, severity: authoritative.severity }
            : subject,
          authoritative ? `event:${authoritative.id}` : "snapshot",
          checkpoint.initialized,
        );
      }
      await client.query(
        `update provisioning.health_watch_state set event_cursor = $1,
        initialized = true, updated_at = now() where watcher = 'atlas'`,
        [cursor],
      );
      await client.query("commit");
      return inserted;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  // ============================================================================
  // One active notice per subject; event IDs and subject fingerprints prevent replay
  // ============================================================================

  private async subject(
    client: PoolClient,
    subject: HealthSubject,
    source: string,
    reportRecovery: boolean,
  ): Promise<number> {
    // An unobserved/unknown state is not evidence that an existing fault recovered.
    if (subject.state === "unknown" && subject.severity === "info") return 0;
    const fingerprint = digest(
      JSON.stringify([
        subject.state,
        subject.severity,
        subject.configuration ?? "",
      ]),
    );
    const result = await client.query<{
      fingerprint: string;
      state: string;
      last_source: string;
      notice_reference: string | null;
      episode: number;
    }>(
      `select fingerprint, state, last_source, notice_reference, episode from provisioning.health_watch_subjects
       where subject_kind = $1 and subject_key = $2`,
      [subject.kind, subject.key],
    );
    const previous = result.rows[0];
    if (
      source === "snapshot" &&
      subject.kind === "vendor" &&
      previous?.state === subject.state &&
      previous.last_source.startsWith("event:")
    )
      return 0;
    if (previous?.fingerprint === fingerprint) return 0;
    if (previous?.notice_reference)
      await this.notices.endSystemNotice(
        REFERENCE_TYPE,
        previous.notice_reference,
        client,
      );
    const recovery =
      subject.state === "ok" || subject.state === "not_supported";
    const episode = (previous?.episode ?? 0) + 1;
    const reference = `episode:${digest(JSON.stringify([subject.kind, subject.key]))}:${episode}`;
    let inserted = 0;
    // A quiet first healthy/unknown sighting is not an operational event.
    const notify = !recovery
      ? subject.severity !== "info"
      : reportRecovery && previous?.notice_reference;
    if (notify) {
      const notice = await this.notices.createSystemNotice(
        {
          targetPlanes: ["admin"],
          severity: recovery ? "info" : subject.severity,
          title:
            `${recovery ? "模型服务恢复" : "模型服务异常"}：${subject.key}（${subject.state}）`.slice(
              0,
              256,
            ),
          body: redactUuids(subject.detail).slice(0, 4000),
          link: "/atlas",
          referenceType: REFERENCE_TYPE,
          referenceId: reference,
          expiresAt: recovery ? new Date(Date.now() + 86_400_000) : null,
        },
        client,
      );
      inserted = notice.inserted ? 1 : 0;
    }
    await client.query(
      `insert into provisioning.health_watch_subjects
      (subject_kind, subject_key, fingerprint, state, episode, notice_reference, last_source)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (subject_kind, subject_key) do update set fingerprint = excluded.fingerprint,
        state = excluded.state, episode = excluded.episode, notice_reference = excluded.notice_reference,
        last_source = excluded.last_source, updated_at = now()`,
      [
        subject.kind,
        subject.key,
        fingerprint,
        subject.state,
        episode,
        !recovery && notify ? reference : null,
        source,
      ],
    );
    return inserted;
  }
}
