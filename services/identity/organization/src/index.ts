/**
 * @vxture/service-organization — Identity core organization service.
 * Organization + Workspace + Membership over the new `identity` schema.
 * docs/design/identity-platform-architecture.md §2/§9；字段级见 platform-data-architecture-schema.md §4.
 *
 * Relocated from services/tenant/organization onto the new model (Batch 3, D-J).
 * Governance RBAC enforcement (Task 3.2) and active-org claim shaping (Task 3.3)
 * land in subsequent tasks.
 */

export { OrganizationModule } from "./module/organization.module";
export { OrganizationService } from "./service/organization.service";
export { GovernanceService } from "./service/governance.service";
export type { GovernanceContext } from "./service/governance.service";
export { ActiveContextService } from "./service/active-context.service";
export {
  PgOrganizationRepository,
  MockOrganizationRepository,
} from "./repository";
export { ORG_PG_POOL, ORGANIZATION_REPOSITORY } from "./tokens";

export type {
  OrgType,
  OrgRole,
  OrgView,
  WorkspaceView,
  OrganizationProfileView,
  OrgProfileUpdateInput,
  OrgLogoRecord,
  OrgMembershipView,
  WorkspaceMembershipView,
  ProvisionedOrg,
  ActiveOrgContext,
  OrgSwitchOption,
  OrgMemberDetail,
  OrgRoleCatalogEntry,
  CreateInvitationInput,
  InvitationView,
  OrganizationReadRepository,
  TenantVerificationRecord,
  SubmitTenantVerificationInput,
} from "./types/organization.types";
