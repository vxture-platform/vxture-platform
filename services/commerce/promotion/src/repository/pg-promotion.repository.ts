import { Inject, Injectable } from "@nestjs/common";
import {
  finalizeSettlementReservation,
  releaseSettlementReservation,
  type ReservationContext,
} from "./settlement-reservations";
import type { Pool, PoolClient } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import { recoverRefundCompensations } from "./refund-compensations";

import type {
  AvailableVoucher,
  FinalizeVoucherInput,
  SettlementVoucherKind,
  TenantVoucherRecord,
  VoucherScope,
} from "../types/promotion.types";
import {
  parseCreditVoucherEffect,
  parseDiscountEffect,
} from "../money/settlement-math";

// P7 availability predicate — ONE predicate, three call sites (list / quote
// resolve / reserve). $1 tenantId, $2 userId, $3 workspaceId. Gate-field
// exclusion: vouchers whose batch effect carries the not-yet-implemented
// applicable_plan_ids / min_user_level thresholds are filtered out rather
// than silently honored (product_321 P7).
const AVAILABILITY_PREDICATE = `
      v.status = 'assigned'
  and v.max_uses = 1 and v.used_count = 0
  and b.kind in ('discount','credit_voucher')
  and (b.tenant_id is null or b.tenant_id = $1)
  and (v.assigned_tenant_id = $1 or (v.assigned_tenant_id is null and (b.tenant_id = $1 or v.assigned_workspace_id = $3)))
  and (b.effect->'effect_version' is null or b.effect->'effect_version' = '1'::jsonb)
  and (b.effect->>'currency' is null or b.effect->>'currency' = 'CNY')
  and exists (select 1 from tenancy.workspaces iw join tenancy.tenants it on it.id=iw.tenant_id
    where iw.id=$3 and iw.tenant_id=$1 and iw.status='active' and iw.deleted_at is null
      and it.status='active' and it.deleted_at is null and (it.owner_user_id=$2 or exists (
        select 1 from tenancy.tenant_memberships im where im.tenant_id=$1 and im.user_id=$2 and im.status='active')))
  and (v.assigned_user_id is null or v.assigned_user_id = $2)
  and (v.assigned_workspace_id is null or v.assigned_workspace_id = $3)
  and (b.tenant_id is not null
       or v.assigned_user_id is not null
       or v.assigned_workspace_id is not null)
  and b.status = 'active'
  and now() >= b.valid_from and now() < b.valid_until
  and (v.expires_at is null or v.expires_at > now())
  and not (b.effect ? 'applicable_plan_ids')
  and not (b.effect ? 'min_user_level')`;

// Shared projection for list/resolve — one edit point for the AvailableRow shape.
const AVAILABLE_SELECT = `
      select v.id, v.code, b.kind, b.name as batch_name, b.effect,
             b.valid_until, v.expires_at
        from promotion.vouchers v
        join promotion.voucher_batches b on b.id = v.batch_id`;

interface AvailableRow {
  id: string;
  code: string;
  kind: SettlementVoucherKind;
  batch_name: string;
  effect: Record<string, unknown>;
  valid_until: Date;
  expires_at: Date | null;
}

const mapAvailableRow = (row: AvailableRow): AvailableVoucher | null => {
  const effect =
    row.kind === "discount"
      ? parseDiscountEffect(row.effect)
      : parseCreditVoucherEffect(row.effect);
  if (!effect) return null; // malformed batch config — never surface as usable
  const expiresAt =
    row.expires_at && row.expires_at < row.valid_until
      ? row.expires_at
      : row.valid_until;
  return {
    voucherId: row.id,
    code: row.code,
    kind: row.kind,
    batchName: row.batch_name,
    effect,
    expiresAt,
  };
};

