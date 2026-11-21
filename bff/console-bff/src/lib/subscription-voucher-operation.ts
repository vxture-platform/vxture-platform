/**
 * subscription-voucher-operation.ts - Atomic noncash subscription redemption.
 * @package @vxture/bff-console
 * @layer Application
 * @category orchestration
 * @author AI-Generated
 * @date 2026-11-19
 */
import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Pool } from "pg";
// ⚠️ 跨层引用: Coordinate public domain interfaces on one connection.
import {
  SubscriptionVouchers,
  type VoucherScope,
} from "@vxture/service-promotion";
// ⚠️ 跨层引用: Subscription owns catalog gates and quota materialization.
import { SubscriptionRedemption } from "@vxture/service-subscription";
// ⚠️ 跨层引用: Provisioning owns the durable queue; no network runs here.
import { PgProvisioningRepository } from "@vxture/service-provisioning";

export interface SubscriptionVoucherResult {
  voucherId: string;
  code: string;
  subscriptionId: string;
  redemptionNo: string;
  tenantId: string;
  workspaceId: string;
  productName: string;
  planName: string;
  versionNo: number;
  startAt: string;
  endAt: string;
  durationDays: number;
}
function keyOf(input: unknown) {
  if (typeof input !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(input))
    throw new BadRequestException("idempotencyKey 非法");
  return input;
}

// ===========================================================================
// Preview never reserves. Confirmation rechecks gates after destination locks.
// ===========================================================================
/** Preview a subscription grant. @param pool - Application pool. @param scope - Verified current actor. @param voucherId - Owned voucher. @returns Version, duration, grants and destination. @throws {ConflictException} For an unavailable destination. */
export async function previewSubscriptionVoucher(
  pool: Pool,
  scope: VoucherScope,
  voucherId: string,
) {
  const context = await SubscriptionVouchers.context(pool, scope);
  const voucher = await SubscriptionVouchers.read(pool, scope, voucherId);
  const domain = new SubscriptionRedemption(pool);
  const plan = await domain.plan(pool, voucher.terms.plan_version_id);
  await domain.assertEmpty(pool, scope.workspaceId, plan.primary.product_id);
  return {
    code: voucher.code,
    productName: plan.primary.product_name,
    planName: plan.planName,
    versionNo: plan.versionNo,
    durationDays: voucher.terms.duration_days,
    tenantName: context.tenant_name,
    workspaceName: context.workspace_name,
    fundingSource: "operator_grant" as const,
    autoRenew: false,
    grants: plan.grants.map((c) => ({
      productName: c.product_name,
      role: c.component_role,
      tier: c.tier,
      quota: c.quota,
      features: c.features,
    })),
  };
}

/** Recover a result without a credential. @param pool - Customer pool. @param scope - Verified current context. @param key - Original request identity. @returns Scoped committed result or null. @throws {BadRequestException} For an invalid request identity. */
export async function subscriptionVoucherResult(
  pool: Pool,
  scope: VoucherScope,
  key: string,
): Promise<SubscriptionVoucherResult | null> {
  key = keyOf(key);
  await SubscriptionVouchers.context(pool, scope);
  const r = await pool.query<{ result: SubscriptionVoucherResult }>(
    `select result from promotion.voucher_operations where actor_realm='customer' and actor_id=$1 and operation_type='subscription_redemption' and idempotency_key=$2 and result->>'tenantId'=$3 and result->>'workspaceId'=$4`,
    [scope.userId, key, scope.tenantId, scope.workspaceId],
  );
  return r.rows[0]?.result ?? null;
}

