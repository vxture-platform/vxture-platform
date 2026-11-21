/**
 * subscription-redemption.ts - Fixed published subscription grants in a caller transaction.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category service
 * @author AI-Generated
 * @date 2026-11-19
 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { PgSubscriptionRepository } from "../repository/pg-subscription.repository";

export interface RedemptionComponent {
  product_id: string;
  product_code: string;
  product_name: string;
  component_role: string;
  tier: string | null;
  quota: Record<string, unknown>;
  features: string[];
}
export interface RedemptionPlan {
  planVersionId: string;
  planName: string;
  planCode: string;
  versionNo: number;
  primary: RedemptionComponent;
  grants: RedemptionComponent[];
}

// ===========================================================================
// A fixed version authorizes the grant; prices and invitations are not payments.
// ===========================================================================
export class SubscriptionRedemption {
  constructor(private readonly pool: Pool) {}

  /** Resolve the grant scope and current service gates. @param client - Caller connection. @param version - Fixed published version. @param lock - Hold catalog gates stable through commit. @returns Display details and immutable grant snapshot. @throws {ConflictException} For unavailable or malformed catalogs. */
  async plan(
    client: Pick<PoolClient, "query">,
    version: string,
    lock = false,
  ): Promise<RedemptionPlan> {
    const plan = (
      await client.query<{
        plan_name: string;
        plan_code: string;
        version_no: number;
      }>(
        `select p.plan_name,p.plan_code,v.version_no from product.plan_versions v join product.plans p on p.id=v.plan_id
       where v.id=$1 and v.status='published' and v.is_locked and p.status='active' and p.deleted_at is null ${lock ? "for share of v,p" : ""}`,
        [version],
      )
    ).rows[0];
    if (!plan)
      throw new ConflictException("兑换套餐版本未发布、未冻结或已停用");
    const components = await client.query<
      RedemptionComponent & {
        status: string;
        release_stage: string;
        maintenance_window_id: string | null;
        deleted_at: Date | null;
      }
    >(
      `select pc.product_id,pr.product_code,pr.product_name,pc.component_role,pc.tier,pc.quota,pc.features,
          pr.status,pr.release_stage,pr.maintenance_window_id,pr.deleted_at
       from product.plan_components pc join product.products pr on pr.id=pc.product_id
       where pc.plan_version_id=$1 order by pc.product_id ${lock ? "for share of pr" : ""}`,
      [version],
    );
    const primary = components.rows.filter(
      (r) => r.component_role === "primary",
    );
    if (
      primary.length !== 1 ||
      components.rows.some(
        (r) =>
          r.status !== "active" ||
          r.deleted_at ||
          !["beta", "stable"].includes(r.release_stage) ||
          r.maintenance_window_id,
      )
    )
      throw new ConflictException(
        "兑换产品未开放、已停用或正在维护，请稍后重试",
      );
    const grants = components.rows.map(
      ({
        product_id,
        product_code,
        product_name,
        component_role,
        tier,
        quota,
        features,
      }) => ({
        product_id,
        product_code,
        product_name,
        component_role,
        tier,
        quota,
        features,
      }),
    );
    return {
      planVersionId: version,
      planName: plan.plan_name,
      planCode: plan.plan_code,
      versionNo: plan.version_no,
      primary: grants.find((r) => r.component_role === "primary")!,
      grants,
    };
  }

  /** Check the destination slot without changing service. @param client - Caller transaction. @param workspaceId - Selected workspace. @param productId - Primary product. @returns Resolves for an empty slot. @throws {ConflictException} For current subscriptions or unsettled orders. */
  async assertEmpty(
    client: Pick<PoolClient, "query">,
    workspaceId: string,
    productId: string,
  ) {
    const held = await client.query(
      `select 1 from metering.subscriptions where workspace_id=$1 and product_id=$2 and deleted_at is null and status in ('active','trialing','expiring','overdue','suspended')
      union all select 1 from billing.orders where workspace_id=$1 and product_id=$2 and status in ('pending_payment','pending_verify','paid') limit 1`,
      [workspaceId, productId],
    );
    if (held.rows.length)
      throw new ConflictException(
        "当前工作空间已有该产品订阅或待处理订单；兑换券只支持新订阅",
      );
  }

  /** Create the noncash subscription and existing quota materializations. @param client - Caller-owned transaction and slot lock. @param scope - Verified actor and workspace. @param plan - Validated fixed catalog. @param days - Approved bounded term. @param start - Database instant after locks. @returns Created subscription with no payment or order. @throws {ConflictException} For an occupied slot. */
  async create(
    client: PoolClient,
    scope: { tenantId: string; workspaceId: string; userId: string },
    plan: RedemptionPlan,
    days: number,
    start: Date,
  ) {
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new BadRequestException("兑换期限必须为 1 至 3650 个整数天");
    await this.assertEmpty(client, scope.workspaceId, plan.primary.product_id);
    const sub = await new PgSubscriptionRepository(this.pool).create(
      {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        planVersionId: plan.planVersionId,
        cycleType: "day",
        cycleCount: days,
        startAt: start,
        endAt: new Date(start.getTime() + days * 86400000),
        autoRenew: false,
        payAmount: 0,
        currency: "CNY",
        createdBy: scope.userId,
        createdByType: "customer",
        status: "active",
        subscriptionKind: "free",
        activationMethod: "redemption",
      },
      client,
    );
    await client.query(
      "update metering.subscriptions set paid_amount=0 where id=$1",
      [sub.id],
    );
    await client.query(
      "delete from metering.entitlement_caches where workspace_id=$1",
      [scope.workspaceId],
    );
    return sub;
  }
}
