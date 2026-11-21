/**
 * refund-compensations.ts - Durable noncash refund compensation and recovery.
 * @package @vxture/service-promotion
 * @layer Domain
 * @category repository
 * @author AI-Generated
 * @date 2026-11-19
 */
import { createHash, randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";

const SYSTEM = "00000000-0000-0000-0000-000000000000";
const logger = new Logger("RefundCompensationRecovery");
export interface CompensationEvidence {
  targets: Array<{ id: string; source: string; targetCents: number }>;
  cashTargetCents: number;
  refundedCashCents: number;
  /** Actual value restored to the proven original wallet debit in this transaction. */
  refundedWalletCents?: number;
}
interface CompensationRow {
  id: string;
  redemption_id: string;
  order_id: string;
  refund_id: string | null;
  amount_cents: string;
  policy_snapshot: Record<string, unknown>;
  status: string;
}
interface SourceRow {
  id: string;
  voucher_id: string;
  kind: string;
  payment_id: string | null;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  policy_snapshot: Record<string, unknown> | null;
}

// ===========================================================================
// Only the financial transaction may approve immutable compensation value.
// ===========================================================================
/**
 * Persist compensation intentions without acquiring a batch write lock.
 * @param client - Financial transaction already holding the order lock.
 * @param orderId - Order whose effects will be completely reversed.
 * @param refundId - Successful cash refund, absent for a noncash reversal.
 * @param evidence - Frozen source targets and actual completed cash refund.
 * @returns Number of newly persisted intentions.
 */
export async function queueRefundCompensations(
  client: PoolClient,
  orderId: string,
  refundId: string | null,
  evidence: CompensationEvidence,
): Promise<number> {
  const rows = (
    await client.query<SourceRow>(
      `select d.id,d.voucher_id,d.kind,d.payment_id,d.tenant_id,d.workspace_id,d.user_id,r.policy_snapshot
    from promotion.voucher_redemptions d left join promotion.voucher_reservations r on r.id=d.reservation_id
    where d.order_id=$1 order by d.voucher_id`,
      [orderId],
    )
  ).rows;
  let count = 0;
  for (const row of rows) {
    const policy = row.policy_snapshot;
    // Missing historical policy is never upgraded to an automatic return promise.
    if (!policy || policy["return_policy"] !== "full_reversal_only") continue;
    const calculation = policy["calculation"] as
      | Record<string, unknown>
      | undefined;
    const amount =
      row.kind === "credit_voucher"
        ? evidence.targets.find(
            (t) => t.id === row.payment_id && t.source === "voucher",
          )?.targetCents
        : row.kind === "discount"
          ? calculation?.["discountOffCents"]
          : undefined;
    const valid =
      Number.isSafeInteger(amount) &&
      Number(amount) >= 0 &&
      typeof policy["effectiveExpiresAt"] === "string" &&
      Number.isFinite(Date.parse(policy["effectiveExpiresAt"]));
    const walletTargets = evidence.targets.filter(
      (target) => target.source === "balance",
    );
    const walletTargetCents = walletTargets.reduce(
      (sum, target) => sum + target.targetCents,
      0,
    );
    const walletComplete =
      walletTargets.length === 0 ||
      (walletTargets.every(
        (target) =>
          Number.isSafeInteger(target.targetCents) && target.targetCents >= 0,
      ) &&
        Number.isSafeInteger(walletTargetCents) &&
        Number.isSafeInteger(evidence.refundedWalletCents) &&
        evidence.refundedWalletCents! >= walletTargetCents);
    const approved =
      valid &&
      evidence.refundedCashCents >= evidence.cashTargetCents &&
      walletComplete;
    const inserted = await client.query(
      `insert into promotion.voucher_compensations(redemption_id,order_id,refund_id,compensation_type,amount_cents,policy_snapshot,status,reason)
      values ($1,$2,$3,'refund_replacement',$4,$5::jsonb,$6,$7) on conflict (redemption_id,compensation_type) do nothing`,
      [
        row.id,
        orderId,
        refundId,
        valid ? Number(amount) : 0,
        JSON.stringify({
          ...policy,
          sourceAllocation: evidence,
          kind: row.kind,
          tenantId: row.tenant_id,
          workspaceId: row.workspace_id,
          userId: row.user_id,
          voucherId: row.voucher_id,
        }),
        approved ? "pending" : "manual_required",
        approved
          ? "awaiting_effect_reversal"
          : !walletComplete
            ? "unproven_value_or_incomplete_wallet_return"
            : "unproven_value_or_incomplete_cash_return",
      ],
    );
    count += inserted.rowCount ?? 0;
  }
  return count;
}

// ===========================================================================
// Recovery owns a separate transaction: compensation batch -> order -> voucher
// -> compensation. It never holds a money transaction while issuing vouchers.
// ===========================================================================
/**
 * Recover one approved intention without repeating any cash movement.
 * @param pool - Runtime pool used for an independent issuance transaction.
 * @param id - Durable compensation ID.
 * @returns Whether the pending intention reached a terminal result.
 * @throws {Error} When storage fails; the whole issuance transaction rolls back.
 */
export async function completeRefundCompensation(
  pool: Pool,
  id: string,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const initial = (
      await client.query<CompensationRow>(
        "select * from promotion.voucher_compensations where id=$1",
        [id],
      )
    ).rows[0];
    if (!initial || initial.status !== "pending") {
      await client.query("commit");
      return false;
    }
    const policy = initial.policy_snapshot;
    const amount = Number(initial.amount_cents);
    const expiresAt = new Date(String(policy["effectiveExpiresAt"]));
    const valid =
      Number.isSafeInteger(amount) &&
      amount >= 0 &&
      Number.isFinite(expiresAt.getTime()) &&
      ["discount", "credit_voucher"].includes(String(policy["kind"]));
    const valuable = valid && amount > 0 && expiresAt.getTime() > Date.now();
    const effect =
      policy["kind"] === "discount"
        ? {
            effect_version: 1,
            currency: "CNY",
            discount_type: "fixed",
            value: amount,
          }
        : { effect_version: 1, currency: "CNY", amount_cents: amount };
    // One dedicated batch per intention makes budget, expiry and preparation idempotent.
    if (valuable) {
      const prepared = await client.query(
        `insert into promotion.voucher_batches(id,tenant_id,kind,name,effect,total_count,valid_from,valid_until,policy_snapshot,frozen_at)
        values ($1,$2,$3,'退款券补偿',$4::jsonb,1,now(),$5,$6::jsonb,now()) on conflict (id) do nothing`,
        [
          id,
          policy["tenantId"],
          policy["kind"],
          JSON.stringify(effect),
          expiresAt,
          JSON.stringify({
            return_policy: "none",
            compensation_batch: true,
            sourceCompensationId: id,
          }),
        ],
      );
      if (prepared.rowCount === 1) {
        const preparationId = randomUUID();
        await client.query(
          `insert into promotion.voucher_operations(id,actor_realm,actor_id,operation_type,idempotency_key,request_hash,batch_id,result)
          values ($1,'system',$2,'refund_compensation_batch',$3::text,$4,$3::uuid,$5::jsonb)`,
          [
            preparationId,
            SYSTEM,
            id,
            createHash("sha256")
              .update(JSON.stringify({ effect, expiresAt }))
              .digest("hex"),
            JSON.stringify({
              compensationId: id,
              batchId: id,
              amountCents: amount,
            }),
          ],
        );
        await client.query(
          `insert into promotion.voucher_events(operation_id,batch_id,redemption_id,order_id,event_type,actor_realm,actor_id,reason)
          values ($1,$2,$3,$4,'compensation_batch_prepared','system',$5,'approved_refund_value')`,
          [preparationId, id, initial.redemption_id, initial.order_id, SYSTEM],
        );
      }
      await client.query(
        "select id from promotion.voucher_batches where id=$1 for update",
        [id],
      );
    }
    const order = (
      await client.query<{
        status: string;
        subscription_id: string | null;
        tenant_id: string;
        workspace_id: string;
      }>(
        "select status,subscription_id,tenant_id,workspace_id from billing.orders where id=$1 for update",
        [initial.order_id],
      )
    ).rows[0];
    const original = (
      await client.query<{ status: string }>(
        "select status from promotion.vouchers where id=$1 for update",
        [policy["voucherId"]],
      )
    ).rows[0];
    const current = (
      await client.query<CompensationRow>(
        "select * from promotion.voucher_compensations where id=$1 for update",
        [id],
      )
    ).rows[0];
    if (!current || current.status !== "pending") {
      await client.query("commit");
      return false;
    }
    const finish = async (
      status: string,
      reason: string,
      replacement: string | null = null,
    ) =>
      client.query(
        "update promotion.voucher_compensations set status=$2,reason=$3,replacement_voucher_id=$4,updated_at=now() where id=$1",
        [id, status, reason, replacement],
      );
    if (
      !valid ||
      original?.status !== "redeemed" ||
      !order ||
      order.tenant_id !== policy["tenantId"] ||
      order.workspace_id !== policy["workspaceId"]
    ) {
      await finish("manual_required", "invalid_source_evidence");
    } else if (order.status !== "refunded") {
      await finish("manual_required", "order_not_reversed");
    } else {
      let effectReversed = true;
      if (order.subscription_id) {
        const sub = (
          await client.query<{
            status: string;
            current_order_id: string | null;
          }>(
            "select status,current_order_id from metering.subscriptions where id=$1 for update",
            [order.subscription_id],
          )
        ).rows[0];
        if (!sub || sub.current_order_id !== initial.order_id) {
          await finish("manual_required", "subsequent_subscription_change");
          await client.query("commit");
          return true;
        }
        effectReversed = ["cancelled", "expired"].includes(sub.status);
      }
      if (!effectReversed) {
        await finish("pending", "awaiting_effect_reversal");
        await client.query("commit");
        return false;
      }
      if (
        initial.refund_id &&
        !(
          await client.query(
            "select id from billing.refunds where id=$1 and order_id=$2 and refund_status='success'",
            [initial.refund_id, initial.order_id],
          )
        ).rows[0]
      ) {
        await finish("manual_required", "cash_refund_not_successful");
      } else if (!valuable || expiresAt.getTime() <= Date.now()) {
        await finish(
          "completed",
          amount === 0 ? "no_remaining_value" : "original_expiry_elapsed",
        );
      } else {
        const matches = (
          await client.query(
            `select id from promotion.voucher_batches where id=$1
          and status='active' and issued_count=0 and total_count=1 and effect=$2::jsonb and valid_until=$3
          and tenant_id=$4 and kind=$5 and policy_snapshot @> $6::jsonb`,
            [
              id,
              JSON.stringify(effect),
              expiresAt,
              policy["tenantId"],
              policy["kind"],
              JSON.stringify({
                compensation_batch: true,
                sourceCompensationId: id,
              }),
            ],
          )
        ).rows[0];
        if (!matches) {
          await finish("manual_required", "compensation_batch_unavailable");
          await client.query("commit");
          return true;
        }
        const replacement = randomUUID(),
          operation = randomUUID();
        const code = `RVC-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
        await client.query(
          `insert into promotion.vouchers(id,batch_id,code,status,assigned_tenant_id,assigned_workspace_id,assigned_user_id,expires_at,replacement_of_redemption_id)
          values ($1,$2,$3,'assigned',$4,$5,$6,$7,$8)`,
          [
            replacement,
            id,
            code,
            policy["tenantId"],
            policy["workspaceId"],
            policy["userId"],
            expiresAt,
            initial.redemption_id,
          ],
        );
        await client.query(
          "update promotion.voucher_batches set issued_count=issued_count+1,updated_at=now() where id=$1",
          [id],
        );
        await client.query(
          `insert into promotion.voucher_operations(id,actor_realm,actor_id,operation_type,idempotency_key,request_hash,batch_id,result)
          values ($1,'system',$2,'refund_replacement',$3,$4,$5,$6::jsonb)`,
          [
            operation,
            SYSTEM,
            id,
            createHash("sha256").update(JSON.stringify(policy)).digest("hex"),
            id,
            JSON.stringify({
              compensationId: id,
              replacementVoucherId: replacement,
            }),
          ],
        );
        await client.query(
          `insert into promotion.voucher_events(operation_id,batch_id,voucher_id,redemption_id,order_id,event_type,actor_realm,actor_id,reason,metadata)
          values ($1,$2,$3,$4,$5,'refund_replacement','system',$6,'full_reversal_only',$7::jsonb)`,
          [
            operation,
            id,
            replacement,
            initial.redemption_id,
            initial.order_id,
            SYSTEM,
            JSON.stringify({ compensationId: id, amountCents: amount }),
          ],
        );
        await finish("completed", "replacement_issued", replacement);
      }
    }
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Resume persisted pending intentions, isolating individual issuance failures.
 * @param pool - Runtime pool.
 * @param limit - Maximum intentions in one sweep.
 * @returns Completed count and failures for job health reporting.
 */
export async function recoverRefundCompensations(
  pool: Pool,
  limit = 100,
): Promise<{ completed: number; failed: number }> {
  const rows = (
    await pool.query<{ id: string }>(
      "select id from promotion.voucher_compensations where status='pending' order by updated_at,id limit $1",
      [limit],
    )
  ).rows;
  let completed = 0,
    failed = 0;
  for (const row of rows)
    try {
      if (await completeRefundCompensation(pool, row.id)) completed++;
    } catch (error) {
      failed++;
      logger.error(
        `Refund compensation ${row.id} failed; intention retained for retry`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  return { completed, failed };
}
