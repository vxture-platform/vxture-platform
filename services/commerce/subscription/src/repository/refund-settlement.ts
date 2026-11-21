/**
 * refund-settlement.ts - Proven payment sources and refund capacity locking.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category repository
 * @author AI-Generated
 * @date 2026-11-19
 */
import { ConflictException } from "@nestjs/common";
import type { PoolClient, Pool } from "pg";
import {
  allocateCashRefund,
  allocateRefundSources,
  type RefundSource,
  type RefundTarget,
} from "../money/refund-sources";

export interface RefundCalculation {
  version: 1;
  alpha: number;
  usage: number;
  cashTargetCents: number;
  targets: RefundTarget[];
  cash: RefundTarget[];
  /** Restored to the proven original wallet debit, never transferred as cash. */
  wallet?: RefundTarget[];
}
function conflict(): never {
  throw new ConflictException(
    "退款来源无法核实或超出可退现金，请联系运营核对。",
  );
}

// ===========================================================================
// Financial transactions always lock order -> invoices -> payment sources.
// ===========================================================================
/**
 * Read actual paid sources; quotes may read without taking row locks.
 * @param db - Pool for quotes, or the caller's transaction for writes.
 * @param orderId - Exact source order.
 * @param lock - Whether to lock invoices and payment rows.
 * @returns Positive settled sources, in UUID lock order.
 * @throws {ConflictException} When amounts or historical payment sources require review.
 */
export async function readRefundSources(
  db: Pool | PoolClient,
  orderId: string,
  lock = false,
): Promise<RefundSource[]> {
  if (lock)
    await db.query(
      "select id from billing.invoices where order_id=$1 and deleted_at is null order by id for update",
      [orderId],
    );
  const rows = await db.query<{
    id: string;
    pay_source: string;
    paid_amount: string;
    currency: string;
    balance_verified: boolean;
    scope_verified: boolean;
  }>(
    `select p.id,p.pay_source,p.paid_amount,p.currency,
      (i.tenant_id=o.tenant_id and p.tenant_id=o.tenant_id and i.deleted_at is null and i.currency=o.currency and p.currency=o.currency) scope_verified,
      exists(select 1 from billing.transactions t join billing.wallet_operations wo on wo.transaction_id=t.id
        join billing.credits c on c.id=wo.credit_id
        where t.id=p.transaction_id and t.bill_id=i.id and t.tenant_id=p.tenant_id and t.currency=p.currency
          and t.trade_type='consume' and t.trade_status='success' and t.amount=-p.paid_amount
          and wo.action='consume' and c.tenant_id=p.tenant_id and c.currency=p.currency
          and (select -sum(e.amount) from billing.wallet_entries e where e.operation_id=wo.id and e.entry_type='consume')=p.paid_amount) balance_verified
      from billing.payments p join billing.invoices i on i.id=p.bill_id
    join billing.orders o on o.id=i.order_id
    where i.order_id=$1 and p.pay_status='paid'
      order by p.id ${lock ? "for update of p" : ""}`,
    [orderId],
  );
  return rows.rows
    .map<RefundSource>((r) => {
      // Persisted legacy values are evidence, not authorization for cash refunds.
      if (
        r.scope_verified !== true ||
        (r.pay_source !== "online" &&
          r.pay_source !== "offline" &&
          r.pay_source !== "voucher" &&
          !(r.pay_source === "balance" && r.balance_verified === true))
      )
        conflict();
      const cents = Math.round(Number(r.paid_amount) * 100);
      if (
        !Number.isSafeInteger(cents) ||
        cents < 0 ||
        Math.abs(Number(r.paid_amount) * 100 - cents) > 0.00001
      )
        conflict();
      return { id: r.id, source: r.pay_source, cents, currency: r.currency };
    })
    .filter((s) => s.cents > 0);
}

/**
 * Freeze policy targets and reserve every cash source inside the request transaction.
 * @param client - Caller-owned transaction.
 * @param orderId - Order locked before any source or refund row.
 * @param amountCents - Requested cash refund only.
 * @param alpha - Frozen consumable share.
 * @param usage - Frozen consumed ratio.
 * @returns Source calculations to store on the immutable refund request.
 * @throws {ConflictException} When sources, current effect ownership or capacity conflict.
 */
