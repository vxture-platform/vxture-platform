/**
 * pg-order.repository.ts — 订单实体（billing.orders）数据访问（product_330 P1-b2）
 * @package @vxture/service-subscription
 *
 * 订单阶段的一切写入都锁 billing.orders 行（不再借订阅行当订单）：下单、申报、收款、
 * 履约、取消、恢复、超时、自愈。账单经 invoices.order_id 关联；事件写 billing.order_events。
 * 对订阅行的改动只有"履约条款"（applySubscriptionTerms）——它由 OrderService 在订阅服务
 * 完成版本切换 / 建行 / 续期之后调用，把周期、实付、current_order_id 落到订阅上。
 */
import { randomUUID } from "node:crypto";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import type {
  CreateOrderInput,
  CreateOrderResult,
  OrderActor,
  OrderActorType,
  OrderEventRecord,
  OrderIntent,
  OrderInvoice,
  OrderRecord,
  OrderStatus,
  RefundPolicy,
  RefundRecordView,
} from "../types/order.types";

interface OrderRow {
  id: string;
  order_no: string;
  tenant_id: string;
  workspace_id: string;
  product_id: string;
  plan_version_id: string;
  intent: string;
  cycle_unit: string;
  cycle_count: number;
  from_subscription_id: string | null;
  subscription_id: string | null;
  list_amount: string;
  credit_amount: string;
  payable_amount: string;
  leftover_amount: string;
  currency: string;
  proration: Record<string, unknown> | null;
  status: string;
  payment_ttl_minutes: number | null;
  declared_at: Date | null;
  paid_at: Date | null;
  fulfilled_at: Date | null;
  closed_at: Date | null;
  close_reason: string | null;
  created_by_type: string;
  created_by_id: string | null;
  operator_remark: string | null;
  created_at: Date;
  updated_at: Date;
}

interface AutoRenewCandidateRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  product_id: string;
  plan_version_id: string;
  cycle_unit: string;
  cycle_count: number;
  end_at: Date;
  status: string;
  subscription_kind: string;
  created_by_id: string | null;
  currency: string | null;
  plan_name: string;
  price: string | null;
}

interface RefundRow {
  id: string;
  tenant_id: string;
  order_id: string | null;
  refund_no: string;
  refund_amount: string;
  currency: string | null;
  refund_reason: string | null;
  audit_status: string;
  audit_remark: string | null;
  audit_at: Date | null;
  refund_status: string;
  refund_at: Date | null;
  created_at: Date;
}

function mapRefund(r: RefundRow): RefundRecordView {
  return {
    id: r.id,
    refundNo: r.refund_no,
    orderId: r.order_id ?? "",
    amount: r.refund_amount,
    currency: r.currency ?? "CNY",
    reason: r.refund_reason,
    auditStatus: r.audit_status as RefundRecordView["auditStatus"],
    auditRemark: r.audit_remark,
    refundStatus: r.refund_status as RefundRecordView["refundStatus"],
    requestedAt: r.created_at,
    auditedAt: r.audit_at,
    refundedAt: r.refund_at,
  };
}

/** 退款判定输入（product_330 §5）。 */
export interface RefundBasis {
  /** 同工作区×产品、履约时间更早的已履约/已退款订单数（>0 = 不是首次购买） */
  earlierFulfilledCount: number;
  /** 消耗性配额已用比 [0,1]（无池 0） */
  usageRatio: number;
  payRecordId: string | null;
  invoiceId: string | null;
  /** 未被驳回/失败的既有退款单 */
  existingRefundId: string | null;
}

/** 折抵三输入（product_330 §4.1）。 */
export interface ProrationBasis {
  paidAmount: number;
  startAt: Date;
  endAt: Date | null;
  /** 主组件 quota._pricing.consumable_share；未配置 null → 默认值 */
  consumableShare: number | null;
  /** 消耗性池剩余比 [0,1]；null = 没有消耗性池 */
  usageRemainingRatio: number | null;
}

export interface AutoRenewCandidate {
  subscriptionId: string;
  tenantId: string;
  workspaceId: string;
  productId: string;
  planVersionId: string;
  cycleUnit: string;
  cycleCount: number;
  endAt: Date;
  status: string;
  kind: string;
  createdById: string | null;
  currency: string;
  planName: string;
  /** 同周期价目（NUMERIC 字符串）；null = 无价目，不能自动续 */
  price: string | null;
}

interface InvoiceRow {
  id: string;
  bill_no: string;
  bill_status: string;
  total_amount: string;
  payable_amount: string;
  paid_amount: string;
  currency: string;
}

interface EventRow {
  id: string;
  order_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_type: string;
  actor_id: string | null;
  remark: string | null;
  client_ip: string | null;
  created_at: Date;
}

/** 可视码 {PREFIX}-{YYYYMM}-{10位}（与 admin billingCode 同规；唯一约束兜底）。 */
function visibleCode(prefix: string): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `${prefix}-${ym}-${suffix}`;
}

const OPEN_STATUSES: readonly OrderStatus[] = [
  "pending_payment",
  "pending_verify",
  "paid",
];

