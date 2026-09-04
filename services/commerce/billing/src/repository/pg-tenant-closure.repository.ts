/**
 * pg-tenant-closure.repository.ts — 一个租户「能不能被清账关闭」的读侧快照。
 * @package @vxture/service-billing
 *
 * 用途:console 删除账号(050-account §7)的资格判定要问五张表——未清账单、余额、
 * 在途退款、在途开票、待付订单——外加订阅未到期。这些事实全在 commerce 库里,
 * 一次读齐比 BFF 逐张表拼 SQL 稳(批 3 的教训:SQL 下沉到服务层,BFF 只编排)。
 *
 * 付费 / 赠送余额:`billing.credits` 一租户一池,充值与赠送同入(52_billing 注释),
 * 库里没有分池。按 owner 裁定「付费余额先消耗赠送」,付费余额 = min(balance,
 * Σrecharge − Σrefund),从 append-only 的 transactions 流水推;赠送余额 = balance − 付费。
 * amount 正入负出,refund 本身就是负数,所以 recharge + refund 直接求和即可。
 *
 * 待付订单分两类:一分钱没收到的(可自动取消)与已有实收 / 有待核实付款腿的
 * (取消会 409,owner:阻断)。判据与 pg-order.repository.cancelOrder 的 409 条件一致。
 */

import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import type { TenantClosureSnapshot } from "../types/closure.types";

@Injectable()
export class PgTenantClosureRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  async getSnapshot(tenantId: string): Promise<TenantClosureSnapshot> {
    const [bills, credit, refunds, receipts, orders, subscriptions] =
      await Promise.all([
        this.pool.query<{ unpaid: string }>(
          `select count(*)::text as unpaid
             from billing.invoices
            where tenant_id = $1 and deleted_at is null
              and bill_status in ('unpaid', 'paying', 'partial', 'overdue')`,
          [tenantId],
        ),
        this.pool.query<{
          balance: string | null;
          currency: string | null;
          paid_flow: string | null;
        }>(
          `select c.balance::text as balance, c.currency,
                  (select coalesce(sum(t.amount), 0)::numeric(12,2)::text
                     from billing.transactions t
                    where t.tenant_id = $1
                      and t.trade_type in ('recharge', 'refund')
                      and t.trade_status = 'success') as paid_flow
             from billing.credits c
            where c.tenant_id = $1
            limit 1`,
          [tenantId],
        ),
        this.pool.query<{ in_progress: string }>(
          `select count(*)::text as in_progress
             from billing.refunds
            where tenant_id = $1
              and (audit_status = 'pending'
                   or (audit_status = 'approved'
                       and refund_status in ('pending', 'processing')))`,
          [tenantId],
        ),
        this.pool.query<{ in_progress: string }>(
          `select count(*)::text as in_progress
             from billing.invoice_receipts
            where tenant_id = $1 and deleted_at is null
              and invoice_status in ('applying', 'approved')`,
          [tenantId],
        ),
        this.pool.query<{ id: string; with_money: boolean }>(
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
        this.pool.query<{ unexpired: string }>(
          `select count(*)::text as unexpired
             from metering.subscriptions
            where tenant_id = $1 and deleted_at is null
              and status not in ('expired', 'cancelled')
              and (end_at is null or end_at > now())`,
          [tenantId],
        ),
      ]);

    const creditRow = credit.rows[0];
    const balance = Number(creditRow?.balance ?? 0);
    const paidFlow = Number(creditRow?.paid_flow ?? 0);
    const paidBalance = Math.max(0, Math.min(balance, paidFlow));
    const giftedBalance = Math.max(0, balance - paidBalance);

    return {
      tenantId,
      unpaidBills: Number(bills.rows[0]?.unpaid ?? 0),
      currency: creditRow?.currency ?? "CNY",
      balance: balance.toFixed(2),
      paidBalance: paidBalance.toFixed(2),
      giftedBalance: giftedBalance.toFixed(2),
      refundsInProgress: Number(refunds.rows[0]?.in_progress ?? 0),
      receiptsInProgress: Number(receipts.rows[0]?.in_progress ?? 0),
      pendingOrdersCancellable: orders.rows
        .filter((r) => !r.with_money)
        .map((r) => r.id),
      pendingOrdersWithMoney: orders.rows.filter((r) => r.with_money).length,
      unexpiredSubscriptions: Number(subscriptions.rows[0]?.unexpired ?? 0),
    };
  }
}