@Injectable()
export class PgPromotionRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  /**
   * Resume approved noncash compensation after financial commit.
   * @param limit - Maximum persisted intentions in one pass.
   * @returns Completed and failed intention counts.
   */
  async recoverRefundCompensations(
    limit = 100,
  ): Promise<{ completed: number; failed: number }> {
    return recoverRefundCompensations(this.pool, limit);
  }

  /** 「我的卡券」台账(全 kind/全状态;实现见文件尾的查询/派生函数)。 */
  async listTenantVouchers(
    scope: VoucherScope,
    limit = 100,
  ): Promise<TenantVoucherRecord[]> {
    const rows = await listTenantVouchersQuery(this.pool, scope, limit);
    const now = new Date();
    return rows.map((r) => mapTenantVoucherRow(r, now));
  }

  /** Customer-facing voucher list for the payment page (read path, own pool). */
  async listAvailableVouchers(
    scope: VoucherScope,
  ): Promise<AvailableVoucher[]> {
    const result = await this.pool.query<AvailableRow>(
      `${AVAILABLE_SELECT}
        where ${AVAILABILITY_PREDICATE}
        order by coalesce(v.expires_at, b.valid_until) asc, v.created_at asc`,
      [scope.tenantId, scope.userId, scope.workspaceId],
    );
    return result.rows
      .map(mapAvailableRow)
      .filter((v): v is AvailableVoucher => v !== null);
  }

  /** Quote-time resolve: same predicate as reserve, zero side effects. */
  async resolveAvailableVoucher(
    scope: VoucherScope,
    voucherId: string,
    kind: SettlementVoucherKind,
  ): Promise<AvailableVoucher | null> {
    const result = await this.pool.query<AvailableRow>(
      `${AVAILABLE_SELECT}
        where v.id = $4 and b.kind = $5 and ${AVAILABILITY_PREDICATE}`,
      [scope.tenantId, scope.userId, scope.workspaceId, voucherId, kind],
    );
    const row = result.rows[0];
    return row ? mapAvailableRow(row) : null;
  }

  /**
   * Atomic reserve (data_commerce_230 §5.2): single UPDATE guarded by the full
   * availability + ownership predicate; rowCount=1 wins the race, 0 = lost /
   * unavailable. Runs on the caller's transaction client — the caller MUST
   * already hold the ordering order's subscription row lock (§7 rule 1).
   */
  async reserve(
    client: PoolClient,
    scope: VoucherScope,
    voucherId: string,
    kind: SettlementVoucherKind,
  ): Promise<{ effect: Record<string, unknown> } | null> {
    const result = await client.query<{ effect: Record<string, unknown> }>(
      `update promotion.vouchers v
          set status = 'reserved', used_count = v.used_count + 1, assigned_tenant_id = $1
         from promotion.voucher_batches b
        where b.id = v.batch_id and v.id = $4 and b.kind = $5
          and ${AVAILABILITY_PREDICATE}
        returning b.effect`,
      [scope.tenantId, scope.userId, scope.workspaceId, voucherId, kind],
    );
    const row = result.rows[0];
    return result.rowCount === 1 && row ? { effect: row.effect } : null;
  }

  /**
   * Finalize only the exact order/declaration reservation.
   * @param client - Caller-owned settlement transaction.
   * @param input - Reservation ownership and financial destinations.
   * @returns The reservation's redemption and whether it already existed.
   * @throws {ConflictException} When ownership or terminal state conflicts.
   */
  async finalize(
    client: PoolClient,
    input: FinalizeVoucherInput,
  ): Promise<{ redemptionId: string; already: boolean }> {
    return finalizeSettlementReservation(client, input);
  }

  /**
   * Release only the exact order/declaration reservation.
   * @param client - Caller-owned settlement transaction.
   * @param voucherId - Voucher named by the original declaration.
   * @param context - Exact order, invoice and declaration payment.
   * @param reservationId - Durable reservation ID, absent for legacy adoption.
   * @param reason - Auditable release reason.
   * @returns Whether the active reservation changed to released.
   * @throws {ConflictException} When ownership or terminal state conflicts.
   */
  async release(
    client: PoolClient,
    voucherId: string,
    context: ReservationContext,
    reservationId?: string | null,
    reason?: string,
  ): Promise<boolean> {
    return releaseSettlementReservation(
      client,
      context,
      voucherId,
      reservationId,
      reason,
    );
  }
}

// ── 「我的卡券」台账(owner 2026-08-21 P0)────────────────────────────────────
// 归属谓词与 P7 同构(tenant 定向批次 ∨ 定向 user ∨ 定向 workspace,禁无主券),
// 但不套可用性过滤——台账要看已用/已锁/过期/撤销。过期是读侧派生(库里没有
// 置 expired 的清扫),按 min(voucher.expires_at, batch.valid_until) 判。

interface TenantVoucherRow {
  id: string;
  code: string;
  kind: string;
  batch_name: string;
  effect: Record<string, unknown>;
  status: string;
  used_count: number;
  max_uses: number;
  batch_status: string;
  valid_from: Date;
  valid_until: Date;
  expires_at: Date | null;
  redeemed_at: Date | null;
  last_redeemed_at: Date | null;
  redemption_no: string | null;
}

