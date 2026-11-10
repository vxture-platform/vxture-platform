/**
 * Scoped portal launch history and view preferences, with server-owned time.
 * @package @vxture/service-account
 * @layer Domain
 * @category service
 * @author AI-Generated
 * @date 2026-11-10
 */
import type { Pool } from "pg";

// ============================================================================
// Scope and read models
// ============================================================================
export type AppView = "favorites" | "recent" | "frequent";
export interface AppActivityScope {
  userId: string;
  tenantId: string;
  workspaceId: string;
}
export interface AppUsage {
  productId: string;
  lastUsedAt: string;
  launches30d: number;
}

/**
 * Account-domain persistence; consumers supply an isolated least-privilege pool.
 * @example import { AppActivityService } from "@vxture/service-account";
 */
export class AppActivityService {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  private values(scope: AppActivityScope): string[] {
    return [scope.userId, scope.tenantId, scope.workspaceId];
  }

  /**
   * Read lifetime recency and a rolling thirty-day count in the verified scope.
   * @param scope - Server-verified account, tenant and workspace.
   * @returns Scoped activity and the preferred portal view.
   */
  async read(
    scope: AppActivityScope,
  ): Promise<{ items: AppUsage[]; view: AppView }> {
    const [usage, preference] = await Promise.all([
      this.pool.query<{
        product_id: string;
        last_used_at: Date;
        launches: string;
      }>(
        `select product_id, max(occurred_at) as last_used_at,
           count(*) filter (where occurred_at > now() - interval '30 days')::text as launches
         from account.user_app_launches
         where user_id = $1 and tenant_id = $2 and workspace_id = $3
         group by product_id`,
        this.values(scope),
      ),
      this.pool.query<{ view: AppView }>(
        `select view from account.user_app_views
         where user_id = $1 and tenant_id = $2 and workspace_id = $3`,
        this.values(scope),
      ),
    ]);
    return {
      items: usage.rows.map((row) => ({
        productId: row.product_id,
        lastUsedAt: row.last_used_at.toISOString(),
        launches30d: Number(row.launches),
      })),
      view: preference.rows[0]?.view ?? "favorites",
    };
  }

  /**
   * Record one explicit launch, deduplicating retries using a browser event UUID.
   * @param scope - Verified scope.
   * @param productId - Authorized subscribed product.
   * @param eventId - Unique launch identifier reused by retries.
   * @returns Nothing after insertion or an idempotent retry.
   */
  async record(
    scope: AppActivityScope,
    productId: string,
    eventId: string,
  ): Promise<void> {
    await this.pool.query(
      `insert into account.user_app_launches
         (user_id, tenant_id, workspace_id, product_id, event_id)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, tenant_id, workspace_id, event_id) do nothing`,
      [...this.values(scope), productId, eventId],
    );
  }

  /**
   * Persist the preferred view without touching other account preferences.
   * @param scope - Verified scope.
   * @param view - Validated portal view.
   * @returns Nothing after the upsert.
   */
  async setView(scope: AppActivityScope, view: AppView): Promise<void> {
    await this.pool.query(
      `insert into account.user_app_views (user_id, tenant_id, workspace_id, view)
       values ($1, $2, $3, $4)
       on conflict (user_id, tenant_id, workspace_id) do update set view = excluded.view`,
      [...this.values(scope), view],
    );
  }
}
