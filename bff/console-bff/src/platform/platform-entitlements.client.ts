/**
 * platform-entitlements.client.ts — S2S client for the C2 entitlement contract.
 * @package @vxture/bff-console
 *
 * TD-042 remediation: console-bff previously re-derived workspace quota by
 * querying `metering.quota_pools` directly and re-implementing the reset-period
 * comparison already owned by `entitlement-view.ts::needsReset()` in
 * platform-api. That duplication is retired here — console-bff now resolves
 * the authoritative view via the same C2 contract product teams consume
 * (`GET /platform/entitlements`, product_220 §3), over the legacy
 * `AUTH_INTERNAL_TOKEN` S2S header (same pattern as
 * `admin-bff/src/auth/operator-stepup.service.ts` calling auth-bff).
 *
 * Fail-closed by design: a platform-api outage degrades the console quota
 * panel to zero rather than serving a stale/incorrect number silently — the
 * router callers decide the exact user-facing fallback.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import type { ProductEntitlementView } from "@vxture-platform/shared";

const MAX_BATCH_PRODUCTS = 20; // mirrors entitlement-view.ts's own cap

@Injectable()
export class PlatformEntitlementsClient {
  private readonly logger = new Logger(PlatformEntitlementsClient.name);

  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** `null` when PLATFORM_API_URL / AUTH_INTERNAL_TOKEN isn't configured. */
  private connectionConfig(): { base: string; token: string } | null {
    const base = this.config.platform.PLATFORM_API_URL;
    const token = this.config.auth.AUTH_INTERNAL_TOKEN;
    if (!base || !token) return null;
    return { base: base.replace(/\/$/, ""), token };
  }

  /**
   * Resolve the C2 view for every requested product code in one batch call.
   * Returns `null` on any failure (network / non-2xx / malformed body) so
   * callers can degrade rather than 500 the whole page — a quota panel
   * outage should never take down the subscription page with it.
   */
  async resolveWorkspaceEntitlements(
    workspaceId: string,
    productCodes: string[],
  ): Promise<Record<string, ProductEntitlementView> | null> {
    if (productCodes.length === 0) return {};
    const codes = productCodes.slice(0, MAX_BATCH_PRODUCTS);
    if (codes.length < productCodes.length) {
      this.logger.warn(
        `workspace ${workspaceId} has ${productCodes.length} ever-subscribed products, ` +
          `truncating to the first ${MAX_BATCH_PRODUCTS} for the C2 batch call`,
      );
    }

    // Checked before the network try/catch below so a missing PLATFORM_API_URL
    // / AUTH_INTERNAL_TOKEN logs as the config problem it is, not a misleading
    // "network" failure — both paths degrade to `null` either way, matching
    // this method's fail-closed-to-the-caller contract.
    const conn = this.connectionConfig();
    if (!conn) {
      this.logger.warn(
        "entitlements fetch skipped: PLATFORM_API_URL / AUTH_INTERNAL_TOKEN not configured",
      );
      return null;
    }

    let res: Response;
    try {
      const url = new URL(`${conn.base}/platform/entitlements`);
      url.searchParams.set("workspace_id", workspaceId);
      url.searchParams.set("products", codes.join(","));
      res = await fetch(url, {
        method: "GET",
        headers: { "x-vxture-internal-auth": conn.token },
      });
    } catch (err) {
      this.logger.warn(
        `entitlements fetch failed (network): ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
    if (!res.ok) {
      this.logger.warn(`entitlements fetch failed: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json().catch(() => null)) as {
      entitlements?: Record<string, ProductEntitlementView>;
    } | null;
    if (!body?.entitlements) {
      this.logger.warn("entitlements fetch: malformed response body");
      return null;
    }
    return body.entitlements;
  }
}
