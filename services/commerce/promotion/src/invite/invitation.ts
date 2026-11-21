/**
 * invitation.ts - Shared invitation eligibility and transactional redemption.
 * @package @vxture/service-promotion
 * @layer Domain
 * @category service
 * @author AI-Generated
 * @date 2026-11-19
 */
import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";

// ===========================================================================
// Eligibility shared by catalog reads, purchase previews and redemption.
// ===========================================================================
export interface InvitationScope {
  userId: string;
  tenantId: string;
  workspaceId: string;
  planVersionId: string;
  planCode: string;
}

/**
 * Build a predicate from trusted SQL aliases and placeholders, never user text.
 * @param o - Internal aliases and parameter expressions.
 * @returns The authoritative invitation eligibility predicate.
 */
export function invitationMatchSql(o: {
  v: string;
  b: string;
  user: string;
  tenant: string;
  workspace: string;
  planVersion: string;
  planCode: string;
}): string {
  const version = `coalesce(${o.b}.effect->>'plan_version_id', ${o.b}.effect->>'planVersionId')`;
  const plan = `coalesce(${o.b}.effect->>'plan_code', ${o.b}.effect->>'planCode')`;
  return `${o.b}.kind = 'invite' and ${o.b}.status = 'active'
    and ${o.v}.status = 'assigned' and ${o.v}.max_uses = 1 and ${o.v}.used_count = 0
    and (${o.v}.expires_at is null or ${o.v}.expires_at > now())
    and ${o.b}.valid_from <= now() and ${o.b}.valid_until > now()
    and (${o.b}.tenant_id is null or ${o.b}.tenant_id = ${o.tenant})
    and (${o.v}.assigned_tenant_id = ${o.tenant}
      or (${o.v}.assigned_tenant_id is null
        and (${o.b}.tenant_id = ${o.tenant} or ${o.v}.assigned_workspace_id = ${o.workspace})))
    and ((${o.v}.assigned_user_id = ${o.user} and ${o.v}.assigned_workspace_id is null)
      or (${o.v}.assigned_workspace_id = ${o.workspace} and ${o.v}.assigned_user_id is null))
    and exists (select 1 from tenancy.workspaces iw join tenancy.tenants it on it.id = iw.tenant_id
      where iw.id = ${o.workspace} and iw.tenant_id = ${o.tenant}
        and iw.deleted_at is null and iw.status = 'active' and it.deleted_at is null and it.status = 'active'
        and (it.owner_user_id = ${o.user} or exists (
          select 1 from tenancy.tenant_memberships im where im.tenant_id = it.id
            and im.user_id = ${o.user} and im.status = 'active')))
    and (${o.b}.effect->'effect_version' is null or ${o.b}.effect->'effect_version' = '1'::jsonb)
    and (${o.b}.effect->>'plan_version_id' is null or ${o.b}.effect->>'planVersionId' is null
      or ${o.b}.effect->>'plan_version_id' = ${o.b}.effect->>'planVersionId')
    and (${o.b}.effect->>'plan_code' is null or ${o.b}.effect->>'planCode' is null
      or ${o.b}.effect->>'plan_code' = ${o.b}.effect->>'planCode')
    and ((${version} is not null and ${version} = ${o.planVersion}
        and (${plan} is null or ${plan} = ${o.planCode}))
      or (${version} is null and ${plan} = ${o.planCode}))`;
}
const predicate = invitationMatchSql({
  v: "v",
  b: "b",
  user: "$1",
  tenant: "$2",
  workspace: "$3",
  planVersion: "$4",
  planCode: "$5",
});
function values(scope: InvitationScope): string[] {
  return [
    scope.userId,
    scope.tenantId,
    scope.workspaceId,
    scope.planVersionId,
    scope.planCode,
  ];
}

/**
 * Check eligibility without consuming a voucher.
 * @param client - Caller-owned query connection.
 * @param scope - Verified customer and actual purchase workspace.
 * @returns Whether an eligible invitation currently exists.
 */
export async function hasInvitation(
  client: Pick<PoolClient, "query">,
  scope: InvitationScope,
): Promise<boolean> {
  const result = await client.query(
    `select v.id from promotion.vouchers v
    join promotion.voucher_batches b on b.id = v.batch_id where ${predicate} limit 1`,
    values(scope),
  );
  return result.rows.length > 0;
}

// ===========================================================================
// The caller owns order creation, operation receipt and the commit boundary.
// ===========================================================================
/**
 * Redeem an invitation after creating its order in the same transaction.
 * @param client - Caller-owned transaction, already holding its new order and invoice.
 * @param scope - Verified purchase scope.
 * @param orderId - Newly created order.
 * @param operationId - Durable idempotency receipt inserted in this transaction.
 * @returns The consumed voucher ID.
 * @throws {ConflictException} When eligibility changed or another order won the voucher.
 */
export async function redeemInvitationTx(
  client: PoolClient,
  scope: InvitationScope,
  orderId: string,
  operationId: string,
): Promise<string> {
  const result = await client.query<{
    id: string;
    batch_id: string;
    effect: Record<string, unknown>;
  }>(
    `with candidate as (
      select v.id from promotion.vouchers v join promotion.voucher_batches b on b.id = v.batch_id
      where ${predicate}
      order by least(coalesce(v.expires_at,b.valid_until),b.valid_until), v.created_at, v.id
      limit 1 for update of v skip locked
    )
    update promotion.vouchers v set status='redeemed', used_count=v.used_count+1,
      redeemed_at=now(), assigned_tenant_id=$2
    from promotion.voucher_batches b, candidate c
    where v.id=c.id and b.id=v.batch_id and ${predicate}
    returning v.id,v.batch_id,b.effect`,
    values(scope),
  );
  const voucher = result.rows[0];
  if (!voucher)
    throw new ConflictException({
      code: "PLAN_NOT_PUBLIC",
      message: "邀请已失效或已被使用，请刷新后重试。",
    });
  const redemption = await client.query<{ id: string }>(
    `insert into promotion.voucher_redemptions
      (redemption_no,voucher_id,tenant_id,workspace_id,user_id,kind,effect_snapshot,order_id,operation_id)
      values ('RV-' || to_char(now(),'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,12),
        $1,$2,$3,$4,'invite',$5::jsonb,$6,$7) returning id`,
    [
      voucher.id,
      scope.tenantId,
      scope.workspaceId,
      scope.userId,
      JSON.stringify({
        ...voucher.effect,
        requested_plan_version_id: scope.planVersionId,
        requested_plan_code: scope.planCode,
      }),
      orderId,
      operationId,
    ],
  );
  await client.query(
    `insert into promotion.voucher_events
    (operation_id,batch_id,voucher_id,redemption_id,order_id,event_type,actor_realm,actor_id,metadata)
    values ($1,$2,$3,$4,$5,'redeemed','customer',$6,$7::jsonb)`,
    [
      operationId,
      voucher.batch_id,
      voucher.id,
      redemption.rows[0]!.id,
      orderId,
      scope.userId,
      JSON.stringify({ kind: "invite", workspace_id: scope.workspaceId }),
    ],
  );
  return voucher.id;
}
