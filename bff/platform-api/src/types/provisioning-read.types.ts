/**
 * Product-scoped provisioning reconciliation wire types.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category types
 * @author AI-Generated
 * @date 2026-10-12
 */

/** A retained provisioning fact; seq is the existing webhook version. */
export interface ProvisioningReadItem {
  workspace_id: string;
  tenant_id: string;
  state: "pending" | "provisioned" | "deprovisioned";
  seq: number;
  updated_at: string;
}

/** One page of a full reconciliation round, not a consistent snapshot. */
export interface ProvisioningReadPage {
  items: ProvisioningReadItem[];
  nextCursor: string | null;
}
