/**
 * order-payment-e2e.itest.spec.ts - product_321 §8 验收走查（活库集成，product_330 P1-b2 订单实体版）。
 * @package @vxture/bff-admin
 *
 * Run:  ORDER_PAYMENT_E2E=1 DATABASE_URL=postgresql://... pnpm test
 *
 * 覆盖 §8 中可在活库/服务/路由层执行的机制项（1-2,3 部分,4-7,9-14 部分）：
 * 真 Postgres、真事务、真行锁——服务与路由按 module-less 方式装配（与
 * commerce-services.provider / orders-write-paths.spec 同款），跳过 HTTP 层的
 * session/step-up 仪式（那两项 + webhook 送达 arda + 浏览器动线 = 生产走查项）。
 *
 * P1-b2 起：下单只建 billing.orders（不建订阅行），履约（fulfill）才建订阅；
 * 订单态看 billing.orders.status，订单事件看 billing.order_events。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { Pool } from "pg";
import type { Request } from "express";
import {
  OrderService,
  PgOrderRepository,
  PgSubscriptionRepository,
  SubscriptionService,
} from "@vxture/service-subscription";
import {
  PgPromotionRepository,
  PromotionService,
} from "@vxture/service-promotion";
import {
  PgProvisioningRepository,
  ProvisioningService,
} from "@vxture/service-provisioning";
import {
  NotificationDispatcher,
  broadcastAnnouncements,
} from "@vxture/service-notification";
import { OrdersRouter } from "./orders.router";
import { PaymentsRouter } from "./payments.router";
import { CommercialRouter } from "./commercial.router";
import type { RequestContext } from "../types/console.types";

const RUN = process.env.ORDER_PAYMENT_E2E === "1";
const DB =
  process.env.DATABASE_URL ??
  "postgresql://postgres:e2e@localhost:55432/vxture";

const OPERATOR = "11111111-1111-4111-8111-111111111111";

function req(capabilities: string[]): Request & RequestContext {
  return {
    user: { id: OPERATOR },
    capabilities,
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

const CAPS_SETTLE = ["commerce:order.read", "commerce:payment.settle"];
const CAPS_PROMO = ["promotion:campaign.manage"];

describe.runIf(RUN)("product_321 §8 e2e (live DB)", () => {
  let pool: Pool;
  let orderService: OrderService;
  let subscriptionsService: SubscriptionService;
  let promotion: PromotionService;
  let orders: OrdersRouter;
  let payments: PaymentsRouter;
  let commercial: CommercialRouter;

  let userId: string;
  let tenantId: string;
  let planVersionId: string;
  let customerNotifier: NotificationDispatcher;

  const CONFIRM = (paidAmount: number) => ({
    paidAmount,
    offlinePayType: "bank_transfer" as const,
    payerName: "E2E Walkthrough Co",
    paidAt: new Date().toISOString(),
    reason: "e2e walkthrough settle",
  });

  /** 每单独立工作空间：一个 (workspace × product) 只允许一张在途单。 */
  async function mkWorkspace(): Promise<string> {
    const ws = await pool.query<{ id: string }>(
      `insert into tenancy.workspaces (tenant_id, name, is_default)
       values ($1, $2, false) returning id`,
      [tenantId, `e2e-${Date.now()}-${Math.random().toFixed(6)}`],
    );
    return ws.rows[0]!.id;
  }

  async function mkOrder(price = 1200, autoRenew?: boolean): Promise<string> {
    const { order } = await orderService.createOrder({
      tenantId,
      workspaceId: await mkWorkspace(),
      planVersionId,
      cycleUnit: "month",
      price,
      createdBy: userId,
      intent: "new",
      itemName: "Arda Pro (e2e)",
      ...(autoRenew === undefined ? {} : { autoRenew }),
    });
    return order.id;
  }

  async function mkVoucher(
    kind: "discount" | "credit_voucher",
    effect: Record<string, unknown>,
  ): Promise<{ batchId: string; voucherId: string }> {
    const { batchId } = await commercial.createVoucherBatch(req(CAPS_PROMO), {
      kind,
      name: `e2e ${kind} ${Date.now()}-${Math.random().toFixed(6)}`,
      effect,
      totalCount: 10,
      perUserLimit: 10,
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      tenantId,
    });
    await commercial.assignVouchers(req(CAPS_PROMO), {
      batchId,
      count: 1,
      targetUserId: userId,
    });
    const row = await pool.query<{ id: string }>(
      `select id from promotion.vouchers where batch_id = $1 limit 1`,
      [batchId],
    );
    return { batchId, voucherId: row.rows[0]!.id };
  }

  /** 无券申报（支付宝）。 */
  async function declare(orderId: string) {
    return orderService.declarePayment({
      orderId,
      tenantId,
      userId,
      payChannel: "alipay",
    });
  }

  /** 运营足额确认收款。 */
  async function confirm(orderId: string, amount: number) {
    return orders.confirmOfflinePayment(
      req(CAPS_SETTLE),
      orderId,
      CONFIRM(amount),
    );
  }

  async function orderFacts(orderId: string) {
    const ord = await pool.query<{
      status: string;
      subscription_id: string | null;
      sub_status: string | null;
    }>(
      `select o.status, o.subscription_id, s.status as sub_status
         from billing.orders o
         left join metering.subscriptions s on s.id = o.subscription_id
        where o.id = $1`,
      [orderId],
    );
    const inv = await pool.query<{
      id: string;
      bill_status: string;
      total_amount: string;
      payable_amount: string;
      paid_amount: string;
      discount_amount: string;
    }>(
      `select id, bill_status, total_amount, payable_amount, paid_amount, discount_amount
         from billing.invoices where order_id = $1
        order by created_at desc limit 1`,
      [orderId],
    );
    const legs = await pool.query<{
      pay_source: string;
      pay_status: string;
      total_amount: string;
      paid_amount: string;
    }>(
      `select pay_source, pay_status, total_amount, paid_amount
         from billing.payments where bill_id = $1 order by created_at asc`,
      [inv.rows[0]?.id],
    );
    return {
      orderStatus: ord.rows[0]?.status,
      subscriptionId: ord.rows[0]?.subscription_id ?? null,
      subStatus: ord.rows[0]?.sub_status ?? null,
      invoice: inv.rows[0],
      legs: legs.rows,
    };
  }

  async function orderEvents(orderId: string, type: string) {
    return pool.query<{ actor_type: string; remark: string | null }>(
      `select actor_type, remark from billing.order_events
        where order_id = $1 and event_type = $2 order by created_at asc`,
      [orderId, type],
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB });
    const provisioning = new ProvisioningService(
      new PgProvisioningRepository(pool),
      {
        maxAttempts: 1,
        backoffBaseSec: 1,
        backoffCapSec: 1,
        leaseSeconds: 1,
        batchSize: 1,
        timeoutMs: 1000,
      },
      { resolve: () => null },
      { deliveryFailed: () => {} },
    );
    promotion = new PromotionService(new PgPromotionRepository(pool));
    const subRepo = new PgSubscriptionRepository(pool);
    const subscriptions = new SubscriptionService(subRepo, provisioning);
    subscriptionsService = subscriptions;
    orderService = new OrderService(
      new PgOrderRepository(pool),
      subRepo,
      subscriptions,
      promotion,
    );
    // P2-g：客户通知（站内；邮件 sender 不注入 → 只落 inbox + inapp 账本）
    const notifier = new NotificationDispatcher(pool, {
      mail: null,
      logger: { warn: () => {} },
    });
    orderService.setCustomerNotifier(notifier);
    subscriptions.setCustomerNotifier(notifier);
    customerNotifier = notifier;
    orders = new OrdersRouter(pool, pool, orderService, promotion);
    payments = new PaymentsRouter(pool, pool);
    commercial = new CommercialRouter(pool, pool);

    // Fixtures: user + tenant + default workspace (sample seed is skipped
    // locally — no password hash — so mint bare rows; FKs are all satisfied).
    const runTag = `${Date.now()}`.slice(-9);
    const user = await pool.query<{ id: string }>(
      `insert into account.users (account, phone, phone_verified_at)
       values ($1, $2, now()) returning id`,
      [`e2e-payer-${runTag}`, `138${runTag.padStart(8, "0")}`],
    );
    userId = user.rows[0]!.id;
    const tenant = await pool.query<{ id: string }>(
      `insert into tenancy.tenants (name, type, owner_user_id)
       values ('E2E Tenant', 'personal', $1) returning id`,
      [userId],
    );
    tenantId = tenant.rows[0]!.id;
    // default workspace（租户不变式）；订单各用独立工作空间（mkWorkspace）
    await pool.query(
      `insert into tenancy.workspaces (tenant_id, name, is_default)
       values ($1, 'default', true)`,
      [tenantId],
    );
    const pv = await pool.query<{ id: string }>(
      `select pv.id from product.plan_versions pv
         join product.plans pl on pl.current_version_id = pv.id
        where pl.plan_code = 'arda-pro' limit 1`,
    );
    planVersionId = pv.rows[0]!.id;
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("§8.1 无券整单：下单 → 申报 → 足额确认 → 订单履约 + 订阅生效 + webhook 入队", async () => {
    const orderId = await mkOrder();
    const before = await orderFacts(orderId);
    expect(before.orderStatus).toBe("pending_payment");
    expect(before.subscriptionId).toBeNull(); // P1-b2：下单不建订阅行

    const declared = await orderService.declarePayment({
      orderId,
      tenantId,
      userId,
      payChannel: "alipay",
    });
    expect(declared.outcome).toBe("declared");
    expect(declared.cashDue).toBe("1200.00");
    expect((await orderFacts(orderId)).orderStatus).toBe("pending_verify");

    const detail = await orders.confirmOfflinePayment(
      req(CAPS_SETTLE),
      orderId,
      CONFIRM(1200),
    );
    expect(detail.orderStatus).toBe("confirmed");
    const facts = await orderFacts(orderId);
    expect(facts.orderStatus).toBe("fulfilled");
    expect(facts.subStatus).toBe("active");
    expect(facts.invoice?.bill_status).toBe("paid");
    // provisioning enqueue landed (delivery to arda = production item)
    const events = await pool.query(
      `select 1 from provisioning.webhook_deliveries d
        join metering.subscriptions s on s.workspace_id = d.workspace_id
       where s.id = $1 limit 1`,
      [facts.subscriptionId],
    );
    expect(events.rows.length).toBeGreaterThan(0);
  }, 30_000);

  it("§8.2 折扣券+代金券复合：金额分解正确、确认后 redemption 回填、paid=Σ腿", async () => {
    const orderId = await mkOrder(1200);
    const discount = await mkVoucher("discount", {
      discount_type: "percent",
      value: 20,
    });
    const credit = await mkVoucher("credit_voucher", { amount_cents: 10000 });

    const declared = await orderService.declarePayment({
      orderId,
      tenantId,
      userId,
      payChannel: "bank_transfer",
      discountVoucherId: discount.voucherId,
      creditVoucherId: credit.voucherId,
    });
    // 1200 − 240 (20%) − 100 = 860
    expect(declared.cashDue).toBe("860.00");

    await orders.confirmOfflinePayment(req(CAPS_SETTLE), orderId, CONFIRM(860));
    const facts = await orderFacts(orderId);
    expect(facts.orderStatus).toBe("fulfilled");
    expect(facts.subStatus).toBe("active");
    expect(Number(facts.invoice?.payable_amount)).toBe(960);
    expect(Number(facts.invoice?.paid_amount)).toBe(960);
    const paidLegSum = facts.legs
      .filter((l) => l.pay_status === "paid")
      .reduce((s, l) => s + Number(l.paid_amount), 0);
    expect(paidLegSum).toBe(960);
    expect(
      facts.legs.some(
        (l) => l.pay_source === "voucher" && l.pay_status === "paid",
      ),
    ).toBe(true);

    const redemptions = await pool.query<{
      kind: string;
      invoice_item_id: string | null;
      payment_id: string | null;
    }>(
      `select kind, invoice_item_id, payment_id from promotion.voucher_redemptions
        where voucher_id = any($1::uuid[]) order by kind`,
      [[credit.voucherId, discount.voucherId]],
    );
    expect(redemptions.rows).toHaveLength(2);
    const disc = redemptions.rows.find((r) => r.kind === "discount");
    const cred = redemptions.rows.find((r) => r.kind === "credit_voucher");
    expect(disc?.invoice_item_id).toBeTruthy();
    expect(cred?.payment_id).toBeTruthy();
  }, 30_000);

  it("§8.3 全额代金券：申报即履约（actor=customer），已清账单重复申报幂等", async () => {
    const orderId = await mkOrder(100);
    const credit = await mkVoucher("credit_voucher", { amount_cents: 10000 });
    const declared = await orderService.declarePayment({
      orderId,
      tenantId,
      userId,
      payChannel: "alipay",
      creditVoucherId: credit.voucherId,
    });
    expect(declared.outcome).toBe("activated");
    const facts = await orderFacts(orderId);
    expect(facts.orderStatus).toBe("fulfilled");
    expect(facts.subStatus).toBe("active");
    expect(facts.invoice?.bill_status).toBe("paid");
    const confirmed = await orderEvents(orderId, "payment_confirmed");
    expect(confirmed.rows[0]?.actor_type).toBe("customer");

    // Hang-window re-submit: cleared invoice → already_settled, no double spend.
    const again = await orderService.declarePayment({
      orderId,
      tenantId,
      userId,
      payChannel: "alipay",
    });
    expect(again.outcome).toBe("already_settled");
  }, 30_000);

  it("§8.3b 悬挂对账：段1已清（orders=paid）、段2未跑 → reconcile 自愈履约", async () => {
    const orderId = await mkOrder(50);
    // Simulate the crash window: stage 1 landed (invoice paid, order paid), stage 2 never ran.
    await pool.query(
      `update billing.invoices set bill_status='paid', paid_amount=payable_amount,
              paid_at=now() where order_id=$1`,
      [orderId],
    );
    await pool.query(
      `update billing.orders set status='paid', paid_at=now() - interval '10 minutes',
              updated_at=now() - interval '10 minutes' where id=$1`,
      [orderId],
    );
    const healed = await orderService.reconcileHungPaid(2, 50);
    expect(healed).toBeGreaterThan(0);
    const facts = await orderFacts(orderId);
    expect(facts.orderStatus).toBe("fulfilled");
    expect(facts.subStatus).toBe("active");
  }, 30_000);

  it("§8.4/8.5 驳回：invoice 还原原价、券释放、TTL 重锚；换券重申报金额正确", async () => {
    const orderId = await mkOrder(1200);
    const v1 = await mkVoucher("discount", {
      discount_type: "percent",
      value: 20,
    });
    await orderService.declarePayment({
      orderId,
      tenantId,
      userId,
      payChannel: "alipay",
      discountVoucherId: v1.voucherId,
    });
    let facts = await orderFacts(orderId);
    expect(Number(facts.invoice?.payable_amount)).toBe(960);

    await orders.rejectPaymentDeclaration(req(CAPS_SETTLE), orderId, {
      reason: "未查到对应转账记录（e2e）",
    });
    facts = await orderFacts(orderId);
    // Pricing rollback: payable restored, discount mirror zeroed, leg failed.
    expect(facts.orderStatus).toBe("pending_payment");
    expect(Number(facts.invoice?.payable_amount)).toBe(1200);
    expect(Number(facts.invoice?.discount_amount)).toBe(0);
    expect(facts.legs.some((l) => l.pay_status === "failed")).toBe(true);
    const voucher = await pool.query<{ status: string; used_count: number }>(
      `select status, used_count from promotion.vouchers where id = $1`,
      [v1.voucherId],
    );
    expect(voucher.rows[0]).toEqual({ status: "assigned", used_count: 0 });
    const rejected = await orderEvents(orderId, "payment_rejected");
    expect(rejected.rows.length).toBe(1);
    expect(rejected.rows[0]?.remark).toBe("未查到对应转账记录（e2e）");

    // Re-declare with a DIFFERENT voucher: exactly one live discount row.
    const v2 = await mkVoucher("discount", {
      discount_type: "fixed",
      value: 30000,
    });
    const redeclared = await orderService.declarePayment({
      orderId,
      tenantId,
      userId,
      payChannel: "alipay",
      discountVoucherId: v2.voucherId,
    });
    expect(redeclared.cashDue).toBe("900.00"); // 1200 − 300
    const liveDiscountRows = await pool.query(
      `select 1 from billing.invoice_items
        where bill_id = $1 and item_type = 'discount' and deleted_at is null`,
      [facts.invoice!.id],
    );
    expect(liveDiscountRows.rows.length).toBe(1);
  }, 30_000);

  it("§8.5b 释放幂等：驳回后同券被另一单占用，旧单关单不误放", async () => {
    const orderA = await mkOrder(500);
    const v = await mkVoucher("discount", {
      discount_type: "percent",
      value: 10,
    });
    await orderService.declarePayment({
      orderId: orderA,
      tenantId,
      userId,
      payChannel: "alipay",
      discountVoucherId: v.voucherId,
    });
    await orders.rejectPaymentDeclaration(req(CAPS_SETTLE), orderA, {
      reason: "e2e stale credential setup",
    });
    // Voucher now reserved by order B.
    const orderB = await mkOrder(500);
    await orderService.declarePayment({
      orderId: orderB,
      tenantId,
      userId,
      payChannel: "alipay",
      discountVoucherId: v.voucherId,
    });
    // Closing order A (stale credential on its failed leg) must NOT free B's hold.
    await orderService.cancel(orderA, {
      actorType: "customer",
      actorId: userId,
    });
    const voucher = await pool.query<{ status: string }>(
      `select status from promotion.vouchers where id = $1`,
      [v.voucherId],
    );
    expect(voucher.rows[0]?.status).toBe("reserved");
  }, 30_000);

  it("§8.6 超时：无申报超期关单（expired），有申报/实收豁免", async () => {
    const stale = await mkOrder(200);
    await pool.query(
      `update billing.orders set created_at = now() - interval '2 hours'
        where id = $1`,
      [stale],
    );
    const declaredButStale = await mkOrder(200);
    await pool.query(
      `update billing.orders set created_at = now() - interval '2 hours'
        where id = $1`,
      [declaredButStale],
    );
    await orderService.declarePayment({
      orderId: declaredButStale,
      tenantId,
      userId,
      payChannel: "alipay",
    });

    await orderService.sweepExpired(30, 100);

    const closed = await orderFacts(stale);
    expect(closed.orderStatus).toBe("expired");
    const expiredEvents = await orderEvents(stale, "order_expired");
    expect(expiredEvents.rows.length).toBe(1);

    const exempt = await orderFacts(declaredButStale);
    expect(exempt.orderStatus).toBe("pending_verify"); // declared → clock frozen
  }, 30_000);

  it("§8.7 取消边界：已申报订单 cancel 409；恢复过期单回到待付款", async () => {
    const orderId = await mkOrder(300);
    await declare(orderId);
    await expect(
      orderService.cancel(orderId, {
        actorType: "customer",
        actorId: userId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const other = await mkOrder(300);
    await orderService.cancel(other, {
      actorType: "customer",
      actorId: userId,
    });
    expect((await orderFacts(other)).orderStatus).toBe("cancelled");
    await orderService.restore(other, {
      actorType: "operator",
      actorId: OPERATOR,
    });
    expect((await orderFacts(other)).orderStatus).toBe("pending_payment");
  }, 30_000);

  it("§8.8 在途唯一：同工作空间同产品第二张单 409（PENDING_ORDER_EXISTS）", async () => {
    const ws = await mkWorkspace();
    const mk = () =>
      orderService.createOrder({
        tenantId,
        workspaceId: ws,
        planVersionId,
        cycleUnit: "month",
        price: 100,
        createdBy: userId,
        intent: "new",
        itemName: "Arda Pro (e2e dup)",
      });
    await mk();
    await expect(mk()).rejects.toBeInstanceOf(ConflictException);
  }, 30_000);

  it("§8.9 并发：同一张券两个订单同时 declare，恰一成功", async () => {
    const v = await mkVoucher("credit_voucher", { amount_cents: 5000 });
    const orderA = await mkOrder(400);
    const orderB = await mkOrder(400);
    const results = await Promise.allSettled([
      orderService.declarePayment({
        orderId: orderA,
        tenantId,
        userId,
        payChannel: "alipay",
        creditVoucherId: v.voucherId,
      }),
      orderService.declarePayment({
        orderId: orderB,
        tenantId,
        userId,
        payChannel: "alipay",
        creditVoucherId: v.voucherId,
      }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
  }, 30_000);

  it("§8.10 金额不符：确认金额≠申报额被拒；无腿路径恒等校验", async () => {
    const orderId = await mkOrder(860);
    await orderService.declarePayment({
      orderId,
      tenantId,
      userId,
      payChannel: "bank_transfer",
    });
    await expect(
      orders.confirmOfflinePayment(req(CAPS_SETTLE), orderId, CONFIRM(500)),
    ).rejects.toBeInstanceOf(BadRequestException);

    // No-leg path (post-reject): exact-remaining enforced.
    await orders.rejectPaymentDeclaration(req(CAPS_SETTLE), orderId, {
      reason: "e2e amount mismatch",
    });
    await expect(
      orders.confirmOfflinePayment(req(CAPS_SETTLE), orderId, CONFIRM(500)),
    ).rejects.toBeInstanceOf(BadRequestException);
    const detail = await orders.confirmOfflinePayment(
      req(CAPS_SETTLE),
      orderId,
      CONFIRM(860),
    );
    expect(detail.orderStatus).toBe("confirmed");
  }, 30_000);

  it("§8.11 存量 partial：cashDue 扣减已收", async () => {
    const orderId = await mkOrder(1000);
    await pool.query(
      `update billing.invoices set paid_amount = 400, bill_status = 'partial'
        where order_id = $1`,
      [orderId],
    );
    const declared = await orderService.declarePayment({
      orderId,
      tenantId,
      userId,
      payChannel: "alipay",
    });
    expect(declared.cashDue).toBe("600.00");
  }, 30_000);

  it("§8.12 升级单履约：原订阅换版本、周期重锚、订单指向原订阅", async () => {
    // free → pro on one workspace: first a ¥0 'new' order fulfilled by instant settle.
    const ws = await mkWorkspace();
    const freePv = await pool.query<{ id: string }>(
      `select pv.id from product.plan_versions pv
         join product.plans pl on pl.current_version_id = pv.id
        where pl.plan_code = 'arda-free' limit 1`,
    );
    const freeVersion = freePv.rows[0]?.id;
    if (!freeVersion) return; // seed without a free tier: skip silently
    const free = await orderService.createOrder({
      tenantId,
      workspaceId: ws,
      planVersionId: freeVersion,
      cycleUnit: "month",
      price: 0,
      createdBy: userId,
      intent: "new",
      itemName: "Arda Free (e2e)",
    });
    const freeDeclared = await orderService.declarePayment({
      orderId: free.order.id,
      tenantId,
      userId,
      payChannel: "alipay",
    });
    expect(freeDeclared.outcome).toBe("activated");
    const freeFacts = await orderFacts(free.order.id);
    expect(freeFacts.subStatus).toBe("active");

    const up = await orderService.createOrder({
      tenantId,
      workspaceId: ws,
      planVersionId,
      cycleUnit: "year",
      price: 9600,
      createdBy: userId,
      intent: "upgrade",
      fromSubscriptionId: freeFacts.subscriptionId!,
      itemName: "Arda Pro (e2e upgrade)",
    });
    await orderService.declarePayment({
      orderId: up.order.id,
      tenantId,
      userId,
      payChannel: "bank_transfer",
    });
    await orders.confirmOfflinePayment(
      req(CAPS_SETTLE),
      up.order.id,
      CONFIRM(9600),
    );
    const upFacts = await orderFacts(up.order.id);
    expect(upFacts.orderStatus).toBe("fulfilled");
    expect(upFacts.subscriptionId).toBe(freeFacts.subscriptionId);
    const subRow = await pool.query<{
      plan_version_id: string;
      cycle_unit: string;
      paid_amount: string;
      current_order_id: string | null;
    }>(
      `select plan_version_id, cycle_unit, paid_amount, current_order_id
         from metering.subscriptions where id = $1`,
      [freeFacts.subscriptionId],
    );
    expect(subRow.rows[0]).toMatchObject({
      plan_version_id: planVersionId,
      cycle_unit: "year",
      current_order_id: up.order.id,
    });
    expect(Number(subRow.rows[0]?.paid_amount)).toBe(9600);
    // 同产品只有一条在用订阅（没有第二条镜像行）
    const live = await pool.query(
      `select 1 from metering.subscriptions
        where workspace_id = $1 and status = 'active' and deleted_at is null`,
      [ws],
    );
    expect(live.rows.length).toBe(1);
  }, 30_000);

  it("§8.17 升级折抵（P2-a）：付费→付费，折抵随单落库、账单负行、履约后订阅换档实付=应付", async () => {
    const versionOf = async (code: string) =>
      (
        await pool.query<{ id: string }>(
          `select pv.id from product.plan_versions pv
             join product.plans pl on pl.current_version_id = pv.id
            where pl.plan_code = $1 limit 1`,
          [code],
        )
      ).rows[0]?.id;
    const starter = await versionOf("arda-starter");
    const business = await versionOf("arda-business");
    if (!starter || !business) return; // seed without the ladder: skip silently

    const ws = await mkWorkspace();
    const first = await orderService.createOrder({
      tenantId,
      workspaceId: ws,
      planVersionId: starter,
      cycleUnit: "month",
      price: 1200,
      createdBy: userId,
      intent: "new",
      itemName: "Arda Starter (e2e)",
    });
    await declare(first.order.id);
    await confirm(first.order.id, 1200);
    const subId = (await orderFacts(first.order.id)).subscriptionId!;

    // 报价与下单同一函数：刚开通 → r≈1，未消耗 → u=1（若有消耗性池），credit ≈ P_old
    const quote = await orderService.quoteUpgrade(subId, 3000);
    expect(quote.credit).toBeGreaterThan(1100);
    expect(quote.credit).toBeLessThanOrEqual(1200);
    expect(quote.payable).toBeCloseTo(3000 - quote.credit, 2);

    const up = await orderService.createOrder({
      tenantId,
      workspaceId: ws,
      planVersionId: business,
      cycleUnit: "month",
      price: 3000,
      createdBy: userId,
      intent: "upgrade",
      fromSubscriptionId: subId,
      itemName: "Arda Business (e2e upgrade)",
    });
    expect(Number(up.order.listAmount)).toBe(3000);
    expect(Number(up.order.creditAmount)).toBeCloseTo(quote.credit, 0);
    expect(Number(up.order.payableAmount)).toBeCloseTo(quote.payable, 0);
    expect(up.order.proration).toMatchObject({ pOld: 1200, pNew: 3000 });
    const items = await pool.query<{ item_type: string; total_amount: string }>(
      `select item_type, total_amount from billing.invoice_items
        where bill_id = $1 and deleted_at is null order by item_type`,
      [up.invoiceId],
    );
    expect(items.rows.map((i) => i.item_type)).toEqual([
      "credit_adjustment",
      "subscription_fee",
    ]);
    expect(Number(items.rows[0]!.total_amount)).toBeCloseTo(-quote.credit, 0);
    const inv = (await orderFacts(up.order.id)).invoice!;
    expect(Number(inv.payable_amount)).toBeCloseTo(quote.payable, 0);

    // 付应付额 → 履约：换档到 business，实付 = 应付（折抵后），周期重锚
    const payable = Number(up.order.payableAmount);
    await declare(up.order.id);
    await confirm(up.order.id, payable);
    const after = await pool.query<{
      plan_version_id: string;
      paid_amount: string;
      status: string;
    }>(
      `select plan_version_id, paid_amount, status from metering.subscriptions where id = $1`,
      [subId],
    );
    expect(after.rows[0]).toMatchObject({
      plan_version_id: business,
      status: "active",
    });
    expect(Number(after.rows[0]!.paid_amount)).toBeCloseTo(payable, 2);
  }, 30_000);

  it("§8.18 24h 退款（P2-b）：资格 → 申请 → 审核通过 → 执行 → 订单 refunded、订阅回到未订阅、冲正流水", async () => {
    const orderId = await mkOrder(1200);
    await declare(orderId);
    await confirm(orderId, 1200);
    const facts = await orderFacts(orderId);
    expect(facts.orderStatus).toBe("fulfilled");

    const e = await orderService.getRefundEligibility(orderId);
    expect(e.eligible).toBe(true);
    expect(e.amount).toBe("1200.00");

    const req1 = await orderService.requestRefund(orderId, {
      userId,
      reason: "e2e refund",
    });
    expect(req1.auditStatus).toBe("pending");
    // 同一订单不能再申请
    await expect(
      orderService.requestRefund(orderId, { userId, reason: "again" }),
    ).rejects.toBeInstanceOf(ConflictException);

    // 未审核不能执行
    await expect(
      orders.executeRefund(req(CAPS_SETTLE), orderId, {
        reason: "e2e pay out",
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const approved = await orders.auditRefund(req(CAPS_SETTLE), orderId, {
      decision: "approved",
      remark: "e2e approve",
    });
    expect(approved.refund?.auditStatus).toBe("approved");

    const done = await orders.executeRefund(req(CAPS_SETTLE), orderId, {
      reason: "e2e paid back via alipay",
    });
    expect(done.orderStatus).toBe("closed");
    expect(done.refund?.refundStatus).toBe("success");
    const after = await orderFacts(orderId);
    expect(after.orderStatus).toBe("refunded");
    expect(after.subStatus).toBe("cancelled");
    const txn = await pool.query<{ amount: string; trade_type: string }>(
      `select amount, trade_type from billing.transactions
        where tenant_id = $1 and related_no = $2`,
      [tenantId, req1.refundNo],
    );
    expect(txn.rows).toEqual([{ amount: "-1200.00", trade_type: "refund" }]);
    const events = await orderEvents(orderId, "refunded");
    expect(events.rows.length).toBe(1);
  }, 30_000);

  it("§8.18b 退款窗口外不可退：履约超过 24 小时", async () => {
    const orderId = await mkOrder(300);
    await declare(orderId);
    await confirm(orderId, 300);
    await pool.query(
      `update billing.orders set fulfilled_at = now() - interval '25 hours' where id = $1`,
      [orderId],
    );
    const e = await orderService.getRefundEligibility(orderId);
    expect(e.eligible).toBe(false);
    expect(e.reasons).toContain("window_elapsed");
  }, 30_000);

  it("§8.19 自动续费默认关、随单留痕（owner 2026-09-03）：不带 → 订阅关；确认页开 → 订阅开；续费单可改回关", async () => {
    // 默认：下单不带 autoRenew → 订单 false → 履约后订阅 auto_renew=false
    const plain = await mkOrder(100);
    const plainOrder = await orderService.getOrder(plain);
    expect(plainOrder.autoRenew).toBe(false);
    await declare(plain);
    await confirm(plain, 100);
    const plainSub = (await orderFacts(plain)).subscriptionId!;
    const r1 = await pool.query<{ auto_renew: boolean }>(
      `select auto_renew from metering.subscriptions where id = $1`,
      [plainSub],
    );
    expect(r1.rows[0]!.auto_renew).toBe(false);

    // 确认页开启 → 订单 true → 履约后订阅开
    const optIn = await mkOrder(100, true);
    expect((await orderService.getOrder(optIn)).autoRenew).toBe(true);
    await declare(optIn);
    await confirm(optIn, 100);
    const optInSub = (await orderFacts(optIn)).subscriptionId!;
    const r2 = await pool.query<{ auto_renew: boolean }>(
      `select auto_renew from metering.subscriptions where id = $1`,
      [optInSub],
    );
    expect(r2.rows[0]!.auto_renew).toBe(true);

    // 续费单（客户手动续，确认页关掉）→ 履约后订阅改回关，并留 auto_renew_off 历史
    const { order: renew } = await orderService.createOrder({
      tenantId,
      workspaceId: (
        await pool.query<{ workspace_id: string }>(
          `select workspace_id from metering.subscriptions where id = $1`,
          [optInSub],
        )
      ).rows[0]!.workspace_id,
      planVersionId,
      cycleUnit: "month",
      price: 100,
      createdBy: userId,
      intent: "renew",
      fromSubscriptionId: optInSub,
      itemName: "Arda Pro (e2e)",
      autoRenew: false,
    });
    await declare(renew.id);
    await confirm(renew.id, 100);
    const r3 = await pool.query<{ auto_renew: boolean }>(
      `select auto_renew from metering.subscriptions where id = $1`,
      [optInSub],
    );
    expect(r3.rows[0]!.auto_renew).toBe(false);
    const hist = await pool.query(
      `select 1 from metering.subscription_histories
        where subscription_id = $1 and change_type = 'auto_renew_off'`,
      [optInSub],
    );
    expect(hist.rows.length).toBe(1);
  }, 60_000);

  it("§8.20 客户通知（P2-g）：履约 → order.fulfilled 站内 + 账本；退款三阶段各一条；重复履约不重复通知", async () => {
    const orderId = await mkOrder(300);
    await declare(orderId);
    await confirm(orderId, 300);
    const inbox = await pool.query<{
      template_code: string;
      link: string | null;
      read_at: Date | null;
    }>(
      `select template_code, link, read_at from support.inbox_messages
        where reference_type = 'order' and reference_id = $1 order by created_at`,
      [orderId],
    );
    expect(inbox.rows.map((r) => r.template_code)).toEqual(["order.fulfilled"]);
    expect(inbox.rows[0]!.link).toBe(`/subscribe/pay/${orderId}`);
    expect(inbox.rows[0]!.read_at).toBeNull();
    const logs = await pool.query<{ channel: string; status: string }>(
      `select channel, status from support.notification_logs
        where reference_type = 'order' and reference_id = $1`,
      [orderId],
    );
    expect(logs.rows).toEqual([{ channel: "inapp", status: "delivered" }]);

    // 幂等履约（已 fulfilled 直接返回）不再通知
    await orderService.fulfill(orderId, { actorType: "system", actorId: null });
    const again = await pool.query(
      `select 1 from support.inbox_messages where reference_type = 'order' and reference_id = $1`,
      [orderId],
    );
    expect(again.rows.length).toBe(1);

    // 退款：申请 / 通过 / 完成 各一条（按 refund:阶段 去重）
    const req1 = await orderService.requestRefund(orderId, {
      userId,
      reason: "e2e notify",
    });
    await orders.auditRefund(req(CAPS_SETTLE), orderId, {
      decision: "approved",
      remark: "e2e approve",
    });
    await orders.executeRefund(req(CAPS_SETTLE), orderId, {
      reason: "e2e paid back",
    });
    const refundInbox = await pool.query<{ template_code: string }>(
      `select template_code from support.inbox_messages
        where reference_type = 'refund' and reference_id like $1 order by created_at`,
      [`${req1.id}:%`],
    );
    expect(refundInbox.rows.map((r) => r.template_code)).toEqual([
      "refund.requested",
      "refund.approved",
      "refund.completed",
    ]);
  }, 60_000);

  it("§8.21 公告推送（P2-h）：published 且到点的公告 → 目标租户 owner 站内一条；重跑不重复；meta.broadcast_at 打标", async () => {
    const ann = await pool.query<{ id: string }>(
      `insert into admin.announcements
         (announcement_type, severity, status, lang, title, content, cta_url, target_plans, target_tenant_types, publish_at, created_by)
       values ('maintenance', 'info', 'published', 'zh-CN', 'e2e 公告', '周六 02:00 升级。', 'https://vxture.com/status', '{}', '{}', now() - interval '1 minute', $1)
       returning id`,
      [OPERATOR],
    );
    const annId = ann.rows[0]!.id;
    const first = await broadcastAnnouncements(pool, customerNotifier);
    expect(first.announcements).toBeGreaterThanOrEqual(1);
    const inbox = await pool.query<{ title: string; link: string | null }>(
      `select title, link from support.inbox_messages
        where reference_type = 'announcement' and reference_id = $1 and account_id = $2`,
      [annId, userId],
    );
    expect(inbox.rows).toEqual([
      { title: "e2e 公告", link: "https://vxture.com/status" },
    ]);
    const meta = await pool.query<{ meta: { broadcast_at?: string } | null }>(
      `select meta from admin.announcements where id = $1`,
      [annId],
    );
    expect(meta.rows[0]!.meta?.broadcast_at).toBeTruthy();
    // 再跑：已打标，不再扫到；即使扫到，收件人级唯一键也挡住（本租户 owner 仍只有一条）
    const again = await broadcastAnnouncements(pool, customerNotifier);
    const stillOne = await pool.query(
      `select 1 from support.inbox_messages
        where reference_type = 'announcement' and reference_id = $1 and account_id = $2`,
      [annId, userId],
    );
    expect(stillOne.rows.length).toBe(1);
    expect(again.tenants).toBe(0);
  }, 60_000);

  it("§8.13 发券边界：超发 409、per_user_limit 409、门槛字段拒绝", async () => {
    const { batchId } = await mkVoucher("discount", {
      discount_type: "percent",
      value: 5,
    });
    // total_count=10, 1 already assigned → 10 more over-issues.
    await expect(
      commercial.assignVouchers(req(CAPS_PROMO), {
        batchId,
        count: 10,
        targetUserId: userId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      commercial.createVoucherBatch(req(CAPS_PROMO), {
        kind: "discount",
        name: "e2e gated",
        effect: {
          discount_type: "percent",
          value: 10,
          applicable_plan_ids: ["x"],
        },
        totalCount: 1,
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  }, 30_000);

  it("§8.14 台账封堵：在途订单腿 verify/reject 均 409 引导订单侧", async () => {
    const orderId = await mkOrder(700);
    await declare(orderId);
    const leg = await pool.query<{ id: string }>(
      `select p.id from billing.payments p
        join billing.invoices i on i.id = p.bill_id
        where i.order_id = $1 and p.pay_status = 'pending_verify'`,
      [orderId],
    );
    const legId = leg.rows[0]!.id;
    const ledgerCaps = [
      "commerce:payment.read",
      "commerce:payment.manage",
      "commerce:payment.settle",
    ];
    await expect(
      payments.verifyPayment(req(ledgerCaps), legId, { remark: "e2e" }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      payments.rejectPayment(req(ledgerCaps), legId, { remark: "e2e-reject" }),
    ).rejects.toBeInstanceOf(ConflictException);
  }, 30_000);

  it("§8.15 自动续费（¥0）：到期前 lead 窗口内系统开单、结清、履约，到期日顺延一个周期", async () => {
    const freePv = await pool.query<{ id: string }>(
      `select pv.id from product.plan_versions pv
         join product.plans pl on pl.current_version_id = pv.id
        where pl.plan_code = 'arda-free' limit 1`,
    );
    const freeVersion = freePv.rows[0]?.id;
    if (!freeVersion) return; // seed without a free tier: skip silently
    const ws = await mkWorkspace();
    const free = await orderService.createOrder({
      tenantId,
      workspaceId: ws,
      planVersionId: freeVersion,
      cycleUnit: "month",
      price: 0,
      createdBy: userId,
      intent: "new",
      itemName: "Arda Free (e2e auto-renew)",
    });
    await orderService.declarePayment({
      orderId: free.order.id,
      tenantId,
      userId,
      payChannel: "alipay",
    });
    const subId = (await orderFacts(free.order.id)).subscriptionId!;
    // 把到期日拉到 1 天后（lead 7 天内），保证 auto_renew 开
    const soon = new Date(Date.now() + 86_400_000);
    await pool.query(
      `update metering.subscriptions set end_at = $2, auto_renew = true where id = $1`,
      [subId, soon],
    );
    const pass = await orderService.runAutoRenewalPass({
      leadDays: 7,
      graceDays: 3,
    });
    expect(pass.fulfilled).toBeGreaterThanOrEqual(1);

    const after = await pool.query<{
      end_at: Date;
      status: string;
      current_order_id: string | null;
    }>(
      `select end_at, status, current_order_id from metering.subscriptions where id = $1`,
      [subId],
    );
    // 顺延：新 end ≈ 旧 end + 1 month（以旧 end 为基，不是 now）
    expect(after.rows[0]!.status).toBe("active");
    expect(after.rows[0]!.end_at.getTime()).toBeGreaterThan(
      soon.getTime() + 27 * 86_400_000,
    );
    const renewOrder = await pool.query<{
      status: string;
      intent: string;
      created_by_type: string;
    }>(
      `select status, intent, created_by_type from billing.orders where id = $1`,
      [after.rows[0]!.current_order_id],
    );
    expect(renewOrder.rows[0]).toEqual({
      status: "fulfilled",
      intent: "renew",
      created_by_type: "system",
    });

    // 幂等：同一 lead 窗口内再跑不重复开单
    const again = await orderService.runAutoRenewalPass({
      leadDays: 7,
      graceDays: 3,
    });
    const dup = await pool.query(
      `select 1 from billing.orders where from_subscription_id = $1 and intent = 'renew'`,
      [subId],
    );
    expect(dup.rows.length).toBe(1);
    expect(again.created).toBe(0);
  }, 30_000);

  it("§8.16 付费到期：续订单挂待付款、到期扫描翻 expired、付款履约复活", async () => {
    const orderId = await mkOrder(1200);
    await declare(orderId);
    await confirm(orderId, 1200);
    const subId = (await orderFacts(orderId)).subscriptionId!;
    // 到期不续（auto_renew 关）：到期扫描翻 expired，权益按 DEACTIVATED 走钩子
    await pool.query(
      `update metering.subscriptions set end_at = now() - interval '1 hour', auto_renew = false
        where id = $1`,
      [subId],
    );
    const expired = await subscriptionsService.sweepExpiredSubscriptions(500);
    expect(expired).toBeGreaterThanOrEqual(1);
    const st = await pool.query<{ status: string }>(
      `select status from metering.subscriptions where id = $1`,
      [subId],
    );
    expect(st.rows[0]!.status).toBe("expired");

    // 过期后客户手动续订同档 → 付款履约 = 复活（从 now 起算一个周期）
    const renew = await orderService.createOrder({
      tenantId,
      workspaceId: (
        await pool.query<{ workspace_id: string }>(
          `select workspace_id from metering.subscriptions where id = $1`,
          [subId],
        )
      ).rows[0]!.workspace_id,
      planVersionId,
      cycleUnit: "month",
      price: 1200,
      createdBy: userId,
      intent: "renew",
      fromSubscriptionId: subId,
      itemName: "Arda Pro (e2e renew)",
    });
    await orderService.declarePayment({
      orderId: renew.order.id,
      tenantId,
      userId,
      payChannel: "alipay",
    });
    await orders.confirmOfflinePayment(
      req(CAPS_SETTLE),
      renew.order.id,
      CONFIRM(1200),
    );
    const revived = await pool.query<{
      status: string;
      end_at: Date;
      current_order_id: string | null;
    }>(
      `select status, end_at, current_order_id from metering.subscriptions where id = $1`,
      [subId],
    );
    expect(revived.rows[0]!.status).toBe("active");
    expect(revived.rows[0]!.end_at.getTime()).toBeGreaterThan(
      Date.now() + 27 * 86_400_000,
    );
    expect(revived.rows[0]!.current_order_id).toBe(renew.order.id);
    // 到期扫描不会把刚复活的行再扫掉
    await subscriptionsService.sweepExpiredSubscriptions(500);
    const still = await pool.query<{ status: string }>(
      `select status from metering.subscriptions where id = $1`,
      [subId],
    );
    expect(still.rows[0]!.status).toBe("active");
  }, 30_000);
});
