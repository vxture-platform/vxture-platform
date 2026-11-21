/**
 * pg-recharge-card-funding.ts - Cash reservations before card issuance.
 * @package @vxture/service-billing
 * @layer Domain
 * @category repository
 * @author AI-Generated
 * @date 2026-11-19
 */
import { ConflictException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { PgWalletLedger } from "./pg-wallet-ledger";
import { positiveWalletCents, walletAmount } from "./wallet-money";

// ===========================================================================
// Issuance and revocation share the source lock and immutable allocation.
// ===========================================================================
export class PgRechargeCardFunding {
  constructor(private readonly pool: Pool) {}

  /** Verify paid capacity before batch locks. @param client - Caller transaction. @param source - Trusted tenant and confirmed sale. @returns No value. @throws {ConflictException} For invalid proof or exhausted capacity. */
  async lockSource(
    client: PoolClient,
    source: { paymentId: string; tenantId: string; amountCents: number },
  ) {
    await new PgWalletLedger(this.pool).lockFundingInTransaction(
      client,
      {
        tenantId: source.tenantId,
        currency: "CNY",
        actorType: "system",
        actorId: source.tenantId,
      },
      source.paymentId,
      positiveWalletCents(source.amountCents),
    );
  }

  /** Freeze one card's principal in the same issuance transaction. @param client - Transaction holding the sales payment lock. @param allocation - Issued voucher and its source. @returns No value. */
  async reserve(
    client: PoolClient,
    allocation: { voucherId: string; paymentId: string; amountCents: number },
  ) {
    await client.query(
      "insert into billing.wallet_card_allocations(voucher_id,payment_id,amount) values($1,$2,$3)",
      [
        allocation.voucherId,
        allocation.paymentId,
        walletAmount(positiveWalletCents(allocation.amountCents)),
      ],
    );
  }

  /** Lock the source before revocation takes batch/voucher locks. @param client - Caller transaction. @param voucherId - Selected instance. @returns No value. */
  async lockRelease(client: PoolClient, voucherId: string) {
    await client.query(
      `select i.id from billing.invoices i join billing.payments p on p.bill_id=i.id
      join billing.wallet_card_allocations a on a.payment_id=p.id where a.voucher_id=$1 for update of i`,
      [voucherId],
    );
    await client.query(
      `select p.id from billing.payments p join billing.wallet_card_allocations a on a.payment_id=p.id
      where a.voucher_id=$1 for update of p`,
      [voucherId],
    );
  }

  /** Release only an unused revoked card; issuance budgets remain spent. @param client - Caller transaction holding the voucher lock. @param voucherId - Revoked instance. @returns No value. @throws {ConflictException} For transferred funds. */
  async release(client: PoolClient, voucherId: string) {
    const row = (
      await client.query<{ status: string }>(
        "select status from billing.wallet_card_allocations where voucher_id=$1",
        [voucherId],
      )
    ).rows[0];
    if (row?.status === "transferred")
      throw new ConflictException(
        "本金已转入钱包，须按原资金来源处理，不能撤券退款",
      );
    await client.query(
      "update billing.wallet_card_allocations set status='released',updated_at=clock_timestamp() where voucher_id=$1 and status='reserved'",
      [voucherId],
    );
  }

  /** List cash evidence for a tenant without exposing payer details. @param tenantId - Batch's fixed tenant. @returns Settled independent sales and remaining allocatable amounts. */
  async sources(tenantId: string) {
    return (
      await this.pool.query<{
        id: string;
        paymentNo: string;
        paidAmount: string;
        availableAmount: string;
      }>(
        `select p.id,p.pay_order_no "paymentNo",p.paid_amount::text "paidAmount",
       (p.paid_amount-coalesce((select sum(l.amount) from billing.wallet_lots l where l.funding_payment_id=p.id),0)
         -coalesce((select sum(a.amount) from billing.wallet_card_allocations a where a.payment_id=p.id and a.status='reserved'),0)
         -coalesce((select sum(r.amount) from billing.refund_allocations r where r.payment_id=p.id and r.status in ('reserved','succeeded')),0))::text "availableAmount"
       from billing.payments p join billing.invoices i on i.id=p.bill_id join billing.transactions t on t.id=p.transaction_id
       where p.tenant_id=$1 and p.currency='CNY' and p.pay_status='paid' and p.paid_at is not null and p.pay_source in ('online','offline')
         and i.tenant_id=p.tenant_id and i.currency=p.currency and i.bill_status='paid' and i.deleted_at is null
         and i.bill_type='one_off' and i.order_id is null and i.subscription_id is null
         and not exists(select from billing.invoice_items ii where ii.bill_id=i.id and ii.subscription_id is not null)
         and not exists(select from billing.payments other where other.transaction_id=t.id and other.id<>p.id)
         and i.paid_amount=(select sum(s.paid_amount) from billing.payments s where s.bill_id=i.id and s.pay_status='paid')
         and t.tenant_id=p.tenant_id and t.bill_id=i.id and t.currency=p.currency and t.amount=p.paid_amount
         and t.trade_type='recharge' and t.trade_status='success' and t.balance_before=t.balance_after
         and not exists(select from billing.refunds r where (r.pay_record_id=p.id or r.bill_id=i.id) and r.audit_status<>'rejected' and r.refund_status<>'failed' and not exists(select from billing.refund_allocations a where a.refund_id=r.id))
       order by p.paid_at desc,p.id limit 100`,
        [tenantId],
      )
    ).rows;
  }
}
