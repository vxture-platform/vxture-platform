/**
 * user-onboarding.service.ts — the SINGLE consolidation point for everything
 * that must accompany a user account (owner directive 2026-07-06: one file that
 * lists every association/initialization so the set is inspectable and
 * extensible).
 *
 * ══ First-user checklist (what a complete user looks like) ═══════════════════
 *
 *  Inside AccountService.createUser's transaction (identity core, atomic):
 *    1. account.users          — user_no from sequence; account defaults to
 *                                `_{user_no}`; phone = verified anchor.
 *    2. account.user_profiles  — 1:1 display row (display_name from input /
 *                                federated profile name).
 *    3. credential.user_credentials — only when a password was supplied.
 *    4. loyalty.user_points    — zero-balance growth row (D-growth baseline).
 *
 *  Social-login extras (social-auth.service, before/after createUser):
 *    5. identity.identities    — federated binding (provider, subject) UNIQUE.
 *    6. account.user_avatars   — imported provider avatar (new users only).
 *
 *  Here (this service; separate idempotent transactions):
 *    7. tenancy.tenants        — personal org, auto-provisioned once per user
 *                                (partial unique index enforces ≤1 personal).
 *                                Naming rule (owner 2026-07-06):
 *                                display_name > account(username) > user_no —
 *                                resolved in-repo when no explicit name is given.
 *    8. tenancy.workspaces     — default workspace, name 'default workspace',
 *                                is_default=true (user-renamable later).
 *    9. tenant/workspace_memberships — owner role at both scopes (composite
 *                                FK pins role scope).
 *   10. loyalty.user_points    — healed here too (ensure) for accounts created
 *                                before step 4 existed.
 *
 *  Extension points (registered, not yet built):
 *    - invite-code / referral attribution + rewards (voucher/extension coupon +
 *      points, composable) — docs/product/platform/feature-backlog.md
 *    - welcome notification / first-login guide flags
 *
 * `ensureOnboarded` is called from the shared tenant-login tail
 * (oidc.finishTenantLogin), so ANY interactive login self-heals a user who is
 * missing pieces 7–10 (PLG lazy provisioning + backfill in one place).
 */
import { Inject, Injectable } from "@nestjs/common";
import { AccountService, type UserView } from "@vxture/service-account";
import {
  OrganizationService,
  type ProvisionedOrg,
} from "@vxture/service-organization";

@Injectable()
export class UserOnboardingService {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(OrganizationService)
    private readonly organization: OrganizationService,
  ) {}

  /**
   * Right after account creation (register / phone first login / social):
   * provision the personal org (+ default workspace + owner memberships) and
   * make sure the growth baseline row exists. `explicitName` (register form)
   * wins; otherwise the display_name > account > user_no chain resolves in-repo.
   */
  async onboardNewUser(
    user: UserView,
    explicitName?: string | null,
  ): Promise<ProvisionedOrg> {
    const provisioned = await this.organization.createPersonalOrg(
      user.id,
      explicitName ?? user.name ?? user.account,
    );
    await this.account.ensureUserPoints(user.id);
    return provisioned;
  }

  /**
   * Idempotent ensure, run on every interactive tenant login (finishTenantLogin
   * tail): a user with no org membership gets the personal org (naming chain
   * resolved in-repo from the DB); the loyalty baseline row is (re)ensured.
   */
  async ensureOnboarded(userId: string): Promise<void> {
    const memberships =
      await this.organization.listOrgMembershipsForUser(userId);
    if (memberships.length === 0) {
      await this.organization.createPersonalOrg(userId, null);
    }
    await this.account.ensureUserPoints(userId);
  }
}
