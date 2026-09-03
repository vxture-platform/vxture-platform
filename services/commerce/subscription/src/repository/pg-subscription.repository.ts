import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import type {
  SubscriptionRecord,
  SubscriptionHistoryRecord,
  ListSubscriptionsParams,
  ListSubscriptionsResult,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
} from "../types/subscription.types";

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  plan_version_id: string;
  cycle_unit: string;
  cycle_count: number;
  start_at: Date;
  end_at: Date | null;
  trial_end_at: Date | null;
  status: string;
  subscription_kind: string;
  activation_method: string;
  auto_renew: boolean;
  pay_amount: string | null;
  currency: string;
  created_by_id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface HistoryRow {
  id: string;
  tenant_id: string;
  subscription_id: string;
  change_type: string;
  from_plan_version_id: string | null;
  to_plan_version_id: string | null;
  from_status: string | null;
  to_status: string | null;
  actor_type: string;
  actor_id: string | null;
  remark: string | null;
  client_ip: string | null;
  created_at: Date;
}

@Injectable()
export class PgSubscriptionRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  async listSubscriptions(
    params: ListSubscriptionsParams,
  ): Promise<ListSubscriptionsResult> {
    const conditions: string[] = ["deleted_at is null"];
    const values: unknown[] = [];
    let idx = 1;

    if (params.tenantId) {
      conditions.push(`tenant_id = $${idx++}`);
      values.push(params.tenantId);
    }
    if (params.workspaceId) {
      conditions.push(`workspace_id = $${idx++}`);
      values.push(params.workspaceId);
    }
    if (params.planVersionId) {
      conditions.push(`plan_version_id = $${idx++}`);
      values.push(params.planVersionId);
    }
    if (params.status) {
      conditions.push(`status = $${idx++}`);
      values.push(params.status);
    }
    if (params.cycleType) {
      conditions.push(`cycle_unit = $${idx++}`);
      values.push(params.cycleType);
    }

    const where = conditions.join(" and ");
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const [countResult, rowsResult] = await Promise.all([
      this.pool.query<{ count: string }>(
        `select count(*) as count from metering.subscriptions where ${where}`,
        values,
      ),
      this.pool.query<SubscriptionRow>(
        `select * from metering.subscriptions where ${where}
         order by created_at desc limit $${idx} offset $${idx + 1}`,
        [...values, pageSize, offset],
      ),
    ]);

    return {
      total: parseInt(countResult.rows[0]?.count ?? "0", 10),
      items: rowsResult.rows.map(this.mapSubscription),
    };
  }

  async getById(id: string): Promise<SubscriptionRecord | null> {
    const result = await this.pool.query<SubscriptionRow>(
      `select * from metering.subscriptions where id = $1 and deleted_at is null limit 1`,
      [id],
    );
    const row = result.rows[0];
    return row ? this.mapSubscription(row) : null;
  }

  /** Latest active subscription for a workspace (the cost center that holds subscriptions). */
  async getActiveByWorkspaceId(
    workspaceId: string,
  ): Promise<SubscriptionRecord | null> {
    const result = await this.pool.query<SubscriptionRow>(
      `select * from metering.subscriptions
       where workspace_id = $1 and status = 'active' and deleted_at is null
       order by created_at desc limit 1`,
      [workspaceId],
    );
    const row = result.rows[0];
    return row ? this.mapSubscription(row) : null;
  }

  async create(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      const status = input.status ?? "active";
      const subscriptionKind = input.subscriptionKind ?? "paid";
      const activationMethod = input.activationMethod ?? "online_purchase";
      const createdByType = input.createdByType ?? "customer";
      const cycleCount = input.cycleCount ?? 1;

      const result = await client.query<SubscriptionRow>(
        `insert into metering.subscriptions (
          tenant_id, workspace_id, plan_version_id, subscription_kind, cycle_unit, cycle_count,
          start_at, end_at, trial_end_at,
          status, activation_method, auto_renew, pay_amount, currency,
          created_by_type, created_by_id, created_at, updated_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), now()
        ) returning *`,
        [
          input.tenantId,
          input.workspaceId,
          input.planVersionId,
          subscriptionKind,
          input.cycleType,
          cycleCount,
          input.startAt,
          input.endAt ?? null,
          input.trialEndAt ?? null,
          status,
          activationMethod,
          input.autoRenew ?? true,
          input.payAmount ?? null,
          input.currency ?? "CNY",
          createdByType,
          input.createdBy,
        ],
      );

      const subscription = result.rows[0]!;
      await this.materializeQuotaPools(
        client,
        subscription.id,
        subscription.workspace_id,
        subscription.plan_version_id,
      );

      await client.query(
        `insert into metering.subscription_histories (
          tenant_id, subscription_id, change_type,
          to_plan_version_id, to_status, actor_type, actor_id, created_at
        ) values ($1, $2, 'created', $3, $4, $5, $6, now())`,
        [
          input.tenantId,
          subscription.id,
          input.planVersionId,
          status,
          createdByType,
          input.createdBy,
        ],
      );

      await client.query("commit");
      return this.mapSubscription(subscription);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async update(
    id: string,
    subscription: SubscriptionRecord,
    input: UpdateSubscriptionInput,
  ): Promise<SubscriptionRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      const result = await client.query<SubscriptionRow>(
        // new DDL drops updated_by (change trail lives in subscription_histories);
        // input.updatedBy is no longer persisted here (see risk_notes).
        // expectedStatus (D10): optional CAS guard — 0 rows when the current
        // status no longer matches, instead of clobbering a concurrent write.
        `update metering.subscriptions set
          status          = coalesce($2, status),
          end_at          = coalesce($3, end_at),
          auto_renew      = coalesce($4, auto_renew),
          -- DDL 契约:auto_renew=false 时 next_renewal_at 必须为 NULL(50_metering
          -- §1 注释)。该列当前无写入方,这里按契约顺手清,免留债(2026-08-21)。
          next_renewal_at = case when $4::boolean is false then null else next_renewal_at end,
          plan_version_id = coalesce($5, plan_version_id),
          updated_at      = now()
         where id = $1 and deleted_at is null
           and ($6::text is null or status = $6)
         returning *`,
        [
          id,
          input.status ?? null,
          input.endAt ?? null,
          input.autoRenew ?? null,
          input.toPlanVersionId ?? null,
          input.expectedStatus ?? null,
        ],
      );

      const updated = result.rows[0];
      if (!updated) {
        await client.query("rollback");
        return null;
      }

      // Version switch (renewal/upgrade): retire this subscription's active pools
      // and re-materialize for the new version. The subscription id is preserved,
      // so subscription_entitlement_override rows survive ("override 续订保留").
      if (input.toPlanVersionId) {
        await client.query(
          `update metering.quota_pools set status = 'retired', retired_at = now(), updated_at = now()
            where subscription_id = $1 and status = 'active'`,
          [id],
        );
        await this.materializeQuotaPools(
          client,
          id,
          updated.workspace_id,
          input.toPlanVersionId,
        );
      }

      const changeType = input.toPlanVersionId
        ? "plan_changed"
        : input.status === "cancelled"
          ? "cancelled"
          : input.status === "suspended"
            ? "suspended"
            : input.status === "active"
              ? "resumed"
              : input.status === "expired"
                ? "expired"
                : // 纯续费开关翻转要在历史里可辨(到期不续/恢复续费,2026-08-21
                  // P0 自助线),不淹没在杂项 'updated' 里。change_type 值域开放。
                  input.autoRenew !== undefined
                  ? input.autoRenew
                    ? "auto_renew_on"
                    : "auto_renew_off"
                  : "updated";

      await client.query(
        `insert into metering.subscription_histories (
          tenant_id, subscription_id, change_type,
          from_plan_version_id, to_plan_version_id, from_status, to_status,
          actor_type, actor_id, remark, client_ip, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
        [
          subscription.tenantId,
          id,
          changeType,
          subscription.planVersionId,
          input.toPlanVersionId ?? subscription.planVersionId,
          subscription.status,
          input.status ?? subscription.status,
          input.operatorType ?? "operator",
          input.operatorId ?? null,
          input.operatorRemark ?? null,
          input.clientIp ?? null,
        ],
      );

      await client.query("commit");
      return this.mapSubscription(updated);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async getHistory(
    subscriptionId: string,
  ): Promise<SubscriptionHistoryRecord[]> {
    const result = await this.pool.query<HistoryRow>(
      `select * from metering.subscription_histories
       where subscription_id = $1
       order by created_at desc`,
      [subscriptionId],
    );
    return result.rows.map(this.mapHistory);
  }

  /**
   * Products bundled by a plan_version (one row per plan_component), with the
   * owning plan_code — the provisioning wire fans events out per product.
   */
  async listVersionProducts(planVersionId: string): Promise<
    {
      productId: string;
      productCode: string;
      planCode: string;
    }[]
  > {
    const result = await this.pool.query<{
      product_id: string;
      product_code: string;
      plan_code: string;
    }>(
      `select pc.product_id, prod.product_code, p.plan_code
       from product.plan_components pc
       join product.products prod on prod.id = pc.product_id
       join product.plan_versions pv on pv.id = pc.plan_version_id
       join product.plans p on p.id = pv.plan_id
       where pc.plan_version_id = $1`,
      [planVersionId],
    );
    return result.rows.map((r) => ({
      productId: r.product_id,
      productCode: r.product_code,
      planCode: r.plan_code,
    }));
  }

  /**
   * True when another active/trialing subscription of this workspace still
   * bundles the product — deprovisioning is per-component fallout (§11.4):
   * a product only deprovisions once its LAST covering subscription lapses.
   */
  async hasOtherActiveCoverage(
    workspaceId: string,
    productId: string,
    excludeSubscriptionId: string,
  ): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `select exists (
         select 1 from metering.subscriptions ts
         join product.plan_components pc on pc.plan_version_id = ts.plan_version_id
         where ts.workspace_id = $1
           and pc.product_id = $2
           and ts.id <> $3
           and ts.status in ('active', 'trialing')
           and ts.deleted_at is null
       ) as exists`,
      [workspaceId, productId, excludeSubscriptionId],
    );
    return result.rows[0]?.exists ?? false;
  }

  /**
   * Tier-conflict probe for the D12 stacking invariant (arda reply-07 §3,
   * owner ruling 2026-07-14): one product must never be covered by several
   * live subscriptions at DIFFERENT tiers — an upgrade modifies the original
   * row, stacking is a misconfiguration. Compares the target plan_version's
   * primary components against every other live subscription's primary
   * component for the same product; same-tier concurrency stays legal
   * (bundled components carry tier NULL and are out of scope by role).
   */
  async findTierConflicts(
    workspaceId: string,
    planVersionId: string,
    excludeSubscriptionId?: string,
  ): Promise<{ productCode: string; newTier: string; existingTier: string }[]> {
    const result = await this.pool.query<{
      product_code: string;
      new_tier: string;
      existing_tier: string;
    }>(
      `select distinct prod.product_code,
              pc_new.tier as new_tier,
              pc_old.tier as existing_tier
         from product.plan_components pc_new
         join product.products prod on prod.id = pc_new.product_id
         join product.plan_components pc_old
           on pc_old.product_id = pc_new.product_id
          and pc_old.component_role = 'primary'
         join metering.subscriptions ts
           on ts.plan_version_id = pc_old.plan_version_id
        where pc_new.plan_version_id = $2
          and pc_new.component_role = 'primary'
          and ts.workspace_id = $1
          and ts.status in ('active', 'trialing')
          and ts.deleted_at is null
          and ($3::uuid is null or ts.id <> $3)
          and pc_old.tier is distinct from pc_new.tier`,
      [workspaceId, planVersionId, excludeSubscriptionId ?? null],
    );
    return result.rows.map((r) => ({
      productCode: r.product_code,
      newTier: r.new_tier,
      existingTier: r.existing_tier,
    }));
  }

  /**
   * Lapsed never-paid trials awaiting the expiry sweep (product_310 D10):
   * kind='trial' rows whose trial window closed while still 'trialing'.
   * Scoped to subscription_kind='trial' on purpose — a future kind='paid'
   * row in 'trialing' (trial-then-charge) belongs to the renewal/payment
   * engine, not this sweep. Ordered oldest-first so a bounded pass drains
   * the backlog deterministically.
   */
  /**
   * 到期扫描候选（product_330 P2-c）：非试用、在用族（active/expiring/overdue）、end_at 已过。
   * 返回当前状态供 CAS（expectedStatus）。自动续费在同一作业里先跑：续上的行 end_at 已后移，
   * 自然不在此列；没续上的（付费单未付 / 无价目）到期即 expired，付款后履约再复活。
   */
  async findExpiredSubscriptionIds(
    limit: number,
  ): Promise<{ id: string; status: string }[]> {
    const result = await this.pool.query<{ id: string; status: string }>(
      `select id, status from metering.subscriptions
        where subscription_kind <> 'trial'
          and status in ('active', 'expiring', 'overdue')
          and end_at is not null
          and end_at <= now()
          and deleted_at is null
        order by end_at asc
        limit $1`,
      [limit],
    );
    return result.rows;
  }

  /**
   * 到期前提醒候选（P2-g）：自动续费关着、在用非试用、end_at 落在 (now, now + leadDays] 的订阅，
   * 带展示名。去重不在这里（dispatcher 按订阅 × 到期日唯一），所以窗口内每趟都会返回同一批行。
   */
  async findExpiringSoon(
    leadDays: number,
    limit: number,
  ): Promise<
    {
      id: string;
      tenantId: string;
      endAt: Date;
      productName: string;
      planName: string;
    }[]
  > {
    const result = await this.pool.query<{
      id: string;
      tenant_id: string;
      end_at: Date;
      product_name: string | null;
      plan_name: string | null;
    }>(
      `select s.id, s.tenant_id, s.end_at, pl.plan_name, pr.product_name
         from metering.subscriptions s
         join product.plan_versions pv on pv.id = s.plan_version_id
         join product.plans pl on pl.id = pv.plan_id
         left join product.products pr on pr.id = s.product_id
        where s.auto_renew = false
          and s.deleted_at is null
          and s.subscription_kind <> 'trial'
          and s.status in ('active', 'expiring', 'overdue')
          and s.cycle_unit <> 'perpetual'
          and s.end_at is not null
          and s.end_at > now()
          and s.end_at <= now() + make_interval(days => $1)
        order by s.end_at asc
        limit $2`,
      [leadDays, limit],
    );
    return result.rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      endAt: r.end_at,
      productName: r.product_name ?? "—",
      planName: r.plan_name ?? "—",
    }));
  }

  /** 通知展示用：订阅的租户 / 产品名 / 套餐名 / 到期（P2-g）。 */
  async getNotifyDisplay(id: string): Promise<{
    tenantId: string;
    endAt: Date | null;
    productName: string;
    planName: string;
  } | null> {
    const result = await this.pool.query<{
      tenant_id: string;
      end_at: Date | null;
      product_name: string | null;
      plan_name: string | null;
    }>(
      `select s.tenant_id, s.end_at, pl.plan_name, pr.product_name
         from metering.subscriptions s
         join product.plan_versions pv on pv.id = s.plan_version_id
         join product.plans pl on pl.id = pv.plan_id
         left join product.products pr on pr.id = s.product_id
        where s.id = $1`,
      [id],
    );
    const r = result.rows[0];
    if (!r) return null;
    return {
      tenantId: r.tenant_id,
      endAt: r.end_at,
      productName: r.product_name ?? "—",
      planName: r.plan_name ?? "—",
    };
  }

  async findLapsedTrialIds(limit: number): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `select id from metering.subscriptions
        where subscription_kind = 'trial'
          and status = 'trialing'
          and trial_end_at is not null
          and trial_end_at <= now()
          and deleted_at is null
        order by trial_end_at asc
        limit $1`,
      [limit],
    );
    return result.rows.map((r) => r.id);
  }

  // ── payment declaration tx-core (product_321 P8/§5.2) ─────────────────────
  // The declare orchestration lives in OrderService (it interleaves promotion
  // reserve + pure settlement math between these writes); the order row lock
  // and transaction boundary are PgOrderRepository.withOrderTx — these are the
  // client-scoped billing primitives it calls inside that tx.

  /** In-flight declared cash leg of an invoice (pending_verify), if any. */
  async findPendingVerifyLegTx(
    client: PoolClient,
    invoiceId: string,
  ): Promise<{ id: string; totalAmount: string } | null> {
    const res = await client.query<{ id: string; total_amount: string }>(
      `select id, total_amount from billing.payments
        where bill_id = $1 and pay_status = 'pending_verify'
        order by created_at desc limit 1`,
      [invoiceId],
    );
    const row = res.rows[0];
    return row ? { id: row.id, totalAmount: row.total_amount } : null;
  }

  /**
   * Defensive pricing reset (P8 declare precondition): soft-delete residual
   * live discount rows. Returns how many were cleaned (0 on the happy path).
   */
  async softDeleteDiscountItemsTx(
    client: PoolClient,
    invoiceId: string,
  ): Promise<number> {
    const res = await client.query(
      `update billing.invoice_items set deleted_at = now(), updated_at = now()
        where bill_id = $1 and item_type = 'discount' and deleted_at is null`,
      [invoiceId],
    );
    return res.rowCount ?? 0;
  }

  /** Insert the discount-voucher negative line (P7 pricing layer). */
  async insertDiscountItemTx(
    client: PoolClient,
    input: {
      invoiceId: string;
      tenantId: string;
      workspaceId: string;
      /** P1-b2：订单阶段没有订阅行 → null（invoice_items.subscription_id 可空）。 */
      subscriptionId: string | null;
      itemName: string;
      /** Negative NUMERIC(12,2) yuan string, e.g. "-240.00". */
      amountYuan: string;
    },
  ): Promise<string> {
    const res = await client.query<{ id: string }>(
      `insert into billing.invoice_items (
         bill_id, tenant_id, workspace_id, subscription_id,
         item_name, item_type, quantity, unit_price, total_amount,
         created_at, updated_at
       ) values ($1, $2, $3, $4, $5, 'discount', 1, $6, $6, now(), now())
       returning id`,
      [
        input.invoiceId,
        input.tenantId,
        input.workspaceId,
        input.subscriptionId,
        input.itemName,
        input.amountYuan,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error("discount item insert returned no row");
    return row.id;
  }

  /**
   * Recompute the invoice money columns from live items (§5.3 formula:
   * total = Σ undeleted items, payable = total, discount_amount = |Σ discount
   * rows| mirror). Returns the recomputed figures.
   */
  async recomputeInvoiceTx(
    client: PoolClient,
    invoiceId: string,
  ): Promise<{ totalAmount: string; payableAmount: string }> {
    const res = await client.query<{
      total_amount: string;
      payable_amount: string;
    }>(
      `update billing.invoices i set
         total_amount = agg.total,
         payable_amount = agg.total,
         discount_amount = agg.discount_off,
         updated_at = now()
        from (
          select coalesce(sum(total_amount), 0) as total,
                 coalesce(abs(sum(total_amount) filter (where item_type = 'discount')), 0) as discount_off
            from billing.invoice_items
           where bill_id = $1 and deleted_at is null
        ) agg
       where i.id = $1
       returning i.total_amount, i.payable_amount`,
      [invoiceId],
    );
    const row = res.rows[0];
    if (!row) throw new Error(`invoice ${invoiceId} recompute matched no row`);
    return { totalAmount: row.total_amount, payableAmount: row.payable_amount };
  }

  /**
   * Insert the customer's declared cash leg (pending_verify, P1). The
   * settlement credential lands in channel_raw_data (P10).
   */
  async insertCashLegTx(
    client: PoolClient,
    input: {
      tenantId: string;
      invoiceId: string;
      /** 'alipay' | 'bank' (DDL pay_channel vocabulary — mapped by service). */
      payChannel: string;
      offlinePayType: string | null;
      payerName: string | null;
      transactionNo: string | null;
      remark: string | null;
      /** NUMERIC(12,2) yuan string. */
      amountYuan: string;
      currency: string;
      credential: Record<string, unknown>;
      actorId: string;
    },
  ): Promise<string> {
    const res = await client.query<{ id: string }>(
      `insert into billing.payments (
         tenant_id, bill_id, pay_order_no, pay_source, pay_channel,
         offline_pay_type, offline_payer_name, channel_transaction_no,
         total_amount, paid_amount, currency, pay_status,
         channel_raw_data, actor_type, actor_id, operate_remark,
         created_at, updated_at
       ) values (
         $1, $2, $3, 'offline', $4, $5, $6, $7, $8, 0, $9,
         'pending_verify', $10, 'customer', $11, $12, now(), now()
       ) returning id`,
      [
        input.tenantId,
        input.invoiceId,
        visibleCode("PAY"),
        input.payChannel,
        input.offlinePayType,
        input.payerName,
        input.transactionNo,
        input.amountYuan,
        input.currency,
        JSON.stringify(input.credential),
        input.actorId,
        input.remark,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error("cash leg insert returned no row");
    return row.id;
  }

  /**
   * cashDue=0 settlement (P8): insert the paid voucher leg (when a credit
   * voucher participates) and clear the invoice in one shot. Cash never moves.
   */
  async settleInvoiceByVouchersTx(
    client: PoolClient,
    input: {
      tenantId: string;
      invoiceId: string;
      /** NUMERIC(12,2) yuan of the credit-voucher leg; "0.00" = none. */
      voucherLegYuan: string;
      currency: string;
      actorId: string;
    },
  ): Promise<{ voucherLegId: string | null }> {
    let voucherLegId: string | null = null;
    if (Number(input.voucherLegYuan) > 0) {
      const leg = await client.query<{ id: string }>(
        `insert into billing.payments (
           tenant_id, bill_id, pay_order_no, pay_source,
           total_amount, paid_amount, currency, pay_status, paid_at,
           actor_type, actor_id, created_at, updated_at
         ) values ($1, $2, $3, 'voucher', $4, $4, $5, 'paid', now(),
                   'customer', $6, now(), now())
         returning id`,
        [
          input.tenantId,
          input.invoiceId,
          visibleCode("PAY"),
          input.voucherLegYuan,
          input.currency,
          input.actorId,
        ],
      );
      voucherLegId = leg.rows[0]?.id ?? null;
    }
    await client.query(
      `update billing.invoices set
         paid_amount = paid_amount + $2,
         bill_status = 'paid',
         paid_at = now(),
         payment_method = 'voucher',
         updated_at = now()
       where id = $1`,
      [input.invoiceId, input.voucherLegYuan],
    );
    return { voucherLegId };
  }

  /**
   * Materialize quota_pool rows for a subscription from its plan_version's components
   * (§8.3): for each enabled plan_component, one quota_pool per pool-type product_metric,
   * limit taken from plan_component.quota[metric_key]. reset_period is projected
   * from product_metrics.reset_period; periodic pools anchor at the subscription
   * start (chk_quota_pools_period_anchor requires anchor+current for non-none).
   */
  private async materializeQuotaPools(
    client: PoolClient,
    subscriptionId: string,
    workspaceId: string,
    planVersionId: string,
  ): Promise<void> {
    // NOTE(task-4): new product.plan_components has no `enabled` column (the old
    // enabled=true filter is dropped — every component of the version materializes).
    // Periodic pools project product_metrics.reset_period and anchor at the
    // subscription's start_at; 'none' pools keep NULL anchors.
    // Product-scoped pool metrics + L0 platform-metric contributions (quota
    // keys owned by product.platform_metrics, product_220 §4) in one pass.
    await client.query(
      `insert into metering.quota_pools (
         workspace_id, subscription_id, product_id, metric_key, quota_limit, quota_used,
         priority, component_role, pool_source, reset_period,
         period_anchor, current_period_start, status,
         effective_at, created_at, updated_at
       )
       select $2, $1, pc.product_id, m.metric_key,
              coalesce((pc.quota ->> m.metric_key)::bigint, 0), 0,
              pc.priority, pc.component_role, 'subscription', m.reset_period,
              case when m.reset_period <> 'none' then s.start_at end,
              case when m.reset_period <> 'none' then s.start_at end,
              'active', now(), now(), now()
         from product.plan_components pc
         join metering.subscriptions s on s.id = $1
         join lateral (
           select pm.metric_key, pm.reset_period
             from product.product_metrics pm
            where pm.product_id = pc.product_id and pm.merge_strategy = 'pool'
           union all
           select plm.metric_key, plm.reset_period
             from product.platform_metrics plm
            where plm.status = 'active' and pc.quota ? plm.metric_key
         ) m on true
        where pc.plan_version_id = $3`,
      [subscriptionId, workspaceId, planVersionId],
    );

    // Default ai.credit sharing participation (owner 2026-08-20): every product
    // whose plan contributes ai.credit joins the workspace sharing policy at
    // materialization. The engine's safe default stays all-reserved (empty
    // policy = no cross-product flow, product_220 §4.3) — this only SEEDS
    // policy DATA, so a tenant admin can later remove rows to opt a product
    // out. ON CONFLICT keeps re-materialization (renew/upgrade) idempotent;
    // note a removed row does reappear if that same product re-materializes —
    // acceptable until the tenant policy UI lands (backlog).
    await client.query(
      `insert into metering.resource_sharing_policies
         (workspace_id, tenant_id, metric_key, product_id, created_by_type, created_at)
       select $2, s.tenant_id, 'ai.credit', pc.product_id, 'system', now()
         from product.plan_components pc
         join metering.subscriptions s on s.id = $1
        where pc.plan_version_id = $3
          and (pc.quota ? 'ai.credit')
       on conflict (workspace_id, metric_key, product_id) do nothing`,
      [subscriptionId, workspaceId, planVersionId],
    );
  }

  /**
   * WS base storage pools (product_220 §4.4 target model, owner 2026-08-20):
   * every live workspace gets one `ws_base` storage.bytes pool — the default
   * grant that exists independent of any product subscription. Idempotent
   * two-step, driven by the platform-api sweep job (self-heals backfill AND
   * new workspaces, no provisioning-time hook in the identity domain):
   *   1. insert the pool where a workspace has NO ws_base storage pool of any
   *      status (retired ones count — an operator retirement must stick);
   *   2. reconcile ACTIVE base pools to the currently configured base bytes
   *      (the grant is platform policy, not a per-workspace number — raising
   *      the default raises everyone; per-workspace extras are addon/override
   *      pools, never edits to the base pool).
   * Gauge pools never enter consume, so priority is display-only here.
   */
  async ensureWorkspaceStorageBasePools(
    baseBytes: string,
  ): Promise<{ created: number; reconciled: number }> {
    const created = await this.pool.query(
      `insert into metering.quota_pools (
         workspace_id, subscription_id, product_id, metric_key, quota_limit, quota_used,
         priority, component_role, pool_source, reset_period, status,
         grant_reason, effective_at, created_at, updated_at
       )
       select w.id, null, null, 'storage.bytes', $1::bigint, 0,
              50, 'primary', 'ws_base', 'none', 'active',
              'workspace base storage (platform default)', now(), now(), now()
         from tenancy.workspaces w
        where w.deleted_at is null
          and w.status = 'active'
          and not exists (
                select 1 from metering.quota_pools qp
                 where qp.workspace_id = w.id
                   and qp.pool_source = 'ws_base'
                   and qp.metric_key = 'storage.bytes')`,
      [baseBytes],
    );
    const reconciled = await this.pool.query(
      `update metering.quota_pools
          set quota_limit = $1::bigint, updated_at = now()
        where pool_source = 'ws_base'
          and metric_key = 'storage.bytes'
          and status = 'active'
          and quota_limit <> $1::bigint`,
      [baseBytes],
    );
    return {
      created: created.rowCount ?? 0,
      reconciled: reconciled.rowCount ?? 0,
    };
  }

  private mapSubscription(row: SubscriptionRow): SubscriptionRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      planVersionId: row.plan_version_id,
      cycleType: row.cycle_unit,
      cycleCount: row.cycle_count,
      startAt: row.start_at,
      endAt: row.end_at,
      trialEndAt: row.trial_end_at,
      status: row.status,
      subscriptionKind: row.subscription_kind,
      activationMethod: row.activation_method,
      autoRenew: row.auto_renew,
      payAmount: row.pay_amount,
      currency: row.currency,
      createdBy: row.created_by_id,
      updatedBy: null, // new DDL has no updated_by column (trail in subscription_histories)
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  private mapHistory(row: HistoryRow): SubscriptionHistoryRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      subscriptionId: row.subscription_id,
      changeType: row.change_type,
      fromPlanVersionId: row.from_plan_version_id,
      toPlanVersionId: row.to_plan_version_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      operatorType: row.actor_type,
      operatorId: row.actor_id,
      operatorRemark: row.remark,
      clientIp: row.client_ip,
      createdAt: row.created_at,
    };
  }
}

// 可视码：{PREFIX}-{YYYYMM}-{10位}，与 admin-bff billingCode() 同规（唯一约束兜底防重）。
function visibleCode(prefix: string): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `${prefix}-${ym}-${suffix}`;
}
