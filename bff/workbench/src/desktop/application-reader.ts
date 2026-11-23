/**
 * Native response projection of the existing workbench catalog and member access.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category adapter
 * @author AI-Generated
 * @date 2026-11-23
 */
import { ServiceUnavailableException } from "@nestjs/common";
import type { RpUser } from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: verified RP identity.
import {
  readProductIcon,
  readRecommendedAgentCodes,
  type SubscriptionReadPool,
} from "@vxture/service-subscription"; // ⚠️ 跨层引用: Public branding and shared recommendation reads.
import type { CatalogService } from "../catalog-service";
import { failure } from "../errors";
import type { ScopeService } from "../scope-service";

// ============================================================================
// Existing workbench read models, projected without a second authorization rule
// ============================================================================
function unavailable(): never {
  throw new ServiceUnavailableException({
    code: "APPLICATION_SOURCE_UNAVAILABLE",
    message: "Agent information is temporarily unavailable",
  });
}

function recommendationUnavailable(): never {
  throw failure(
    503,
    "WORKBENCH_RECOMMENDATIONS_UNAVAILABLE",
    "Agent recommendations are temporarily unavailable",
  );
}

export class ApplicationReader {
  constructor(
    private readonly catalog: Pick<
      CatalogService,
      "subscriptions" | "catalog" | "entries"
    >,
    private readonly pool: SubscriptionReadPool,
    private readonly scope?: Pick<ScopeService, "assertRead">,
  ) {}
  async subscribed(user: RpUser) {
    try {
      const [rows, products, entries] = await Promise.all([
        this.catalog.subscriptions(
          user.activeWorkspace!,
          user.activeOrg!,
          user.userId,
          true,
          true,
        ),
        this.catalog.catalog(true),
        this.catalog.entries(),
      ]);
      const metadata = new Map(
        products.map((item) => [item.productCode, item]),
      );
      const homes = new Map(entries.map((item) => [item.code, item.homeUrl]));
      return rows.map((row) => {
        if (!row.subscriptionId) unavailable();
        const meta = metadata.get(row.productCode);
        return {
          subscriptionId: row.subscriptionId,
          productCode: row.productCode,
          productName: meta?.productName ?? null,
          productNick: meta?.productNick ?? null,
          tier: row.tier,
          status: row.status,
          releaseVersion: meta?.releaseVersion ?? null,
          endAt: row.expiresAt?.toISOString() ?? null,
          homeUrl: homes.get(row.productCode) ?? null,
          iconUrl: meta?.iconUrl ?? null,
          iconVersion: meta?.iconVersion ?? null,
          description: meta?.description ?? null,
          releaseStage: meta?.releaseStage ?? null,
          bundled: row.bundled,
          access: row.access ?? "unknown",
        };
      });
    } catch {
      unavailable();
    }
  }

  /**
   * Tenant-wide subscription history requires a tenant-level grant.
   * @param user - Verified identity and active scope from the desktop session.
   * @returns Ordered candidate codes for public catalog enrichment.
   * @throws When the scope, permission or recommendation source is unavailable.
   */
  async recommended(user: RpUser): Promise<{ productCode: string }[]> {
    if (!this.scope) recommendationUnavailable();
    await this.scope.assertRead(user, "tenant.billing.read", true);
    const rows = await readRecommendedAgentCodes(
      this.pool,
      user.activeOrg!,
    ).catch(recommendationUnavailable);
    await this.scope.assertRead(user, "tenant.billing.read", true);
    return rows.map(({ productCode }) => ({ productCode }));
  }

  icon(code: string) {
    return readProductIcon(this.pool, code).catch(unavailable);
  }
}
export function requireApplicationReader(
  reader: ApplicationReader | undefined,
): ApplicationReader {
  if (!reader) unavailable();
  return reader;
}
