/**
 * recharge-cards.ts - Owned single-use cards and committed wallet evidence.
 * @package @vxture/service-promotion
 * @layer Domain
 * @category service
 * @author AI-Generated
 * @date 2026-11-19
 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { VoucherScope } from "../types/promotion.types";
import { identity, parseRechargeEffect } from "../management/batch-input";

// ===========================================================================
// Sources are selected during reviewed issuance, never during customer redeem.
// ===========================================================================
export class RechargeCards {
  /** Read terms after any requested locks have been acquired. @param client - Caller connection. @param scope - Verified customer destination. @param voucherId - Owned card. @param lock - Acquire batch then card after cash and wallet. @returns Frozen terms and funding identity. @throws {BadRequestException} For unavailable ownership, terms or sources. */
  static async read(
    client: Pick<PoolClient, "query">,
    scope: VoucherScope,
    voucherId: string,
    lock = false,
  ) {
    const id = identity(voucherId, "voucherId");
    if (lock) {
      await client.query(
        "select b.id from promotion.voucher_batches b join promotion.vouchers v on v.batch_id=b.id where v.id=$1 for update of b",
        [id],
      );
      await client.query(
        "select id from promotion.vouchers where id=$1 for update",
        [id],
      );
    }
    const row = (
      await client.query<{
        id: string;
        batch_id: string;
        code: string;
        effect: Record<string, unknown>;
        payment_id: string | null;
        allocation_id: string | null;
        amount: string | null;
      }>(
        `select v.id,v.batch_id,v.code,b.effect,v.funding_payment_id payment_id,a.id allocation_id,a.amount::text
       from promotion.vouchers v join promotion.voucher_batches b on b.id=v.batch_id
       left join billing.wallet_card_allocations a on a.voucher_id=v.id and a.status='reserved' and a.payment_id=v.funding_payment_id
       where v.id=$1 and b.kind='recharge_card' and b.status='active' and v.status='assigned' and v.max_uses=1 and v.used_count=0
       and v.funding_order_id is null and b.valid_from<=clock_timestamp() and b.valid_until>clock_timestamp()
       and (v.expires_at is null or v.expires_at>clock_timestamp()) and (b.tenant_id is null or b.tenant_id=$2)
       and v.assigned_tenant_id=$2 and (v.assigned_user_id is null or v.assigned_user_id=$3)
       and (v.assigned_workspace_id is null or v.assigned_workspace_id=$4) and (v.claim_key_version is null or v.claimed_at is not null)`,
        [id, scope.tenantId, scope.userId, scope.workspaceId],
      )
    ).rows[0];
    if (!row) throw new BadRequestException("充值卡不可用，请刷新卡券列表");
    const terms = parseRechargeEffect(row.effect);
    if (
      terms.face_value_cents > 0
        ? !row.payment_id ||
          !row.allocation_id ||
          Number(row.amount?.replace(".", "")) !== terms.face_value_cents
        : row.payment_id || row.allocation_id
    )
      throw new BadRequestException("充值卡资金来源尚未核实");
    const confirmation = createHash("sha256")
      .update(
        JSON.stringify({ ...scope, id, terms, paymentId: row.payment_id }),
      )
      .digest("hex");
    return { ...row, terms, confirmation };
  }

  /** Consume a card only after both wallet postings succeed. @param client - Same transaction as all wallet effects. @param scope - Verified customer. @param voucher - Locked eligible card. @param operationId - Durable receipt. @param redemptionNo - Human-readable result. @param transactionId - Actual wallet transaction. @param snapshot - Principal/bonus operations and immutable terms. @returns No value. @throws {ConflictException} For competing consumption. */
  static async consume(
    client: PoolClient,
    scope: VoucherScope,
    voucher: { id: string; batch_id: string },
    operationId: string,
    redemptionNo: string,
    transactionId: string,
    snapshot: Record<string, unknown> & {
      principal_operation_id: string | null;
      bonus_operation_id: string | null;
    },
  ) {
    const updated = await client.query(
      "update promotion.vouchers set status='redeemed',used_count=1,redeemed_at=clock_timestamp() where id=$1 and status='assigned' and used_count=0 and max_uses=1",
      [voucher.id],
    );
    if (updated.rowCount !== 1) throw new ConflictException("充值卡已被使用");
    const redemption = (
      await client.query<{ id: string }>(
        `insert into promotion.voucher_redemptions(redemption_no,voucher_id,tenant_id,workspace_id,user_id,kind,effect_snapshot,transaction_id,operation_id,principal_wallet_operation_id,bonus_wallet_operation_id)
       values($1,$2,$3,$4,$5,'recharge_card',$6::jsonb,$7,$8,$9,$10) returning id`,
        [
          redemptionNo,
          voucher.id,
          scope.tenantId,
          scope.workspaceId,
          scope.userId,
          JSON.stringify(snapshot),
          transactionId,
          operationId,
          snapshot.principal_operation_id,
          snapshot.bonus_operation_id,
        ],
      )
    ).rows[0]!;
    await client.query(
      `insert into promotion.voucher_events(operation_id,batch_id,voucher_id,redemption_id,event_type,actor_realm,actor_id,reason,metadata)
      values($1,$2,$3,$4,'redeemed','customer',$5,'客户确认充值卡入账',$6::jsonb)`,
      [
        operationId,
        voucher.batch_id,
        voucher.id,
        redemption.id,
        scope.userId,
        JSON.stringify(snapshot),
      ],
    );
  }
}
