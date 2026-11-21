import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  recordSettlementReservations,
  releaseSettlementReservation,
  type ReservationContext,
} from "../repository/settlement-reservations";
import { PgPromotionRepository } from "../repository/pg-promotion.repository";
import {
  queueRefundCompensations,
  type CompensationEvidence,
} from "../repository/refund-compensations";
import {
  parseCreditVoucherEffect,
  parseDiscountEffect,
} from "../money/settlement-math";
import type {
  AvailableVoucher,
  TenantVoucherRecord,
  FinalizeVoucherInput,
  ReleaseCredential,
  ReservedVoucher,
  ReserveVouchersInput,
  SettlementVoucherKind,
  VoucherScope,
} from "../types/promotion.types";

/**
 * Voucher settlement engine (product_321 §5.1). Write primitives take the
 * caller's PoolClient and join its transaction — declare / confirm / release
 * orchestration owns the transaction boundary and MUST hold the order's
 * subscription row lock first (§7 rule 1). Voucher order inside a transaction
 * is fixed: discount before credit_voucher (§7 rule 2 — reserve, finalize and
 * release all walk the same order).
 */
@Injectable()
export class PromotionService {
  private readonly logger = new Logger(PromotionService.name);

  // Explicit tokens: bff bundles (esbuild) emit no decorator metadata, so an
  // implicit constructor type silently injects undefined (repo-wide pattern).
  constructor(
    @Inject(PgPromotionRepository)
    private readonly repo: PgPromotionRepository,
  ) {}

  /**
   * Approve noncash replacement intentions inside the financial transaction.
   * @param client - Caller-owned transaction holding the order lock.
   * @param orderId - Order whose effect is being reversed.
   * @param refundId - Successful cash refund, or null for a noncash reversal.
   * @param evidence - Frozen allocation and completed cash value.
   * @returns Number of new durable intentions.
   */
  async queueRefundCompensations(
    client: PoolClient,
    orderId: string,
    refundId: string | null,
    evidence: CompensationEvidence,
  ): Promise<number> {
    return queueRefundCompensations(client, orderId, refundId, evidence);
  }

  /**
   * Recover pending replacement intentions in separate issuance transactions.
   * @param limit - Maximum intentions per pass.
   * @returns Completed and failed counts for the existing job heartbeat.
   */
  async recoverRefundCompensations(
    limit = 100,
  ): Promise<{ completed: number; failed: number }> {
    return this.repo.recoverRefundCompensations(limit);
  }

  /** Payment-page voucher list (P7 predicate, gate-field vouchers filtered). */
  async listAvailableVouchers(
    scope: VoucherScope,
  ): Promise<AvailableVoucher[]> {
    return this.repo.listAvailableVouchers(scope);
  }

  /** 「我的卡券」台账(owner 2026-08-21 P0):全 kind/全状态,展示态读侧派生。 */
  async listTenantVouchers(
    scope: VoucherScope,
  ): Promise<TenantVoucherRecord[]> {
    return this.repo.listTenantVouchers(scope);
  }

  /**
   * Quote-time resolve — same predicate as reserve so a voucher that lists
   * as usable cannot fail at declare for availability reasons (P7: no
   * "selectable in the list, 409 at the last step").
   */
  async resolveForQuote(
    scope: VoucherScope,
    voucherId: string,
    kind: SettlementVoucherKind,
  ): Promise<AvailableVoucher | null> {
    return this.repo.resolveAvailableVoucher(scope, voucherId, kind);
  }

  /**
   * Reserve the selected vouchers inside the declare transaction (P8).
   * Discount first, then credit voucher. A lost race / unavailable voucher
   * aborts the whole declare with 409 — the caller's transaction rolls back
   * every prior step.
   */
  async reserveForOrder(
    client: PoolClient,
    input: ReserveVouchersInput,
  ): Promise<ReservedVoucher[]> {
    const reserved: ReservedVoucher[] = [];
    const plan: Array<{ id: string; kind: SettlementVoucherKind }> = [];
    if (input.discountVoucherId) {
      plan.push({ id: input.discountVoucherId, kind: "discount" });
    }
    if (input.creditVoucherId) {
      plan.push({ id: input.creditVoucherId, kind: "credit_voucher" });
    }

    for (const step of plan) {
      const row = await this.repo.reserve(
        client,
        input.scope,
        step.id,
        step.kind,
      );
      if (!row) {
        throw new ConflictException(
          `券 ${step.id} 不可用或已被占用，请刷新后重试`,
        );
      }
      const effect =
        step.kind === "discount"
          ? parseDiscountEffect(row.effect)
          : parseCreditVoucherEffect(row.effect);
      if (!effect) {
        // Predicate should have filtered malformed configs; a hit here means
        // batch config mutated mid-flight — abort, transaction rolls back.
        throw new ConflictException(`券 ${step.id} 配置异常，无法使用`);
      }
      reserved.push({
        reservationId: randomUUID(),
        voucherId: step.id,
        kind: step.kind,
        effect,
        effectSnapshot: row.effect,
      });
    }
    return reserved;
  }

