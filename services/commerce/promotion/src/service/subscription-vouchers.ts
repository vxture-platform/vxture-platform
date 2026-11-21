/**
 * subscription-vouchers.ts - Scoped subscription vouchers and atomic effect evidence.
 * @package @vxture/service-promotion
 * @layer Domain
 * @category service
 * @author AI-Generated
 * @date 2026-11-19
 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { VoucherScope } from "../types/promotion.types";
import {
  identity,
  parseRedemptionEffect,
  parseExtensionEffect,
} from "../management/batch-input";
import { assertVoucherClaimScope } from "../management/pg-voucher-claims";

// ===========================================================================
// Read and write share ownership, time and effect validation.
// ===========================================================================
export class SubscriptionVouchers {
  /** Validate current membership. @param client - Caller connection. @param scope - Verified session. @returns Context display names. @throws {ForbiddenException} For inaccessible contexts. */
  static context(client: Pick<PoolClient, "query">, scope: VoucherScope) {
    return assertVoucherClaimScope(client, scope);
  }

  /** Read an eligible voucher. @param client - Caller transaction. @param scope - Current actor and destination. @param voucherId - Selected owned instance. @param lock - Acquire batch then voucher after the destination slot. @returns Validated immutable terms. @throws {BadRequestException} For ineligible vouchers. */
  static async read(
    client: Pick<PoolClient, "query">,
    scope: VoucherScope,
    voucherId: string,
    lock = false,
  ) {
    const row = await this.readInstance(
      client,
      scope,
      voucherId,
      lock,
      "redemption",
    );
    return { ...row, terms: parseRedemptionEffect(row.effect) };
  }

  /** Read a scoped extension voucher. @param client - Caller connection. @param scope - Verified session. @param voucherId - Selected voucher. @param lock - Lock after the target subscription. @returns Approved days and product scope. @throws {BadRequestException} For unavailable effects or ownership. */
  static async readExtension(
    client: Pick<PoolClient, "query">,
    scope: VoucherScope,
    voucherId: string,
    lock = false,
  ) {
    const row = await this.readInstance(
      client,
      scope,
      voucherId,
      lock,
      "extension",
    );
    return { ...row, terms: parseExtensionEffect(row.effect) };
  }

  private static async readInstance(
    client: Pick<PoolClient, "query">,
    scope: VoucherScope,
    voucherId: string,
    lock: boolean,
    kind: "redemption" | "extension",
  ) {
    const id = identity(voucherId, "voucherId");
    if (lock) {
      // Never lock a voucher before its batch or the destination acquisition slot.
      await client.query(
        "select b.id from promotion.voucher_batches b join promotion.vouchers v on v.batch_id=b.id where v.id=$1 for update of b",
        [id],
      );
    }
    const r = await client.query<{
      id: string;
      batch_id: string;
      code: string;
      effect: Record<string, unknown>;
    }>(
      `select v.id,v.batch_id,v.code,b.effect from promotion.vouchers v join promotion.voucher_batches b on b.id=v.batch_id
       where v.id=$1 and b.kind=$5 and b.status='active' and v.status='assigned' and v.max_uses=1 and v.used_count=0
         and v.funding_order_id is null and v.funding_payment_id is null
         and b.valid_from<=clock_timestamp() and b.valid_until>clock_timestamp() and (v.expires_at is null or v.expires_at>clock_timestamp())
         and (b.tenant_id is null or b.tenant_id=$2)
         and (v.assigned_tenant_id=$2 or (v.assigned_tenant_id is null and (b.tenant_id=$2 or v.assigned_workspace_id=$4)))
         and (v.assigned_user_id is null or v.assigned_user_id=$3) and (v.assigned_workspace_id is null or v.assigned_workspace_id=$4)
         and (v.claim_key_version is null or v.claimed_at is not null)
       ${lock ? "for update of v" : ""}`,
      [id, scope.tenantId, scope.userId, scope.workspaceId, kind],
    );
    const row = r.rows[0];
    if (!row) throw new BadRequestException("卡券不可用，请刷新卡券列表后重试");
    return row;
  }

  /** Persist the committed economic effect. @param client - Same subscription transaction. @param scope - Verified recipient. @param voucher - Locked eligible instance. @param operationId - Inserted durable receipt. @param subscriptionId - Real created subscription. @param snapshot - Resolved immutable grants and term. @returns The visible redemption number. @throws {ConflictException} If another operation consumed the instance. */
  static async consume(
    client: PoolClient,
    scope: VoucherScope,
    voucher: { id: string; batch_id: string },
    operationId: string,
    subscriptionId: string,
    snapshot: object,
    redemptionNo: string,
    kind: "redemption" | "extension" = "redemption",
  ) {
    const changed = await client.query(
      "update promotion.vouchers set status='redeemed',used_count=used_count+1,redeemed_at=clock_timestamp(),assigned_tenant_id=$2 where id=$1 and status='assigned' and used_count=0 and max_uses=1",
      [voucher.id, scope.tenantId],
    );
    if (changed.rowCount !== 1)
      throw new ConflictException("兑换券已被使用，请刷新");
    const result = await client.query<{ id: string }>(
      `insert into promotion.voucher_redemptions(redemption_no,voucher_id,tenant_id,workspace_id,user_id,kind,effect_snapshot,subscription_id,operation_id)
       values($1,$2,$3,$4,$5,$9,$6::jsonb,$7,$8) returning id`,
      [
        redemptionNo,
        voucher.id,
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        JSON.stringify(snapshot),
        subscriptionId,
        operationId,
        kind,
      ],
    );
    await client.query(
      `insert into promotion.voucher_events(operation_id,batch_id,voucher_id,redemption_id,event_type,actor_realm,actor_id,reason,metadata)
       values($1,$2,$3,$4,'redeemed','customer',$5,$7,$6::jsonb)`,
      [
        operationId,
        voucher.batch_id,
        voucher.id,
        result.rows[0]!.id,
        scope.userId,
        JSON.stringify({ subscriptionId, kind }),
        kind === "extension" ? "客户确认订阅展期" : "客户确认兑换订阅",
      ],
    );
    return redemptionNo;
  }
}
