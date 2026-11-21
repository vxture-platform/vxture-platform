/**
 * subscription-extension.ts - Term-only changes in a caller-owned transaction.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category service
 * @author AI-Generated
 * @date 2026-11-19
 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";

// ===========================================================================
// Eligibility is also projected by the customer voucher ledger.
// ===========================================================================
interface ExtensionScope {
  tenantId: string;
  workspaceId: string;
  userId: string;
}
export interface ExtensionTarget {
  id: string;
  plan_version_id: string;
  product_code: string;
  product_name: string;
  plan_name: string;
  version_no: number;
  status: string;
  end_at: Date;
}
const TARGETS = `select s.id,s.plan_version_id,s.status,s.end_at,pr.product_code,pr.product_name,p.plan_name,v.version_no
  from metering.subscriptions s join product.plan_versions v on v.id=s.plan_version_id
  join product.plans p on p.id=v.plan_id join product.products pr on pr.id=s.product_id
  where s.tenant_id=$1 and s.workspace_id=$2 and s.deleted_at is null
    and s.status in ('active','expiring','overdue') and s.subscription_kind<>'trial' and s.end_at is not null and s.cycle_unit<>'perpetual'
    and ($3::text[] is null or pr.product_code=any($3))
    and not exists(select 1 from metering.subscription_suspensions su where su.subscription_id=s.id and su.resumed_at is null)
    and not exists(select 1 from billing.orders o where o.workspace_id=s.workspace_id and o.product_id=s.product_id and o.status in ('pending_payment','pending_verify','paid'))
    and not exists(select 1 from product.plan_components c join product.products cp on cp.id=c.product_id where c.plan_version_id=s.plan_version_id and (cp.status<>'active' or cp.deleted_at is not null or cp.release_stage not in ('beta','stable') or cp.maintenance_window_id is not null))`;

export class SubscriptionExtension {
  /** List eligible existing subscriptions. @param client - Current connection. @param scope - Verified destination. @param codes - Optional primary-product scope. @returns Targets in deterministic order. */
  static async targets(
    client: Pick<PoolClient, "query">,
    scope: ExtensionScope,
    codes?: string[],
  ) {
    return (
      await client.query<ExtensionTarget>(`${TARGETS} order by s.end_at,s.id`, [
        scope.tenantId,
        scope.workspaceId,
        codes ?? null,
      ])
    ).rows;
  }

  /** Lock before any voucher lock. @param client - Caller transaction holding the workspace lock. @param scope - Verified destination. @param id - Selected subscription. @returns Resolves for an owned target. @throws {ConflictException} For missing or foreign targets. */
  static async lock(client: PoolClient, scope: ExtensionScope, id: string) {
    const row = await client.query(
      "select id from metering.subscriptions where id=$1 and tenant_id=$2 and workspace_id=$3 and deleted_at is null for update",
      [id, scope.tenantId, scope.workspaceId],
    );
    if (!row.rows.length)
      throw new ConflictException("目标订阅不可展期，请重新预览");
    await client.query(
      `select pr.id from product.products pr join product.plan_components c on c.product_id=pr.id join metering.subscriptions s on s.plan_version_id=c.plan_version_id where s.id=$1 order by pr.id for share of pr`,
      [id],
    );
  }

  /** Validate the confirmed baseline under the target lock. @param client - Caller connection. @param scope - Verified destination. @param id - Locked subscription. @param codes - Approved primary products. @param expected - Dates/version shown to the customer. @returns Current eligible target. @throws {ConflictException} When the preview is stale or the target is ineligible. */
  static async target(
    client: PoolClient,
    scope: ExtensionScope,
    id: string,
    codes: string[] | undefined,
    expected: { endAt: string; planVersionId: string },
  ) {
    const target = (
      await client.query<ExtensionTarget>(`${TARGETS} and s.id=$4`, [
        scope.tenantId,
        scope.workspaceId,
        codes ?? null,
        id,
      ])
    ).rows[0];
    if (
      !target ||
      target.end_at.toISOString() !== expected.endAt ||
      target.plan_version_id !== expected.planVersionId
    )
      throw new ConflictException(
        "订阅期限、版本或可用状态已变化，请重新预览展期",
      );
    return target;
  }

  /** Extend time without granting quota or restarting a cycle. @param client - Caller-owned transaction and subscription lock. @param scope - Verified actor. @param target - Revalidated subscription. @param days - Approved integer days of 24 hours. @param reference - Durable voucher evidence number. @returns The database's actual new end date. @throws {BadRequestException} For unbounded durations. */
  static async apply(
    client: PoolClient,
    scope: ExtensionScope,
    target: ExtensionTarget,
    days: number,
    reference: string,
  ) {
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650)
      throw new BadRequestException("展期天数必须为 1 至 3650 个整数天");
    // Only term-bound subscription pools follow the term. Independent grants and
    // entitlement overrides keep their own expiration; usage and anchors never move.
    await client.query(
      `update metering.quota_pools set expires_at=expires_at+($2*interval '24 hours'),updated_at=clock_timestamp()
      where subscription_id=$1 and pool_source='subscription' and status='active' and expires_at=(select end_at from metering.subscriptions where id=$1)`,
      [target.id, days],
    );
    const changed = await client.query<{ end_at: Date }>(
      `update metering.subscriptions set end_at=end_at+($2*interval '24 hours'),
      next_renewal_at=case when auto_renew and next_renewal_at is not null then next_renewal_at+($2*interval '24 hours') else next_renewal_at end,
      updated_at=clock_timestamp() where id=$1 returning end_at`,
      [target.id, days],
    );
    await client.query(
      `insert into metering.subscription_histories(tenant_id,subscription_id,change_type,from_plan_version_id,to_plan_version_id,from_status,to_status,actor_type,actor_id,remark)
      values($1,$2,'voucher_extended',$3,$3,$4,$4,'customer',$5,$6)`,
      [
        scope.tenantId,
        target.id,
        target.plan_version_id,
        target.status,
        scope.userId,
        `${reference}: +${days} days; ${target.end_at.toISOString()} -> ${changed.rows[0]!.end_at.toISOString()}`,
      ],
    );
    await client.query(
      "delete from metering.entitlement_caches where workspace_id=$1",
      [scope.workspaceId],
    );
    return changed.rows[0]!.end_at;
  }
}
