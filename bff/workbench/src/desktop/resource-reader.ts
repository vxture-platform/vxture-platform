/**
 * Reuse workspace permission checks and the existing quota read projection.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category adapter
 * @author AI-Generated
 * @date 2026-11-23
 */
import type { RpUser } from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: consume verified RP identity only.
import { failure } from "../errors";
import type { ResourceOverview } from "../resource-overview";
import type { ScopeService } from "../scope-service";

/** No SQL, accounting, commercial inference or additional data connection. */
export class ResourceReader {
  constructor(
    private readonly scope: Pick<ScopeService, "assertRead">,
    private readonly overview: Pick<ResourceOverview, "resources">,
  ) {}

  /**
   * Read quota for the session's exact workspace with live permission checks.
   * @param user - Verified native identity with its original scope binding.
   * @returns The existing workspace quota projection, including legitimate zeros.
   * @throws When membership, permission or the quota source is unavailable.
   */
  async quotaUsage(
    user: RpUser,
  ): Promise<Awaited<ReturnType<ResourceOverview["resources"]>>> {
    await this.scope.assertRead(user, "tenant.quota.read");
    const usage = await this.overview.resources(user.activeWorkspace!);
    // A membership or permission removal during a slow read must win.
    await this.scope.assertRead(user, "tenant.quota.read");
    return usage;
  }
}

/**
 * Require an explicitly wired quota source rather than fabricating zero usage.
 * @param reader - Optional native adapter from the production composition.
 * @returns The configured reader.
 * @throws When the source has not been configured.
 */
export function requireResourceReader(
  reader: ResourceReader | undefined,
): ResourceReader {
  if (!reader)
    throw failure(
      503,
      "WORKBENCH_RESOURCE_UNAVAILABLE",
      "Resource overview is unavailable",
    );
  return reader;
}