export async function listTenantVouchersQuery(
  pool: Pool,
  scope: VoucherScope,
  limit: number,
): Promise<TenantVoucherRow[]> {
  const result = await pool.query<TenantVoucherRow>(
    `select v.id, v.code, b.kind, b.name as batch_name, b.effect,
            v.status, v.used_count, v.max_uses,
            b.status as batch_status, b.valid_from, b.valid_until,
            v.expires_at, v.redeemed_at,
            r.redeemed_at as last_redeemed_at, r.redemption_no
       from promotion.vouchers v
       join promotion.voucher_batches b on b.id = v.batch_id
       left join lateral (
         select vr.redeemed_at, vr.redemption_no
           from promotion.voucher_redemptions vr
          where vr.voucher_id = v.id
          order by vr.redeemed_at desc
          limit 1
       ) r on true
      where v.status <> 'issued'
        and (v.claim_key_version is null or v.claimed_at is not null)
        and (b.tenant_id is null or b.tenant_id = $1)
        and (v.assigned_tenant_id = $1 or (v.assigned_tenant_id is null
          and (b.tenant_id = $1 or v.assigned_workspace_id = $3)))
        and (v.assigned_user_id is null or v.assigned_user_id = $2)
        and (v.assigned_workspace_id is null or v.assigned_workspace_id = $3)
        and (b.tenant_id is not null
             or v.assigned_user_id is not null
             or v.assigned_workspace_id is not null)
      order by (v.status in ('assigned','reserved')) desc,
               least(coalesce(v.expires_at, b.valid_until), b.valid_until) asc,
               v.created_at desc
      limit $4`,
    [scope.tenantId, scope.userId, scope.workspaceId, limit],
  );
  return result.rows;
}

export function mapTenantVoucherRow(
  r: TenantVoucherRow,
  now: Date,
): TenantVoucherRecord {
  const expiresAt = new Date(
    Math.min(
      r.expires_at ? r.expires_at.getTime() : Number.POSITIVE_INFINITY,
      r.valid_until.getTime(),
    ),
  );
  let displayStatus: TenantVoucherRecord["displayStatus"];
  if (r.status === "revoked") displayStatus = "revoked";
  else if (r.status === "redeemed") displayStatus = "redeemed";
  else if (r.status === "reserved") displayStatus = "reserved";
  else if (
    r.status === "expired" ||
    now.getTime() > expiresAt.getTime() ||
    now.getTime() < r.valid_from.getTime() ||
    r.batch_status !== "active"
  )
    displayStatus = "expired";
  else displayStatus = "available";

  // Keep the legacy projection stable while exposing distinct read-side states.
  let availabilityStatus: TenantVoucherRecord["availabilityStatus"];
  if (
    r.status === "revoked" ||
    r.status === "redeemed" ||
    r.status === "reserved"
  ) {
    availabilityStatus = r.status;
  } else if (r.status === "expired" || now.getTime() >= expiresAt.getTime()) {
    availabilityStatus = "expired";
  } else if (now.getTime() < r.valid_from.getTime()) {
    availabilityStatus = "not_started";
  } else if (r.batch_status === "paused" || r.batch_status === "archived") {
    availabilityStatus = r.batch_status;
  } else if (
    r.status !== "assigned" ||
    r.batch_status !== "active" ||
    r.used_count >= r.max_uses ||
    !["discount", "credit_voucher", "invite"].includes(r.kind)
  ) {
    availabilityStatus = "unavailable";
  } else if (
    (r.kind === "discount" &&
      (!parseDiscountEffect(r.effect) ||
        !Number.isFinite(r.effect["value"]))) ||
    (r.kind === "credit_voucher" && !parseCreditVoucherEffect(r.effect)) ||
    (["discount", "credit_voucher"].includes(r.kind) &&
      ("applicable_plan_ids" in r.effect || "min_user_level" in r.effect))
  ) {
    // Match existing settlement exclusions without changing the write path.
    availabilityStatus = "unavailable";
  } else {
    availabilityStatus = "available";
  }
  return {
    voucherId: r.id,
    code: r.code,
    kind: r.kind as TenantVoucherRecord["kind"],
    batchName: r.batch_name,
    effect: r.effect ?? {},
    status: r.status,
    displayStatus,
    availabilityStatus,
    usedCount: r.used_count,
    maxUses: r.max_uses,
    validFrom: r.valid_from,
    expiresAt,
    redeemedAt: r.last_redeemed_at ?? r.redeemed_at,
    redemptionNo: r.redemption_no,
  };
}
