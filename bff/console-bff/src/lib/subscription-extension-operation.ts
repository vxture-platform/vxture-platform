/**
 * subscription-extension-operation.ts - Atomic extension, receipt and delivery intent.
 * @package @vxture/bff-console
 * @layer Application
 * @category orchestration
 * @author AI-Generated
 * @date 2026-11-19
 */
import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Pool } from "pg";
// ⚠️ 跨层引用: Coordinate public domain interfaces in one local transaction.
import {
  SubscriptionVouchers,
  type VoucherScope,
} from "@vxture/service-promotion";
// ⚠️ 跨层引用: Subscription owns eligibility, time and quota materializations.
import { SubscriptionExtension } from "@vxture/service-subscription";
// ⚠️ 跨层引用: Reuse the durable subscription_changed delivery queue.
import { PgProvisioningRepository } from "@vxture/service-provisioning";

// ===========================================================================
// Customer confirmation binds both the target and its displayed baseline.
// ===========================================================================
export interface ExtensionCommand {
  voucherId: string;
  subscriptionId: string;
  expectedEndAt: string;
  expectedPlanVersionId: string;
  idempotencyKey: string;
}
export interface ExtensionResult {
  voucherId: string;
  subscriptionId: string;
  tenantId: string;
  workspaceId: string;
  code: string;
  redemptionNo: string;
  productName: string;
  planName: string;
  versionNo: number;
  previousEndAt: string;
  endAt: string;
  extendDays: number;
}
function identity(value: unknown, field: string) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException(`${field} 非法`);
  return value.toLowerCase();
}
function requestKey(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value))
    throw new BadRequestException("idempotencyKey 非法");
  return value;
}

/** Preview all eligible subscriptions in the current workspace. @param pool - Customer database pool. @param scope - Verified current session. @param voucherId - Owned voucher. @returns Explicit old/new dates and unchanged plan. @throws {BadRequestException} For unavailable vouchers. */
export async function previewSubscriptionExtension(
  pool: Pool,
  scope: VoucherScope,
  voucherId: string,
) {
  const context = await SubscriptionVouchers.context(pool, scope);
  const voucher = await SubscriptionVouchers.readExtension(
    pool,
    scope,
    voucherId,
  );
  const targets = await SubscriptionExtension.targets(
    pool,
    scope,
    voucher.terms.applicable_product_codes,
  );
  return {
    code: voucher.code,
    tenantName: context.tenant_name,
    workspaceName: context.workspace_name,
    extendDays: voucher.terms.extend_days,
    targets: targets.map((s) => ({
      subscriptionId: s.id,
      planVersionId: s.plan_version_id,
      productName: s.product_name,
      planName: s.plan_name,
      versionNo: s.version_no,
      previousEndAt: s.end_at.toISOString(),
      endAt: new Date(
        s.end_at.getTime() + voucher.terms.extend_days * 86400000,
      ).toISOString(),
    })),
  };
}

/** Recover a committed extension after a lost response. @param pool - Customer pool. @param scope - Verified session destination. @param key - Stable request identity. @returns Scoped original receipt or null. @throws {BadRequestException} For malformed keys. */
export async function subscriptionExtensionResult(
  pool: Pool,
  scope: VoucherScope,
  key: string,
): Promise<ExtensionResult | null> {
  key = requestKey(key);
  await SubscriptionVouchers.context(pool, scope);
  return (
    (
      await pool.query<{ result: ExtensionResult }>(
        `select result from promotion.voucher_operations where actor_realm='customer' and actor_id=$1 and operation_type='subscription_extension' and idempotency_key=$2 and result->>'tenantId'=$3 and result->>'workspaceId'=$4`,
        [scope.userId, key, scope.tenantId, scope.workspaceId],
      )
    ).rows[0]?.result ?? null
  );
}

