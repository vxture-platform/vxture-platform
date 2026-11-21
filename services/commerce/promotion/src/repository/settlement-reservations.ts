/**
 * settlement-reservations.ts - Durable settlement ownership and terminal CAS.
 * @package @vxture/service-promotion
 * @layer Domain
 * @category repository
 * @author AI-Generated
 * @date 2026-11-19
 */
import { createHash, randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  FinalizeVoucherInput,
  ReservedVoucher,
  SettlementActor,
  VoucherScope,
} from "../types/promotion.types";

// ===========================================================================
// A reservation belongs to one order, invoice and immutable declaration leg.
// ===========================================================================
export interface ReservationContext {
  actor?: SettlementActor;
  orderId: string;
  invoiceId: string;
  declarationPaymentId?: string | null;
}
interface ReservationRow {
  id: string;
  voucher_id: string;
  order_id: string;
  invoice_id: string;
  declaration_payment_id: string | null;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  operation_id: string;
  status: string;
  effect_snapshot: Record<string, unknown>;
}
function conflict(): never {
  throw new ConflictException({
    code: "VOUCHER_RESERVATION_CONFLICT",
    message: "卡券占用凭据不一致，请刷新后重试；历史申报请联系运营核对。",
  });
}

async function lockContext(client: PoolClient, context: ReservationContext) {
  const result = await client.query<{
    tenant_id: string;
    workspace_id: string;
  }>(
    `select o.tenant_id,o.workspace_id from billing.orders o join billing.invoices i on i.order_id=o.id
      where o.id=$1 and i.id=$2 and i.deleted_at is null for update of o,i`,
    [context.orderId, context.invoiceId],
  );
  return result.rows[0] ?? conflict();
}
async function event(
  client: PoolClient,
  row: ReservationRow,
  type: string,
  reason?: string,
  redemptionId?: string,
  actor: SettlementActor = { realm: "customer", id: row.user_id },
) {
  if (!actor.id && actor.realm !== "system") conflict();
  await client.query(
    `insert into promotion.voucher_events
    (operation_id,batch_id,voucher_id,reservation_id,redemption_id,order_id,event_type,actor_realm,actor_id,reason)
    select $1,v.batch_id,v.id,$2,$3,$4,$5,$9,$6,$7 from promotion.vouchers v where v.id=$8`,
    [
      row.operation_id,
      row.id,
      redemptionId ?? null,
      row.order_id,
      type,
      // A nil UUID identifies a system executor without impersonating a customer.
      actor.id ?? "00000000-0000-0000-0000-000000000000",
      reason ?? null,
      row.voucher_id,
      actor.realm,
    ],
  );
}

/**
 * Persist reserved effects after the declaration leg is known, before commit.
 * @param client - Caller-owned order/invoice transaction.
 * @param context - Exact order, invoice and optional cash declaration.
 * @param scope - Verified customer scope.
 * @param vouchers - Newly reserved vouchers, in discount/credit lock order.
 * @param calculation - Frozen settlement calculation in integer cents.
 * @returns Resolves after all receipts, reservations and events are recorded.
 * @throws {ConflictException} When order or declaration ownership does not match.
 */
export async function recordSettlementReservations(
  client: PoolClient,
  context: ReservationContext,
  scope: VoucherScope,
  vouchers: ReservedVoucher[],
  calculation: object = {},
): Promise<void> {
  if (vouchers.length === 0) return;
  const order = await lockContext(client, context);
  if (
    order.tenant_id !== scope.tenantId ||
    order.workspace_id !== scope.workspaceId
  )
    conflict();
  if (context.declarationPaymentId) {
    const payment = await client.query(
      `select id from billing.payments where id=$1 and bill_id=$2
      and tenant_id=$3 and actor_id=$4`,
      [
        context.declarationPaymentId,
        context.invoiceId,
        scope.tenantId,
        scope.userId,
      ],
    );
    if (!payment.rows[0]) conflict();
  }
  const operationId = randomUUID();
  await client.query(
    `insert into promotion.voucher_operations(id,actor_realm,actor_id,operation_type,idempotency_key,request_hash,result)
    values ($1::uuid,'customer',$2,'reserve',$1::text,$3,$4)`,
    [
      operationId,
      scope.userId,
      createHash("sha256")
        .update(JSON.stringify({ ...context, ...scope }))
        .digest("hex"),
      JSON.stringify({ reservationIds: vouchers.map((v) => v.reservationId) }),
    ],
  );
  for (const voucher of vouchers) {
    await client.query(
      "select id from promotion.vouchers where id=$1 for update",
      [voucher.voucherId],
    );
    const result = await client.query<ReservationRow>(
      `insert into promotion.voucher_reservations
      (id,voucher_id,order_id,invoice_id,declaration_payment_id,tenant_id,workspace_id,user_id,operation_id,effect_snapshot,policy_snapshot)
      select $1,v.id,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,
        (case when $10::jsonb->>'legacy_adoption'='true' then '{"return_policy":"none"}'::jsonb
          else coalesce(b.policy_snapshot,'{"return_policy":"none"}'::jsonb) end) || jsonb_build_object('calculation',$10::jsonb,
            'effectiveExpiresAt',least(coalesce(v.expires_at,b.valid_until),b.valid_until))
      from promotion.vouchers v join promotion.voucher_batches b on b.id=v.batch_id
      where v.id=$11 and v.status='reserved' and v.used_count=1 and v.max_uses=1
        and (b.tenant_id is null or b.tenant_id=$5)
        and (v.assigned_user_id is null or v.assigned_user_id=$7)
        and (v.assigned_workspace_id is null or v.assigned_workspace_id=$6)
        and (v.assigned_tenant_id=$5 or (v.assigned_tenant_id is null and (b.tenant_id=$5 or v.assigned_workspace_id=$6)))
      returning *`,
      [
        voucher.reservationId,
        context.orderId,
        context.invoiceId,
        context.declarationPaymentId ?? null,
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        operationId,
        JSON.stringify(voucher.effectSnapshot),
        JSON.stringify(calculation),
        voucher.voucherId,
      ],
    );
    if (!result.rows[0]) conflict();
    await event(client, result.rows[0], "reserved");
  }
}

