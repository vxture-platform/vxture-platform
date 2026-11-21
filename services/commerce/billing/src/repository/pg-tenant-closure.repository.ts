/**
 * pg-tenant-closure.repository.ts — 一个租户「能不能被清账关闭」的读侧快照。
 * @package @vxture/service-billing
 *
 * 用途:console 删除账号(050-account §7)的资格判定要问五张表——未清账单、余额、
 * 在途退款、在途开票、待付订单——外加订阅未到期。这些事实全在 commerce 库里,
 * 一次读齐比 BFF 逐张表拼 SQL 稳(批 3 的教训:SQL 下沉到服务层,BFF 只编排)。
 *
 * Wallet source balances come from immutable lot entries. Cash receipt totals
 * also include subscription payments and cannot prove a wallet's principal.
 * Unclassified historical balances require reconciliation before account closure.
 *
 * 待付订单分两类:一分钱没收到的(可自动取消)与已有实收 / 有待核实付款腿的
 * (取消会 409,owner:阻断)。判据与 pg-order.repository.cancelOrder 的 409 条件一致。
 */

import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import type { TenantClosureSnapshot } from "../types/closure.types";
import { walletCents, walletAmount } from "./wallet-money";

// ===========================================================================
// Financial and lifecycle facts share one repeatable-read snapshot.
// ===========================================================================

@Injectable()
export class PgTenantClosureRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  async getSnapshot(tenantId: string): Promise<TenantClosureSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      const [bills, credit, refunds, receipts, orders, subscriptions] =
        await Promise.all([
          client.query<{ unpaid: string; card_principal: string }>(
            `select count(*)::text as unpaid,
              (select coalesce(sum(a.amount),0)::text from billing.wallet_card_allocations a
                join billing.payments p on p.id=a.payment_id
                where p.tenant_id=$1 and a.status='reserved') card_principal
             from billing.invoices i
            where i.tenant_id = $1 and i.deleted_at is null
              and i.bill_status in ('unpaid', 'paying', 'partial', 'overdue')
              and not (i.bill_status='unpaid' and coalesce(i.paid_amount,0)=0
                and exists (select 1 from billing.orders o where o.id=i.order_id
                  and o.status='pending_payment'
                  and not exists(select 1 from billing.invoices paid where paid.order_id=o.id
                    and paid.deleted_at is null and (paid.bill_status='paid' or paid.paid_amount>0))
                  and not exists(select 1 from billing.payments p join billing.invoices ip on ip.id=p.bill_id
                    where ip.order_id=o.id and p.pay_status='pending_verify')))`,
            [tenantId],
          ),
          client.query<{
            balance: string | null;
            currency: string | null;
            principal: string;
            bonus: string;
            tracked: boolean;
          }>(
            `select c.balance::text as balance, c.currency,
                  exists(select from billing.wallet_accounts a where a.credit_id=c.id) tracked,
                  (select coalesce(sum(e.amount),0)::text from billing.wallet_entries e
                    join billing.wallet_lots l on l.id=e.lot_id where l.credit_id=c.id and l.kind='principal') principal,
                  (select coalesce(sum(e.amount),0)::text from billing.wallet_entries e
                    join billing.wallet_lots l on l.id=e.lot_id where l.credit_id=c.id and l.kind='bonus') bonus
             from billing.credits c
            where c.tenant_id = $1
            limit 1`,
            [tenantId],
          ),
          client.query<{ in_progress: string }>(
            `select count(*)::text as in_progress
             from billing.refunds
            where tenant_id = $1
              and (audit_status = 'pending'
                   or (audit_status = 'approved'
                       and refund_status in ('pending', 'processing')))`,
            [tenantId],
          ),
          client.query<{ in_progress: string }>(
            `select count(*)::text as in_progress
             from billing.invoice_receipts
            where tenant_id = $1 and deleted_at is null
              and invoice_status in ('applying', 'approved')`,
            [tenantId],
          ),
          client.query<{ id: string; with_money: boolean }>(
            `select o.id,
                  (o.status = 'pending_verify'
                   or exists (select 1 from billing.invoices i
                               where i.order_id = o.id and i.deleted_at is null
                                 and (i.bill_status = 'paid' or i.paid_amount > 0))
                   or exists (select 1 from billing.payments p
                               join billing.invoices i2 on i2.id = p.bill_id
                              where i2.order_id = o.id and p.pay_status = 'pending_verify')
                  ) as with_money
             from billing.orders o
            where o.tenant_id = $1
              and o.status in ('pending_payment', 'pending_verify')
            order by o.created_at asc`,
            [tenantId],
          ),
          client.query<{ unexpired: string }>(
            `select count(*)::text as unexpired
             from metering.subscriptions
            where tenant_id = $1 and deleted_at is null
              and status not in ('expired', 'cancelled')
              and (end_at is null or end_at > now())`,
            [tenantId],
          ),
        ]);

      if (walletCents(bills.rows[0]?.card_principal ?? "0.00") > 0)
        throw new ConflictException("存在尚未核销的充值卡本金，不能清账关闭");
      const creditRow = credit.rows[0];
      const balance = walletCents(creditRow?.balance ?? "0.00");
      if (creditRow && !creditRow.tracked && balance !== 0)
        throw new ConflictException(
          "历史钱包余额尚未完成来源核对，不能清账关闭",
        );
      const paidBalance = walletCents(creditRow?.principal ?? "0.00");
      const giftedBalance = walletCents(creditRow?.bonus ?? "0.00");
      if (balance !== paidBalance + giftedBalance || balance < 0)
        throw new ConflictException("钱包来源对账不一致，不能清账关闭");
      await client.query("commit");

      return {
        tenantId,
        unpaidBills: Number(bills.rows[0]?.unpaid ?? 0),
        currency: creditRow?.currency ?? "CNY",
        balance: walletAmount(balance),
        paidBalance: walletAmount(paidBalance),
        giftedBalance: walletAmount(giftedBalance),
        refundsInProgress: Number(refunds.rows[0]?.in_progress ?? 0),
        receiptsInProgress: Number(receipts.rows[0]?.in_progress ?? 0),
        pendingOrdersCancellable: orders.rows
          .filter((r) => !r.with_money)
          .map((r) => r.id),
        pendingOrdersWithMoney: orders.rows.filter((r) => r.with_money).length,
        unexpiredSubscriptions: Number(subscriptions.rows[0]?.unexpired ?? 0),
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