export async function prepareRefundCalculation(
  client: PoolClient,
  orderId: string,
  amountCents: number,
  alpha: number,
  usage: number,
): Promise<RefundCalculation> {
  const order = (
    await client.query<{
      status: string;
      currency: string;
      leftover_amount: string;
      credit_amount: string;
      subscription_id: string | null;
    }>("select * from billing.orders where id=$1 for update", [orderId])
  ).rows[0];
  if (!order || order.status !== "fulfilled") conflict();
  if (order.subscription_id) {
    const sub = (
      await client.query<{ current_order_id: string | null }>(
        "select current_order_id from metering.subscriptions where id=$1 for update",
        [order.subscription_id],
      )
    ).rows[0];
    if (!sub || sub.current_order_id !== orderId) conflict();
  }
  const sources = await readRefundSources(client, orderId, true);
  if (!sources.length || sources.some((s) => s.currency !== order.currency))
    conflict();
  const ledger = (
    await client.query<{ paid: string; payable: string }>(
      "select sum(paid_amount)::text paid,sum(payable_amount)::text payable from billing.invoices where order_id=$1 and deleted_at is null and bill_status='paid'",
      [orderId],
    )
  ).rows[0];
  if (
    !ledger ||
    Math.round(Number(ledger.paid) * 100) !==
      sources.reduce((n, s) => n + s.cents, 0) ||
    Math.round(Number(ledger.payable) * 100) !==
      sources.reduce((n, s) => n + s.cents, 0)
  )
    conflict();
  // Legacy successful refunds without allocations must never be treated as unused capacity.
  if (
    (
      await client.query(
        "select 1 from billing.refunds where order_id=$1 and refund_status='success'",
        [orderId],
      )
    ).rows.length
  )
    conflict();
  const targets = allocateRefundSources(sources, alpha, usage);
  const cashSources = sources.filter(
    (s) => s.source === "online" || s.source === "offline",
  );
  const cashTargets = targets.filter(
    (s) => s.source === "online" || s.source === "offline",
  );
  const walletSources = sources.filter((s) => s.source === "balance");
  if (walletSources.length > 0) {
    // Keep the existing one-debit wallet restoration boundary. Mixed external
    // cash and wallet payments need a separate workflow and remain rejected.
    if (
      walletSources.length !== 1 ||
      cashSources.length > 0 ||
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > walletSources[0]!.cents
    )
      conflict();
    return {
      version: 1,
      alpha,
      usage,
      cashTargetCents: 0,
      targets,
      cash: [],
      wallet: [{ ...walletSources[0]!, targetCents: amountCents }],
    };
  }
  const policyCash = cashTargets.reduce((n, s) => n + s.targetCents, 0);
  let cash: RefundTarget[];
  try {
    cash =
      amountCents <= policyCash
        ? allocateCashRefund(
            cashTargets.map((s) => ({ ...s, cents: s.targetCents })),
            amountCents,
          ).map((s) => ({
            ...s,
            cents: cashSources.find((original) => original.id === s.id)!.cents,
          }))
        : allocateCashRefund(cashSources, amountCents);
  } catch {
    conflict();
  }
  for (const source of cash) {
    const spent = (
      await client.query<{ cents: string }>(
        `select (coalesce(sum(amount)*100,0)+(select coalesce(sum(amount)*100,0) from billing.wallet_lots where funding_payment_id=$1)+(select coalesce(sum(amount)*100,0) from billing.wallet_card_allocations where payment_id=$1 and status='reserved'))::text cents from billing.refund_allocations where payment_id=$1 and status in ('reserved','succeeded')`,
        [source.id],
      )
    ).rows[0];
    if (Number(spent?.cents ?? 0) + source.targetCents > source.cents)
      conflict();
  }
  return {
    version: 1,
    alpha,
    usage,
    cashTargetCents: targets
      .filter((s) => s.source === "online" || s.source === "offline")
      .reduce((n, s) => n + s.targetCents, 0),
    targets,
    cash,
  };
}

/**
 * Persist source reservations after the request ID exists.
 * @param client - Caller-owned request transaction.
 * @param refundId - Newly inserted refund.
 * @param calculation - Proven immutable source calculation.
 * @returns Resolves when all positive cash allocations are reserved.
 * @throws {ConflictException} When the calculation contains a non-cash source.
 */
export async function insertRefundAllocations(
  client: PoolClient,
  refundId: string,
  calculation: RefundCalculation,
): Promise<void> {
  if (
    calculation.cash.some(
      (s) => s.source !== "online" && s.source !== "offline",
    )
  )
    conflict();
  for (const s of calculation.cash)
    if (s.targetCents > 0)
      await client.query(
        "insert into billing.refund_allocations(refund_id,payment_id,currency,amount) values ($1,$2,$3,$4)",
        [refundId, s.id, s.currency, (s.targetCents / 100).toFixed(2)],
      );
}

