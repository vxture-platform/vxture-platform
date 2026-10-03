/**
 * database-timezone.check.ts - boot signal: the commerce pool's session TimeZone must be UTC.
 * @package  @vxture/bff-platform-api
 * @layer    Application
 * @category service
 *
 * Owner ruling 4 (2026-10-04): usage day buckets default to UTC+0. The default is
 * pinned on the database (ALTER DATABASE … SET timezone = 'UTC': 00_schemas.sql +
 * migration 2026-10-05-database-timezone-utc.sql; 30-verify asserts the
 * pg_db_role_setting row), and the usage-rollup SQL is session-independent anyway
 * (explicit `::timestamp at time zone 'UTC'` bounds + SET LOCAL TIME ZONE 'UTC').
 *
 * This class is therefore only a SIGNAL. The two ways the pool can still open
 * non-UTC sessions are both silent otherwise: the migration ran as a non-owner
 * role (it WARNs instead of aborting, so the migrate chain stays green), or this
 * container predates the migration (ALTER DATABASE affects new sessions only).
 * In either case one error-level line at boot names it. It never refuses to
 * start, and it never blocks bootstrap: the read is fire-and-forget, because a
 * slow or unreachable database must not turn a log line into a hung boot.
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import type { Pool } from "pg";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";

/** UTC+0 without DST, either spelling PostgreSQL reports for the pinned default. */
const UTC_SPELLINGS: ReadonlySet<string> = new Set(["UTC", "Etc/UTC"]);

@Injectable()
export class DatabaseTimezoneCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseTimezoneCheck.name);

  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap(): void {
    // TD-024 boot-smoke resolves the DI graph with fake env and exits; there is
    // no database to ask, and a connect attempt there is noise at best.
    if (process.env["BOOT_SMOKE"] === "1") return;
    void this.check();
  }

  /**
   * Reads `show timezone` on one pooled session and logs at error level when it
   * is not UTC. Returns the observed value (null = unreadable). Never throws.
   */
  async check(): Promise<string | null> {
    try {
      const res =
        await this.pool.query<Record<string, string>>("show timezone");
      const zone = Object.values(res.rows[0] ?? {})[0] ?? null;
      if (zone === null || !UTC_SPELLINGS.has(zone)) {
        this.logger.error(
          `database session TimeZone is ${zone ?? "unreadable"}, expected UTC. ` +
            "Either the database-level default is not pinned (run as the DB owner: " +
            "ALTER DATABASE <db> SET timezone = 'UTC'; see deploy/database/migrations/" +
            "2026-10-05-database-timezone-utc.sql) or this container predates it " +
            "(33-recreate-service.sh platform-api). usage-rollup is unaffected " +
            "(session-independent SQL); session-dependent now()::date reads elsewhere are not.",
        );
      } else {
        this.logger.log(`database session TimeZone = ${zone}`);
      }
      return zone;
    } catch (err) {
      this.logger.error(
        `could not read database session TimeZone: ${String(err)}`,
      );
      return null;
    }
  }
}
