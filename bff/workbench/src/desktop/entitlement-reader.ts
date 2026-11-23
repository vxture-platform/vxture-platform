/**
 * Read the minimal desktop entitlement view using existing workspace grants.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category adapter
 * @author AI-Generated
 * @date 2026-11-23
 */
import type { RpUser } from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: Consume verified native identity.
import {
  readWorkspaceEntitlementSummary,
  type SubscriptionReadPool,
  type WorkspaceEntitlementSummary,
} from "@vxture/service-subscription"; // ⚠️ 跨层引用: Delegate entitlement decisions to the subscription domain.
import { failure } from "../errors";
import type { ScopeService } from "../scope-service";

function sourceUnavailable() {
  return failure(
    503,
    "WORKBENCH_ENTITLEMENTS_UNAVAILABLE",
    "Workspace entitlements are temporarily unavailable",
  );
}

export class EntitlementReader {
  constructor(
    private readonly pool: SubscriptionReadPool,
    private readonly scope: Pick<ScopeService, "assertRead">,
  ) {}

  /**
   * Read the session's workspace entitlement facts.
   * @param user - Verified native identity bound to its original scope.
   * @returns Minimal facts; an empty result represents known empty coverage.
   * @throws When the workspace, live grant or entitlement source is unavailable.
   */
  async read(user: RpUser): Promise<WorkspaceEntitlementSummary[]> {
    await this.scope.assertRead(user, "tenant.quota.read");
    const rows = await readWorkspaceEntitlementSummary(
      this.pool,
      user.activeWorkspace!,
    ).catch(() => {
      throw sourceUnavailable();
    });
    await this.scope.assertRead(user, "tenant.quota.read");
    return rows;
  }
}

/**
 * Get the configured reader so missing wiring cannot look like empty coverage.
 * @param reader - Native reader from the existing Workbench composition.
 * @returns The configured reader.
 * @throws When the read source is unavailable.
 */
export function requireEntitlementReader(
  reader: EntitlementReader | undefined,
): EntitlementReader {
  if (!reader) throw sourceUnavailable();
  return reader;
}
