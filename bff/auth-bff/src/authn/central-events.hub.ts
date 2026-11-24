/**
 * Share one central identity notification connection across Accounts streams.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-24
 */
import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { SESSION_PG_POOL } from "./tokens";

interface Subscription {
  realm: string;
  sid: string;
  sub: string;
  changed(): void;
  close(): void;
}

// ============================================================================
// Notification loss closes the stream; reconnect always revalidates the cookie.
// ============================================================================
@Injectable()
export class CentralEventsHub {
  private client: PoolClient | undefined;
  private pending: Promise<void> | undefined;
  private readonly subscriptions = new Set<Subscription>();
  constructor(@Inject(SESSION_PG_POOL) private readonly pool: Pool) {}

  private async connect(): Promise<void> {
    const client = await this.pool.connect();
    const lost = () => {
      if (this.client !== client) return;
      this.client = undefined;
      for (const item of [...this.subscriptions]) item.close();
      this.subscriptions.clear();
      client.release(true);
    };
    client.on("error", lost);
    client.on("end", lost);
    try {
      await client.query("LISTEN central_identity_changed");
      const installed = await client.query(`select 1 from pg_trigger where
        tgname='trg_central_identity' and tgrelid='session.auth_sessions'::regclass
        and tgenabled in ('O','A')`);
      if (!installed.rowCount)
        throw new Error("Central notification migration required");
      this.client = client;
      client.on("notification", ({ channel, payload }) => {
        if (
          this.client !== client ||
          channel !== "central_identity_changed" ||
          !payload
        )
          return;
        try {
          const hint = JSON.parse(payload) as {
            realm?: string;
            sid?: string;
            sub?: string;
          };
          for (const item of this.subscriptions)
            if (hint.realm === item.realm && hint.sub === item.sub)
              item.changed();
        } catch {
          /* Invalid hints never authorize or terminate identity. */
        }
      });
    } catch (error) {
      client.release(true);
      throw error;
    }
  }

  /** Subscribe before the caller's final authority check. */
  async subscribe(item: Subscription): Promise<() => void> {
    if (!this.client) {
      this.pending ??= this.connect();
      try {
        await this.pending;
      } catch {
        throw new ServiceUnavailableException("Session events unavailable");
      } finally {
        this.pending = undefined;
      }
    }
    if (!this.client)
      throw new ServiceUnavailableException("Session events unavailable");
    if (
      this.subscriptions.size >= 5000 ||
      [...this.subscriptions].filter(
        (entry) => entry.realm === item.realm && entry.sid === item.sid,
      ).length >= 32
    )
      throw new HttpException("Session connection limit", 429);
    this.subscriptions.add(item);
    return () => this.subscriptions.delete(item);
  }

  async onModuleDestroy(): Promise<void> {
    for (const item of [...this.subscriptions]) item.close();
    this.subscriptions.clear();
    const client = this.client;
    this.client = undefined;
    client?.release(true);
  }
}
