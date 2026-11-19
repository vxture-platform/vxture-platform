/**
 * access-claims.ts — pure builder for the new access-token claim set.
 *
 * docs/design/identity-platform-architecture.md §4: access claims = sub + active_org +
 * active_workspace + roles (+ standard OIDC iss/aud/sub/exp/iat/jti, added by the
 * signer). §9: NO business entitlement. This REPLACES the old active_tenant_* +
 * entitlement claim set.
 *
 * Also carries display context for cross-domain RPs that read identity from the
 * access_token (cannot reach the IdP DB): active_org_type (personal|team — the
 * personal-vs-team discriminator), active_org_name, active_workspace_name.
 *
 * Kept dependency-free (no NestJS) so it is unit-testable in isolation.
 */

export interface AccessClaimsInput {
  /** Central session id (sid claim), when issued within a session. */
  sessionId?: string | null;
  /** Active organization id. */
  activeOrg?: string | null;
  /** Active organization type: "personal" | "organization" (personal-vs-team discriminator). */
  activeOrgType?: string | null;
  /** Active organization full name. */
  activeOrgName?: string | null;
  /** Optional short name for presentation, independent of the full name. */
  activeOrgDisplayName?: string | null;
  /** Active workspace id (default workspace). */
  activeWorkspace?: string | null;
  /** Active workspace display name. */
  activeWorkspaceName?: string | null;
  /** Governance role codes, scope-prefixed, e.g. ["org:owner","workspace:owner"]. */
  roles?: string[];
  /** Realm marker: "tenant_user" | "operator". */
  userType?: string;
  /** Extra claims to merge last (e.g. operator_role for the operator realm). */
  extra?: Record<string, unknown>;
}

/**
 * Build the custom claim set. iss/aud/sub/exp/iat/jti are added by the signer
 * (OidcKeyService.sign), so they are intentionally NOT set here. Deliberately
 * omits active_tenant_* and entitlement (boundary: §6.3/§9).
 */
export function buildAccessClaims(
  input: AccessClaimsInput,
): Record<string, unknown> {
  const claims: Record<string, unknown> = {};
  if (input.userType) claims.userType = input.userType;
  if (input.sessionId) claims.sid = input.sessionId;
  if (input.activeOrg != null) claims.active_org = input.activeOrg;
  if (input.activeOrgType != null) claims.active_org_type = input.activeOrgType;
  if (input.activeOrgName != null) claims.active_org_name = input.activeOrgName;
  const orgDisplayName = input.activeOrgDisplayName?.trim();
  if (orgDisplayName) claims.active_org_display_name = orgDisplayName;
  if (input.activeWorkspace != null)
    claims.active_workspace = input.activeWorkspace;
  if (input.activeWorkspaceName != null)
    claims.active_workspace_name = input.activeWorkspaceName;
  claims.roles = input.roles ?? [];
  return { ...claims, ...(input.extra ?? {}) };
}