/**
 * Reacquire released allocations before retry; legacy requests require manual review.
 * @param client - Caller-owned transaction holding the order lock.
 * @param refundId - Exact refund being transitioned.
 * @param orderId - Source order.
 * @returns Resolves after capacity and total match the immutable request.
 * @throws {ConflictException} When evidence is absent or another request took capacity.
 */
export async function validateRefundAllocations(
  client: PoolClient,
  refundId: string,
  orderId: string,
): Promise<void> {
  const sources = await readRefundSources(client, orderId, true);
  const refund = (
    await client.query<{
      refund_amount: string;
      calculation_snapshot: RefundCalculation | null;
    }>(
      "select refund_amount,calculation_snapshot from billing.refunds where id=$1 and order_id=$2 for update",
      [refundId, orderId],
    )
  ).rows[0];
  const rows = (
    await client.query<{
      payment_id: string;
      amount: string;
      currency: string;
      status: string;
    }>(
      "select * from billing.refund_allocations where refund_id=$1 order by payment_id for update",
      [refundId],
    )
  ).rows;
  const snapshot = refund?.calculation_snapshot;
  if (
    snapshot?.version !== 1 ||
    !Array.isArray(snapshot.targets) ||
    !Array.isArray(snapshot.cash)
  )
    conflict();
  let expectedTargets: RefundTarget[];
  try {
    expectedTargets = allocateRefundSources(
      sources,
      snapshot.alpha,
      snapshot.usage,
    );
  } catch {
    conflict();
  }
  if (
    snapshot.targets.length !== expectedTargets.length ||
    new Set(snapshot.targets.map((target) => target.id)).size !==
      expectedTargets.length ||
    expectedTargets.some(
      (expected) =>
        !snapshot.targets.some(
          (target) =>
            target.id === expected.id &&
            target.source === expected.source &&
            target.cents === expected.cents &&
            target.currency === expected.currency &&
            target.targetCents === expected.targetCents,
        ),
    )
  )
    conflict();
  if (
    refund?.calculation_snapshot?.version === 1 &&
    (refund.calculation_snapshot.wallet?.length ?? 0) > 0
  ) {
    const wallet = refund.calculation_snapshot.wallet!;
    const source = sources.find((s) => s.id === wallet[0]?.id);
    if (
      rows.length ||
      refund.calculation_snapshot.cash.length ||
      wallet.length !== 1 ||
      !source ||
      source.source !== "balance" ||
      wallet[0]!.source !== "balance" ||
      source.cents !== wallet[0]!.cents ||
      source.currency !== wallet[0]!.currency ||
      !Number.isSafeInteger(wallet[0]!.targetCents) ||
      wallet[0]!.targetCents <= 0 ||
      wallet[0]!.targetCents > source.cents ||
      Math.round(Number(refund.refund_amount) * 100) !==
        wallet[0]!.targetCents ||
      sources.some((s) => s.source === "online" || s.source === "offline")
    )
      conflict();
    return;
  }
  if (
    refund?.calculation_snapshot?.version !== 1 ||
    !rows.length ||
    Math.round(Number(refund.refund_amount) * 100) !==
      rows.reduce((n, r) => n + Math.round(Number(r.amount) * 100), 0)
  )
    conflict();
  for (const row of rows) {
    const source = sources.find((s) => s.id === row.payment_id);
    const frozen = refund.calculation_snapshot.cash.find(
      (s) => s.id === row.payment_id,
    );
    const other = (
      await client.query<{ cents: string }>(
        `select (coalesce(sum(amount)*100,0)+(select coalesce(sum(amount)*100,0) from billing.wallet_lots where funding_payment_id=$1)+(select coalesce(sum(amount)*100,0) from billing.wallet_card_allocations where payment_id=$1 and status='reserved'))::text cents from billing.refund_allocations where payment_id=$1 and refund_id<>$2 and status in ('reserved','succeeded')`,
        [row.payment_id, refundId],
      )
    ).rows[0];
    if (
      !source ||
      !frozen ||
      frozen.targetCents !== Math.round(Number(row.amount) * 100) ||
      frozen.cents !== source.cents ||
      (source.source !== "online" && source.source !== "offline") ||
      frozen.source !== source.source ||
      source.currency !== row.currency ||
      Number(other?.cents ?? 0) + Math.round(Number(row.amount) * 100) >
        source.cents
    )
      conflict();
  }
  await client.query(
    "update billing.refund_allocations set status='reserved',updated_at=now() where refund_id=$1 and status='released'",
    [refundId],
  );
}
