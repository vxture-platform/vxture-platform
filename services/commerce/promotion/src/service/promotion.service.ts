import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import type { PoolClient } from "pg";
import { PgPromotionRepository } from "../repository/pg-promotion.repository";
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
        voucherId: step.id,
        kind: step.kind,
        effect,
        effectSnapshot: row.effect,
      });
    }
    return reserved;
  }

  /**
   * Finalize reserved vouchers at settlement completion (full-amount confirm
   * stage 1 / cashDue=0 declare). Idempotent per voucher — an existing
   * redemption short-circuits, safe under confirm re-drive (§7 rule 4).
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
   * operated on — never an order-wide aggregate scan, P10). status='reserved'
   * guard means a stale credential can never free a voucher another order has
   * since reserved, and a finalized voucher is never rolled back (P8b guard —
   * the caller must refuse the whole release orchestration when a redemption
   * exists for this order).
   */
  async releaseReserved(
    client: PoolClient,
    credential: ReleaseCredential,
  ): Promise<string[]> {
    const released: string[] = [];
    const plan = [credential.discountVoucherId, credential.creditVoucherId];
    for (const voucherId of plan) {
      if (!voucherId) continue;
      const done = await this.repo.release(client, voucherId);
      if (done) {
        released.push(voucherId);
      } else {
        this.logger.warn(
          `voucher ${voucherId} not in reserved state — release skipped (stale credential or already finalized)`,
        );
      }
    }
    return released;
  }
}