/** Commit grants, evidence and delivery intents together. @param pool - Application pool. @param scope - Verified session destination. @param command - Owned voucher and stable retry identity. @returns Original successful result on retry. @throws {ConflictException} For changed parameters or an occupied slot. */
export async function redeemSubscriptionVoucher(
  pool: Pool,
  scope: VoucherScope,
  command: { voucherId: string; idempotencyKey: string },
): Promise<SubscriptionVoucherResult> {
  const key = keyOf(command?.idempotencyKey);
  if (
    typeof command?.voucherId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      command.voucherId,
    )
  )
    throw new BadRequestException("voucherId 非法");
  const voucherId = command.voucherId.toLowerCase();
  scope = {
    tenantId: scope.tenantId.toLowerCase(),
    userId: scope.userId.toLowerCase(),
    workspaceId: scope.workspaceId.toLowerCase(),
  };
  const hash = createHash("sha256")
    .update(JSON.stringify({ ...scope, voucherId }))
    .digest("hex");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `voucher:redemption:${scope.userId}:${key}`,
    ]);
    await SubscriptionVouchers.context(client, scope);
    const prior = (
      await client.query<{
        request_hash: string;
        result: SubscriptionVoucherResult;
      }>(
        `select request_hash,result from promotion.voucher_operations where actor_realm='customer' and actor_id=$1 and operation_type='subscription_redemption' and idempotency_key=$2`,
        [scope.userId, key],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash)
        throw new ConflictException("同一兑换请求标识的参数或上下文已改变");
      await client.query("commit");
      return prior.result;
    }
    await client.query(
      "select id from tenancy.workspaces where id=$1 and tenant_id=$2 for no key update",
      [scope.workspaceId, scope.tenantId],
    );
    await SubscriptionVouchers.context(client, scope);
    const candidate = await SubscriptionVouchers.read(client, scope, voucherId);
    const domain = new SubscriptionRedemption(pool);
    const plan = await domain.plan(
      client,
      candidate.terms.plan_version_id,
      true,
    );
    await domain.assertEmpty(
      client,
      scope.workspaceId,
      plan.primary.product_id,
    );
    const voucher = await SubscriptionVouchers.read(
      client,
      scope,
      voucherId,
      true,
    );
    const start = (
      await client.query<{ now: Date }>("select clock_timestamp() now")
    ).rows[0]!.now;
    const sub = await domain.create(
      client,
      scope,
      plan,
      voucher.terms.duration_days,
      start,
    );
    const operationId = randomUUID(),
      redemptionNo = `RV-${randomUUID().replaceAll("-", "").toUpperCase()}`;
    const result: SubscriptionVoucherResult = {
      voucherId,
      code: voucher.code,
      subscriptionId: sub.id,
      redemptionNo,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      productName: plan.primary.product_name,
      planName: plan.planName,
      versionNo: plan.versionNo,
      startAt: start.toISOString(),
      endAt: sub.endAt!.toISOString(),
      durationDays: voucher.terms.duration_days,
    };
    await client.query(
      `insert into promotion.voucher_operations(id,actor_realm,actor_id,operation_type,idempotency_key,request_hash,batch_id,result) values($1,'customer',$2,'subscription_redemption',$3,$4,$5,$6::jsonb)`,
      [
        operationId,
        scope.userId,
        key,
        hash,
        voucher.batch_id,
        JSON.stringify(result),
      ],
    );
    await SubscriptionVouchers.consume(
      client,
      scope,
      voucher,
      operationId,
      sub.id,
      {
        ...voucher.effect,
        resolved_grants: plan.grants,
        start_at: result.startAt,
        end_at: result.endAt,
        auto_renew: false,
      },
      redemptionNo,
    );
    const queue = new PgProvisioningRepository(pool);
    for (const component of plan.grants) {
      await queue.enqueue(
        {
          workspaceId: scope.workspaceId,
          tenantId: scope.tenantId,
          applicationId: component.product_id,
          appCode: component.product_code,
          event: "tenant.provisioned",
          plan: plan.planCode,
        },
        client,
      );
      await queue.enqueueEvent(
        {
          workspaceId: scope.workspaceId,
          tenantId: scope.tenantId,
          applicationId: component.product_id,
          appCode: component.product_code,
          event: "subscription_changed",
          idempotencyKey: `redeem:${sub.id}:${component.product_id}`,
          data: { products: [component.product_code], subscription_id: sub.id },
        },
        client,
      );
    }
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
