/**
 * account-deletion.aggregator.ts — 删除账号(批 5b,050-account §7)的编排。
 * @package @vxture/console-bff
 *
 * 账号自己那一段(状态 / 会话 / 令牌 / 三方绑定)归 AccountService;这里做跨域的
 * 资格判定与连带动作(owner 2026-09-04 裁定):
 *
 *   阻断(任一命中不能删):是组织租户所有者 · 未清账单 · 付费余额 > 0 ·
 *        进行中退款 · 进行中开票 · 有钱在途的待付订单
 *   确认(能删,但要用户知悉):订阅未到期(剩余周期作废)· 赠送余额作废
 *   自动(删除时连带):一分钱没收到的待付订单取消 · 非所有者成员关系解除 ·
 *        会话 / 刷新令牌 / 三方绑定 / 本人发出的待接受邀请清掉 · 个人租户随账号软删
 *        (软删发生在 30 天清扫时,保留期内撤销删除不必恢复什么)
 *
 * 判定范围 = 本人是所有者的租户(个人租户 + 组织租户)。组织租户所有者本身就阻断,
 * 所以钱的判定实际落在个人租户上;仍按「所有的 owned 租户」算,免得两处口径漂开。
 * 付费 / 赠送余额从流水推(先消耗赠送),见 service-billing PgTenantClosureRepository。
 */

import { ConflictException, Inject, Injectable } from "@nestjs/common";
import {
  AccountService,
  ACCOUNT_DELETION_RETENTION_DAYS,
  accountPurgeAt,
} from "@vxture/service-account";
import {
  TenantClosureReadService,
  type TenantClosureSnapshot,
} from "@vxture/service-billing";
import { OrganizationService } from "@vxture/service-organization";
import { OrderService } from "@vxture/service-subscription";

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
  return values.reduce((acc, v) => acc + Number(v), 0).toFixed(2);
}

@Injectable()
export class AccountDeletionAggregator {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(OrganizationService) private readonly org: OrganizationService,
    @Inject(TenantClosureReadService)
    private readonly closure: TenantClosureReadService,
    @Inject(OrderService) private readonly orders: OrderService,
  ) {}

  async getState(userId: string): Promise<AccountDeletionState> {
    const user = await this.account.getUserById(userId);
    const status: AccountDeletionState["status"] =
      user?.status === "deleting"
        ? "deleting"
        : user?.status === "active"
          ? "active"
          : "other";
    const deletionRequestedAt = user?.deletionRequestedAt ?? null;

    const memberships = await this.org.listOrgMembershipsForUser(userId);
    const owned = memberships.filter(
      (m) => m.organization && m.organization.ownerUserId === userId,
    );
    const ownedOrgs = owned.filter(
      (m) => m.organization?.type === "organization",
    );
    const nonOwnerOrgs = memberships.filter(
      (m) =>
        m.organization?.type === "organization" &&
        m.organization.ownerUserId !== userId,
    );
    const hasPersonal = owned.some((m) => m.organization?.type === "personal");

    const snapshots: TenantClosureSnapshot[] = await Promise.all(
      owned.map((m) => this.closure.getSnapshot(m.organization!.id)),
    );
    const identities = await this.account.listIdentitiesByUser(userId);
    const currency = snapshots[0]?.currency ?? "CNY";

    const blockers: DeletionItem<DeletionBlockerCode>[] = [];
    if (ownedOrgs.length > 0) {
      blockers.push({
        code: "org_owner",
        count: ownedOrgs.length,
        names: ownedOrgs.map((m) => m.organization!.name),
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

  /**
   * 执行删除:再判一次资格(前端看到的快照可能已过时),连带动作先做、最后才把账号
   * 翻成 deleting——连带动作任一失败就不动账号,用户下次再点。
   */
  async request(
    userId: string,
    clientIp?: string,
  ): Promise<AccountDeletionState> {
    const state = await this.getState(userId);
    if (state.status === "deleting") {
      throw new ConflictException({
        code: "account_already_deleting",
        message: "account_already_deleting",
      });
    }
    if (!state.canDelete) {
      throw new ConflictException({
        code: "deletion_blocked",
        message: "deletion_blocked",
        blockers: state.blockers,
      });
    }

    const memberships = await this.org.listOrgMembershipsForUser(userId);
    const owned = memberships.filter(
      (m) => m.organization && m.organization.ownerUserId === userId,
    );
    for (const m of owned) {
      const snapshot = await this.closure.getSnapshot(m.organization!.id);
      for (const orderId of snapshot.pendingOrdersCancellable) {
        await this.orders.cancel(orderId, {
          actorType: "customer",
          actorId: userId,
          remark: "account_deletion",
          ...(clientIp ? { clientIp } : {}),
        });
      }
    }
    for (const m of memberships) {
      const orgRow = m.organization;
      if (!orgRow || orgRow.type !== "organization") continue;
      if (orgRow.ownerUserId === userId) continue;
      await this.org.removeOrgMember(orgRow.id, userId);
    }
    await this.org.revokeInvitationsCreatedBy(userId);
    await this.account.requestDeletion(userId);
    return this.getState(userId);
  }

  async cancel(userId: string): Promise<AccountDeletionState> {
    await this.account.cancelDeletion(userId);
    return this.getState(userId);
  }
}
