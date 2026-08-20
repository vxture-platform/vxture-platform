import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import type {
  AddonPackRecord,
  AddonPurchaseRecord,
  CreateAddonOrderInput,
  DeclareAddonPaymentInput,
} from "../types/addon.types";

/**
 * Addon pack purchase flow (加油包自助购买闭环, owner 2026-08-20):
 *   place order  → metering.addon_purchases (pending_payment, catalog SNAPSHOT)
 *                  + billing.invoices (bill_type='one_off') + invoice_items
 *   declare      → billing.payments leg (pending_verify, offline) + invoice 'paying'
 *   op confirm   → leg 'paid' + transactions row + invoice 'paid'
 *                  + WS-level quota_pool grant (pool_source='addon_purchase',
 *                    product_id NULL, priority 200, expires = now + validity)
 *                  + purchase 'completed'
 *   TTL sweep    → undeclared over-TTL orders → 'cancelled' (+ invoice cancelled)
 *
 * Snapshot columns are copied at order time (product_220 profile-stamp
 * principle) — later catalog edits never move a sold order. No vouchers /
 * zero-amount path here (catalog price > 0; promo participation is a
 * registered non-goal for v1).
 */
@Injectable()
export class PgAddonRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  async listPacks(): Promise<AddonPackRecord[]> {
    const res = await this.pool.query<{
      id: string;
      pack_code: string;
      pack_name: string;
      metric_key: string;
      amount: string;
      validity_days: number;
      price: string;
      currency: string;
      status: string;
      sort: number;
    }>(
      `select id, pack_code, pack_name, metric_key, amount::text as amount,
              validity_days, price::text as price, currency, status, sort
         from product.addon_packs
        where status = 'active'
        order by sort asc, pack_code asc`,
    );
    return res.rows.map((r) => ({
      id: r.id,
      packCode: r.pack_code,
      packName: r.pack_name,
      metricKey: r.metric_key,
      amount: r.amount,
      validityDays: r.validity_days,
      price: r.price,
      currency: r.currency,
      status: r.status,
      sort: r.sort,
    }));
  }

  /** Purchase rows for a workspace (console 加油包订单卡片), newest first. */
  async listPurchases(
    workspaceId: string,
    limit = 20,
  ): Promise<AddonPurchaseRecord[]> {
    const res = await this.pool.query<PurchaseRow>(
      `${PURCHASE_SELECT}
        where ap.workspace_id = $1
        order by ap.created_at desc
        limit $2`,
      [workspaceId, limit],
    );
    return res.rows.map(mapPurchase);
  }

  /** Ops view: declared-and-waiting first, then other pending. */
  async listPendingOps(limit = 50): Promise<AddonPurchaseRecord[]> {
    const res = await this.pool.query<PurchaseRow>(
      `${PURCHASE_SELECT}
        where ap.status = 'pending_payment'
        order by (exists (
                 select 1 from billing.payments p
                  where p.bill_id = ap.invoice_id
                    and p.pay_status = 'pending_verify')) desc,
                 ap.created_at asc
        limit $1`,
      [limit],
    );
    return res.rows.map(mapPurchase);
  }

  async getByOrderNo(orderNo: string): Promise<AddonPurchaseRecord | null> {
    const res = await this.pool.query<PurchaseRow>(
      `${PURCHASE_SELECT} where ap.order_no = $1`,
      [orderNo],
    );
    const row = res.rows[0];
    return row ? mapPurchase(row) : null;
  }

  async getById(id: string): Promise<AddonPurchaseRecord | null> {
    const res = await this.pool.query<PurchaseRow>(
      `${PURCHASE_SELECT} where ap.id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapPurchase(row) : null;
  }

  /**
   * Place a pending addon order: snapshot the pack + one_off invoice, single
   * tx. Throws coded errors the service maps to HTTP:
   *   addon_pack_not_found / addon_order_already_pending
   */
  async createOrder(
    input: CreateAddonOrderInput,
  ): Promise<AddonPurchaseRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      const packRes = await client.query<{
        id: string;
        pack_name: string;
        metric_key: string;
        amount: string;
        validity_days: number;
        price: string;
        currency: string;
      }>(
        `select id, pack_name, metric_key, amount::text as amount,
                validity_days, price::text as price, currency
           from product.addon_packs
          where pack_code = $1 and status = 'active'`,
        [input.packCode],
      );
      const pack = packRes.rows[0];
      if (!pack) throw new Error("addon_pack_not_found");

      // 一 workspace 一 pack 一开放订单(同订阅单的防重口径,防误触双开)
      const dupRes = await client.query(
        `select 1 from metering.addon_purchases
          where workspace_id = $1 and pack_code = $2 and status = 'pending_payment'
          limit 1`,
        [input.workspaceId, input.packCode],
      );
      if ((dupRes.rowCount ?? 0) > 0) {
        throw new Error("addon_order_already_pending");
      }

      const orderNo = visibleCode("ORD");
      const billNo = visibleCode("INV");

      const invoiceRes = await client.query<{ id: string }>(
        `insert into billing.invoices (
           tenant_id, bill_no, bill_cycle,
           total_amount, payable_amount, paid_amount, currency,
           bill_status, bill_type, created_by_type, created_by_id, operate_remark,
           created_at, updated_at
         ) values (
           $1, $2, to_char(now(), 'YYYYMM'),
           $3, $3, 0, $4,
           'unpaid', 'one_off', 'customer', $5, $6,
           now(), now()
         ) returning id`,
        [
          input.tenantId,
          billNo,
          pack.price,
          pack.currency,
          input.createdBy,
          JSON.stringify({ intent: "addon", pack_code: input.packCode }),
        ],
      );
      const invoiceId = invoiceRes.rows[0]!.id;

      await client.query(
        `insert into billing.invoice_items (
           bill_id, tenant_id, workspace_id, metric_key,
           item_name, item_type, quantity, unit_price, total_amount,
           created_at, updated_at
         ) values ($1, $2, $3, $4, $5, 'addon_fee', 1, $6, $6, now(), now())`,
        [
          invoiceId,
          input.tenantId,
          input.workspaceId,
          pack.metric_key,
          pack.pack_name,
          pack.price,
        ],
      );

      const purchaseRes = await client.query<{ id: string }>(
        `insert into metering.addon_purchases (
           tenant_id, workspace_id, pack_id, pack_code, pack_name, metric_key,
           amount, validity_days, price, currency, order_no, status,
           payment_ttl_minutes, invoice_id, created_by_type, created_by_id,
           created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_payment',
           $12, $13, 'customer', $14, now(), now()
         ) returning id`,
        [
          input.tenantId,
          input.workspaceId,
          pack.id,
          input.packCode,
          pack.pack_name,
          pack.metric_key,
          pack.amount,
          pack.validity_days,
          pack.price,
          pack.currency,
          orderNo,
          input.paymentTtlMinutes ?? null,
          invoiceId,
          input.createdBy,
        ],
      );
      await client.query("commit");
      const record = await this.getById(purchaseRes.rows[0]!.id);
      if (!record) throw new Error("addon_order_readback_failed");
      return record;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Customer payment declaration (线下对公转账申报): one pending_verify leg
   * per order — re-declaring while one is open is a no-op (idempotent).
   * Coded errors: addon_order_not_found / addon_order_not_pending
   */
  async declarePayment(input: DeclareAddonPaymentInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const row = await this.lockPurchase(client, {
        orderNo: input.orderNo,
        tenantId: input.tenantId,
      });
      if (row.status !== "pending_payment" || !row.invoice_id) {
        throw new Error("addon_order_not_pending");
      }

      const open = await client.query(
        `select 1 from billing.payments
          where bill_id = $1 and pay_status = 'pending_verify' limit 1`,
        [row.invoice_id],
      );
      if ((open.rowCount ?? 0) === 0) {
        await client.query(
          `insert into billing.payments (
             tenant_id, bill_id, pay_order_no, pay_source, pay_channel,
             offline_payer_name, channel_transaction_no,
             total_amount, paid_amount, currency, pay_status,
             actor_type, actor_id, operate_remark, created_at, updated_at
           ) values ($1, $2, $3, 'offline', $4, $5, $6, $7, 0, $8,
                     'pending_verify', 'customer', $9, $10, now(), now())`,
          [
            input.tenantId,
            row.invoice_id,
            visibleCode("PAY"),
            input.payChannel,
            input.payerName ?? null,
            input.transactionNo ?? null,
            row.price,
            row.currency,
            input.actorId,
            input.remark ?? null,
          ],
        );
        await client.query(
          `update billing.invoices set bill_status = 'paying', updated_at = now()
            where id = $1 and bill_status = 'unpaid'`,
          [row.invoice_id],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Customer cancel (undeclared or declared-but-unconfirmed):
   * purchase → cancelled, invoice → cancelled, open legs → closed.
   */
  async cancelOrder(input: {
    orderNo: string;
    tenantId: string;
    reason: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const row = await this.lockPurchase(client, {
        orderNo: input.orderNo,
        tenantId: input.tenantId,
      });
      if (row.status !== "pending_payment") {
        throw new Error("addon_order_not_pending");
      }
      await this.cancelTx(client, row, input.reason);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Operator settlement (确认收款核销): flip/insert the paid leg, book the
   * transaction, clear the invoice, grant the WS-level pool, complete the
   * purchase — one tx. Returns null when the CAS loses (already settled) so a
   * re-drive is a safe no-op. Coded error: addon_order_not_pending
   */
  async confirmPayment(input: {
    purchaseId: string;
    operatorId: string | null;
    remark?: string;
  }): Promise<AddonPurchaseRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const rowRes = await client.query<PurchaseLockRow>(
        `select ap.id, ap.tenant_id, ap.workspace_id, ap.metric_key,
                ap.amount::text as amount, ap.validity_days,
                ap.price::text as price, ap.currency, ap.pack_code,
                ap.status, ap.invoice_id, ap.order_no
           from metering.addon_purchases ap
          where ap.id = $1
          for update`,
        [input.purchaseId],
      );
      const row = rowRes.rows[0];
      if (!row) throw new Error("addon_order_not_found");
      if (row.status === "completed") {
        // re-drive tolerance: already settled → report the settled record
        await client.query("commit");
        return null;
      }
      if (row.status !== "pending_payment" || !row.invoice_id) {
        throw new Error("addon_order_not_pending");
      }

      // 1. payment leg: flip the declared leg, or insert an offline leg when
      //    the customer paid without declaring (operator-observed transfer).
      const flip = await client.query(
        `update billing.payments
            set pay_status = 'paid', paid_amount = total_amount, paid_at = now(),
                actor_type = 'operator', actor_id = $2, updated_at = now()
          where bill_id = $1 and pay_status = 'pending_verify'`,
        [row.invoice_id, input.operatorId],
      );
      if ((flip.rowCount ?? 0) === 0) {
        await client.query(
          `insert into billing.payments (
             tenant_id, bill_id, pay_order_no, pay_source,
             total_amount, paid_amount, currency, pay_status, paid_at,
             actor_type, actor_id, operate_remark, created_at, updated_at
           ) values ($1, $2, $3, 'offline', $4, $4, $5, 'paid', now(),
                     'operator', $6, $7, now(), now())`,
          [
            row.tenant_id,
            row.invoice_id,
            visibleCode("PAY"),
            row.price,
            row.currency,
            input.operatorId,
            input.remark ?? "addon offline payment confirm",
          ],
        );
      }

      // 2. transaction (balance snapshots from the tenant credits pool; the
      //    addon settles cash-only so before == after).
      const balRes = await client.query<{ balance: string }>(
        `select balance::text as balance from billing.credits where tenant_id = $1`,
        [row.tenant_id],
      );
      const balance = balRes.rows[0]?.balance ?? "0.00";
      await client.query(
        `insert into billing.transactions (
           tenant_id, bill_id, transaction_no, trade_type, source_method,
           amount, currency, balance_before, balance_after, trade_status,
           related_no, remark, actor_type, actor_id, created_at
         ) values ($1, $2, $3, 'adjust', 'offline', $4, $5, $6, $6, 'success',
                   $7, $8, 'operator', $9, now())`,
        [
          row.tenant_id,
          row.invoice_id,
          visibleCode("TXN"),
          row.price,
          row.currency,
          balance,
          row.order_no,
          input.remark ?? "addon offline payment confirm",
          input.operatorId,
        ],
      );

      // 3. invoice cleared
      await client.query(
        `update billing.invoices set
           paid_amount = payable_amount, bill_status = 'paid', paid_at = now(),
           payment_method = 'offline', updated_at = now()
         where id = $1`,
        [row.invoice_id],
      );

      // 4. WS-level pool grant (product_220 §4.4): product_id NULL, priority
      //    200 (burns after subscription pools), no reset (one-time bucket),
      //    expires at activation + validity. Gauge metrics (storage) never
      //    enter consume — the limit joins the workspace Σ.
      const poolRes = await client.query<{ id: string }>(
        `insert into metering.quota_pools (
           workspace_id, subscription_id, product_id, metric_key,
           quota_limit, quota_used, priority, component_role, pool_source,
           reset_period, status, granted_by, grant_reason,
           effective_at, expires_at, created_at, updated_at
         ) values (
           $1, null, null, $2, $3::bigint, 0, 200, 'primary', 'addon_purchase',
           'none', 'active', $4, $5,
           now(), now() + make_interval(days => $6), now(), now()
         ) returning id`,
        [
          row.workspace_id,
          row.metric_key,
          row.amount,
          input.operatorId,
          `addon:${row.pack_code} (${row.order_no})`,
          row.validity_days,
        ],
      );
      const poolId = poolRes.rows[0]!.id;

      // 5. purchase completed (CAS on status keeps concurrent confirms single-shot)
      const done = await client.query(
        `update metering.addon_purchases
            set status = 'completed', quota_pool_id = $2, activated_at = now(),
                updated_at = now()
          where id = $1 and status = 'pending_payment'`,
        [row.id, poolId],
      );
      if ((done.rowCount ?? 0) === 0) throw new Error("addon_confirm_cas_lost");

      await client.query("commit");
      return this.getById(row.id);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * TTL sweep: cancel undeclared pending orders past their payment window.
   * Declared orders (an open pending_verify leg) wait for the operator and
   * are never auto-expired.
   */
  async sweepExpiredOrders(
    fallbackTtlMinutes: number,
    limit = 50,
  ): Promise<number> {
    const idsRes = await this.pool.query<{
      order_no: string;
      tenant_id: string;
    }>(
      `select ap.order_no, ap.tenant_id
         from metering.addon_purchases ap
        where ap.status = 'pending_payment'
          and ap.created_at
              + make_interval(mins => coalesce(ap.payment_ttl_minutes, $1)) <= now()
          and not exists (select 1 from billing.payments p
                           where p.bill_id = ap.invoice_id
                             and p.pay_status = 'pending_verify')
        order by ap.created_at asc
        limit $2`,
      [fallbackTtlMinutes, limit],
    );
    let swept = 0;
    for (const r of idsRes.rows) {
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        const row = await this.lockPurchase(client, {
          orderNo: r.order_no,
          tenantId: r.tenant_id,
        });
        if (row.status === "pending_payment") {
          await this.cancelTx(client, row, "payment window expired (sweep)");
          swept += 1;
        }
        await client.query("commit");
      } catch {
        await client.query("rollback");
        // per-order isolation: one failure never stops the sweep
      } finally {
        client.release();
      }
    }
    return swept;
  }

  // ── shared tx pieces ──────────────────────────────────────────────────────

  private async lockPurchase(
    client: PoolClient,
    key: { orderNo: string; tenantId: string },
  ): Promise<PurchaseLockRow> {
    const res = await client.query<PurchaseLockRow>(
      `select ap.id, ap.tenant_id, ap.workspace_id, ap.metric_key,
              ap.amount::text as amount, ap.validity_days,
              ap.price::text as price, ap.currency, ap.pack_code,
              ap.status, ap.invoice_id, ap.order_no
         from metering.addon_purchases ap
        where ap.order_no = $1 and ap.tenant_id = $2
        for update`,
      [key.orderNo, key.tenantId],
    );
    const row = res.rows[0];
    if (!row) throw new Error("addon_order_not_found");
    return row;
  }

  private async cancelTx(
    client: PoolClient,
    row: PurchaseLockRow,
    reason: string,
  ): Promise<void> {
    await client.query(
      `update metering.addon_purchases
          set status = 'cancelled', cancelled_at = now(), cancel_reason = $2,
              updated_at = now()
        where id = $1`,
      [row.id, reason],
    );
    if (row.invoice_id) {
      await client.query(
        `update billing.invoices set bill_status = 'cancelled', updated_at = now()
          where id = $1 and bill_status in ('unpaid', 'paying')`,
        [row.invoice_id],
      );
      await client.query(
        `update billing.payments
            set pay_status = 'closed', closed_at = now(), updated_at = now()
          where bill_id = $1 and pay_status in ('pending', 'pending_verify')`,
        [row.invoice_id],
      );
    }
  }
}

interface PurchaseLockRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  metric_key: string;
  amount: string;
  validity_days: number;
  price: string;
  currency: string;
  pack_code: string;
  status: string;
  invoice_id: string | null;
  order_no: string;
}

interface PurchaseRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  pack_id: string;
  pack_code: string;
  pack_name: string;
  metric_key: string;
  amount: string;
  validity_days: number;
  price: string;
  currency: string;
  order_no: string;
  status: "pending_payment" | "completed" | "cancelled";
  payment_ttl_minutes: number | null;
  invoice_id: string | null;
  bill_no: string | null;
  quota_pool_id: string | null;
  activated_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  payment_declared: boolean;
  created_at: Date;
}

const PURCHASE_SELECT = `
  select ap.id, ap.tenant_id, ap.workspace_id, ap.pack_id, ap.pack_code,
         ap.pack_name, ap.metric_key, ap.amount::text as amount,
         ap.validity_days, ap.price::text as price, ap.currency,
         ap.order_no, ap.status, ap.payment_ttl_minutes, ap.invoice_id,
         inv.bill_no, ap.quota_pool_id, ap.activated_at, ap.cancelled_at,
         ap.cancel_reason, ap.created_at,
         exists (select 1 from billing.payments p
                  where p.bill_id = ap.invoice_id
                    and p.pay_status = 'pending_verify') as payment_declared
    from metering.addon_purchases ap
    left join billing.invoices inv on inv.id = ap.invoice_id`;

function mapPurchase(r: PurchaseRow): AddonPurchaseRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    workspaceId: r.workspace_id,
    packId: r.pack_id,
    packCode: r.pack_code,
    packName: r.pack_name,
    metricKey: r.metric_key,
    amount: r.amount,
    validityDays: r.validity_days,
    price: r.price,
    currency: r.currency,
    orderNo: r.order_no,
    status: r.status,
    paymentTtlMinutes: r.payment_ttl_minutes,
    invoiceId: r.invoice_id,
    billNo: r.bill_no,
    quotaPoolId: r.quota_pool_id,
    activatedAt: r.activated_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    paymentDeclared: r.payment_declared,
    createdAt: r.created_at,
  };
}

// 可视码：{PREFIX}-{YYYYMM}-{10位}，与 pg-subscription visibleCode() 同规（唯一约束兜底防重）。
function visibleCode(prefix: string): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `${prefix}-${ym}-${suffix}`;
}
