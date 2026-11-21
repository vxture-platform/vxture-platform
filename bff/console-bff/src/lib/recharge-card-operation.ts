/**
 * recharge-card-operation.ts - Atomic source conversion, wallet posting and receipt.
 * @package @vxture/bff-console
 * @layer Application
 * @category orchestration
 * @author AI-Generated
 * @date 2026-11-19
 */
import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Pool } from "pg";
// ⚠️ 跨层引用: Coordinate supported card and wallet domains in one transaction.
import {
  RechargeCards,
  SubscriptionVouchers,
  type VoucherScope,
} from "@vxture/service-promotion";
// ⚠️ 跨层引用: Billing exclusively owns money and its source allocations.
import { PgWalletLedger, type WalletResult } from "@vxture/service-billing";

export interface RechargeCommand {
  voucherId: string;
  confirmation: string;
  idempotencyKey: string;
}
export interface RechargeResult {
  voucherId: string;
  tenantId: string;
  workspaceId: string;
  code: string;
  redemptionNo: string;
  principal: string;
  bonus: string;
  bonusExpiresAt: string | null;
  balance: string;
  currency: string;
  transactions: string[];
}
function key(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value))
    throw new BadRequestException("充值请求标识非法");
  return value;
}
function money(cents: number) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

// ===========================================================================
// Preview has no writes; confirmation binds exact terms and destination.
// ===========================================================================
/** Preview principal and gift separately. @param pool - Customer pool. @param scope - Verified destination. @param voucherId - Selected owned card. @returns Confirmable immutable effects. @throws {ConflictException} For unverified legacy wallets. */
export async function previewRechargeCard(
  pool: Pool,
  scope: VoucherScope,
  voucherId: string,
) {
  const context = await SubscriptionVouchers.context(pool, scope);
  const card = await RechargeCards.read(pool, scope, voucherId);
  const wallet = await new PgWalletLedger(pool).summary(scope.tenantId);
  if (
    (!["absent", "ready"].includes(wallet.status) &&
      !(wallet.status === "unverified" && wallet.balance === "0.00")) ||
    wallet.currency !== "CNY"
  )
    throw new ConflictException("钱包币种或历史来源待核对，暂不可兑换充值卡");
  return {
    code: card.code,
    confirmation: card.confirmation,
    tenantName: context.tenant_name,
    workspaceName: context.workspace_name,
    principal: money(card.terms.face_value_cents),
    bonus: money(card.terms.bonus_cents),
    bonusExpiresInDays: card.terms.bonus_expires_in_days ?? null,
    currency: "CNY",
    balance: wallet.balance,
  };
}

/** Recover a scoped committed result after response loss. @param pool - Customer pool. @param scope - Current session. @param requestKey - Original request identity. @returns Original result or null. */
export async function rechargeCardResult(
  pool: Pool,
  scope: VoucherScope,
  requestKey: string,
): Promise<RechargeResult | null> {
  const request = key(requestKey);
  await SubscriptionVouchers.context(pool, scope);
  return (
    (
      await pool.query<{ result: RechargeResult }>(
        `select result from promotion.voucher_operations where actor_realm='customer' and actor_id=$1 and operation_type='recharge_card' and idempotency_key=$2 and result->>'tenantId'=$3 and result->>'workspaceId'=$4`,
        [scope.userId, request, scope.tenantId, scope.workspaceId],
      )
    ).rows[0]?.result ?? null
  );
}

