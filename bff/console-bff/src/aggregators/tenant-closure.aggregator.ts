/**
 * tenant-closure.aggregator.ts — 注销组织租户的资格判定与执行(走查 2026-09-05)。
 * @package @vxture/console-bff
 * @layer Application
 * @category Aggregator
 *
 * 照账号删除(批 5b)的三档:**阻断**(不满足就不能注销)/ **确认**(可以注销但要知悉)/
 * **连带动作**(注销时顺手做掉)。钱的判据复用 TenantClosureReadService 的清算快照——
 * 与删除账号同一个口径,不另写一套。
 *
 * 注销后:租户软删(deleted_at),所有读路径都按它过滤;会话下一次解析找不到活动租户
 * 就回落到个人租户(ActiveContextService 的既有行为),前端整页重载即可。不做保留期——
 * 组织租户注销前已要求清空成员与钱,没有"反悔要回来"的余地(与账号的 30 天不同)。
 */

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { TenantClosureReadService } from "@vxture/service-billing";
import { OrganizationService } from "@vxture/service-organization";
import { OrderService } from "@vxture/service-subscription";
import type {
  TenantClosureAutoCode,
  TenantClosureBlockerCode,
  TenantClosureConfirmCode,
  TenantClosureItem,
  TenantClosureState,
} from "../types/console.types";

@Injectable()
export class TenantClosureAggregator {
  constructor(
    @Inject(OrganizationService) private readonly org: OrganizationService,
    @Inject(TenantClosureReadService)
    private readonly closure: TenantClosureReadService,
    @Inject(OrderService) private readonly orders: OrderService,
  ) {}

  async getState(
    userId: string,
    tenantId: string,
  ): Promise<TenantClosureState> {
    const orgRow = await this.org.getOrgById(tenantId);
    if (!orgRow) throw new NotFoundException("tenant_not_found");

    const blockers: TenantClosureItem<TenantClosureBlockerCode>[] = [];
    const confirmations: TenantClosureItem<TenantClosureConfirmCode>[] = [];
    const autoActions: TenantClosureItem<TenantClosureAutoCode>[] = [];

    // 身份与成员两条硬条件(仓储层事务里会再判一次)
    if (orgRow.type !== "organization")
      blockers.push({ code: "personal_tenant" });
    if (orgRow.ownerUserId !== userId) blockers.push({ code: "not_owner" });
    const others = await this.org.countOtherActiveMembers(
      tenantId,
      orgRow.ownerUserId,
    );
    if (others > 0) blockers.push({ code: "active_members", count: others });

    // 钱的判据:与删除账号同一份清算快照
    const s = await this.closure.getSnapshot(tenantId);
    if (s.unpaidBills > 0) {
      blockers.push({ code: "unpaid_bills", count: s.unpaidBills });
    }
    if (Number(s.paidBalance) > 0) {
      blockers.push({
        code: "paid_balance",
        amount: s.paidBalance,
        currency: s.currency,
      });
    }
    if (s.refundsInProgress > 0) {
      blockers.push({ code: "refund_in_progress", count: s.refundsInProgress });
    }
    if (s.receiptsInProgress > 0) {
      blockers.push({
        code: "receipt_in_progress",
        count: s.receiptsInProgress,
      });
    }
    if (s.pendingOrdersWithMoney > 0) {
      blockers.push({
        code: "pending_order_with_payment",
        count: s.pendingOrdersWithMoney,
      });
    }
    if (s.unexpiredSubscriptions > 0) {
      confirmations.push({
        code: "active_subscription",
        count: s.unexpiredSubscriptions,
      });
    }
    if (Number(s.giftedBalance) > 0) {
      confirmations.push({
        code: "gifted_balance",
        amount: s.giftedBalance,
        currency: s.currency,
      });
    }
    if (s.pendingOrdersCancellable.length > 0) {
      autoActions.push({
        code: "cancel_pending_orders",
        count: s.pendingOrdersCancellable.length,
      });
    }
    autoActions.push({ code: "revoke_invitations" });
    autoActions.push({ code: "switch_to_personal" });

    return {
      tenantId,
      tenantName: orgRow.displayName ?? orgRow.name,
      status: orgRow.status,
      canClose: blockers.length === 0,
      blockers,
      confirmations,
      autoActions,
    };
  }

  /**
   * 执行注销。再判一次资格(409 带阻断项),核对输入的名称(简称或认证名都认),
   * 取消可取消的订单,然后仓储层事务软删 + 撤邀请。
   */
  async request(
    userId: string,
    tenantId: string,
    confirmName: string,
    clientIp?: string,
  ): Promise<TenantClosureState> {
    const state = await this.getState(userId, tenantId);
    if (!state.canClose) {
      throw new ConflictException({
        code: "closure_blocked",
        blockers: state.blockers,
      });
    }
    const orgRow = await this.org.getOrgById(tenantId);
    if (!orgRow) throw new NotFoundException("tenant_not_found");
    const typed = confirmName.trim();
    if (
      typed === "" ||
      (typed !== orgRow.name && typed !== (orgRow.displayName ?? orgRow.name))
    ) {
      throw new ConflictException({ code: "confirm_name_mismatch" });
    }

    const snapshot = await this.closure.getSnapshot(tenantId);
    for (const orderId of snapshot.pendingOrdersCancellable) {
      await this.orders.cancel(orderId, {
        actorType: "customer",
        actorId: userId,
        remark: "tenant_closure",
        ...(clientIp ? { clientIp } : {}),
      });
    }

    const result = await this.org.closeTenant(tenantId, userId);
    if (!result.ok) {
      throw new ConflictException({ code: result.reason });
    }
    return { ...state, status: "deleted", canClose: false };
  }
}