/** Commit term, evidence and notifications together. @param pool - Application pool. @param scope - Verified actor and destination. @param command - Target and confirmed date/version baseline. @returns Original successful result for an identical retry. @throws {ConflictException} For changed parameters, stale previews or consumed vouchers. */
export async function extendSubscriptionVoucher(
  pool: Pool,
  scope: VoucherScope,
  command: ExtensionCommand,
): Promise<ExtensionResult> {
  const key = requestKey(command?.idempotencyKey);
  const voucherId = identity(command?.voucherId, "voucherId");
  const subscriptionId = identity(command?.subscriptionId, "subscriptionId");
  const expectedPlanVersionId = identity(
    command?.expectedPlanVersionId,
    "expectedPlanVersionId",
  );
  if (
    typeof command?.expectedEndAt !== "string" ||
    !Number.isFinite(Date.parse(command.expectedEndAt))
  )
    throw new BadRequestException("expectedEndAt 非法");
  const expectedEndAt = new Date(command.expectedEndAt).toISOString();
  scope = {
    tenantId: identity(scope.tenantId, "tenantId"),
    workspaceId: identity(scope.workspaceId, "workspaceId"),
    userId: identity(scope.userId, "userId"),
  };
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        ...scope,
        voucherId,
        subscriptionId,
        expectedEndAt,
        expectedPlanVersionId,
      }),
    )
    .digest("hex");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `voucher:extension:${scope.userId}:${key}`,
    ]);
    await SubscriptionVouchers.context(client, scope);
    const prior = (
      await client.query<{ request_hash: string; result: ExtensionResult }>(
        `select request_hash,result from promotion.voucher_operations where actor_realm='customer' and actor_id=$1 and operation_type='subscription_extension' and idempotency_key=$2`,
        [scope.userId, key],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash)
        throw new ConflictException("同一展期请求标识的参数或上下文已改变");
      await client.query("commit");
      return prior.result;
    }
    // Normal purchases take this workspace lock too. Reading open orders under
    // it avoids taking an order lock after the subscription lock.
    await client.query(
      "select id from tenancy.workspaces where id=$1 and tenant_id=$2 for no key update",
      [scope.workspaceId, scope.tenantId],
    );
    await SubscriptionVouchers.context(client, scope);
    await SubscriptionExtension.lock(client, scope, subscriptionId);
    const voucher = await SubscriptionVouchers.readExtension(
      client,
      scope,
      voucherId,
      true,
    );
    const target = await SubscriptionExtension.target(
      client,
      scope,
      subscriptionId,
      voucher.terms.applicable_product_codes,
      { endAt: expectedEndAt, planVersionId: expectedPlanVersionId },
    );
    const operationId = randomUUID(),
      redemptionNo = `EV-${randomUUID().replaceAll("-", "").toUpperCase()}`;
    const end = await SubscriptionExtension.apply(
      client,
      scope,
      target,
      voucher.terms.extend_days,
      redemptionNo,
    );
    const result: ExtensionResult = {
      voucherId,
      subscriptionId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      code: voucher.code,
      redemptionNo,
      productName: target.product_name,
      planName: target.plan_name,
      versionNo: target.version_no,
      previousEndAt: target.end_at.toISOString(),
      endAt: end.toISOString(),
      extendDays: voucher.terms.extend_days,
    };
    await client.query(
      `insert into promotion.voucher_operations(id,actor_realm,actor_id,operation_type,idempotency_key,request_hash,batch_id,result) values($1,'customer',$2,'subscription_extension',$3,$4,$5,$6::jsonb)`,
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
      subscriptionId,
      {
        ...voucher.effect,
        plan_version_id: target.plan_version_id,
        previous_end_at: result.previousEndAt,
        end_at: result.endAt,
        status: target.status,
        quota_reset: false,
      },
      redemptionNo,
      "extension",
    );
    const products = (
      await client.query<{ product_id: string; product_code: string }>(
        `select c.product_id,p.product_code from product.plan_components c join product.products p on p.id=c.product_id where c.plan_version_id=$1 order by c.product_id`,
        [target.plan_version_id],
      )
    ).rows;
    const queue = new PgProvisioningRepository(pool);
    for (const p of products)
      await queue.enqueueEvent(
        {
          workspaceId: scope.workspaceId,
          tenantId: scope.tenantId,
          applicationId: p.product_id,
          appCode: p.product_code,
          event: "subscription_changed",
          idempotencyKey: `extend:${operationId}:${p.product_id}`,
          data: { products: [p.product_code], subscription_id: subscriptionId },
        },
        client,
      );
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