// ===========================================================================
// Request -> source invoice/payment -> wallet -> batch -> voucher.
// ===========================================================================
/** Convert one card's sources into wallet lots exactly once. @param pool - Caller application pool. @param scope - Verified recipient. @param command - Explicit terms confirmation and stable request key. @returns Durable result, including on an identical retry. @throws {ConflictException} For changed confirmation, ownership or consumed cards. */
export async function redeemRechargeCard(
  pool: Pool,
  scope: VoucherScope,
  command: RechargeCommand,
): Promise<RechargeResult> {
  if (
    !command ||
    Object.keys(command).some(
      (k) => !["voucherId", "confirmation", "idempotencyKey"].includes(k),
    ) ||
    !/^[a-f0-9]{64}$/.test(command.confirmation)
  )
    throw new BadRequestException("充值卡请求仅接受卡券、预览确认和请求标识");
  const request = key(command.idempotencyKey);
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        ...scope,
        voucherId: command.voucherId,
        confirmation: command.confirmation,
      }),
    )
    .digest("hex");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `voucher:recharge:${scope.userId}:${request}`,
    ]);
    await SubscriptionVouchers.context(client, scope);
    const prior = (
      await client.query<{ request_hash: string; result: RechargeResult }>(
        "select request_hash,result from promotion.voucher_operations where actor_realm='customer' and actor_id=$1 and operation_type='recharge_card' and idempotency_key=$2",
        [scope.userId, request],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash)
        throw new ConflictException("同一充值请求的参数或上下文已改变");
      await client.query("commit");
      return prior.result;
    }
    const initial = await RechargeCards.read(client, scope, command.voucherId);
    for (const action of ["bonus", "principal"])
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [`wallet:${scope.tenantId}:card:${initial.id}:${action}`],
      );
    const wallet = new PgWalletLedger(pool),
      context = {
        tenantId: scope.tenantId,
        actorId: scope.userId,
        actorType: "customer" as const,
        currency: "CNY",
      };
    if (initial.payment_id && initial.allocation_id)
      await wallet.lockFundingInTransaction(
        client,
        context,
        initial.payment_id,
        initial.terms.face_value_cents,
        initial.allocation_id,
      );
    await wallet.lockAccountInTransaction(client, context);
    const card = await RechargeCards.read(client, scope, initial.id, true);
    if (card.confirmation !== command.confirmation)
      throw new ConflictException("充值卡效果或目标已改变，请重新预览");
    const now = (
      await client.query<{ now: Date }>("select clock_timestamp() now")
    ).rows[0]!.now;
    const bonusExpiresAt = card.terms.bonus_expires_in_days
      ? new Date(
          now.getTime() + card.terms.bonus_expires_in_days * 86400000,
        ).toISOString()
      : null;
    const postings: WalletResult[] = [];
    if (card.terms.face_value_cents && card.payment_id && card.allocation_id)
      postings.push(
        await wallet.postInTransaction(client, context, {
          action: "principal",
          amountCents: card.terms.face_value_cents,
          paymentId: card.payment_id,
          cardAllocationId: card.allocation_id,
          idempotencyKey: `card:${card.id}:principal`,
        }),
      );
    if (card.terms.bonus_cents)
      postings.push(
        await wallet.postInTransaction(client, context, {
          action: "bonus",
          amountCents: card.terms.bonus_cents,
          ...(bonusExpiresAt ? { expiresAt: bonusExpiresAt } : {}),
          idempotencyKey: `card:${card.id}:bonus`,
        }),
      );
    const transactionNos = (
      await client.query<{ transaction_no: string }>(
        "select transaction_no from billing.transactions where id=any($1::uuid[]) order by transaction_no",
        [postings.map((p) => p.transactionId)],
      )
    ).rows.map((p) => p.transaction_no);
    const operation = randomUUID(),
      redemptionNo = `RC-${randomUUID().replaceAll("-", "").toUpperCase()}`;
    const result: RechargeResult = {
      voucherId: card.id,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      code: card.code,
      redemptionNo,
      principal: money(card.terms.face_value_cents),
      bonus: money(card.terms.bonus_cents),
      bonusExpiresAt,
      balance: postings.at(-1)!.balance,
      currency: "CNY",
      transactions: transactionNos,
    };
    await client.query(
      `insert into promotion.voucher_operations(id,actor_realm,actor_id,operation_type,idempotency_key,request_hash,batch_id,result) values($1,'customer',$2,'recharge_card',$3,$4,$5,$6::jsonb)`,
      [
        operation,
        scope.userId,
        request,
        hash,
        card.batch_id,
        JSON.stringify(result),
      ],
    );
    await RechargeCards.consume(
      client,
      scope,
      card,
      operation,
      redemptionNo,
      postings[0]!.transactionId,
      {
        ...card.effect,
        principal_operation_id:
          postings.find((p) => p.action === "principal")?.operationId ?? null,
        bonus_operation_id:
          postings.find((p) => p.action === "bonus")?.operationId ?? null,
        bonus_expires_at: bonusExpiresAt,
      },
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
