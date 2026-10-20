/**
 * Real PostgreSQL migration, role and durable notification episode regressions.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-10-20
 */
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { HealthWatchRepository } from "./health-watch.repository";
import type { HealthEvent, HealthSubject } from "./health-watch.types";

const url = process.env.HEALTH_WATCH_ITEST_DATABASE_URL;
const root = new URL("../../../../", import.meta.url);
const down: HealthSubject = {
  kind: "route",
  key: "chat/a",
  state: "down",
  severity: "critical",
  detail: "unavailable",
};
const event = (id: string, to = "down"): HealthEvent => ({
  id,
  createdAt: "2026-10-20T00:00:00Z",
  subjectKind: "route",
  subjectKey: "chat/a",
  providerCode: null,
  from: "ok",
  to,
  severity: to === "ok" ? "info" : "critical",
  upstreamStatus: 503,
  detail: "upstream unavailable",
  affectedRoutes: [],
});

// ============================================================================
// Dedicated disposable database only; never target a development/production DB
// ============================================================================
describe.skipIf(!url)(
  "health watcher PostgreSQL transactions and role permissions",
  () => {
    let owner: Pool;
    let app: Pool;
    let repo: HealthWatchRepository;
    beforeAll(async () => {
      if (!url || new URL(url).pathname !== "/codex_health_562")
        throw new Error("Dedicated codex_health_562 database required");
      owner = new Pool({ connectionString: url });
      await owner.query(`create schema if not exists admin; create schema if not exists provisioning;
      do $$ begin if not exists(select from pg_roles where rolname='platform_svc') then create role platform_svc; end if;
      if not exists(select from pg_roles where rolname='svc_platform_api') then create role svc_platform_api; end if; end $$;
      grant usage on schema admin, provisioning to platform_svc, svc_platform_api`);
      const ddl = await readFile(
        new URL("deploy/database/ddl/80_admin.sql", root),
        "utf8",
      );
      const table = ddl.match(
        /CREATE TABLE admin\.operator_notices \([\s\S]*?\n\);/i,
      )?.[0];
      const unique = ddl.match(
        /CREATE UNIQUE INDEX uq_operator_notices_system[\s\S]*?;/i,
      )?.[0];
      if (!table || !unique)
        throw new Error("Authoritative notice DDL not found");
      await owner.query(
        table.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"),
      );
      await owner.query(
        unique.replace(
          "CREATE UNIQUE INDEX",
          "CREATE UNIQUE INDEX IF NOT EXISTS",
        ),
      );
      await owner.query(
        "grant select, insert on admin.operator_notices to svc_platform_api; grant select, insert, update on admin.operator_notices to platform_svc",
      );
      const migration = await readFile(
        new URL(
          "deploy/database/migrations/2026-12-05-atlas-health-watch-state.sql",
          root,
        ),
        "utf8",
      );
      await owner.query(migration);
      await owner.query(migration);
      app = new Pool({
        connectionString: url,
        options: "-c role=svc_platform_api",
      });
      repo = new HealthWatchRepository(app);
    });
    beforeEach(async () => {
      await owner.query(
        "truncate provisioning.health_watch_events, provisioning.health_watch_state, provisioning.health_watch_subjects, admin.operator_notices",
      );
    });
    afterAll(async () => {
      await app?.end();
      await owner?.end();
    });
    const notices = async () =>
      (
        await owner.query(
          "select *, expires_at is null or expires_at > now() as active from admin.operator_notices order by published_at, id",
        )
      ).rows;
    const apply = (
      events: HealthEvent[],
      cursor: string,
      subjects: HealthSubject[],
    ) =>
      repo.exclusive((client, state) =>
        repo.apply(client, state, events, cursor, subjects),
      );

    // ============================================================================
    // Bootstrap, replay, recovery, recurrence and crash rollback
    // ============================================================================
    it("quiets historical transitions, then closes faults and notifies a new recurring episode", async () => {
      expect(await apply([event("old")], "a", [down])).toBe(1);
      const first = (await notices())[0];
      expect(first).toMatchObject({
        severity: "critical",
        target_planes: ["admin"],
        active: true,
      });
      expect(await apply([event("old")], "a", [down])).toBe(0);
      expect(
        await apply([event("recovery", "ok")], "b", [
          { ...down, state: "ok", severity: "info" },
        ]),
      ).toBe(1);
      expect((await notices()).find((n) => n.id === first.id)?.active).toBe(
        false,
      );
      expect(
        (await notices()).filter((n) => n.severity === "info"),
      ).toHaveLength(1);
      expect(await apply([event("recurs")], "c", [down])).toBe(1);
      const failures = (await notices()).filter(
        (n) => n.severity === "critical",
      );
      expect(failures).toHaveLength(2);
      expect(failures[0].reference_id).not.toBe(failures[1].reference_id);
      expect(await apply([event("recurs")], "c", [down])).toBe(0);
    });
    it("rolls back notices, event IDs and checkpoint together on a later write failure", async () => {
      await apply([], "stored", []);
      const bad = { ...event("bad"), subjectKey: "x".repeat(257) };
      await expect(apply([event("good"), bad], "lost", [])).rejects.toThrow();
      expect(await notices()).toHaveLength(0);
      expect(
        (await owner.query("select * from provisioning.health_watch_events"))
          .rows,
      ).toHaveLength(0);
      expect(
        (
          await owner.query(
            "select event_cursor from provisioning.health_watch_state",
          )
        ).rows[0]?.event_cursor,
      ).toBe("stored");
      expect(await apply([event("good")], "replayed", [down])).toBe(1);
    });
    it("does not treat an unknown snapshot as evidence of recovery", async () => {
      await apply([], "a", [down]);
      expect(
        await apply([], "a", [{ ...down, state: "unknown", severity: "info" }]),
      ).toBe(0);
      expect(
        (await notices()).filter((n) => n.active && n.severity === "critical"),
      ).toHaveLength(1);
    });
    it("retires only legacy model-health notices at bootstrap and reports the current fault", async () => {
      await owner.query(`insert into admin.operator_notices (title, body, source, reference_type, reference_id)
        values ('old health', 'old', 'system', 'model_health', 'old'), ('other', 'other', 'system', 'customer_event', 'other')`);
      expect(
        await apply(
          [event("historical-recovery", "ok"), event("historical-fault")],
          "now",
          [down],
        ),
      ).toBe(1);
      const all = await notices();
      expect(all.find((n) => n.title === "old health")?.active).toBe(false);
      expect(all.find((n) => n.title === "other")?.active).toBe(true);
      expect(
        all.filter((n) => n.reference_type === "model_health" && n.active),
      ).toHaveLength(1);
    });
    it("keeps event-derived critical vendor severity across incomplete snapshots and restarts", async () => {
      const vendor = {
        ...down,
        kind: "vendor",
        state: "balance_low",
        severity: "warning",
      } as const;
      await apply([], "start", []);
      expect(
        await apply(
          [{ ...event("vendor"), subjectKind: "vendor", to: "balance_low" }],
          "v",
          [vendor],
        ),
      ).toBe(1);
      repo = new HealthWatchRepository(app);
      expect(await apply([], "v", [vendor])).toBe(0);
      expect((await notices()).filter((n) => n.active)).toHaveLength(1);
      expect((await notices())[0]?.severity).toBe("critical");
    });
    it("persists three failed probes across repository restarts, then recovers once", async () => {
      const probe = (alive: boolean) =>
        repo.exclusive((client, state) => repo.liveness(client, alive, state));
      expect(await probe(false)).toBe(0);
      repo = new HealthWatchRepository(app);
      expect(await probe(false)).toBe(0);
      expect(await probe(false)).toBe(1);
      expect(await probe(false)).toBe(0);
      expect((await notices())[0]?.severity).toBe("critical");
      expect(await probe(true)).toBe(1);
      expect(await probe(true)).toBe(0);
      expect(
        (await notices()).filter((n) => n.active && n.severity === "critical"),
      ).toHaveLength(0);
    });
    it("excludes another replica and releases the advisory lock after failure", async () => {
      await repo.exclusive(async () => {
        expect(
          await new HealthWatchRepository(app).exclusive(async () => 99),
        ).toBeNull();
      });
      await expect(
        repo.exclusive(async () => {
          throw new Error("crash");
        }),
      ).rejects.toThrow("crash");
      expect(await repo.exclusive(async () => 7)).toBe(7);
    });
    it("enforces scoped notice updates and immutable anchors for the shared role", async () => {
      await apply([], "first", [down]);
      await expect(
        app.query("update admin.operator_notices set title='forbidden'"),
      ).rejects.toMatchObject({ code: "42501" });
      const shared = await owner.connect();
      try {
        await shared.query("set role platform_svc");
        await shared.query(
          "update provisioning.health_watch_state set event_cursor='allowed'",
        );
        await expect(
          shared.query(
            "update provisioning.health_watch_state set watcher='forbidden'",
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          shared.query(
            "update provisioning.health_watch_subjects set subject_key='forbidden'",
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await shared.query("reset role");
        shared.release();
      }
    });
  },
);
