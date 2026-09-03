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
  let promotion: PromotionService;
  let orders: OrdersRouter;
  let payments: PaymentsRouter;
  let commercial: CommercialRouter;

  let userId: string;
  let tenantId: string;
  let planVersionId: string;

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

  async function mkOrder(price = 1200): Promise<string> {
    const { order } = await orderService.createOrder({
      tenantId,
      workspaceId: await mkWorkspace(),
      planVersionId,
      cycleUnit: "month",
      price,
      createdBy: userId,
      intent: "new",
      itemName: "Arda Pro (e2e)",
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
    const subscriptions = new SubscriptionService(
      subRepo,
      provisioning,
      promotion,
    );
    orderService = new OrderService(
      new PgOrderRepository(pool),
      subRepo,
      subscriptions,
      promotion,
    );
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
    await orderService.declarePayment({
      orderId,
      tenantId,
      userId,
      payChannel: "alipay",
    });
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
    await orderService.declarePayment({
      orderId,
      tenantId,
      userId,
      payChannel: "alipay",
    });
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
});