@Injectable()
export class PgOrderRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  async getById(id: string): Promise<OrderRecord | null> {
    const res = await this.pool.query<OrderRow>(
      `select * from billing.orders where id = $1 limit 1`,
      [id],
    );
    const row = res.rows[0];
    return row ? this.mapOrder(row) : null;
  }

  async getByOrderNo(orderNo: string): Promise<OrderRecord | null> {
    const res = await this.pool.query<OrderRow>(
      `select * from billing.orders where order_no = $1 limit 1`,
      [orderNo],
    );
    const row = res.rows[0];
    return row ? this.mapOrder(row) : null;
  }

  /** 同工作区同产品的在途订单（pending_payment / pending_verify / paid）。 */
  async findOpenOrderForProduct(
    workspaceId: string,
    productCode: string,
  ): Promise<OrderRecord | null> {
    const res = await this.pool.query<OrderRow>(
      `select o.* from billing.orders o
         join product.products p on p.id = o.product_id
        where o.workspace_id = $1 and p.product_code = $2
          and o.status = any($3::text[])
        order by o.created_at desc limit 1`,
      [workspaceId, productCode, [...OPEN_STATUSES]],
    );
    const row = res.rows[0];
    return row ? this.mapOrder(row) : null;
  }

  /**
   * 下单（product_330 §3）：orders(pending_payment) + invoices(unpaid, order_id) +
   * invoice_items(subscription_fee) + order_events(created)，一个事务。**不建订阅行。**
   * 在途订单部分唯一索引撞上 → 409。
   */
  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const orderNo = visibleCode("ORD");
      const billNo = visibleCode("INV");
      const currency = input.currency ?? "CNY";
      const createdByType: OrderActorType = input.createdByType ?? "customer";
      // 升级折抵（P2-a）：标价 → 折抵 → 应付 / 溢出；无折抵时 应付 = 标价。
      const credit = input.proration?.credit ?? 0;
      const payable = input.proration?.payable ?? input.price;
      const leftover = input.proration?.leftover ?? 0;
      const creditApplied =
        Math.round(Math.min(credit, input.price) * 100) / 100;

      let orderRow: OrderRow;
      try {
        const res = await client.query<OrderRow>(
          `insert into billing.orders (
             order_no, tenant_id, workspace_id, product_id, plan_version_id, intent,
             cycle_unit, cycle_count, from_subscription_id,
             list_amount, credit_amount, payable_amount, leftover_amount, currency, proration,
             status, payment_ttl_minutes, created_by_type, created_by_id, created_at, updated_at
           ) values (
             $1, $2, $3,
             (select pc.product_id from product.plan_components pc
               where pc.plan_version_id = $4 and pc.component_role = 'primary'
               order by pc.priority asc, pc.sort_order asc limit 1),
             $4, $5, $6, 1, $7,
             $8, $13, $14, $15, $9, $16::jsonb,
             'pending_payment', $10, $12, $11, now(), now()
           ) returning *`,
          [
            orderNo,
            input.tenantId,
            input.workspaceId,
            input.planVersionId,
            input.intent,
            input.cycleUnit,
            input.intent === "new" ? null : (input.fromSubscriptionId ?? null),
            input.price,
            currency,
            input.paymentTtlMinutes ?? null,
            input.createdBy,
            createdByType,
            credit,
            payable,
            leftover,
            input.proration ? JSON.stringify(input.proration.snapshot) : null,
          ],
        );
        orderRow = res.rows[0]!;
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new ConflictException({
            code: "PENDING_ORDER_EXISTS",
            message: "该工作区在此产品上已有在途订单，请先完成付款或取消该订单",
          });
        }
        if ((err as { code?: string }).code === "23502") {
          // product_id 子查询为空：套餐版本没有主组件
          throw new ConflictException("套餐版本缺少主组件产品，无法下单");
        }
        throw err;
      }

      const invoice = await client.query<{ id: string }>(
        `insert into billing.invoices (
           tenant_id, bill_no, subscription_id, order_id, bill_cycle,
           cycle_start_date, cycle_end_date,
           total_amount, payable_amount, paid_amount, currency,
           bill_status, bill_type, created_by_type, created_by_id, operate_remark,
           created_at, updated_at
         ) values (
           $1, $2, $3, $4, to_char(now(), 'YYYYMM'),
           now()::date, (now() + ('1 ' || $5)::interval)::date,
           $6, $6, 0, $7,
           'unpaid', 'normal', $10, $8, $9,
           now(), now()
         ) returning id`,
        [
          input.tenantId,
          billNo,
          orderRow.from_subscription_id,
          orderRow.id,
          input.cycleUnit,
          payable,
          currency,
          input.createdBy,
          JSON.stringify({ intent: input.intent, order_no: orderNo }),
          createdByType,
        ],
      );
      const invoiceId = invoice.rows[0]!.id;

      // 折抵负行（credit_adjustment）：账单总额 = 标价 + (−折抵) = 应付；不用 discount 类型，
      // 券的预留 / 释放 / 驳回回滚只动 discount 行，折抵行不受影响。
      if (creditApplied > 0) {
        await client.query(
          `insert into billing.invoice_items (
             bill_id, tenant_id, workspace_id, subscription_id,
             item_name, item_type, quantity, unit_price, total_amount, remark, created_at, updated_at
           ) values ($1, $2, $3, $4, '升级折抵', 'credit_adjustment', 1, $5, $5, $6, now(), now())`,
          [
            invoiceId,
            input.tenantId,
            input.workspaceId,
            orderRow.from_subscription_id,
            -creditApplied,
            `product_330 §4.1 proration of ${orderRow.from_subscription_id}`,
          ],
        );
      }

      await client.query(
        `insert into billing.invoice_items (
           bill_id, tenant_id, workspace_id, subscription_id,
           item_name, item_type, quantity, unit_price, total_amount, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, 'subscription_fee', 1, $6, $6, now(), now())`,
        [
          invoiceId,
          input.tenantId,
          input.workspaceId,
          orderRow.from_subscription_id,
          input.itemName,
          input.price,
        ],
      );

      await this.insertEventTx(client, {
        orderId: orderRow.id,
        eventType: "created",
        fromStatus: null,
        toStatus: "pending_payment",
        actorType: createdByType,
        actorId: input.createdBy,
        remark: JSON.stringify({ intent: input.intent, price: input.price }),
      });

      await client.query("commit");
      return { order: this.mapOrder(orderRow), invoiceId, billNo };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 申报事务：锁 orders 行 FOR UPDATE → 锁最新账单（order_id）FOR UPDATE，把两者交给编排；
   * resolve commit、throw rollback。锁序：订单 → 账单 → 券（§7 规则 1）。
   */
  async withOrderTx<T>(
    orderId: string,
    fn: (ctx: {
      client: PoolClient;
      order: OrderRecord;
      invoice: OrderInvoice | null;
    }) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const res = await client.query<OrderRow>(
        `select * from billing.orders where id = $1 for update`,
        [orderId],
      );
      const row = res.rows[0];
      if (!row) throw new ConflictException("订单不存在");
      const invoice = await this.lockInvoiceTx(client, orderId);
      const out = await fn({ client, order: this.mapOrder(row), invoice });
      await client.query("commit");
      return out;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async lockInvoiceTx(
    client: PoolClient,
    orderId: string,
  ): Promise<OrderInvoice | null> {
    const res = await client.query<InvoiceRow>(
      `select id, bill_no, bill_status, total_amount, payable_amount, paid_amount, currency
         from billing.invoices
        where order_id = $1 and deleted_at is null
        order by created_at desc limit 1
        for update`,
      [orderId],
    );
    const inv = res.rows[0];
    return inv
      ? {
          id: inv.id,
          billNo: inv.bill_no,
          billStatus: inv.bill_status,
          totalAmount: inv.total_amount,
          payableAmount: inv.payable_amount,
          paidAmount: inv.paid_amount,
          currency: inv.currency,
        }
      : null;
  }

  async markDeclaredTx(client: PoolClient, orderId: string): Promise<void> {
    await client.query(
      `update billing.orders
          set status = 'pending_verify', declared_at = now(), updated_at = now()
        where id = $1 and status = 'pending_payment'`,
      [orderId],
    );
  }

  async markPaidTx(
    client: PoolClient,
    orderId: string,
    paidAt: Date | null = null,
  ): Promise<void> {
    await client.query(
      `update billing.orders
          set status = 'paid', paid_at = coalesce($2, paid_at, now()), updated_at = now()
        where id = $1 and status in ('pending_payment', 'pending_verify')`,
      [orderId, paidAt],
    );
  }

  async markRejectedTx(client: PoolClient, orderId: string): Promise<void> {
    await client.query(
      `update billing.orders
          set status = 'pending_payment', declared_at = null, updated_at = now()
        where id = $1 and status = 'pending_verify'`,
      [orderId],
    );
  }

  /** CAS paid → fulfilled；返回是否本次翻转（false = 已履约或不在 paid）。 */
  async markFulfilled(
    orderId: string,
    subscriptionId: string,
    actor: OrderActor,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const res = await client.query<{ id: string }>(
        `update billing.orders
            set status = 'fulfilled', subscription_id = $2,
                fulfilled_at = now(), closed_at = null, close_reason = null, updated_at = now()
          where id = $1 and status = 'paid'
          returning id`,
        [orderId, subscriptionId],
      );
      const flipped = Boolean(res.rows[0]);
      if (flipped) {
        await this.insertEventTx(client, {
          orderId,
          eventType: "fulfilled",
          fromStatus: "paid",
          toStatus: "fulfilled",
          actorType: actor.actorType,
          actorId: actor.actorId,
          remark: actor.remark ?? `subscription ${subscriptionId}`,
          clientIp: actor.clientIp ?? null,
        });
      }
      await client.query("commit");
      return flipped;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 自动续费候选（product_330 P2-c）：auto_renew 开、在用族、非试用、end_at 落在 leadDays 内，
   * 同产品没有在途订单，且 leadDays 窗口内没为它开过续订单（避免关单后反复重开）。
   * 带同周期价目（缺价目 = 自定义/企业档 → 调用方跳过并记日志）与套餐名。
   */
  async findAutoRenewCandidates(
    leadDays: number,
    limit: number,
  ): Promise<AutoRenewCandidate[]> {
    const res = await this.pool.query<AutoRenewCandidateRow>(
      `select s.id, s.tenant_id, s.workspace_id, s.product_id, s.plan_version_id,
              s.cycle_unit, s.cycle_count, s.end_at, s.status, s.subscription_kind,
              s.created_by_id, s.currency,
              pl.plan_name,
              pp.price::text as price
         from metering.subscriptions s
         join product.plan_versions pv on pv.id = s.plan_version_id
         join product.plans pl on pl.id = pv.plan_id
         left join product.plan_prices pp
           on pp.plan_version_id = s.plan_version_id
          and pp.cycle_unit = s.cycle_unit and pp.cycle_count = s.cycle_count
          and pp.currency = coalesce(s.currency, 'CNY')
        where s.auto_renew = true
          and s.deleted_at is null
          and s.subscription_kind <> 'trial'
          and s.status in ('active', 'expiring', 'overdue')
          and s.cycle_unit <> 'perpetual'
          and s.end_at is not null
          and s.end_at <= now() + make_interval(days => $1)
          and s.product_id is not null
          and not exists (
            select 1 from billing.orders o
             where o.workspace_id = s.workspace_id and o.product_id = s.product_id
               and o.status in ('pending_payment', 'pending_verify', 'paid')
          )
          and not exists (
            select 1 from billing.orders o
             where o.from_subscription_id = s.id and o.intent = 'renew'
               and o.created_at > now() - make_interval(days => $1)
          )
        order by s.end_at asc
        limit $2`,
      [leadDays, limit],
    );
    return res.rows.map((r) => ({
      subscriptionId: r.id,
      tenantId: r.tenant_id,
      workspaceId: r.workspace_id,
      productId: r.product_id,
      planVersionId: r.plan_version_id,
      cycleUnit: r.cycle_unit,
      cycleCount: r.cycle_count,
      endAt: r.end_at,
      status: r.status,
      kind: r.subscription_kind,
      createdById: r.created_by_id,
      currency: r.currency ?? "CNY",
      planName: r.plan_name,
      price: r.price,
    }));
  }

  /** 已收款（¥0 即时结清）：在订单事务内把账单记 paid、订单翻 paid。 */
  async settleZeroOrderTx(
    client: PoolClient,
    order: OrderRecord,
    invoiceId: string,
    actor: OrderActor,
  ): Promise<void> {
    await client.query(
      `update billing.invoices
          set bill_status = 'paid', paid_at = now(), payment_method = 'voucher', updated_at = now()
        where id = $1 and bill_status in ('unpaid', 'partial')`,
      [invoiceId],
    );
    await this.markPaidTx(client, order.id);
    await this.insertEventTx(client, {
      orderId: order.id,
      eventType: "payment_confirmed",
      fromStatus: order.status,
      toStatus: "paid",
      actorType: actor.actorType,
      actorId: actor.actorId,
      remark: actor.remark ?? "zero-amount order settled",
      clientIp: actor.clientIp ?? null,
    });
  }

  /**
   * 升级折抵的三个输入（product_330 §4.1）：原订阅本周期实付、周期起止、消耗性池剩余比
   * （消耗性 = 产品 pool 型 metric 或平台 counter 型；按额度加权）、主组件 consumable_share。
   */
  async getProrationBasis(
    subscriptionId: string,
  ): Promise<ProrationBasis | null> {
    const res = await this.pool.query<{
      paid_amount: string | null;
      pay_amount: string | null;
      start_at: Date;
      end_at: Date | null;
      consumable_share: string | null;
      pool_limit: string | null;
      pool_remaining: string | null;
    }>(
      `select s.paid_amount, s.pay_amount, s.start_at, s.end_at,
              pc.quota #>> '{_pricing,consumable_share}' as consumable_share,
              pools.pool_limit, pools.pool_remaining
         from metering.subscriptions s
         left join lateral (
           select quota from product.plan_components
            where plan_version_id = s.plan_version_id and component_role = 'primary'
            order by priority asc, sort_order asc limit 1
         ) pc on true
         left join lateral (
           select sum(qp.quota_limit)::text as pool_limit,
                  sum(greatest(0, qp.quota_limit - qp.quota_used))::text as pool_remaining
             from metering.quota_pools qp
            where qp.subscription_id = s.id and qp.status = 'active'
              and qp.pool_source = 'subscription' and qp.quota_limit > 0
              and (
                exists (select 1 from product.product_metrics pm
                         where pm.product_id = qp.product_id and pm.metric_key = qp.metric_key
                           and pm.merge_strategy = 'pool')
                or exists (select 1 from product.platform_metrics plm
                            where plm.metric_key = qp.metric_key and plm.kind = 'counter')
              )
         ) pools on true
        where s.id = $1 and s.deleted_at is null`,
      [subscriptionId],
    );
    const r = res.rows[0];
    if (!r) return null;
    const limit = Number(r.pool_limit ?? 0);
    return {
      paidAmount: Number(r.paid_amount ?? r.pay_amount ?? 0),
      startAt: r.start_at,
      endAt: r.end_at,
      consumableShare:
        r.consumable_share !== null &&
        Number.isFinite(Number(r.consumable_share))
          ? Number(r.consumable_share)
          : null,
      usageRemainingRatio:
        limit > 0 ? Number(r.pool_remaining ?? 0) / limit : null,
    };
  }

  /**
   * 折抵溢出进预付款余额（product_330 §4.1 leftover）：credits 池 += leftover + grant 流水；
   * 以 transactions.related_no = order_no 幂等（履约重跑不重复入账）。
   */
  async grantLeftoverToPrepaid(
    order: OrderRecord,
    actor: OrderActor,
  ): Promise<boolean> {
    const leftover = Number(order.leftoverAmount);
    if (!(leftover > 0)) return false;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const dup = await client.query(
        `select 1 from billing.transactions
          where related_no = $1 and trade_type = 'grant' limit 1`,
        [order.orderNo],
      );
      if (dup.rows[0]) {
        await client.query("rollback");
        return false;
      }
      const pool = await client.query<{ balance: string }>(
        `insert into billing.credits (tenant_id, currency, balance, total_granted, version, created_at, updated_at)
         values ($1, $2, $3, $3, 1, now(), now())
         on conflict (tenant_id) do update set
           balance = billing.credits.balance + excluded.balance,
           total_granted = billing.credits.total_granted + excluded.total_granted,
           version = billing.credits.version + 1,
           updated_at = now()
         returning balance`,
        [order.tenantId, order.currency, leftover],
      );
      const after = Number(pool.rows[0]!.balance);
      await client.query(
        `insert into billing.transactions (
           tenant_id, bill_id, transaction_no, trade_type, source_method,
           amount, currency, balance_before, balance_after, trade_status,
           related_no, remark, actor_type, actor_id
         ) values ($1, null, $2, 'grant', null, $3, $4, $5, $6, 'success', $7, $8, $9, $10)`,
        [
          order.tenantId,
          visibleCode("TXN"),
          leftover,
          order.currency,
          Math.round((after - leftover) * 100) / 100,
          after,
          order.orderNo,
          `upgrade proration leftover (order ${order.orderNo})`,
          actor.actorType,
          actor.actorId,
        ],
      );
      await client.query("commit");
      return true;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  // ── 退款（product_330 §5）────────────────────────────────────────────────────

  /** 平台参数：refund.window_hours（int，默认 24）/ refund.max_usage_ratio（默认 0.10）。 */
  async getRefundPolicy(): Promise<RefundPolicy> {
    const res = await this.pool.query<{
      config_key: string;
      config_value: string;
    }>(
      `select config_key, config_value from admin.settings
        where config_key in ('refund.window_hours', 'refund.max_usage_ratio')`,
    );
    const map = new Map(res.rows.map((r) => [r.config_key, r.config_value]));
    const hours = Number(map.get("refund.window_hours"));
    const ratio = Number(map.get("refund.max_usage_ratio"));
    return {
      windowHours: Number.isFinite(hours) && hours > 0 ? hours : 24,
      maxUsageRatio: Number.isFinite(ratio) && ratio >= 0 ? ratio : 0.1,
    };
  }

  /**
   * 退款判定的三输入 + 落单所需引用：是否该工作区×产品的首笔已履约订单、消耗性配额已用比、
   * 已付现金腿（退款单 pay_record_id NOT NULL）、账单、既有退款单。
   */
  async getRefundBasis(orderId: string): Promise<RefundBasis | null> {
    const res = await this.pool.query<{
      earlier_fulfilled: string;
      usage_used: string | null;
      usage_limit: string | null;
      pay_record_id: string | null;
      invoice_id: string | null;
      existing_refund: string | null;
    }>(
      `select
         (select count(*) from billing.orders p
           where p.workspace_id = o.workspace_id and p.product_id = o.product_id
             and p.status in ('fulfilled', 'refunded') and p.id <> o.id
             and p.fulfilled_at < o.fulfilled_at)::text as earlier_fulfilled,
         pools.usage_used, pools.usage_limit,
         (select p.id from billing.payments p
           join billing.invoices i on i.id = p.bill_id
          where i.order_id = o.id and p.pay_status = 'paid'
          order by (p.pay_source = 'voucher') asc, p.paid_at desc nulls last limit 1) as pay_record_id,
         (select i.id from billing.invoices i
           where i.order_id = o.id and i.deleted_at is null
           order by i.created_at desc limit 1) as invoice_id,
         (select r.id from billing.refunds r
           where r.order_id = o.id
             and not (r.audit_status = 'rejected' or r.refund_status = 'failed')
           order by r.created_at desc limit 1) as existing_refund
       from billing.orders o
       left join lateral (
         select sum(qp.quota_used)::text as usage_used, sum(qp.quota_limit)::text as usage_limit
           from metering.quota_pools qp
          where qp.subscription_id = o.subscription_id and qp.status = 'active'
            and qp.pool_source = 'subscription' and qp.quota_limit > 0
            and (
              exists (select 1 from product.product_metrics pm
                       where pm.product_id = qp.product_id and pm.metric_key = qp.metric_key
                         and pm.merge_strategy = 'pool')
              or exists (select 1 from product.platform_metrics plm
                          where plm.metric_key = qp.metric_key and plm.kind = 'counter')
            )
       ) pools on true
       where o.id = $1`,
      [orderId],
    );
    const r = res.rows[0];
    if (!r) return null;
    const limit = Number(r.usage_limit ?? 0);
    return {
      earlierFulfilledCount: Number(r.earlier_fulfilled),
      usageRatio: limit > 0 ? Number(r.usage_used ?? 0) / limit : 0,
      payRecordId: r.pay_record_id,
      invoiceId: r.invoice_id,
      existingRefundId: r.existing_refund,
    };
  }

  async getRefundByOrder(orderId: string): Promise<RefundRecordView | null> {
    const res = await this.pool.query<RefundRow>(
      `select * from billing.refunds where order_id = $1 order by created_at desc limit 1`,
      [orderId],
    );
    const row = res.rows[0];
    return row ? mapRefund(row) : null;
  }

  async getRefundById(refundId: string): Promise<RefundRecordView | null> {
    const res = await this.pool.query<RefundRow>(
      `select * from billing.refunds where id = $1 limit 1`,
      [refundId],
    );
    const row = res.rows[0];
    return row ? mapRefund(row) : null;
  }

  /** 客户申请：refunds(pending/pending) + order_events(refund_requested)，一个事务。 */
  async createRefundRequest(input: {
    order: OrderRecord;
    invoiceId: string;
    payRecordId: string;
    reason: string | null;
    userId: string;
    clientIp?: string | null;
  }): Promise<RefundRecordView> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const res = await client.query<RefundRow>(
        `insert into billing.refunds (
           tenant_id, bill_id, pay_record_id, order_id, refund_no,
           refund_amount, currency, refund_reason, refund_type,
           audit_status, refund_status, created_by_type, created_by_id, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'normal',
                   'pending', 'pending', 'customer', $9, now(), now())
         returning *`,
        [
          input.order.tenantId,
          input.invoiceId,
          input.payRecordId,
          input.order.id,
          visibleCode("RFD"),
          input.order.payableAmount,
          input.order.currency,
          input.reason,
          input.userId,
        ],
      );
      await this.insertEventTx(client, {
        orderId: input.order.id,
        eventType: "refund_requested",
        fromStatus: input.order.status,
        toStatus: input.order.status,
        actorType: "customer",
        actorId: input.userId,
        remark: input.reason,
        clientIp: input.clientIp ?? null,
      });
      await client.query("commit");
      return mapRefund(res.rows[0]!);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /** 运营审核：approved / rejected + order_events。 */
  async auditRefund(input: {
    refund: RefundRecordView;
    order: OrderRecord;
    decision: "approved" | "rejected";
    remark: string;
    operatorId: string;
    clientIp?: string | null;
  }): Promise<RefundRecordView> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const res = await client.query<RefundRow>(
        `update billing.refunds
            set audit_status = $2, audit_remark = $3, auditor_id = $4, audit_at = now(), updated_at = now()
          where id = $1 and audit_status = 'pending'
          returning *`,
        [input.refund.id, input.decision, input.remark, input.operatorId],
      );
      const row = res.rows[0];
      if (!row) throw new ConflictException("退款申请不是待审核状态");
      await this.insertEventTx(client, {
        orderId: input.order.id,
        eventType:
          input.decision === "approved" ? "refund_approved" : "refund_rejected",
        fromStatus: input.order.status,
        toStatus: input.order.status,
        actorType: "operator",
        actorId: input.operatorId,
        remark: input.remark,
        clientIp: input.clientIp ?? null,
      });
      await client.query("commit");
      return mapRefund(row);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 退款执行（运营已按原渠道打款后）：refunds → success + 冲正流水（trade_type=refund，
   * 预付池不动、快照 before=after）+ 折抵溢出回冲（credits −= leftover，adjust 流水）
   * + orders → refunded + order_events。订阅回滚由服务层随后经 SubscriptionService 做。
   */
  async executeRefund(input: {
    refund: RefundRecordView;
    order: OrderRecord;
    actor: OrderActor;
  }): Promise<{ refund: RefundRecordView; order: OrderRecord }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const lock = await client.query<OrderRow>(
        `select * from billing.orders where id = $1 for update`,
        [input.order.id],
      );
      const ord = lock.rows[0];
      if (!ord) throw new ConflictException("订单不存在");
      if (ord.status !== "fulfilled") {
        throw new ConflictException("只有已履约的订单可以退款");
      }
      const amount = Number(input.refund.amount);
      const pool = await client.query<{ balance: string }>(
        `select balance from billing.credits where tenant_id = $1`,
        [ord.tenant_id],
      );
      const balance = Number(pool.rows[0]?.balance ?? 0);
      const txn = await client.query<{ id: string }>(
        `insert into billing.transactions (
           tenant_id, bill_id, transaction_no, trade_type, source_method,
           amount, currency, balance_before, balance_after, trade_status,
           related_no, remark, actor_type, actor_id, client_ip
         ) values ($1, $2, $3, 'refund', null, $4, $5, $6, $6, 'success', $7, $8, $9, $10, $11)
         returning id`,
        [
          ord.tenant_id,
          null,
          visibleCode("TXN"),
          -amount,
          ord.currency,
          balance,
          input.refund.refundNo,
          `refund of order ${ord.order_no}`,
          input.actor.actorType,
          input.actor.actorId,
          input.actor.clientIp ?? null,
        ],
      );
      const leftover = Number(ord.leftover_amount);
      if (leftover > 0) {
        // 折抵溢出当初进了预付池，退款把它冲回（余额可为负——运营对账处理）。
        const after = await client.query<{ balance: string }>(
          `update billing.credits
              set balance = balance - $2, version = version + 1, updated_at = now()
            where tenant_id = $1
            returning balance`,
          [ord.tenant_id, leftover],
        );
        const bal = Number(after.rows[0]?.balance ?? balance - leftover);
        await client.query(
          `insert into billing.transactions (
             tenant_id, bill_id, transaction_no, trade_type, source_method,
             amount, currency, balance_before, balance_after, trade_status,
             related_no, remark, actor_type, actor_id
           ) values ($1, null, $2, 'adjust', null, $3, $4, $5, $6, 'success', $7, $8, $9, $10)`,
          [
            ord.tenant_id,
            visibleCode("TXN"),
            -leftover,
            ord.currency,
            bal + leftover,
            bal,
            input.refund.refundNo,
            `reverse upgrade proration leftover (order ${ord.order_no})`,
            input.actor.actorType,
            input.actor.actorId,
          ],
        );
      }
      const refundRow = await client.query<RefundRow>(
        `update billing.refunds
            set refund_status = 'success', refund_at = now(), transaction_id = $2, updated_at = now()
          where id = $1 and audit_status = 'approved' and refund_status in ('pending', 'processing')
          returning *`,
        [input.refund.id, txn.rows[0]!.id],
      );
      const refund = refundRow.rows[0];
      if (!refund) throw new ConflictException("退款单不是已审核待执行状态");
      const updated = await client.query<OrderRow>(
        `update billing.orders
            set status = 'refunded', closed_at = now(), close_reason = 'refunded', updated_at = now()
          where id = $1 returning *`,
        [ord.id],
      );
      await this.insertEventTx(client, {
        orderId: ord.id,
        eventType: "refunded",
        fromStatus: "fulfilled",
        toStatus: "refunded",
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        remark: input.actor.remark ?? `refund ${refund.refund_no}`,
        clientIp: input.actor.clientIp ?? null,
      });
      await client.query("commit");
      return {
        refund: mapRefund(refund),
        order: this.mapOrder(updated.rows[0]!),
      };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async listRefunds(
    status?: "pending" | "approved" | "rejected",
  ): Promise<(RefundRecordView & { orderNo: string; tenantId: string })[]> {
    const res = await this.pool.query<RefundRow & { order_no: string }>(
      `select r.*, o.order_no from billing.refunds r
         join billing.orders o on o.id = r.order_id
        where ($1::text is null or r.audit_status = $1)
        order by r.created_at desc limit 200`,
      [status ?? null],
    );
    return res.rows.map((r) => ({
      ...mapRefund(r),
      orderNo: r.order_no,
      tenantId: r.tenant_id,
    }));
  }

  /**
   * 履约条款落到订阅（product_330 §4）：
   *  - new     ：paid_amount / current_order_id（行本身由 SubscriptionService.createSubscription 建）
   *  - upgrade ：cycle 取订单、start=now、end=now+周期、pay/paid_amount=订单实付、current_order_id；周期池重锚
   *  - renew   ：cycle 取订单、pay/paid_amount、current_order_id（end 已由服务层延长）
   */
  async applySubscriptionTerms(
    subscriptionId: string,
    terms: {
      mode: OrderIntent;
      cycleUnit: string;
      cycleCount: number;
      payAmount: string;
      orderId: string;
    },
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (terms.mode === "upgrade") {
        // 周期区间单独传参（同一 $n 既当列值又当拼接字符串会让 pg 推不出类型）。
        await client.query(
          `update metering.subscriptions
              set cycle_unit = $2, cycle_count = $3,
                  start_at = now(),
                  end_at = now() + $6::interval,
                  pay_amount = $4, paid_amount = $4,
                  current_order_id = $5, updated_at = now()
            where id = $1 and deleted_at is null`,
          [
            subscriptionId,
            terms.cycleUnit,
            terms.cycleCount,
            terms.payAmount,
            terms.orderId,
            `${terms.cycleCount} ${terms.cycleUnit}`,
          ],
        );
        await this.reanchorPeriodicPoolsTx(client, subscriptionId);
      } else if (terms.mode === "renew") {
        await client.query(
          `update metering.subscriptions
              set cycle_unit = $2, cycle_count = $3,
                  pay_amount = $4, paid_amount = $4,
                  current_order_id = $5, updated_at = now()
            where id = $1 and deleted_at is null`,
          [
            subscriptionId,
            terms.cycleUnit,
            terms.cycleCount,
            terms.payAmount,
            terms.orderId,
          ],
        );
        // 续订 = 新周期（product_330 P2-c）：按周期发放的消耗性池（reset_period='none'、
        // pool_source='subscription'）归零重发——归零走 quota_pool_resets 审计（与月度归零同款，
        // 保 quota_used 可重建）；周期池（day/month）重锚到 now。
        await client.query(
          `insert into metering.quota_pool_resets (pool_id, period_start, used_before_reset, reset_at)
           select id, coalesce(current_period_start, period_anchor, effective_at), quota_used, now()
             from metering.quota_pools
            where subscription_id = $1 and status = 'active'
              and pool_source = 'subscription' and reset_period = 'none' and quota_used > 0`,
          [subscriptionId],
        );
        await client.query(
          `update metering.quota_pools
              set quota_used = 0, effective_at = now(), updated_at = now()
            where subscription_id = $1 and status = 'active'
              and pool_source = 'subscription' and reset_period = 'none' and quota_used > 0`,
          [subscriptionId],
        );
        await this.reanchorPeriodicPoolsTx(client, subscriptionId);
      } else {
        await client.query(
          `update metering.subscriptions
              set paid_amount = $2, current_order_id = $3, updated_at = now()
            where id = $1 and deleted_at is null`,
          [subscriptionId, terms.payAmount, terms.orderId],
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
   * 关闭未付订单（客户取消 / 运营作废 / TTL 过期）：账单 cancelled、折扣行软删、订单
   * cancelled|expired。已有实收或在途申报腿 → 409（先驳回申报 / 走结算）。
   */
  async cancelOrder(
    orderId: string,
    actor: OrderActor,
    kind: "cancelled" | "expired",
  ): Promise<OrderRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const res = await client.query<OrderRow>(
        `select * from billing.orders where id = $1 for update`,
        [orderId],
      );
      const row = res.rows[0];
      if (!row) throw new ConflictException("订单不存在");
      if (row.status !== "pending_payment" && row.status !== "pending_verify") {
        throw new ConflictException("订单不是待付款状态，不能取消");
      }
      const invoice = await this.lockInvoiceTx(client, orderId);
      if (
        invoice &&
        (invoice.billStatus === "paid" || Number(invoice.paidAmount) > 0)
      ) {
        throw new ConflictException("订单已收到支付，不能取消（请走结算流程）");
      }
      if (invoice) {
        const leg = await client.query(
          `select 1 from billing.payments
            where bill_id = $1 and pay_status = 'pending_verify' limit 1`,
          [invoice.id],
        );
        if (leg.rows[0]) {
          throw new ConflictException(
            "订单已申报付款、等待确认中，不能取消（请先由运营驳回申报）",
          );
        }
        await client.query(
          `update billing.invoice_items set deleted_at = now(), updated_at = now()
            where bill_id = $1 and item_type = 'discount' and deleted_at is null`,
          [invoice.id],
        );
        await client.query(
          `update billing.invoices set bill_status = 'cancelled', updated_at = now() where id = $1`,
          [invoice.id],
        );
      }
      const closeReason =
        kind === "expired"
          ? "ttl_expired"
          : actor.actorType === "customer"
            ? "customer_cancel"
            : "operator_void";
      const updated = await client.query<OrderRow>(
        `update billing.orders
            set status = $2, closed_at = now(), close_reason = $3, updated_at = now()
          where id = $1 returning *`,
        [orderId, kind, closeReason],
      );
      await this.insertEventTx(client, {
        orderId,
        eventType: kind === "expired" ? "order_expired" : "cancelled",
        fromStatus: row.status,
        toStatus: kind,
        actorType: actor.actorType,
        actorId: actor.actorId,
        remark: actor.remark ?? null,
        clientIp: actor.clientIp ?? null,
      });
      await client.query("commit");
      return this.mapOrder(updated.rows[0]!);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /** 恢复被作废 / 过期的未付订单 → pending_payment（有实收不可恢复）。 */
  async restoreOrder(orderId: string, actor: OrderActor): Promise<OrderRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const res = await client.query<OrderRow>(
        `select * from billing.orders where id = $1 for update`,
        [orderId],
      );
      const row = res.rows[0];
      if (!row) throw new ConflictException("订单不存在");
      if (row.status !== "cancelled" && row.status !== "expired") {
        throw new ConflictException("订单不是可恢复的已关闭状态");
      }
      const invoice = await this.lockInvoiceTx(client, orderId);
      if (invoice && Number(invoice.paidAmount) > 0) {
        throw new ConflictException("订单已有支付记录，不能恢复");
      }
      if (invoice) {
        await client.query(
          `update billing.invoice_items set deleted_at = null, updated_at = now()
            where bill_id = $1 and item_type = 'discount' and deleted_at is not null`,
          [invoice.id],
        );
        await client.query(
          `update billing.invoices set bill_status = 'unpaid', updated_at = now() where id = $1`,
          [invoice.id],
        );
      }
      // 在途订单唯一索引：同产品又有了新的在途单 → 23505 → 409
      let updated: OrderRow;
      try {
        const upd = await client.query<OrderRow>(
          `update billing.orders
              set status = 'pending_payment', closed_at = null, close_reason = null, updated_at = now()
            where id = $1 returning *`,
          [orderId],
        );
        updated = upd.rows[0]!;
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new ConflictException(
            "该工作区在此产品上已有另一张在途订单，不能恢复本单",
          );
        }
        throw err;
      }
      await this.insertEventTx(client, {
        orderId,
        eventType: "restored",
        fromStatus: row.status,
        toStatus: "pending_payment",
        actorType: actor.actorType,
        actorId: actor.actorId,
        remark: actor.remark ?? null,
        clientIp: actor.clientIp ?? null,
      });
      await client.query("commit");
      return this.mapOrder(updated);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 超时候选（P4 全守卫）：pending_payment、零实收、无在途申报腿、
   * greatest(created_at, 最近一次 payment_rejected 事件) + TTL ≤ now。
   */
  async findExpiredIds(
    fallbackTtlMinutes: number,
    limit: number,
  ): Promise<string[]> {
    const res = await this.pool.query<{ id: string }>(
      `select o.id
         from billing.orders o
         left join lateral (
           select id, paid_amount from billing.invoices i
            where i.order_id = o.id and i.deleted_at is null
            order by i.created_at desc limit 1
         ) inv on true
        where o.status = 'pending_payment'
          and coalesce(inv.paid_amount, 0) = 0
          and not exists (
            select 1 from billing.payments p
             where p.bill_id = inv.id and p.pay_status = 'pending_verify'
          )
          and greatest(
            o.created_at,
            coalesce((select max(e.created_at) from billing.order_events e
                       where e.order_id = o.id and e.event_type = 'payment_rejected'), o.created_at)
          ) + make_interval(mins => coalesce(o.payment_ttl_minutes, $1)) <= now()
        order by o.created_at asc
        limit $2`,
      [fallbackTtlMinutes, limit],
    );
    return res.rows.map((r) => r.id);
  }

  /** 已收款未履约（paid 停留超过 minAge 分钟）→ reconcile 候选。 */
  async findHungPaidIds(
    minAgeMinutes: number,
    limit: number,
  ): Promise<string[]> {
    const res = await this.pool.query<{ id: string }>(
      `select o.id from billing.orders o
        where o.status = 'paid'
          and coalesce(o.paid_at, o.updated_at) + make_interval(mins => $1) <= now()
        order by o.created_at asc
        limit $2`,
      [minAgeMinutes, limit],
    );
    return res.rows.map((r) => r.id);
  }

  async insertEventTx(
    client: PoolClient,
    input: {
      orderId: string;
      eventType: string;
      fromStatus: string | null;
      toStatus: string | null;
      actorType: OrderActorType;
      actorId: string | null;
      remark?: string | null;
      clientIp?: string | null;
    },
  ): Promise<void> {
    await client.query(
      `insert into billing.order_events (
         order_id, event_type, from_status, to_status, actor_type, actor_id, remark, client_ip, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [
        input.orderId,
        input.eventType,
        input.fromStatus,
        input.toStatus,
        input.actorType,
        input.actorId,
        input.remark ?? null,
        input.clientIp ?? null,
      ],
    );
  }

  async insertEvent(
    input: Parameters<PgOrderRepository["insertEventTx"]>[1],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.insertEventTx(client, input);
    } finally {
      client.release();
    }
  }

  async listEvents(orderId: string, limit = 200): Promise<OrderEventRecord[]> {
    const res = await this.pool.query<EventRow>(
      `select * from billing.order_events where order_id = $1
        order by created_at desc limit $2`,
      [orderId, limit],
    );
    return res.rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      eventType: r.event_type,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      actorType: r.actor_type,
      actorId: r.actor_id,
      remark: r.remark,
      clientIp: r.client_ip,
      createdAt: r.created_at,
    }));
  }

  async latestRejectReason(orderId: string): Promise<string | null> {
    const res = await this.pool.query<{ remark: string | null }>(
      `select remark from billing.order_events
        where order_id = $1 and event_type = 'payment_rejected'
        order by created_at desc limit 1`,
      [orderId],
    );
    return res.rows[0]?.remark ?? null;
  }

  /** 新周期起点：周期池（day/month）锚点与当前期起点都拨到 now（升级 / 续订共用）。 */
  private async reanchorPeriodicPoolsTx(
    client: PoolClient,
    subscriptionId: string,
  ): Promise<void> {
    await client.query(
      `update metering.quota_pools
          set period_anchor = now(), current_period_start = now(), updated_at = now()
        where subscription_id = $1 and status = 'active' and reset_period <> 'none'`,
      [subscriptionId],
    );
  }

  private mapOrder(row: OrderRow): OrderRecord {
    return {
      id: row.id,
      orderNo: row.order_no,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      productId: row.product_id,
      planVersionId: row.plan_version_id,
      intent: row.intent as OrderIntent,
      cycleUnit: row.cycle_unit,
      cycleCount: row.cycle_count,
      fromSubscriptionId: row.from_subscription_id,
      subscriptionId: row.subscription_id,
      listAmount: row.list_amount,
      creditAmount: row.credit_amount,
      payableAmount: row.payable_amount,
      leftoverAmount: row.leftover_amount,
      currency: row.currency,
      proration: row.proration,
      status: row.status as OrderStatus,
      paymentTtlMinutes: row.payment_ttl_minutes,
      declaredAt: row.declared_at,
      paidAt: row.paid_at,
      fulfilledAt: row.fulfilled_at,
      closedAt: row.closed_at,
      closeReason: row.close_reason,
      createdByType: row.created_by_type as OrderActorType,
      createdById: row.created_by_id,
      operatorRemark: row.operator_remark,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
