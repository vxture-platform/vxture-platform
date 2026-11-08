/**
 * Independent customer lifecycle entry and retryable cross-domain adapters.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-07
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
// ⚠️ 跨层引用: Lifecycle state and persistence remain in the account domain.
import {
  AccountService,
  AccountLifecycleRepository,
  ACCOUNT_DELETION_RETENTION_DAYS,
  accountPurgeAt,
} from "@vxture/service-account";
// ⚠️ 跨层引用: Each business domain owns its blockers and idempotent cleanup.
import {
  TenantClosureReadService,
  type TenantClosureSnapshot,
} from "@vxture/service-billing";
import { OrganizationService } from "@vxture/service-organization";
import { OrderService } from "@vxture/service-subscription";
import { CustomerSecurityChallengeService } from "../authn/customer-security-challenge.service";
import type { CustomerSessionContext } from "./realm-session.service";
import { OidcService } from "./oidc.service";

// ============================================================================
// Lifecycle view (no tenant selection or portal session required)
// ============================================================================
export type DeletionBlockerCode =
  | "org_owner"
  | "unpaid_bills"
  | "paid_balance"
  | "refund_in_progress"
  | "receipt_in_progress"
  | "pending_order_with_payment";

export type DeletionConfirmCode = "active_subscription" | "gifted_balance";

export type DeletionAutoCode =
  | "cancel_pending_orders"
  | "leave_organizations"
  | "revoke_sessions"
  | "unbind_identities"
  | "revoke_invitations"
  | "delete_personal_tenant";

export interface DeletionItem<TCode extends string = string> {
  code: TCode;
  count?: number;
  amount?: string;
  currency?: string;
  names?: string[];
}

export interface AccountDeletionState {
  status: "active" | "deleting" | "other";
  deletionRequestedAt: string | null;
  purgeAt: string | null;
  retentionDays: number;
  canDelete: boolean;
  blockers: DeletionItem<DeletionBlockerCode>[];
  confirmations: DeletionItem<DeletionConfirmCode>[];
  autoActions: DeletionItem<DeletionAutoCode>[];
}

function sum(values: string[]): string {
  const total = values.reduce(
    (n, value) => n + BigInt(value.replace(".", "")),
    0n,
  );
  return `${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`;
}
function input(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("invalid_lifecycle_request");
  return body as Record<string, unknown>;
}

@Injectable()
export class CustomerLifecycleService {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(AccountLifecycleRepository)
    private readonly lifecycle: AccountLifecycleRepository,
    @Inject(OrganizationService) private readonly org: OrganizationService,
    @Inject(TenantClosureReadService)
    private readonly closure: TenantClosureReadService,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(CustomerSecurityChallengeService)
    private readonly challenges: CustomerSecurityChallengeService,
    @Inject(OidcService) private readonly oidc: OidcService,
  ) {}

  /** Return account state even when business systems are unavailable during recovery. */
  async view(context: CustomerSessionContext) {
    const state = await this.getState(context.userId);
    const operation = await this.lifecycle.getForUser(context.userId);
    return {
      ...state,
      cleanup: operation
        ? { status: operation.status, attempts: operation.attempts }
        : null,
      canRecover:
        state.status === "deleting" &&
        state.purgeAt !== null &&
        Date.parse(state.purgeAt) > Date.now(),
    };
  }

  /** Start only the server-selected lifecycle operation, bound to the current request. */
  async start(
    context: CustomerSessionContext,
    body: unknown,
    recovery = false,
  ) {
    const data = input(body);
    if (data.method !== "phone" && data.method !== "email")
      throw new BadRequestException("invalid_verification_method");
    const operation = recovery ? "account-recovery" : "account-deletion";
    if (
      recovery
        ? context.user.status !== "deleting" ||
          !context.user.deletionRequestedAt ||
          Date.parse(accountPurgeAt(context.user.deletionRequestedAt)) <=
            Date.now()
        : context.user.status !== "active"
    )
      throw new ConflictException("lifecycle_state_changed");
    return this.challenges.start(
      context,
      operation,
      recovery ? context.user.deletionRequestedAt! : "",
      data.method,
    );
  }

  /** Require a fresh operation-bound proof and explicit acknowledgement. */
  async request(context: CustomerSessionContext, body: unknown) {
    const data = input(body);
    if (data.acknowledged !== true || typeof data.challengeId !== "string")
      throw new BadRequestException("acknowledgement_and_proof_required");
    const state = await this.getState(context.userId);
    if (!state.canDelete)
      throw new ConflictException({
        code: "deletion_blocked",
        message: "deletion_blocked",
        blockers: state.blockers,
      });
    const proof = await this.challenges.consume(
      context,
      data.challengeId,
      "account-deletion",
    );
    const result = await this.account.requestDeletion(
      context.userId,
      proof.snapshot,
    );
    // From here onward, delivery belongs to the durable worker. Never turn a
    // committed deletion into a failed HTTP mutation because Redis/RPs are down.
    return {
      ok: true as const,
      status: "deleting" as const,
      purgeAt: result.purgeAt,
      cleanupPending: true,
      reauthenticate: true,
    };
  }

  /** Recover this exact request; account locking fences concurrent cleanup. */
  async recover(context: CustomerSessionContext, body: unknown) {
    const data = input(body);
    if (typeof data.challengeId !== "string")
      throw new BadRequestException("security_proof_required");
    const proof = await this.challenges.consume(
      context,
      data.challengeId,
      "account-recovery",
    );
    if (proof.target !== context.user.deletionRequestedAt)
      throw new ConflictException("lifecycle_state_changed");
    await this.account.cancelDeletion(context.userId, proof.target);
    return { ok: true as const, status: "active" as const };
  }

  // ============================================================================
  // Fail-closed business adapters and durable delivery checkpoints
  // ============================================================================

  async process(id: string): Promise<boolean> {
    return this.lifecycle.run(id, async (operation, save) => {
      // Persist every recipient list before any Redis key can be removed.
      for (const session of operation.payload.sessions)
        if (session.clients === null)
          session.clients = await this.oidc.getCustomerLogoutClients(
            operation.userId,
            session.sid,
          );
      await save(operation.payload);
      for (const session of operation.payload.sessions)
        await this.oidc.cleanupCustomerLifecycleSession(
          operation.userId,
          session.sid,
          session.clients!,
        );
      const state = await this.getState(operation.userId, true);
      if (state.blockers.length)
        throw new ConflictException("deletion_blocked");
      const owned = await this.org.listOwnedOrganizations(operation.userId);
      for (const org of owned) {
        const snapshot = await this.closure.getSnapshot(org.id);
        for (const orderId of snapshot.pendingOrdersCancellable)
          await this.orders.cancel(
            orderId,
            {
              actorType: "customer",
              actorId: operation.userId,
              remark: `account_deletion:${operation.id}`,
            },
            "cancelled",
            operation.id,
          );
      }
      await this.org.cleanupAccountMemberships(operation.userId);
      await this.org.revokeInvitationsCreatedBy(operation.userId);
      // Late payment and owner changes must not mark unfinished work completed.
      if ((await this.getState(operation.userId, true)).blockers.length)
        throw new ConflictException("deletion_blocked");
    });
  }

  async getState(
    userId: string,
    includeBusiness = false,
  ): Promise<AccountDeletionState> {
    const user = await this.account.getUserById(userId);
    const status: AccountDeletionState["status"] =
      user?.status === "deleting"
        ? "deleting"
        : user?.status === "active"
          ? "active"
          : "other";
    const deletionRequestedAt = user?.deletionRequestedAt ?? null;

    if (status !== "active" && !includeBusiness) {
      return {
        status,
        deletionRequestedAt,
        purgeAt: deletionRequestedAt
          ? accountPurgeAt(deletionRequestedAt)
          : null,
        retentionDays: ACCOUNT_DELETION_RETENTION_DAYS,
        canDelete: false,
        blockers: [],
        confirmations: [],
        autoActions: [],
      };
    }
    const [memberships, owned] = await Promise.all([
      this.org.listOrgMembershipsForUser(userId),
      this.org.listOwnedOrganizations(userId),
    ]);
    const ownedOrgs = owned.filter((org) => org.type === "organization");
    const nonOwnerOrgs = memberships.filter(
      (m) =>
        m.organization?.type === "organization" &&
        m.organization.ownerUserId !== userId,
    );
    const hasPersonal = owned.some((m) => m.type === "personal");

    const snapshots: TenantClosureSnapshot[] = await Promise.all(
      owned.map((m) => this.closure.getSnapshot(m.id)),
    );
    const identities = await this.account.listIdentitiesByUser(userId);
    const currency = snapshots[0]?.currency ?? "CNY";

    const blockers: DeletionItem<DeletionBlockerCode>[] = [];
    if (ownedOrgs.length > 0) {
      blockers.push({
        code: "org_owner",
        count: ownedOrgs.length,
        names: ownedOrgs.map((m) => m.name),
      });
    }
    const unpaidBills = snapshots.reduce((n, s) => n + s.unpaidBills, 0);
    if (unpaidBills > 0)
      blockers.push({ code: "unpaid_bills", count: unpaidBills });
    const paidBalance = sum(snapshots.map((s) => s.paidBalance));
    if (Number(paidBalance) > 0) {
      blockers.push({ code: "paid_balance", amount: paidBalance, currency });
    }
    const refunds = snapshots.reduce((n, s) => n + s.refundsInProgress, 0);
    if (refunds > 0)
      blockers.push({ code: "refund_in_progress", count: refunds });
    const receipts = snapshots.reduce((n, s) => n + s.receiptsInProgress, 0);
    if (receipts > 0) {
      blockers.push({ code: "receipt_in_progress", count: receipts });
    }
    const ordersWithMoney = snapshots.reduce(
      (n, s) => n + s.pendingOrdersWithMoney,
      0,
    );
    if (ordersWithMoney > 0) {
      blockers.push({
        code: "pending_order_with_payment",
        count: ordersWithMoney,
      });
    }

    const confirmations: DeletionItem<DeletionConfirmCode>[] = [];
    const unexpired = snapshots.reduce(
      (n, s) => n + s.unexpiredSubscriptions,
      0,
    );
    if (unexpired > 0) {
      confirmations.push({ code: "active_subscription", count: unexpired });
    }
    const giftedBalance = sum(snapshots.map((s) => s.giftedBalance));
    if (Number(giftedBalance) > 0) {
      confirmations.push({
        code: "gifted_balance",
        amount: giftedBalance,
        currency,
      });
    }

    const autoActions: DeletionItem<DeletionAutoCode>[] = [];
    const cancellable = snapshots.reduce(
      (n, s) => n + s.pendingOrdersCancellable.length,
      0,
    );
    if (cancellable > 0) {
      autoActions.push({ code: "cancel_pending_orders", count: cancellable });
    }
    if (nonOwnerOrgs.length > 0) {
      autoActions.push({
        code: "leave_organizations",
        count: nonOwnerOrgs.length,
        names: nonOwnerOrgs.map((m) => m.organization!.name),
      });
    }
    autoActions.push({ code: "revoke_sessions" });
    if (identities.length > 0) {
      autoActions.push({ code: "unbind_identities", count: identities.length });
    }
    autoActions.push({ code: "revoke_invitations" });
    if (hasPersonal) autoActions.push({ code: "delete_personal_tenant" });

    return {
      status,
      deletionRequestedAt,
      purgeAt: deletionRequestedAt ? accountPurgeAt(deletionRequestedAt) : null,
      retentionDays: ACCOUNT_DELETION_RETENTION_DAYS,
      canDelete: status === "active" && blockers.length === 0,
      blockers,
      confirmations,
      autoActions,
    };
  }
}