// ===========================================================================
// Legacy adoption is permitted only from one provable, unreleased cash leg.
// ===========================================================================
async function loadReservation(
  client: PoolClient,
  context: ReservationContext,
  voucherId: string,
  reservationId?: string | null,
): Promise<ReservationRow> {
  await lockContext(client, context);
  const voucher = await client.query(
    "select id,status from promotion.vouchers where id=$1 for update",
    [voucherId],
  );
  if (!voucher.rows[0]) conflict();
  const result = await client.query<ReservationRow>(
    `select * from promotion.voucher_reservations
    where voucher_id=$1 and (($2::uuid is not null and id=$2) or ($2::uuid is null and order_id=$3
      and invoice_id=$4 and declaration_payment_id is not distinct from $5::uuid)) for update`,
    [
      voucherId,
      reservationId ?? null,
      context.orderId,
      context.invoiceId,
      context.declarationPaymentId ?? null,
    ],
  );
  let row = result.rows[0];
  if (result.rows.length > 1) conflict();
  if (!row && !reservationId && context.declarationPaymentId) {
    // Never infer ownership merely from the voucher's reserved state.
    const candidates = await client.query<{
      id: string;
      order_id: string;
      invoice_id: string;
      tenant_id: string;
      workspace_id: string;
      user_id: string;
      kind: "discount" | "credit_voucher";
      effect: Record<string, unknown>;
    }>(
      `select p.id,i.order_id,i.id invoice_id,o.tenant_id,o.workspace_id,
      coalesce(p.channel_raw_data#>>'{settlement,declaredBy}',p.actor_id::text)::uuid user_id,b.kind,
      case when b.kind='discount' then p.channel_raw_data#>'{settlement,discountEffectSnapshot}'
        else p.channel_raw_data#>'{settlement,creditEffectSnapshot}' end effect
      from billing.payments p join billing.invoices i on i.id=p.bill_id join billing.orders o on o.id=i.order_id
      join promotion.vouchers v on v.id=$1 join promotion.voucher_batches b on b.id=v.batch_id
      where (p.pay_status='pending_verify' or p.id=$2) and i.deleted_at is null
        and coalesce(p.channel_raw_data#>>'{settlement,released}','false')='false'
        and ((b.kind='discount' and p.channel_raw_data#>>'{settlement,discountVoucherId}'=$1::text)
          or (b.kind='credit_voucher' and p.channel_raw_data#>>'{settlement,creditVoucherId}'=$1::text))`,
      [voucherId, context.declarationPaymentId],
    );
    const candidate = candidates.rows[0];
    if (
      candidates.rows.length !== 1 ||
      !candidate ||
      candidate.id !== context.declarationPaymentId ||
      candidate.order_id !== context.orderId ||
      candidate.invoice_id !== context.invoiceId ||
      !candidate.user_id ||
      !candidate.effect ||
      voucher.rows[0].status !== "reserved"
    )
      conflict();
    const occupied = await client.query(
      "select 1 from promotion.voucher_reservations where voucher_id=$1 and status='active'",
      [voucherId],
    );
    if (occupied.rows[0]) conflict();
    const adoptedId = randomUUID();
    await recordSettlementReservations(
      client,
      context,
      {
        tenantId: candidate.tenant_id,
        workspaceId: candidate.workspace_id,
        userId: candidate.user_id,
      },
      [
        {
          voucherId,
          reservationId: adoptedId,
          kind: candidate.kind,
          effectSnapshot: candidate.effect,
          effect: { amountCents: 0 },
        },
      ],
      { legacy_adoption: true },
    );
    row = (
      await client.query<ReservationRow>(
        "select * from promotion.voucher_reservations where id=$1 for update",
        [adoptedId],
      )
    ).rows[0];
  }
  if (
    !row ||
    row.order_id !== context.orderId ||
    row.invoice_id !== context.invoiceId ||
    row.declaration_payment_id !== (context.declarationPaymentId ?? null)
  )
    conflict();
  return row;
}