  /**
   * Persist immutable ownership once the declaration payment ID is known.
   * @param client - Caller-owned settlement transaction.
   * @param context - Exact order, invoice and optional cash declaration.
   * @param scope - Verified customer scope.
   * @param vouchers - Newly reserved vouchers in deterministic lock order.
   * @param calculation - Frozen settlement amounts in integer cents.
   * @returns Resolves after the reservation receipts and events are persisted.
   * @throws {ConflictException} When ownership does not match.
   */
  async recordReservations(
    client: PoolClient,
    context: ReservationContext,
    scope: VoucherScope,
    vouchers: ReservedVoucher[],
    calculation: object = {},
  ): Promise<void> {
    await recordSettlementReservations(
      client,
      context,
      scope,
      vouchers,
      calculation,
    );
  }

  /**
   * Release orphaned reservations after the caller rules out pending payments.
   * @param client - Caller-owned close transaction holding the order lock.
   * @param context - Exact order and invoice being closed.
   * @param reason - Auditable cancellation or expiration reason.
   * @returns Resolves after all matching active reservations are released.
   * @throws {ConflictException} When a reservation cannot be safely released.
   */
  async releaseOrderReservations(
    client: PoolClient,
    context: ReservationContext,
    reason: string,
  ): Promise<void> {
    const result = await client.query<{
      id: string;
      voucher_id: string;
      declaration_payment_id: string | null;
    }>(
      `select r.id,r.voucher_id,r.declaration_payment_id from promotion.voucher_reservations r
        join promotion.vouchers v on v.id=r.voucher_id join promotion.voucher_batches b on b.id=v.batch_id
        where r.order_id=$1 and r.invoice_id=$2 and r.status='active'
        order by case b.kind when 'discount' then 0 else 1 end,v.id`,
      [context.orderId, context.invoiceId],
    );
    for (const row of result.rows)
      await releaseSettlementReservation(
        client,
        { ...context, declarationPaymentId: row.declaration_payment_id },
        row.voucher_id,
        row.id,
        reason,
      );
  }

  /**
   * Finalize reserved vouchers at settlement completion (full-amount confirm
   * stage 1 / cashDue=0 declare). Retries return only the same reservation's
   * redemption; another order's redemption cannot satisfy this request.
   * @param client - Caller-owned settlement transaction.
   * @param inputs - Exact reservation ownership and financial destinations.
   * @returns Redemption IDs for the supplied reservations.
   * @throws {ConflictException} When ownership or terminal state conflicts.
   */
  async finalizeReserved(
    client: PoolClient,
    inputs: FinalizeVoucherInput[],
  ): Promise<Array<{ voucherId: string; redemptionId: string }>> {
    const out: Array<{ voucherId: string; redemptionId: string }> = [];
    for (const input of inputs) {
      const result = await this.repo.finalize(client, input);
      if (result.already) {
        this.logger.log(
          `voucher ${input.voucherId} already redeemed — finalize skipped (idempotent re-drive)`,
        );
      }
      out.push({
        voucherId: input.voucherId,
        redemptionId: result.redemptionId,
      });
    }
    return out;
  }

  /**
   * Release the vouchers named by ONE settlement credential (the leg being
   * operated on, P10). Exact reservation ownership prevents an old credential
   * from freeing a later reservation. Consumed reservations reject release.
   * @param client - Caller-owned rejection transaction.
   * @param credential - Original order, invoice, declaration and reservation IDs.
   * @returns Voucher IDs newly released by this call.
   * @throws {ConflictException} When ownership is missing or conflicts.
   */
  async releaseReserved(
    client: PoolClient,
    credential: ReleaseCredential,
  ): Promise<string[]> {
    const released: string[] = [];
    const plan = [
      [credential.discountVoucherId, credential.discountReservationId],
      [credential.creditVoucherId, credential.creditReservationId],
    ];
    for (const [voucherId, reservationId] of plan) {
      if (!voucherId) continue;
      if (!credential.orderId || !credential.invoiceId) {
        throw new ConflictException("卡券占用凭据缺少订单归属，无法释放");
      }
      const done = await this.repo.release(
        client,
        voucherId,
        {
          orderId: credential.orderId,
          invoiceId: credential.invoiceId,
          ...(credential.actor ? { actor: credential.actor } : {}),
          ...(credential.declarationPaymentId !== undefined
            ? { declarationPaymentId: credential.declarationPaymentId }
            : {}),
        },
        reservationId,
        credential.reason,
      );
      if (done) {
        released.push(voucherId);
      } else {
        this.logger.warn(
          `voucher ${voucherId} reservation already released — replay skipped`,
        );
      }
    }
    return released;
  }
}
