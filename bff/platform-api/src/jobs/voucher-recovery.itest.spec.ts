/**
 * voucher-recovery.itest.spec.ts - Durable recovery through actual platform composition.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// ⚠️ 跨层引用: the application composes public domain services with real database roles.
import { PgWalletLedger } from "@vxture/service-billing";
import {
  PgVoucherManagement,
  PgPromotionRepository,
  PromotionService,
  type VoucherScope,
  type CreateBatchCommand,
} from "@vxture/service-promotion";
import {
  OrderService,
  PgOrderRepository,
  PgSubscriptionRepository,
  SubscriptionService,
  AddonService,
  PgAddonRepository,
} from "@vxture/service-subscription";
import {
  PgProvisioningRepository,
  ProvisioningService,
} from "@vxture/service-provisioning";
import type { OrganizationService } from "@vxture/service-organization";
import { CustomerNotificationsWiring } from "../notifications/customer-notifications.wiring";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { JOB_NAME, OrderPaymentExpiryJob } from "./order-payment-expiry.job";

// ============================================================================
// The suite cannot write until its disposable loopback target marker is proven.
// ============================================================================
describe.skipIf(process.env["VOUCHER_RECOVERY_ITEST"] !== "1")(
  "platform voucher recovery",
  () => {
    let owner: Pool, customer: Pool, admin: Pool;
    const runtimes: Pool[] = [];
    beforeAll(async () => {
      const runId = process.env["VOUCHER_RECOVERY_OWNED_RUN_ID"];
      expect(runId).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
      const url = new URL(
        process.env["VOUCHER_RECOVERY_OWNED_DATABASE_URL"] ?? "",
      );
      expect(url.protocol).toBe("postgresql:");
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.username).toBe("postgres");
      expect(url.password).toBe("");
      expect(url.pathname).toBe("/voucher_recovery");
      expect(url.search + url.hash).toBe("");
      expect(Number(url.port)).toBeGreaterThan(0);
      const connection = {
        host: "127.0.0.1",
        port: Number(url.port),
        database: "voucher_recovery",
        connectionTimeoutMillis: 3000,
        statement_timeout: 15000,
        idle_in_transaction_session_timeout: 15000,
        lock_timeout: 10000,
      };
      owner = new Pool({ ...connection, user: "postgres" });
      expect(
        (
          await owner.query(
            "select current_database() db,current_user role,shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()",
          )
        ).rows,
      ).toEqual([
        {
          db: "voucher_recovery",
          role: "postgres",
          marker: "codex-voucher-recovery:" + runId,
        },
      ]);
      customer = new Pool({ ...connection, user: "svc_console_bff" });
      admin = new Pool({ ...connection, user: "svc_admin_bff" });
      for (const role of ["platform_svc", "svc_platform_api"])
        runtimes.push(new Pool({ ...connection, user: role, max: 10 }));
    });
    afterAll(async () => {
      vi.restoreAllMocks();
      await Promise.all(runtimes.map((pool) => pool.end()));
      await customer?.end();
      await admin?.end();
      await owner?.end();
    });

    // ============================================================================
    // Complete DDL fixtures preserve membership, seats and all source guards.
    // ============================================================================
    const creator = randomUUID(),
      reviewer = randomUUID();
    const actor = { actorType: "operator" as const, actorId: reviewer };
    const command = () => ({
      idempotencyKey: randomUUID(),
      reason: "S07-R3c3 synthetic acceptance",
    });
    const management = () => new PgVoucherManagement(admin);
    async function fixture() {
      const scope: VoucherScope = {
        tenantId: randomUUID(),
        workspaceId: randomUUID(),
        userId: randomUUID(),
      };
      const productId = randomUUID(),
        bundledId = randomUUID(),
        planId = randomUUID(),
        versionId = randomUUID();
      await owner.query(
        "insert into account.users(id,account,phone,phone_verified_at) values($1::uuid,$1::text,$2,now())",
        [scope.userId, `+${Date.now()}${Math.floor(Math.random() * 100000)}`],
      );
      await owner.query(
        "insert into tenancy.tenants(id,name,type,owner_user_id) values($1,'Subscription QA','organization',$2)",
        [scope.tenantId, scope.userId],
      );
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1,$2,'Subscription QA')",
        [scope.workspaceId, scope.tenantId],
      );
      const tenantRole = randomUUID(),
        workspaceRole = randomUUID();
      await owner.query(
        "insert into access.roles(id,role_code,scope) values($1::uuid,$1::text,'tenant'),($2::uuid,$2::text,'workspace')",
        [tenantRole, workspaceRole],
      );
      await owner.query(
        "insert into tenancy.tenant_memberships(tenant_id,user_id,role_id,role_scope) values($1,$2,$3,'tenant')",
        [scope.tenantId, scope.userId, tenantRole],
      );
      await owner.query(
        "insert into tenancy.workspace_memberships(tenant_id,workspace_id,user_id,role_id,role_scope) values($1,$2,$3,$4,'workspace')",
        [scope.tenantId, scope.workspaceId, scope.userId, workspaceRole],
      );
      for (const id of [productId, bundledId]) {
        await owner.query(
          "insert into product.products(id,product_code,product_name,product_type,status,release_stage) values($1::uuid,$1::text,'Subscription QA','agent','active','stable')",
          [id],
        );
        await owner.query(
          "insert into product.product_webhooks(product_id,webhook_url) values($1,'https://example.invalid/never-dispatched')",
          [id],
        );
      }
      await owner.query(
        "insert into product.product_metrics(product_id,metric_key,merge_strategy,consume_mode,cost_class,reset_period) values($1,'calls','pool','atomic','zero_cost','day')",
        [productId],
      );
      await owner.query(
        "insert into product.plans(id,plan_code,plan_name) values($1::uuid,$1::text,'Subscription QA')",
        [planId],
      );
      await owner.query(
        "insert into product.plan_versions(id,plan_id,version_no) values($1,$2,1)",
        [versionId, planId],
      );
      await owner.query(
        `insert into product.plan_components(plan_version_id,product_id,tier,component_role,quota,features) values($1,$2,'pro','primary','{"calls":100,"seat.max":5}',array['feature.qa']),($1,$3,null,'bundled','{"seat.max":5}','{}')`,
        [versionId, productId, bundledId],
      );
      await owner.query(
        "insert into product.plan_prices(plan_version_id,cycle_unit,price) values($1,'month',100)",
        [versionId],
      );
      await owner.query(
        "update product.plan_versions set status='published',is_locked=true where id=$1",
        [versionId],
      );
      await owner.query(
        "update product.plans set current_version_id=$2 where id=$1",
        [planId, versionId],
      );
      return { scope, productId, bundledId, versionId };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    async function voucher(
      f: Fixture,
      kind: CreateBatchCommand["kind"] = "redemption",
      amount = 2000,
    ) {
      const effect =
        kind === "redemption"
          ? {
              plan_version_id: f.versionId,
              duration_days: 30,
              funding_source: "operator_grant",
            }
          : kind === "extension"
            ? { extend_days: 7 }
            : { amount_cents: amount };
      const { batchId } = await management().createBatch(creator, {
        ...command(),
        kind,
        name: "Subscription QA",
        effect,
        totalCount: 10,
        perUserLimit: 10,
        tenantId: f.scope.tenantId,
        validFrom: new Date(Date.now() - 60000).toISOString(),
        validUntil: new Date(Date.now() + 864000000).toISOString(),
        returnPolicy: kind === "credit_voucher" ? "full_reversal_only" : "none",
      });
      const revision = (
        await owner.query(
          "select extract(epoch from updated_at)::text revision from promotion.voucher_batches where id=$1",
          [batchId],
        )
      ).rows[0].revision;
      await management().actOnBatch(reviewer, batchId, {
        ...command(),
        action: "review",
        expectedRevision: revision,
      });
      const assigned = await management().assign(creator, {
        ...command(),
        batchId,
        count: 1,
        targetTenantId: f.scope.tenantId,
        targetUserId: f.scope.userId,
      });
      return assigned.voucherIds[0]!;
    }

    function app(pool: Pool) {
      const repository = new PgOrderRepository(pool);
      const subscriptions = new PgSubscriptionRepository(pool);
      const provisioning = new ProvisioningService(
        new PgProvisioningRepository(pool),
        {
          maxAttempts: 1,
          backoffBaseSec: 1,
          backoffCapSec: 1,
          leaseSeconds: 30,
          batchSize: 10,
          timeoutMs: 100,
        },
        { resolve: () => null },
        { deliveryFailed: () => undefined },
      );
      const lifecycle = new SubscriptionService(subscriptions, provisioning);
      const promotion = new PromotionService(new PgPromotionRepository(pool));
      const orders = new OrderService(
        repository,
        subscriptions,
        lifecycle,
        promotion,
      );
      const addons = new AddonService(new PgAddonRepository(pool));
      const wiring = new CustomerNotificationsWiring(
        pool,
        orders,
        lifecycle,
        addons,
        {
          setCustomerNotifier: () => undefined,
        } as unknown as OrganizationService,
      );
      // Channel delivery has its own acceptance suite; no external sends belong here.
      vi.spyOn(wiring.dispatcher, "notify").mockResolvedValue({
        inboxCreated: 0,
        emailsSent: 0,
        emailsFailed: 0,
        smsSent: 0,
        smsFailed: 0,
        skipped: 1,
      });
      wiring.onModuleInit();
      const heartbeat = new JobHeartbeatService(pool);
      return {
        repository,
        lifecycle,
        promotion,
        orders,
        addons,
        heartbeat,
        job: new OrderPaymentExpiryJob(orders, addons, heartbeat),
      };
    }

    async function checkout(cash = false) {
      const f = await fixture();
      const buyer = app(customer),
        operator = app(admin);
      const v = cash ? null : await voucher(f, "credit_voucher", 2000);
      const result = await buyer.orders.createOrder({
        tenantId: f.scope.tenantId,
        workspaceId: f.scope.workspaceId,
        planVersionId: f.versionId,
        cycleUnit: "month",
        price: 100,
        createdBy: f.scope.userId,
        intent: "new",
        itemName: "Recovery QA",
      });
      if (cash) {
        // Seed a synthetic, fully settled cash receipt. This is fixture preparation,
        // not a payment endpoint or a transfer performed by the recovery process.
        await owner.query(
          `insert into billing.payments(tenant_id,bill_id,pay_order_no,pay_source,total_amount,paid_amount,currency,pay_status,paid_at,actor_type,actor_id)
        values($1,$2,$3,'offline',100,100,'CNY','paid',now(),'operator',$4)`,
          [f.scope.tenantId, result.invoiceId, "QA-" + randomUUID(), creator],
        );
        await owner.query(
          "update billing.invoices set paid_amount=100,bill_status='paid',paid_at=now() where id=$1",
          [result.invoiceId],
        );
        await owner.query(
          "update billing.orders set status='paid',paid_at=now() where id=$1",
          [result.order.id],
        );
        await operator.orders.fulfill(result.order.id, actor);
      } else {
        await new PgWalletLedger(customer).post(
          {
            tenantId: f.scope.tenantId,
            actorId: f.scope.userId,
            actorType: "customer",
            currency: "CNY",
          },
          { action: "bonus", amountCents: 10000, idempotencyKey: randomUUID() },
        );
        await buyer.orders.declarePayment({
          orderId: result.order.id,
          tenantId: f.scope.tenantId,
          userId: f.scope.userId,
          payChannel: "balance",
          creditVoucherId: v!,
        });
      }
      expect((await buyer.orders.getOrder(result.order.id)).status).toBe(
        "fulfilled",
      );
      const refund = await operator.orders.createOperatorRefund({
        orderId: result.order.id,
        operatorId: creator,
        reason: "Synthetic full reversal",
      });
      if (cash) {
        await operator.orders.auditRefund(refund.id, {
          decision: "approved",
          remark: "Synthetic approval",
          operatorId: reviewer,
        });
        await operator.orders.initiateRefundTransfer(
          refund.id,
          { channel: "alipay", reference: "QA-" + randomUUID() },
          actor,
        );
      }
      return { ...f, ...result, operator, buyer, refund, voucherId: v };
    }
    type Checkout = Awaited<ReturnType<typeof checkout>>;

    async function persist(c: Checkout) {
      const failure = vi
        .spyOn(c.operator.lifecycle, "cancelSubscription")
        .mockRejectedValueOnce(new Error("controlled process interruption"));
      try {
        if (
          (await c.operator.repository.getRefundById(c.refund.id))!
            .auditStatus === "pending"
        )
          await c.operator.orders.auditRefund(c.refund.id, {
            decision: "approved",
            remark: "Synthetic approval",
            operatorId: reviewer,
          });
        else await c.operator.orders.executeRefund(c.refund.id, actor);
      } finally {
        failure.mockRestore();
      }
      expect(
        (await c.operator.repository.getRefundById(c.refund.id))!.refundStatus,
      ).toBe("success");
      expect((await state(c)).subscription).toBe("active");
    }
    async function state(c: Checkout) {
      return (
        await owner.query(
          `select o.status,s.status subscription,
      (select status from promotion.voucher_compensations where order_id=o.id) compensation,
      (select replacement_voucher_id from promotion.voucher_compensations where order_id=o.id) replacement
      from billing.orders o join metering.subscriptions s on s.id=o.subscription_id where o.id=$1`,
          [c.order.id],
        )
      ).rows[0];
    }
    async function money(c: Checkout) {
      const transactions = (
        await owner.query(
          "select id,trade_type,amount,balance_before,balance_after from billing.transactions where tenant_id=$1 order by id",
          [c.scope.tenantId],
        )
      ).rows;
      const entries = (
        await owner.query(
          "select e.* from billing.wallet_entries e join billing.wallet_lots l on l.id=e.lot_id join billing.credits c on c.id=l.credit_id where c.tenant_id=$1 order by e.id",
          [c.scope.tenantId],
        )
      ).rows;
      const refunds = (
        await owner.query(
          "select refund_status,refund_amount,transfer_attempt,transfer_reference,transfer_initiated_at,transfer_channel from billing.refunds where id=$1",
          [c.refund.id],
        )
      ).rows;
      return { transactions, entries, refunds };
    }
    async function replacementCount(c: Checkout) {
      return Number(
        (
          await owner.query(
            "select count(*) n from promotion.vouchers where replacement_of_redemption_id in(select id from promotion.voucher_redemptions where order_id=$1)",
            [c.order.id],
          )
        ).rows[0].n,
      );
    }

    // ============================================================================
    // New process instances use only persisted evidence; no scheduler is started.
    // ============================================================================
    it.each([0, 1])(
      "uses real runtime role %i without owner privileges",
      async (index) => {
        const pool = runtimes[index]!;
        expect(
          (
            await pool.query(
              "select current_user role,rolsuper from pg_roles where rolname=current_user",
            )
          ).rows,
        ).toEqual([
          {
            role: index === 0 ? "platform_svc" : "svc_platform_api",
            rolsuper: false,
          },
        ]);
        await expect(
          pool.query("update billing.refunds set calculation_snapshot='{}'"),
        ).rejects.toThrow();
      },
    );

    it.each([0, 1])(
      "recovers a committed wallet refund after restart under role %i",
      async (index) => {
        const c = await checkout();
        await persist(c);
        expect((await state(c)).compensation).toBe("pending");
        const before = await money(c);
        expect(
          before.entries.filter((entry) => entry.entry_type === "restore"),
        ).toHaveLength(1);
        expect(before.refunds[0].transfer_channel).toBe("balance");
        const restarted = app(runtimes[index]!);
        const execute = vi.spyOn(restarted.orders, "executeRefund");
        const transfer = vi.spyOn(restarted.orders, "initiateRefundTransfer");
        await restarted.job.tick();
        expect(await state(c)).toMatchObject({
          status: "refunded",
          subscription: "cancelled",
          compensation: "completed",
        });
        expect(await replacementCount(c)).toBe(1);
        expect(await money(c)).toEqual(before);
        expect(execute).not.toHaveBeenCalled();
        expect(transfer).not.toHaveBeenCalled();
        await app(runtimes[index]!).job.tick();
        expect(await replacementCount(c)).toBe(1);
        expect(await money(c)).toEqual(before);
        const heartbeat = (
          await owner.query(
            "select status,last_items_processed from provisioning.background_jobs where job_name=$1",
            [JOB_NAME],
          )
        ).rows[0];
        expect(heartbeat).toMatchObject({
          status: "success",
          last_items_processed: 0,
        });
      },
    );

    it("serializes concurrent restarted workers without duplicate replacements or wallet restores", async () => {
      const c = await checkout();
      await persist(c);
      const before = await money(c);
      const subscriptionId = (await c.operator.orders.getOrder(c.order.id))
        .subscriptionId!;
      await app(runtimes[1]!).lifecycle.cancelSubscription(
        subscriptionId,
        undefined,
        "Synthetic effect reversal before competing issuance",
        "system",
        c.order.id,
      );
      const workers = [app(runtimes[0]!), app(runtimes[1]!), app(runtimes[1]!)];
      const blocker = await owner.connect();
      await blocker.query("begin");
      await blocker.query(
        "select id from billing.orders where id=$1 for update",
        [c.order.id],
      );
      const pending = Promise.all(workers.map((worker) => worker.job.tick()));
      try {
        // The first issuance waits on the order FK in its event, the others on
        // its unique batch. No issuance can commit while this lock is held.
        // All three must have read the pending intention before any can commit.
        await vi.waitFor(
          async () => {
            const waiting =
              await owner.query(`select count(*) n from pg_stat_activity
          where datname=current_database() and usename in ('platform_svc','svc_platform_api')
          and wait_event_type='Lock' and (query like '%promotion.voucher_batches%' or query like '%promotion.voucher_events%' or query like '%billing.orders%for update%')`);
            expect(Number(waiting.rows[0].n)).toBe(3);
          },
          { timeout: 5000, interval: 20 },
        );
      } finally {
        await blocker.query("rollback");
        blocker.release();
        await pending;
      }
      expect((await state(c)).compensation).toBe("completed");
      expect(await replacementCount(c)).toBe(1);
      expect(await money(c)).toEqual(before);
    });

    it("rolls a failed replacement transaction back and retries on the next tick", async () => {
      const c = await checkout();
      await persist(c);
      const before = await money(c);
      const compensation = (
        await owner.query(
          "select id from promotion.voucher_compensations where order_id=$1",
          [c.order.id],
        )
      ).rows[0].id as string;
      // Controlled database fault after batch preparation, before replacement commit.
      await owner.query(`create function promotion.qa_recovery_fail() returns trigger language plpgsql as $$ begin
      if NEW.replacement_of_redemption_id is not null then raise exception 'controlled replacement failure'; end if; return NEW; end $$;
      create trigger qa_recovery_fail before insert on promotion.vouchers for each row execute function promotion.qa_recovery_fail()`);
      const worker = app(runtimes[1]!);
      try {
        await worker.job.tick();
      } finally {
        await owner.query(
          "drop trigger qa_recovery_fail on promotion.vouchers; drop function promotion.qa_recovery_fail()",
        );
      }
      expect((await state(c)).compensation).toBe("pending");
      expect(await replacementCount(c)).toBe(0);
      expect(
        (
          await owner.query(
            "select id from promotion.voucher_batches where id=$1",
            [compensation],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await owner.query(
            "select status,last_error from provisioning.background_jobs where job_name=$1",
            [JOB_NAME],
          )
        ).rows[0],
      ).toMatchObject({
        status: "failed",
        last_error: expect.stringContaining("compensation(s) failed"),
      });
      expect(await money(c)).toEqual(before);
      await worker.job.tick();
      expect((await state(c)).compensation).toBe("completed");
      expect(await replacementCount(c)).toBe(1);
      expect(await money(c)).toEqual(before);
    });

    it("does not recover or refund a rolled-back financial settlement", async () => {
      const c = await checkout();
      const before = await money(c);
      const failure = vi
        .spyOn(c.operator.promotion, "queueRefundCompensations")
        .mockRejectedValueOnce(new Error("controlled intention failure"));
      try {
        await expect(
          c.operator.orders.auditRefund(c.refund.id, {
            decision: "approved",
            remark: "Synthetic approval",
            operatorId: reviewer,
          }),
        ).rejects.toThrow("controlled intention failure");
      } finally {
        failure.mockRestore();
      }
      expect(await money(c)).toEqual(before);
      expect(await state(c)).toMatchObject({
        status: "fulfilled",
        subscription: "active",
        compensation: null,
      });
      await app(runtimes[1]!).job.tick();
      expect(await state(c)).toMatchObject({
        status: "fulfilled",
        subscription: "active",
        compensation: null,
      });
      expect(await money(c)).toEqual(before);
      await persist(c);
      await app(runtimes[1]!).job.tick();
      expect((await state(c)).compensation).toBe("completed");
    });

    it("recovers a cash-refunded effect without repeating its transfer or cash ledger", async () => {
      const c = await checkout(true);
      await persist(c);
      const before = await money(c);
      expect(before.refunds[0]).toMatchObject({
        refund_status: "success",
        transfer_attempt: 1,
        transfer_channel: "alipay",
      });
      expect(
        before.transactions.filter(
          (transaction) => transaction.trade_type === "refund",
        ),
      ).toHaveLength(1);
      const worker = app(runtimes[1]!);
      const transfer = vi.spyOn(worker.orders, "initiateRefundTransfer");
      const execute = vi.spyOn(worker.orders, "executeRefund");
      await worker.job.tick();
      await app(runtimes[0]!).job.tick();
      expect((await state(c)).subscription).toBe("cancelled");
      expect(await money(c)).toEqual(before);
      expect(transfer).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    });
  },
);