// ===========================================================================
// Both terminal paths lock the voucher, then the exact reservation, before CAS.
// ===========================================================================
/**
 * Consume only the reservation named by this order's declaration.
 * @param client - Caller-owned transaction.
 * @param input - Immutable ownership and settlement destinations.
 * @returns The same reservation's redemption, including on retry.
 * @throws {ConflictException} When the reservation was released or belongs elsewhere.
 */
export async function finalizeSettlementReservation(
  client: PoolClient,
  input: FinalizeVoucherInput,
): Promise<{ redemptionId: string; already: boolean }> {
  if (!input.orderId || !input.invoiceId) conflict();
  const row = await loadReservation(
    client,
    {
      orderId: input.orderId,
      invoiceId: input.invoiceId,
      ...(input.declarationPaymentId !== undefined
        ? { declarationPaymentId: input.declarationPaymentId }
        : {}),
    },
    input.voucherId,
    input.reservationId,
  );
  if (
    row.tenant_id !== input.scope.tenantId ||
    row.workspace_id !== input.scope.workspaceId ||
    row.user_id !== input.scope.userId
  )
    conflict();
  const kind = await client.query(
    "select b.kind from promotion.vouchers v join promotion.voucher_batches b on b.id=v.batch_id where v.id=$1",
    [input.voucherId],
  );
  if (kind.rows[0]?.kind !== input.kind) conflict();
  if (row.status === "consumed") {
    const existing = await client.query<{ id: string }>(
      "select id from promotion.voucher_redemptions where reservation_id=$1 and order_id=$2",
      [row.id, input.orderId],
    );
    if (!existing.rows[0]) conflict();
    return { redemptionId: existing.rows[0].id, already: true };
  }
  if (row.status !== "active") conflict();
  // Financial destinations must belong to the same invoice, never to another order.
  if (input.invoiceItemId) {
    const item = await client.query(
      "select id from billing.invoice_items where id=$1 and bill_id=$2 and deleted_at is null and item_type='discount'",
      [input.invoiceItemId, input.invoiceId],
    );
    if (!item.rows[0]) conflict();
  }
  if (input.paymentId) {
    const payment = await client.query(
      "select id from billing.payments where id=$1 and bill_id=$2 and pay_source='voucher' and pay_status='paid'",
      [input.paymentId, input.invoiceId],
    );
    if (!payment.rows[0]) conflict();
  }
  const flipped = await client.query(
    "update promotion.vouchers set status='redeemed',redeemed_at=now() where id=$1 and status='reserved' and used_count=1 and max_uses=1",
    [input.voucherId],
  );
  if (flipped.rowCount !== 1) conflict();
  const inserted = await client.query<{ id: string }>(
    `insert into promotion.voucher_redemptions
    (redemption_no,voucher_id,tenant_id,workspace_id,user_id,kind,effect_snapshot,invoice_item_id,payment_id,reservation_id,order_id,operation_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [
      `RDM-${new Date().toISOString().slice(0, 7).replace("-", "")}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
      input.voucherId,
      row.tenant_id,
      row.workspace_id,
      row.user_id,
      input.kind,
      JSON.stringify(row.effect_snapshot),
      input.invoiceItemId ?? null,
      input.paymentId ?? null,
      row.id,
      row.order_id,
      row.operation_id,
    ],
  );
  await client.query(
    "update promotion.voucher_reservations set status='consumed',consumed_at=now() where id=$1 and status='active'",
    [row.id],
  );
  const redemptionId = inserted.rows[0]!.id;
  await event(client, row, "redeemed", undefined, redemptionId, input.actor);
  return { redemptionId, already: false };
}

/**
 * Release the exact reservation without touching later reservations of this voucher.
 * @param client - Caller-owned transaction.
 * @param context - Verified order, invoice and original declaration leg.
 * @param voucherId - Named voucher.
 * @param reservationId - New credentials require this ID; legacy credentials may be adopted.
 * @param reason - Auditable terminal reason.
 * @returns Whether this call changed the active reservation.
 * @throws {ConflictException} When ownership conflicts or the reservation was consumed.
 */
export async function releaseSettlementReservation(
  client: PoolClient,
  context: ReservationContext,
  voucherId: string,
  reservationId?: string | null,
  reason = "rejected",
): Promise<boolean> {
  const row = await loadReservation(client, context, voucherId, reservationId);
  if (row.status === "released") return false;
  if (row.status !== "active") conflict();
  const result = await client.query(
    "update promotion.vouchers set status='assigned',used_count=used_count-1 where id=$1 and status='reserved' and used_count=1 and max_uses=1",
    [voucherId],
  );
  if (result.rowCount !== 1) conflict();
  await client.query(
    "update promotion.voucher_reservations set status='released',released_at=now(),release_reason=$2 where id=$1 and status='active'",
    [row.id, reason],
  );
  await event(client, row, "released", reason, undefined, context.actor);
  return true;
}
