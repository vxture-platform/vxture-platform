/**
 * invitation-order.itest.spec.ts - Real PostgreSQL invitation/order atomicity.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import type { Request } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// ⚠️ 跨层引用: Exercise public domain APIs within the BFF transaction boundary.
import {
  hasInvitation,
  redeemInvitationTx,
  type InvitationScope,
  PromotionService,
  PgPromotionRepository,
  PgVoucherManagement,
} from "@vxture/service-promotion";
// ⚠️ 跨层引用: Use the actual order repository, including invoice and order event writes.
import {
  PgOrderRepository,
  PgSubscriptionRepository,
  OrderService,
  SubscriptionService,
} from "@vxture/service-subscription";
import { withOrderCreationOperation } from "./order-creation-operation";
import { SubscriptionRouter } from "../routers/subscription.router";
import type { RequestContext } from "../types/console.types";

// ===========================================================================
// Only a runner-owned, marked loopback database is accepted by this suite.
// ===========================================================================
describe.skipIf(process.env["INVITATION_ITEST"] !== "1")(
  "invitation order PostgreSQL",
  () => {
    let owner: Pool;
    let runtime: Pool, customer: Pool;
    let repository: PgOrderRepository;
    beforeAll(async () => {
      const runId = process.env["VOUCHER_INVITATION_OWNED_RUN_ID"];
      expect(runId).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
      );
      const url = new URL(
        process.env["VOUCHER_INVITATION_OWNED_DATABASE_URL"] ?? "",
      );
      expect(url.protocol).toBe("postgresql:");
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.username).toBe("postgres");
      expect(url.password).toBe("");
      expect(url.pathname).toBe("/voucher_invitation");
      expect(url.search + url.hash).toBe("");
      expect(Number(url.port)).toBeGreaterThan(0);
      const connection = {
        host: "127.0.0.1",
        port: Number(url.port),
        database: "voucher_invitation",
        connectionTimeoutMillis: 3000,
        statement_timeout: 15000,
        lock_timeout: 10000,
      };
      owner = new Pool({ ...connection, user: "postgres" });
      const identity = await owner.query(
        "select current_database() db, current_user role, shobj_description(oid, 'pg_database') marker from pg_database where datname=current_database()",
      );
      expect(identity.rows).toEqual([
        {
          db: "voucher_invitation",
          role: "postgres",
          marker: "codex-voucher-invitation:" + runId,
        },
      ]);
      runtime = new Pool({ ...connection, user: "platform_svc", max: 12 });
      customer = new Pool({ ...connection, user: "svc_console_bff", max: 12 });
      repository = new PgOrderRepository(runtime);
    }, 60000);
    afterAll(async () => {
      await customer?.end();
      await runtime?.end();
      await owner?.end();
    }, 60000);

    async function fixture() {
      const userId = randomUUID();
      const tenantId = randomUUID();
      const workspaceId = randomUUID();
      const workspace2 = randomUUID();
      const productId = randomUUID();
      const planId = randomUUID();
      const planVersionId = randomUUID();
      const planCode = `b03-${planId}`;
      await owner.query(
        "insert into account.users(id,account,phone,phone_verified_at) values ($1,$2,$3,now())",
        [userId, userId, `+${Date.now()}${Math.floor(Math.random() * 10000)}`],
      );
      await owner.query(
        "insert into tenancy.tenants(id,name,type,owner_user_id) values ($1,'B03','organization',$2)",
        [tenantId, userId],
      );
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values ($1,$3,'B03 A'),($2,$3,'B03 B')",
        [workspaceId, workspace2, tenantId],
      );
      await owner.query(
        "insert into product.products(id,product_code,product_name,product_type,status,release_stage) values ($1,$2,'B03','agent','active','stable')",
        [productId, planCode],
      );
      await owner.query(
        "insert into product.plans(id,plan_code,plan_name,is_public) values ($1,$2,'B03',false)",
        [planId, planCode],
      );
      await owner.query(
        "insert into product.plan_versions(id,plan_id,version_no) values ($1,$2,1)",
        [planVersionId, planId],
      );
      await owner.query(
        "insert into product.plan_components(plan_version_id,product_id,tier,component_role,quota) values ($1,$2,'pro','primary','{\"seat.max\":5}')",
        [planVersionId, productId],
      );
      await owner.query(
        "insert into product.plan_prices(plan_version_id,cycle_unit,price) values ($1,'month',100)",
        [planVersionId],
      );
      await owner.query(
        "update product.plan_versions set is_locked=true where id=$1",
        [planVersionId],
      );
      await owner.query(
        "update product.plans set current_version_id=$2 where id=$1",
        [planId, planVersionId],
      );
      const batchId = randomUUID();
      const voucherId = randomUUID();
      await owner.query(
        `insert into promotion.voucher_batches(id,tenant_id,kind,name,effect,total_count,valid_from,valid_until)
      values ($1,$2,'invite','B03',$3,1,now()-interval '1 day',now()+interval '1 day')`,
        [
          batchId,
          tenantId,
          JSON.stringify({
            effect_version: 1,
            plan_version_id: planVersionId,
            plan_code: planCode,
          }),
        ],
      );
      await owner.query(
        `insert into promotion.vouchers(id,batch_id,code,status,assigned_user_id,assigned_tenant_id)
      values ($1::uuid,$2,$1::text,'assigned',$3,$4)`,
        [voucherId, batchId, userId, tenantId],
      );
      const tenantRole = randomUUID(),
        workspaceRole = randomUUID();
      await owner.query(
        "insert into access.roles(id,role_code,scope) values($1::uuid,$1::text,'tenant'),($2::uuid,$2::text,'workspace')",
        [tenantRole, workspaceRole],
      );
      await owner.query(
        "insert into tenancy.tenant_memberships(tenant_id,user_id,role_id,role_scope) values($1,$2,$3,'tenant')",
        [tenantId, userId, tenantRole],
      );
      await owner.query(
        "insert into tenancy.workspace_memberships(tenant_id,workspace_id,user_id,role_id,role_scope) values($1,$2,$4,$5,'workspace'),($1,$3,$4,$5,'workspace')",
        [tenantId, workspaceId, workspace2, userId, workspaceRole],
      );
      const scope: InvitationScope = {
        userId,
        tenantId,
        workspaceId,
        planVersionId,
        planCode,
      };
      return { scope, workspace2, batchId, voucherId };
    }
    async function create(
      scope: InvitationScope,
      key: string,
      fail?: "order" | "redemption" | "event",
    ) {
      return withOrderCreationOperation(
        customer,
        {
          ...scope,
          key,
          request: { planVersionId: scope.planVersionId, cycleUnit: "month" },
        },
        async (client) => {
          const created = await new PgOrderRepository(customer).createOrder(
            {
              tenantId: scope.tenantId,
              workspaceId: scope.workspaceId,
              planVersionId: scope.planVersionId,
              cycleUnit: "month",
              price: 100,
              createdBy: scope.userId,
              intent: "new",
              itemName: "B03",
            },
            client,
          );
          if (fail === "order") throw new Error("injected order failure");
          return {
            result: { orderId: created.order.id, invoiceId: created.invoiceId },
            onCreated: async (operationId: string) => {
              if (fail === "redemption")
                throw new Error("injected redemption failure");
              await redeemInvitationTx(
                client,
                scope,
                created.order.id,
                operationId,
              );
              if (fail === "event") throw new Error("injected event failure");
            },
          };
        },
      );
    }
    async function counts(scope: InvitationScope) {
      const { rows } = await owner.query(
        `select
      (select count(*)::int from billing.orders where tenant_id=$1) orders,
      (select count(*)::int from billing.invoices where tenant_id=$1) invoices,
      (select count(*)::int from promotion.voucher_operations where actor_id=$2) operations,
      (select count(*)::int from promotion.voucher_redemptions where tenant_id=$1) redemptions,
      (select count(*)::int from promotion.voucher_events where actor_id=$2) events`,
        [scope.tenantId, scope.userId],
      );
      return rows[0];
    }

    // ===========================================================================
    // Atomic commits, retry receipts and contended invitation/order resources.
    // ===========================================================================
    async function settlementFixture() {
      const f = await fixture();
      await owner.query(
        "update promotion.voucher_batches set kind='discount',effect='{" +
          '"discount_type":"fixed","value":1000' +
          "}' where id=$1",
        [f.batchId],
      );
      const order = await repository.createOrder({
        tenantId: f.scope.tenantId,
        workspaceId: f.scope.workspaceId,
        planVersionId: f.scope.planVersionId,
        price: 100,
        cycleUnit: "month",
        intent: "new",
        createdBy: f.scope.userId,
        itemName: "B04",
      });
      const promotion = new PromotionService(
        new PgPromotionRepository(runtime),
      );
      const context = { orderId: order.order.id, invoiceId: order.invoiceId };
      return { ...f, promotion, context, order };
    }
    async function tx<T>(
      run: (client: import("pg").PoolClient) => Promise<T>,
    ): Promise<T> {
      const client = await runtime.connect();
      try {
        await client.query("begin");
        const result = await run(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
    it("B04 persists ownership, releases once, and a stale release cannot free a new reservation", async () => {
      const f = await settlementFixture();
      const reserve = () =>
        tx(async (client) => {
          await client.query(
            "select id from billing.orders where id=$1 for update",
            [f.context.orderId],
          );
          const rows = await f.promotion.reserveForOrder(client, {
            scope: f.scope,
            discountVoucherId: f.voucherId,
          });
          await f.promotion.recordReservations(
            client,
            f.context,
            f.scope,
            rows,
          );
          return rows[0]!;
        });
      const first = await reserve();
      const operatorId = randomUUID();
      const release = (id: string) =>
        tx((client) =>
          f.promotion.releaseReserved(client, {
            ...f.context,
            discountVoucherId: f.voucherId,
            discountReservationId: id,
            reason: "rejected",
            actor: { realm: "operator", id: operatorId },
          }),
        );
      expect(await release(first.reservationId)).toEqual([f.voucherId]);
      expect(
        (
          await owner.query(
            "select actor_realm,actor_id from promotion.voucher_events where reservation_id=$1 and event_type='released'",
            [first.reservationId],
          )
        ).rows[0],
      ).toEqual({ actor_realm: "operator", actor_id: operatorId });
      const second = await reserve();
      expect(second.reservationId).not.toBe(first.reservationId);
      expect(await release(first.reservationId)).toEqual([]);
      expect(
        (
          await owner.query(
            "select status,used_count from promotion.vouchers where id=$1",
            [f.voucherId],
          )
        ).rows[0],
      ).toEqual({ status: "reserved", used_count: 1 });
      expect(await release(second.reservationId)).toEqual([f.voucherId]);
    });
    it("B04 finalizes the frozen reservation after pause and expiry, exactly once", async () => {
      const f = await settlementFixture();
      const rows = await tx(async (client) => {
        await client.query(
          "select id from billing.orders where id=$1 for update",
          [f.context.orderId],
        );
        const reserved = await f.promotion.reserveForOrder(client, {
          scope: f.scope,
          discountVoucherId: f.voucherId,
        });
        await f.promotion.recordReservations(
          client,
          f.context,
          f.scope,
          reserved,
          { discountOffCents: 1000 },
        );
        return reserved;
      });
      await owner.query(
        "update promotion.voucher_batches set status='paused',valid_from=now()-interval '2 days',valid_until=now()-interval '1 day',effect='{}' where id=$1",
        [f.batchId],
      );
      const finalize = () =>
        tx((client) =>
          f.promotion.finalizeReserved(client, [
            {
              ...f.context,
              scope: f.scope,
              voucherId: f.voucherId,
              reservationId: rows[0]!.reservationId,
              kind: "discount",
              effectSnapshot: { tampered: true },
            },
          ]),
        );
      const first = await finalize();
      expect(await finalize()).toEqual(first);
      const redemption = (
        await owner.query(
          "select effect_snapshot,reservation_id,order_id from promotion.voucher_redemptions where voucher_id=$1",
          [f.voucherId],
        )
      ).rows;
      expect(redemption).toHaveLength(1);
      expect(redemption[0]).toMatchObject({
        effect_snapshot: { discount_type: "fixed", value: 1000 },
        order_id: f.context.orderId,
      });
      await expect(
        tx((client) =>
          f.promotion.releaseReserved(client, {
            ...f.context,
            discountVoucherId: f.voucherId,
            discountReservationId: rows[0]!.reservationId,
          }),
        ),
      ).rejects.toMatchObject({
        response: { code: "VOUCHER_RESERVATION_CONFLICT" },
      });
    });
    it("B04 concurrent reserve has one winner and rollback leaves no receipt", async () => {
      const f = await settlementFixture();
      const other = await repository.createOrder({
        tenantId: f.scope.tenantId,
        workspaceId: f.workspace2,
        planVersionId: f.scope.planVersionId,
        price: 100,
        cycleUnit: "month",
        intent: "new",
        createdBy: f.scope.userId,
        itemName: "B04",
      });
      const contexts = [
        f.context,
        { orderId: other.order.id, invoiceId: other.invoiceId },
      ];
      const run = (index: number, fail = false) =>
        tx(async (client) => {
          const context = contexts[index]!;
          await client.query(
            "select id from billing.orders where id=$1 for update",
            [context.orderId],
          );
          const scope = {
            ...f.scope,
            workspaceId: index === 0 ? f.scope.workspaceId : f.workspace2,
          };
          const reserved = await f.promotion.reserveForOrder(client, {
            scope,
            discountVoucherId: f.voucherId,
          });
          await f.promotion.recordReservations(
            client,
            context,
            scope,
            reserved,
          );
          if (fail) throw new Error("injected reservation failure");
          return reserved;
        });
      await expect(run(0, true)).rejects.toThrow("injected");
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.voucher_reservations where voucher_id=$1",
            [f.voucherId],
          )
        ).rows[0].n,
      ).toBe(0);
      const result = await Promise.allSettled([run(0), run(1)]);
      expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.voucher_reservations where voucher_id=$1",
            [f.voucherId],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("B04 rejects another order's reservation for both terminal paths", async () => {
      const f = await settlementFixture();
      const other = await settlementFixture();
      const reserved = await tx(async (client) => {
        await client.query(
          "select id from billing.orders where id=$1 for update",
          [f.context.orderId],
        );
        const rows = await f.promotion.reserveForOrder(client, {
          scope: f.scope,
          discountVoucherId: f.voucherId,
        });
        await f.promotion.recordReservations(client, f.context, f.scope, rows);
        return rows[0]!;
      });
      await expect(
        tx((client) =>
          f.promotion.releaseReserved(client, {
            ...other.context,
            discountVoucherId: f.voucherId,
            discountReservationId: reserved.reservationId,
          }),
        ),
      ).rejects.toMatchObject({
        response: { code: "VOUCHER_RESERVATION_CONFLICT" },
      });
      await expect(
        tx((client) =>
          f.promotion.finalizeReserved(client, [
            {
              ...other.context,
              scope: other.scope,
              voucherId: f.voucherId,
              reservationId: reserved.reservationId,
              kind: "discount",
              effectSnapshot: {},
            },
          ]),
        ),
      ).rejects.toMatchObject({
        response: { code: "VOUCHER_RESERVATION_CONFLICT" },
      });
      expect(
        (
          await owner.query(
            "select status from promotion.voucher_reservations where id=$1",
            [reserved.reservationId],
          )
        ).rows[0].status,
      ).toBe("active");
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.voucher_redemptions where voucher_id=$1",
            [f.voucherId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("B04 rolls back the discount reservation when the second voucher is unavailable", async () => {
      const f = await settlementFixture();
      const subs = new PgSubscriptionRepository(runtime);
      const service = new OrderService(
        repository,
        subs,
        new SubscriptionService(subs, undefined as never),
        f.promotion,
      );
      await expect(
        service.declarePayment({
          orderId: f.context.orderId,
          tenantId: f.scope.tenantId,
          userId: f.scope.userId,
          payChannel: "bank_transfer",
          discountVoucherId: f.voucherId,
          creditVoucherId: randomUUID(),
        }),
      ).rejects.toThrow("不可用或已被占用");
      expect(
        (
          await owner.query(
            "select status,used_count from promotion.vouchers where id=$1",
            [f.voucherId],
          )
        ).rows[0],
      ).toEqual({ status: "assigned", used_count: 0 });
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.voucher_reservations where order_id=$1",
            [f.context.orderId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.payments where bill_id=$1",
            [f.context.invoiceId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("B04 full declaration writes both credential and reservation, then cancellation refuses pending verification", async () => {
      const f = await settlementFixture();
      const subRepo = new PgSubscriptionRepository(runtime);
      const service = new OrderService(
        repository,
        subRepo,
        new SubscriptionService(subRepo, undefined as never),
        f.promotion,
      );
      const input = {
        orderId: f.context.orderId,
        tenantId: f.scope.tenantId,
        userId: f.scope.userId,
        payChannel: "bank_transfer" as const,
        discountVoucherId: f.voucherId,
      };
      const result = await service.declarePayment(input);
      expect(result.outcome).toBe("declared");
      expect((await service.declarePayment(input)).outcome).toBe(
        "already_declared",
      );
      const row = (
        await owner.query(
          "select * from promotion.voucher_reservations where order_id=$1",
          [f.context.orderId],
        )
      ).rows[0];
      const payment = (
        await owner.query(
          "select channel_raw_data from billing.payments where id=$1",
          [row.declaration_payment_id],
        )
      ).rows[0];
      expect(payment.channel_raw_data.settlement.discountReservationId).toBe(
        row.id,
      );
      await expect(
        service.cancel(f.context.orderId, {
          actorType: "customer",
          actorId: f.scope.userId,
        }),
      ).rejects.toThrow("等待确认");
    });
    it("B04 credit-only instant settlement consumes the reservation without a cash declaration", async () => {
      const f = await settlementFixture();
      await owner.query(
        "update promotion.voucher_batches set kind='credit_voucher',effect='{" +
          '"amount_cents":10000' +
          "}' where id=$1",
        [f.batchId],
      );
      const subs = new PgSubscriptionRepository(runtime);
      const service = new OrderService(
        repository,
        subs,
        new SubscriptionService(subs, undefined as never),
        f.promotion,
      );
      const fulfill = vi
        .spyOn(service, "fulfill")
        .mockRejectedValue(new Error("injected provisioning outage"));
      const result = await service.declarePayment({
        orderId: f.context.orderId,
        tenantId: f.scope.tenantId,
        userId: f.scope.userId,
        payChannel: "bank_transfer",
        creditVoucherId: f.voucherId,
      });
      expect(result.outcome).toBe("activating");
      expect(fulfill).toHaveBeenCalledOnce();
      const row = (
        await owner.query(
          "select r.status,r.declaration_payment_id,d.payment_id,p.pay_source,p.paid_amount from promotion.voucher_reservations r join promotion.voucher_redemptions d on d.reservation_id=r.id join billing.payments p on p.id=d.payment_id where r.order_id=$1",
          [f.context.orderId],
        )
      ).rows[0];
      expect(row).toMatchObject({
        status: "consumed",
        declaration_payment_id: null,
        pay_source: "voucher",
        paid_amount: "100.00",
      });
    });
    it("B04 finalize and release compete for one terminal state", async () => {
      const f = await settlementFixture();
      const reserved = await tx(async (client) => {
        await client.query(
          "select id from billing.orders where id=$1 for update",
          [f.context.orderId],
        );
        const result = await f.promotion.reserveForOrder(client, {
          scope: f.scope,
          discountVoucherId: f.voucherId,
        });
        await f.promotion.recordReservations(
          client,
          f.context,
          f.scope,
          result,
        );
        return result[0]!;
      });
      const result = await Promise.allSettled([
        tx((client) =>
          f.promotion.finalizeReserved(client, [
            {
              ...f.context,
              scope: f.scope,
              voucherId: f.voucherId,
              reservationId: reserved.reservationId,
              kind: "discount",
              effectSnapshot: {},
            },
          ]),
        ),
        tx((client) =>
          f.promotion.releaseReserved(client, {
            ...f.context,
            discountVoucherId: f.voucherId,
            discountReservationId: reserved.reservationId,
          }),
        ),
      ]);
      expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const row = (
        await owner.query(
          "select status from promotion.voucher_reservations where id=$1",
          [reserved.reservationId],
        )
      ).rows[0];
      expect(["consumed", "released"]).toContain(row.status);
      const voucher = (
        await owner.query(
          "select status,used_count from promotion.vouchers where id=$1",
          [f.voucherId],
        )
      ).rows[0];
      expect(voucher).toEqual(
        row.status === "consumed"
          ? { status: "redeemed", used_count: 1 }
          : { status: "assigned", used_count: 0 },
      );
    });
    it("B04 adopts only a provable legacy declaration and preserves its frozen effect", async () => {
      const f = await settlementFixture();
      const leg = await tx(async (client) => {
        await f.promotion.reserveForOrder(client, {
          scope: f.scope,
          discountVoucherId: f.voucherId,
        });
        return new PgSubscriptionRepository(runtime).insertCashLegTx(client, {
          tenantId: f.scope.tenantId,
          invoiceId: f.context.invoiceId,
          payChannel: "bank",
          offlinePayType: "bank_transfer",
          payerName: null,
          transactionNo: null,
          remark: null,
          amountYuan: "90.00",
          currency: "CNY",
          actorId: f.scope.userId,
          credential: {
            settlement: {
              discountVoucherId: f.voucherId,
              discountEffectSnapshot: { discount_type: "fixed", value: 1000 },
              declaredBy: f.scope.userId,
              released: false,
            },
          },
        });
      });
      const result = await tx((client) =>
        f.promotion.releaseReserved(client, {
          ...f.context,
          declarationPaymentId: leg,
          discountVoucherId: f.voucherId,
        }),
      );
      expect(result).toEqual([f.voucherId]);
      const rows = (
        await owner.query(
          "select status,declaration_payment_id from promotion.voucher_reservations where order_id=$1",
          [f.context.orderId],
        )
      ).rows;
      expect(rows).toEqual([
        { status: "released", declaration_payment_id: leg },
      ]);
    });
    it("B04 refuses unprovable legacy ownership and rolls back", async () => {
      const f = await settlementFixture();
      await tx((client) =>
        f.promotion.reserveForOrder(client, {
          scope: f.scope,
          discountVoucherId: f.voucherId,
        }),
      );
      await expect(
        tx((client) =>
          f.promotion.releaseReserved(client, {
            ...f.context,
            discountVoucherId: f.voucherId,
          }),
        ),
      ).rejects.toMatchObject({
        response: { code: "VOUCHER_RESERVATION_CONFLICT" },
      });
      expect(
        (
          await owner.query(
            "select status from promotion.vouchers where id=$1",
            [f.voucherId],
          )
        ).rows[0].status,
      ).toBe("reserved");
    });
    it.each(["cancelled", "expired"] as const)(
      "B04 closes orphan reservations with the %s order transaction",
      async (kind) => {
        const f = await settlementFixture();
        await tx(async (client) => {
          await client.query(
            "select id from billing.orders where id=$1 for update",
            [f.context.orderId],
          );
          const result = await f.promotion.reserveForOrder(client, {
            scope: f.scope,
            discountVoucherId: f.voucherId,
          });
          await f.promotion.recordReservations(
            client,
            f.context,
            f.scope,
            result,
          );
        });
        const subs = new PgSubscriptionRepository(runtime);
        const service = new OrderService(
          repository,
          subs,
          new SubscriptionService(subs, undefined as never),
          f.promotion,
        );
        await service.cancel(
          f.context.orderId,
          kind === "expired"
            ? { actorType: "system", actorId: null }
            : { actorType: "customer", actorId: f.scope.userId },
          kind,
        );
        const row = (
          await owner.query(
            "select status,release_reason from promotion.voucher_reservations where order_id=$1",
            [f.context.orderId],
          )
        ).rows[0];
        expect(row).toEqual({
          status: "released",
          release_reason: kind === "expired" ? "order_expired" : "cancelled",
        });
        expect(
          (
            await owner.query(
              "select actor_realm,actor_id from promotion.voucher_events where order_id=$1 and event_type='released'",
              [f.context.orderId],
            )
          ).rows[0],
        ).toEqual({
          actor_realm: kind === "expired" ? "system" : "customer",
          actor_id:
            kind === "expired"
              ? "00000000-0000-0000-0000-000000000000"
              : f.scope.userId,
        });
      },
    );
    // ===========================================================================
    // B06 operator lifecycle uses the runtime role and the same production DDL.
    // ===========================================================================
    const operator = "11111111-1111-4111-8111-111111111111";
    const reviewer = "22222222-2222-4222-8222-222222222222";
    const command = () => ({
      idempotencyKey: randomUUID(),
      reason: "B06 verified operation",
    });
    async function reviewCommand(batchId: string) {
      const revision = (
        await owner.query<{ revision: string }>(
          "select extract(epoch from updated_at)::text revision from promotion.voucher_batches where id=$1",
          [batchId],
        )
      ).rows[0]!.revision;
      return {
        ...command(),
        action: "review" as const,
        expectedRevision: revision,
      };
    }
    async function managedBatch(overrides: Record<string, unknown> = {}) {
      const f = await fixture();
      const management = new PgVoucherManagement(runtime);
      const input = {
        kind: "credit_voucher" as const,
        name: "B06 budget",
        effect: { amount_cents: 1000 },
        totalCount: 2,
        perUserLimit: 2,
        tenantId: f.scope.tenantId,
        validFrom: new Date(Date.now() - 86400000).toISOString(),
        validUntil: new Date(Date.now() + 86400000).toISOString(),
        ...command(),
        ...overrides,
      };
      const { batchId } = await management.createBatch(operator, input);
      const assign = {
        ...command(),
        batchId,
        count: 1,
        targetUserId: f.scope.userId,
      };
      return { ...f, management, input, batchId, assign };
    }
    it("B06 rejects approving a draft that changed after the reviewer opened it", async () => {
      const f = await managedBatch();
      const stale = await reviewCommand(f.batchId);
      await f.management.actOnBatch(operator, f.batchId, {
        ...command(),
        action: "configure",
        configuration: { ...f.input, effect: { amount_cents: 2000 } },
      });
      await expect(
        f.management.actOnBatch(reviewer, f.batchId, stale),
      ).rejects.toThrow("草稿配置已变化");
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      const review = (
        await owner.query(
          "select metadata from promotion.voucher_events where batch_id=$1 and event_type='batch_review'",
          [f.batchId],
        )
      ).rows[0];
      expect(review.metadata.approvedConfiguration.effect).toMatchObject({
        amount_cents: 2000,
      });
    });
    it("B06 requires manual ownership review before a legacy platform batch can use tenant limits", async () => {
      const f = await managedBatch({ tenantId: null, perTenantLimit: 1 });
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      await owner.query(
        "insert into promotion.vouchers(batch_id,code,status,assigned_user_id) values ($1,$2,'assigned',$3)",
        [f.batchId, randomUUID(), f.scope.userId],
      );
      await owner.query(
        "update promotion.voucher_batches set issued_count=1 where id=$1",
        [f.batchId],
      );
      await expect(
        f.management.assign(operator, {
          ...f.assign,
          targetTenantId: f.scope.tenantId,
        }),
      ).rejects.toThrow("租户归属待核对");
    });
    it("B06 serializes assignment against a concurrently paused batch", async () => {
      const f = await managedBatch();
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      const client = await owner.connect();
      let attempt: Promise<unknown> | undefined;
      try {
        await client.query("begin");
        await client.query(
          "select id from promotion.voucher_batches where id=$1 for update",
          [f.batchId],
        );
        attempt = f.management
          .assign(operator, f.assign)
          .catch((error) => error);
        await setTimeout(25);
        await client.query(
          "update promotion.voucher_batches set status='paused' where id=$1",
          [f.batchId],
        );
        await client.query("commit");
        expect(await attempt).toMatchObject({ message: "批次不可发放" });
      } finally {
        await client.query("rollback");
        client.release();
        await attempt;
      }
      expect(
        (
          await owner.query(
            "select issued_count from promotion.voucher_batches where id=$1",
            [f.batchId],
          )
        ).rows[0].issued_count,
      ).toBe(0);
    });
    it("B06 requires separate review, then freezes economic configuration on issuance", async () => {
      const f = await managedBatch();
      await expect(f.management.assign(operator, f.assign)).rejects.toThrow(
        "不可发放",
      );
      await expect(
        f.management.actOnBatch(
          operator,
          f.batchId,
          await reviewCommand(f.batchId),
        ),
      ).rejects.toThrow("另一位");
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      const issued = await f.management.assign(operator, f.assign);
      expect(issued.codes).toHaveLength(1);
      expect(issued.codes[0]).toMatch(
        /^VX-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/,
      );
      await expect(
        f.management.actOnBatch(operator, f.batchId, {
          ...command(),
          action: "configure",
          configuration: { ...f.input, effect: { amount_cents: 2000 } },
        }),
      ).rejects.toThrow("冻结");
      const batch = (
        await owner.query(
          "select status,issued_count,reviewed_by,frozen_at from promotion.voucher_batches where id=$1",
          [f.batchId],
        )
      ).rows[0];
      expect(batch).toMatchObject({
        status: "active",
        issued_count: 1,
        reviewed_by: reviewer,
      });
      expect(batch.frozen_at).toBeTruthy();
    });
    it("B06 returns the same receipt under concurrent replays and rejects changed parameters", async () => {
      const f = await managedBatch();
      expect(await f.management.createBatch(operator, f.input)).toEqual({
        batchId: f.batchId,
      });
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      const [a, b] = await Promise.all([
        f.management.assign(operator, f.assign),
        f.management.assign(operator, f.assign),
      ]);
      expect(a).toEqual(b);
      await expect(
        f.management.assign(operator, { ...f.assign, count: 2 }),
      ).rejects.toThrow("幂等键");
      expect(
        (
          await owner.query(
            "select issued_count from promotion.voucher_batches where id=$1",
            [f.batchId],
          )
        ).rows[0].issued_count,
      ).toBe(1);
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.voucher_events where batch_id=$1 and event_type='voucher_assigned'",
            [f.batchId],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("B06 serializes the last issuance budget and requires independently approved increases", async () => {
      const f = await managedBatch({ totalCount: 1 });
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      const results = await Promise.allSettled([
        f.management.assign(operator, f.assign),
        f.management.assign(operator, { ...f.assign, ...command() }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const request = await f.management.actOnBatch(operator, f.batchId, {
        ...command(),
        action: "request_budget",
        totalCount: 2,
      });
      await expect(
        f.management.actOnBatch(operator, f.batchId, {
          ...command(),
          action: "approve_budget",
          requestOperationId: request.operationId,
        }),
      ).rejects.toThrow("自行审批");
      const approvals = await Promise.allSettled(
        [reviewer, randomUUID()].map((actor) =>
          f.management.actOnBatch(actor, f.batchId, {
            ...command(),
            action: "approve_budget",
            requestOperationId: request.operationId,
          }),
        ),
      );
      expect(approvals.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await f.management.assign(operator, { ...f.assign, ...command() });
      expect(
        (
          await owner.query(
            "select total_count,issued_count from promotion.voucher_batches where id=$1",
            [f.batchId],
          )
        ).rows[0],
      ).toEqual({ total_count: 2, issued_count: 2 });
    });
    it("B06 revocation never restores lifetime limits or issuance budget", async () => {
      const f = await managedBatch({ perUserLimit: 1 });
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      const issued = await f.management.assign(operator, f.assign);
      const revoke = command();
      await f.management.revoke(operator, issued.voucherIds[0]!, revoke);
      expect(
        await f.management.revoke(operator, issued.voucherIds[0]!, revoke),
      ).toMatchObject({ status: "revoked" });
      await expect(
        f.management.assign(operator, { ...f.assign, ...command() }),
      ).rejects.toThrow("累计发放上限");
      expect(
        (
          await owner.query(
            "select issued_count from promotion.voucher_batches where id=$1",
            [f.batchId],
          )
        ).rows[0].issued_count,
      ).toBe(1);
    });
    it("B06 enforces workspace and tenant limits independently", async () => {
      const f = await managedBatch({ perWorkspaceLimit: 1, perTenantLimit: 1 });
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      await f.management.assign(operator, {
        ...command(),
        batchId: f.batchId,
        count: 1,
        targetWorkspaceId: f.scope.workspaceId,
      });
      await expect(
        f.management.assign(operator, {
          ...command(),
          batchId: f.batchId,
          count: 1,
          targetWorkspaceId: f.workspace2,
        }),
      ).rejects.toThrow("累计发放上限");
    });
    it("B06 refuses cross-tenant users and workspaces without consuming budget", async () => {
      const f = await managedBatch();
      const other = await fixture();
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      await expect(
        f.management.assign(operator, {
          ...f.assign,
          targetUserId: other.scope.userId,
        }),
      ).rejects.toThrow("有效租户成员");
      await expect(
        f.management.assign(operator, {
          ...command(),
          batchId: f.batchId,
          count: 1,
          targetWorkspaceId: other.scope.workspaceId,
        }),
      ).rejects.toThrow("目标租户");
      expect(
        (
          await owner.query(
            "select issued_count from promotion.voucher_batches where id=$1",
            [f.batchId],
          )
        ).rows[0].issued_count,
      ).toBe(0);
    });
    it("B06 binds platform personal vouchers to an explicit tenant and relative use expiry", async () => {
      const f = await managedBatch({
        tenantId: null,
        useValidDays: 1,
        validUntil: new Date(Date.now() + 86400000 * 30).toISOString(),
      });
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      await expect(f.management.assign(operator, f.assign)).rejects.toThrow(
        "目标租户",
      );
      const issued = await f.management.assign(operator, {
        ...f.assign,
        targetTenantId: f.scope.tenantId,
      });
      const voucher = (
        await owner.query(
          "select assigned_tenant_id,claimed_at,expires_at from promotion.vouchers where id=$1",
          [issued.voucherIds[0]],
        )
      ).rows[0];
      expect(voucher.assigned_tenant_id).toBe(f.scope.tenantId);
      expect(voucher.expires_at.getTime() - voucher.claimed_at.getTime()).toBe(
        86400000,
      );
    });
    it("B06 pause/resume/archive gates issuance and archived batches cannot reopen", async () => {
      const f = await managedBatch();
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      await f.management.actOnBatch(operator, f.batchId, {
        ...command(),
        action: "pause",
      });
      await expect(f.management.assign(operator, f.assign)).rejects.toThrow(
        "不可发放",
      );
      await f.management.actOnBatch(operator, f.batchId, {
        ...command(),
        action: "resume",
      });
      await f.management.assign(operator, f.assign);
      await f.management.actOnBatch(operator, f.batchId, {
        ...command(),
        action: "archive",
      });
      await expect(
        f.management.actOnBatch(operator, f.batchId, {
          ...command(),
          action: "resume",
        }),
      ).rejects.toThrow("归档");
    });
    it("B06 refuses revocation of an actual order reservation", async () => {
      const f = await managedBatch();
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      const issued = await f.management.assign(operator, f.assign);
      await tx(async (client) => {
        expect(
          await new PgPromotionRepository(runtime).reserve(
            client,
            f.scope,
            issued.voucherIds[0]!,
            "credit_voucher",
          ),
        ).toBeTruthy();
      });
      await expect(
        f.management.revoke(operator, issued.voucherIds[0]!, command()),
      ).rejects.toThrow("关联订单");
    });
    it("B06 rolls back all issuance when append-only audit cannot be persisted", async () => {
      const f = await managedBatch();
      await f.management.actOnBatch(
        reviewer,
        f.batchId,
        await reviewCommand(f.batchId),
      );
      await owner.query(
        "revoke insert on promotion.voucher_events from platform_svc",
      );
      try {
        await expect(f.management.assign(operator, f.assign)).rejects.toThrow();
      } finally {
        await owner.query(
          "grant insert on promotion.voucher_events to platform_svc",
        );
      }
      expect(
        (
          await owner.query(
            "select issued_count,frozen_at from promotion.voucher_batches where id=$1",
            [f.batchId],
          )
        ).rows[0],
      ).toEqual({ issued_count: 0, frozen_at: null });
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.vouchers where batch_id=$1",
            [f.batchId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.voucher_operations where batch_id=$1 and operation_type='voucher_assign'",
            [f.batchId],
          )
        ).rows[0].n,
      ).toBe(0);
      await f.management.assign(operator, f.assign);
    });
    // ===========================================================================
    // B05 cash refunds preserve source caps; replacement issuance is independent.
    // ===========================================================================
    async function refundFixture(
      cashCents = 9000,
      returnPolicy = "full_reversal_only",
      expiresMs?: number,
    ) {
      const f = await settlementFixture();
      await owner.query(
        "update promotion.voucher_batches set kind='credit_voucher',effect=$2::jsonb,policy_snapshot=$3::jsonb where id=$1",
        [
          f.batchId,
          JSON.stringify({ amount_cents: 20000 }),
          JSON.stringify({ return_policy: returnPolicy }),
        ],
      );
      const subs = new PgSubscriptionRepository(runtime);
      if (expiresMs)
        await owner.query(
          "update promotion.voucher_batches set valid_until=now()+($2::int*interval '1 millisecond') where id=$1",
          [f.batchId, expiresMs],
        );
      const subscriptions = new SubscriptionService(subs, {
        onSubscriptionActivated: vi.fn(async () => undefined),
        onSubscriptionDeactivated: vi.fn(async () => undefined),
        enqueueEvent: vi.fn(async () => undefined),
      } as never);
      const service = new OrderService(
        repository,
        subs,
        subscriptions,
        f.promotion,
      );
      let cashId: string | null = null;
      await tx(async (client) => {
        await client.query(
          "select id from billing.orders where id=$1 for update",
          [f.context.orderId],
        );
        const reserved = await f.promotion.reserveForOrder(client, {
          scope: f.scope,
          creditVoucherId: f.voucherId,
        });
        if (cashCents > 0)
          cashId = (
            await client.query<{ id: string }>(
              `insert into billing.payments(tenant_id,bill_id,pay_order_no,pay_source,total_amount,paid_amount,currency,pay_status,paid_at,actor_id)
          values ($1,$2,$3,'offline',$4,$4,'CNY','paid',now(),$5) returning id`,
              [
                f.scope.tenantId,
                f.context.invoiceId,
                `PAY-${randomUUID()}`,
                (cashCents / 100).toFixed(2),
                f.scope.userId,
              ],
            )
          ).rows[0]!.id;
        const { voucherLegId } = await subs.settleInvoiceByVouchersTx(client, {
          tenantId: f.scope.tenantId,
          invoiceId: f.context.invoiceId,
          voucherLegYuan: ((10000 - cashCents) / 100).toFixed(2),
          currency: "CNY",
          actorId: f.scope.userId,
        });
        if (cashCents > 0)
          await client.query(
            "update billing.invoices set paid_amount=paid_amount+$2 where id=$1",
            [f.context.invoiceId, (cashCents / 100).toFixed(2)],
          );
        const context = { ...f.context, declarationPaymentId: cashId };
        await f.promotion.recordReservations(
          client,
          context,
          f.scope,
          reserved,
          { voucherOffCents: 10000 - cashCents },
        );
        await f.promotion.finalizeReserved(client, [
          {
            ...context,
            reservationId: reserved[0]!.reservationId,
            voucherId: f.voucherId,
            scope: f.scope,
            kind: "credit_voucher",
            effectSnapshot: reserved[0]!.effectSnapshot,
            paymentId: voucherLegId,
          },
        ]);
        await repository.markPaidTx(client, f.context.orderId);
      });
      await service.fulfill(f.context.orderId, {
        actorType: "customer",
        actorId: f.scope.userId,
      });
      return { ...f, service, subscriptions, cashId };
    }
    async function requestedRefund(
      f: Awaited<ReturnType<typeof refundFixture>>,
      amount = "81.00",
    ) {
      const order = await f.service.getOrder(f.context.orderId);
      const refund = await repository.createRefundRequest({
        order,
        invoiceId: f.context.invoiceId,
        payRecordId: f.cashId!,
        amount,
        reason: "B05",
        userId: f.scope.userId,
        costPolicy: { alpha: 0.5, usage: 0.2 },
      });
      await f.service.auditRefund(refund.id, {
        decision: "approved",
        remark: "verified",
        operatorId: f.scope.userId,
      });
      await f.service.initiateRefundTransfer(
        refund.id,
        { channel: "alipay", reference: randomUUID() },
        { actorType: "operator", actorId: f.scope.userId },
      );
      return refund;
    }
    it("B05 rejects refunding the voucher portion as cash", async () => {
      const f = await refundFixture();
      expect(
        (await f.service.getRefundEligibility(f.context.orderId)).paidAmount,
      ).toBe("90.00");
      const order = await f.service.getOrder(f.context.orderId);
      await expect(
        repository.createRefundRequest({
          order,
          invoiceId: f.context.invoiceId,
          payRecordId: f.cashId!,
          amount: "100.00",
          reason: "invalid cash",
          userId: f.scope.userId,
        }),
      ).rejects.toThrow("可退现金");
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.refunds where order_id=$1",
            [order.id],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("B05 commits cash allocations and one durable intention, then issues only remaining voucher value", async () => {
      const f = await refundFixture();
      const refund = await requestedRefund(f);
      await f.service.executeRefund(refund.id, {
        actorType: "operator",
        actorId: f.scope.userId,
      });
      const intent = (
        await owner.query(
          "select * from promotion.voucher_compensations where order_id=$1",
          [f.context.orderId],
        )
      ).rows[0];
      expect(intent).toMatchObject({
        amount_cents: "900",
        status: "pending",
        refund_id: refund.id,
      });
      expect(
        (
          await owner.query(
            "select amount,status from billing.refund_allocations where refund_id=$1",
            [refund.id],
          )
        ).rows,
      ).toEqual([{ amount: "81.00", status: "succeeded" }]);
      const results = await Promise.all([
        f.promotion.recoverRefundCompensations(),
        f.promotion.recoverRefundCompensations(),
      ]);
      expect(results.reduce((n, r) => n + r.failed, 0)).toBe(0);
      await f.service.executeRefund(refund.id, {
        actorType: "operator",
        actorId: f.scope.userId,
      });
      const replacement = (
        await owner.query(
          "select v.status,v.expires_at,b.effect,b.policy_snapshot from promotion.vouchers v join promotion.voucher_batches b on b.id=v.batch_id where v.replacement_of_redemption_id=$1",
          [intent.redemption_id],
        )
      ).rows;
      expect(replacement).toHaveLength(1);
      expect(replacement[0]).toMatchObject({
        status: "assigned",
        effect: { amount_cents: 900 },
        policy_snapshot: { compensation_batch: true, return_policy: "none" },
      });
      expect(replacement[0].expires_at.toISOString()).toBe(
        new Date(intent.policy_snapshot.effectiveExpiresAt).toISOString(),
      );
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.transactions where related_no=$1 and trade_type='refund'",
            [refund.refundNo],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("B05 failed transfer releases source capacity and retry reacquires it", async () => {
      const f = await refundFixture();
      const refund = await requestedRefund(f);
      await f.service.failRefund(refund.id, "transfer returned", {
        actorType: "operator",
        actorId: f.scope.userId,
      });
      expect(
        (
          await owner.query(
            "select status from billing.refund_allocations where refund_id=$1",
            [refund.id],
          )
        ).rows[0].status,
      ).toBe("released");
      await f.service.initiateRefundTransfer(
        refund.id,
        { channel: "alipay", reference: randomUUID() },
        { actorType: "operator", actorId: f.scope.userId },
      );
      expect(
        (
          await owner.query(
            "select status from billing.refund_allocations where refund_id=$1",
            [refund.id],
          )
        ).rows[0].status,
      ).toBe("reserved");
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.voucher_compensations where order_id=$1",
            [f.context.orderId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("B05 pure voucher cancellation completes without a cash refund record", async () => {
      const f = await refundFixture(0);
      const order = await f.service.getOrder(f.context.orderId);
      await f.subscriptions.cancelSubscription(
        order.subscriptionId!,
        f.scope.userId,
        "B05",
        "customer",
      );
      await f.service.settleAfterCancel({
        subscriptionId: order.subscriptionId!,
        tenantId: f.scope.tenantId,
        actorUserId: f.scope.userId,
      });
      expect((await f.service.getOrder(order.id)).status).toBe("refunded");
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.refunds where order_id=$1",
            [order.id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await owner.query(
            "select amount_cents,status from promotion.voucher_compensations where order_id=$1",
            [order.id],
          )
        ).rows,
      ).toEqual([{ amount_cents: "10000", status: "pending" }]);
      expect((await f.promotion.recoverRefundCompensations()).failed).toBe(0);
    });
    it("B05 leaves no financial writes when persisting the compensation intention fails", async () => {
      const f = await refundFixture();
      const refund = await requestedRefund(f);
      const original = f.promotion.queueRefundCompensations.bind(f.promotion);
      const failure = vi
        .spyOn(f.promotion, "queueRefundCompensations")
        .mockImplementationOnce(async (...args) => {
          await original(...args);
          throw new Error("injected intent failure");
        });
      await expect(
        f.service.executeRefund(refund.id, {
          actorType: "operator",
          actorId: f.scope.userId,
        }),
      ).rejects.toThrow("injected intent failure");
      failure.mockRestore();
      expect((await repository.getRefundById(refund.id))?.refundStatus).toBe(
        "processing",
      );
      expect((await f.service.getOrder(f.context.orderId)).status).toBe(
        "fulfilled",
      );
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.voucher_compensations where order_id=$1",
            [f.context.orderId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.transactions where related_no=$1 and trade_type='refund'",
            [refund.refundNo],
          )
        ).rows[0].n,
      ).toBe(0);
      await f.service.executeRefund(refund.id, {
        actorType: "operator",
        actorId: f.scope.userId,
      });
    });
    it.each([
      ["none", "81.00", null],
      ["full_reversal_only", "70.00", "manual_required"],
    ] as const)(
      "B05 policy %s and cash %s cannot overcompensate",
      async (policy, amount, status) => {
        const f = await refundFixture(9000, policy);
        const refund = await requestedRefund(f, amount);
        await f.service.executeRefund(refund.id, {
          actorType: "operator",
          actorId: f.scope.userId,
        });
        const rows = (
          await owner.query(
            "select status from promotion.voucher_compensations where order_id=$1",
            [f.context.orderId],
          )
        ).rows;
        expect(rows).toEqual(status ? [{ status }] : []);
      },
    );
    it("B05 retries failed effect rollback before issuing a replacement, without repeating money", async () => {
      const f = await refundFixture();
      const refund = await requestedRefund(f);
      const failure = vi
        .spyOn(f.subscriptions, "cancelSubscription")
        .mockRejectedValueOnce(new Error("injected effect outage"));
      await f.service.executeRefund(refund.id, {
        actorType: "operator",
        actorId: f.scope.userId,
      });
      await f.promotion.recoverRefundCompensations();
      expect(
        (
          await owner.query(
            "select status from promotion.voucher_compensations where order_id=$1",
            [f.context.orderId],
          )
        ).rows[0].status,
      ).toBe("pending");
      failure.mockRestore();
      expect(
        await f.service.reconcileRefundSettlements(),
      ).toBeGreaterThanOrEqual(1);
      expect(
        (
          await owner.query(
            "select status from promotion.voucher_compensations where order_id=$1",
            [f.context.orderId],
          )
        ).rows[0].status,
      ).toBe("completed");
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.transactions where related_no=$1 and trade_type='refund'",
            [refund.refundNo],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("B05 stops automatic cancellation and replacement after subscription ownership changes", async () => {
      const f = await refundFixture();
      const refund = await requestedRefund(f);
      const failure = vi
        .spyOn(f.subscriptions, "cancelSubscription")
        .mockRejectedValueOnce(new Error("injected effect outage"));
      await f.service.executeRefund(refund.id, {
        actorType: "operator",
        actorId: f.scope.userId,
      });
      failure.mockRestore();
      await owner.query(
        "update metering.subscriptions set current_order_id=null where id=(select subscription_id from billing.orders where id=$1)",
        [f.context.orderId],
      );
      const cancellation = vi.spyOn(f.subscriptions, "cancelSubscription");
      await f.service.reconcileRefundSettlements();
      expect(cancellation).not.toHaveBeenCalled();
      cancellation.mockRestore();
      expect(
        (
          await owner.query(
            "select status,reason,replacement_voucher_id from promotion.voucher_compensations where order_id=$1",
            [f.context.orderId],
          )
        ).rows[0],
      ).toMatchObject({
        status: "manual_required",
        reason: "subsequent_subscription_change",
        replacement_voucher_id: null,
      });
    });
    it("B05 serializes issuance against a compensation batch pause", async () => {
      const f = await refundFixture();
      const refund = await requestedRefund(f);
      const failure = vi
        .spyOn(f.subscriptions, "cancelSubscription")
        .mockRejectedValueOnce(new Error("injected effect outage"));
      await f.service.executeRefund(refund.id, {
        actorType: "operator",
        actorId: f.scope.userId,
      });
      failure.mockRestore();
      await f.promotion.recoverRefundCompensations();
      const intent = (
        await owner.query(
          "select id from promotion.voucher_compensations where order_id=$1",
          [f.context.orderId],
        )
      ).rows[0];
      const client = await owner.connect();
      let recovery:
        | ReturnType<typeof f.service.reconcileRefundSettlements>
        | undefined;
      try {
        await client.query("begin");
        await client.query(
          "select id from promotion.voucher_batches where id=$1 for update",
          [intent.id],
        );
        recovery = f.service.reconcileRefundSettlements();
        await client.query(
          "update promotion.voucher_batches set status='paused' where id=$1",
          [intent.id],
        );
        await client.query("commit");
        await recovery;
      } finally {
        await client.query("rollback");
        client.release();
        await recovery;
      }
      expect(
        (
          await owner.query(
            "select status,reason,replacement_voucher_id from promotion.voucher_compensations where id=$1",
            [intent.id],
          )
        ).rows[0],
      ).toMatchObject({
        status: "manual_required",
        reason: "compensation_batch_unavailable",
        replacement_voucher_id: null,
      });
      expect(
        (
          await owner.query(
            "select issued_count from promotion.voucher_batches where id=$1",
            [intent.id],
          )
        ).rows[0].issued_count,
      ).toBe(0);
    });
    it("B05 refuses an old failed transfer retry after another refund reserves the source", async () => {
      const f = await refundFixture();
      const refund = await requestedRefund(f);
      await f.service.failRefund(refund.id, "returned", {
        actorType: "operator",
        actorId: f.scope.userId,
      });
      await requestedRefund(f);
      await expect(
        f.service.initiateRefundTransfer(
          refund.id,
          { channel: "alipay", reference: randomUUID() },
          { actorType: "operator", actorId: f.scope.userId },
        ),
      ).rejects.toThrow("可退现金");
      expect(
        (
          await owner.query(
            "select status from billing.refund_allocations where refund_id=$1",
            [refund.id],
          )
        ).rows[0].status,
      ).toBe("released");
    });
    it("B05 completes expired compensation without issuing or extending a voucher", async () => {
      const f = await refundFixture(9000, "full_reversal_only", 5000);
      const refund = await requestedRefund(f);
      await f.service.executeRefund(refund.id, {
        actorType: "operator",
        actorId: f.scope.userId,
      });
      const intent = (
        await owner.query(
          "select id,policy_snapshot from promotion.voucher_compensations where order_id=$1",
          [f.context.orderId],
        )
      ).rows[0];
      await setTimeout(
        Math.max(
          0,
          Date.parse(intent.policy_snapshot.effectiveExpiresAt) -
            Date.now() +
            30,
        ),
      );
      await f.promotion.recoverRefundCompensations();
      expect(
        (
          await owner.query(
            "select status,reason,replacement_voucher_id from promotion.voucher_compensations where id=$1",
            [intent.id],
          )
        ).rows[0],
      ).toEqual({
        status: "completed",
        reason: "original_expiry_elapsed",
        replacement_voucher_id: null,
      });
    }, 10000);
    it("B05 zero remaining voucher value records completion without a zero-value replacement", async () => {
      const f = await refundFixture();
      const order = await f.service.getOrder(f.context.orderId);
      const refund = await repository.createRefundRequest({
        order,
        invoiceId: f.context.invoiceId,
        payRecordId: f.cashId!,
        amount: "90.00",
        reason: "operator policy override",
        userId: f.scope.userId,
        costPolicy: { alpha: 1, usage: 1 },
      });
      await f.service.auditRefund(refund.id, {
        decision: "approved",
        remark: "cash override",
        operatorId: f.scope.userId,
      });
      await f.service.initiateRefundTransfer(
        refund.id,
        { channel: "alipay", reference: randomUUID() },
        { actorType: "operator", actorId: f.scope.userId },
      );
      await f.service.executeRefund(refund.id, {
        actorType: "operator",
        actorId: f.scope.userId,
      });
      await f.promotion.recoverRefundCompensations();
      expect(
        (
          await owner.query(
            "select status,reason,replacement_voucher_id from promotion.voucher_compensations where order_id=$1",
            [order.id],
          )
        ).rows[0],
      ).toEqual({
        status: "completed",
        reason: "no_remaining_value",
        replacement_voucher_id: null,
      });
    });
    it("completes the actual router/service path with a one-connection pool and replays after catalog changes", async () => {
      const { scope } = await fixture();
      const single = new Pool({
        ...customer.options,
        max: 1,
        connectionTimeoutMillis: 2000,
      });
      try {
        const orders = new PgOrderRepository(single);
        const subs = new PgSubscriptionRepository(single);
        const none = undefined as never;
        const subscriptions = new SubscriptionService(subs, none);
        const service = new OrderService(orders, subs, subscriptions, none);
        const router = new SubscriptionRouter(
          subscriptions,
          service,
          none,
          none,
          none,
          single,
          none,
          none,
          none,
        );
        const request = {
          user: { id: scope.userId },
          tenant: { id: scope.tenantId, workspace: scope.workspaceId },
        } as unknown as Request & RequestContext;
        const body = {
          productCode: scope.planCode,
          planVersionId: scope.planVersionId,
          cycleUnit: "month",
          intent: "new",
          idempotencyKey: randomUUID(),
        };
        const result = await router.createOrder(request, body);
        await owner.query(
          "update product.plans set status='inactive' where current_version_id=$1",
          [scope.planVersionId],
        );
        expect(await router.createOrder(request, body)).toEqual(result);
        expect(await counts(scope)).toEqual({
          orders: 1,
          invoices: 1,
          operations: 1,
          redemptions: 1,
          events: 1,
        });
      } finally {
        await single.end();
      }
    });
    it("commits the order, invoice, receipt, exact workspace redemption and event together", async () => {
      const { scope, voucherId } = await fixture();
      const result = await create(scope, randomUUID());
      expect(await counts(scope)).toEqual({
        orders: 1,
        invoices: 1,
        operations: 1,
        redemptions: 1,
        events: 1,
      });
      const { rows } = await owner.query(
        "select order_id,workspace_id,operation_id,effect_snapshot from promotion.voucher_redemptions where voucher_id=$1",
        [voucherId],
      );
      expect(rows[0]).toMatchObject({
        order_id: result.orderId,
        workspace_id: scope.workspaceId,
        effect_snapshot: { requested_plan_version_id: scope.planVersionId },
      });
      expect(rows[0].operation_id).toBeTruthy();
      expect(await hasInvitation(customer, scope)).toBe(false);
    });
    it.each(["order", "redemption", "event"] as const)(
      "rolls back all writes after %s failure and permits retry",
      async (failure) => {
        const { scope, voucherId } = await fixture();
        const key = randomUUID();
        await expect(create(scope, key, failure)).rejects.toThrow("injected");
        expect(await counts(scope)).toEqual({
          orders: 0,
          invoices: 0,
          operations: 0,
          redemptions: 0,
          events: 0,
        });
        expect(
          (
            await owner.query(
              "select status,used_count from promotion.vouchers where id=$1",
              [voucherId],
            )
          ).rows[0],
        ).toEqual({ status: "assigned", used_count: 0 });
        await expect(create(scope, key)).resolves.toHaveProperty("orderId");
      },
    );
    it("returns one durable result for simultaneous same-key requests", async () => {
      const { scope } = await fixture();
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => create(scope, key)),
      );
      expect(
        results.every((value) => value.orderId === results[0]!.orderId),
      ).toBe(true);
      expect(await counts(scope)).toEqual({
        orders: 1,
        invoices: 1,
        operations: 1,
        redemptions: 1,
        events: 1,
      });
    });
    it("rejects reuse of a key with another workspace or plan", async () => {
      const { scope, workspace2 } = await fixture();
      const key = randomUUID();
      await create(scope, key);
      await expect(
        create({ ...scope, workspaceId: workspace2 }, key),
      ).rejects.toMatchObject({ response: { code: "IDEMPOTENCY_CONFLICT" } });
      await expect(
        create({ ...scope, planVersionId: randomUUID() }, key),
      ).rejects.toMatchObject({ response: { code: "IDEMPOTENCY_CONFLICT" } });
    });
    it.each([false, true])(
      "allows only one winner for different keys (different workspace: %s)",
      async (differentWorkspace) => {
        const { scope, workspace2 } = await fixture();
        const results = await Promise.allSettled([
          create(scope, randomUUID()),
          create(
            {
              ...scope,
              workspaceId: differentWorkspace ? workspace2 : scope.workspaceId,
            },
            randomUUID(),
          ),
        ]);
        expect(
          results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(await counts(scope)).toEqual({
          orders: 1,
          invoices: 1,
          operations: 1,
          redemptions: 1,
          events: 1,
        });
      },
    );

    // ===========================================================================
    // Eligibility uses the same SQL for reads and transactional consumption.
    // ===========================================================================
    it.each([
      [
        "exact version wins over matching code",
        { plan_version_id: "wrong", plan_code: "$code" },
        false,
      ],
      [
        "snake selectors",
        { plan_version_id: "$version", plan_code: "$code" },
        true,
      ],
      [
        "legacy camel selectors",
        { planVersionId: "$version", planCode: "$code" },
        true,
      ],
      ["code-only selectors", { plan_code: "$code" }, true],
      [
        "conflicting alias selectors",
        { plan_version_id: "$version", planVersionId: "wrong" },
        false,
      ],
      [
        "conflicting plan code",
        { plan_version_id: "$version", plan_code: "wrong" },
        false,
      ],
      [
        "unknown effect version",
        { effect_version: 2, plan_code: "$code" },
        false,
      ],
    ] as const)("%s", async (_name, effect, eligible) => {
      const { scope, batchId } = await fixture();
      const json = JSON.stringify(effect)
        .replaceAll("$code", scope.planCode)
        .replaceAll("$version", scope.planVersionId);
      await owner.query(
        "update promotion.voucher_batches set effect=$2 where id=$1",
        [batchId, json],
      );
      expect(await hasInvitation(runtime, scope)).toBe(eligible);
      if (eligible)
        await expect(create(scope, randomUUID())).resolves.toHaveProperty(
          "orderId",
        );
      else {
        await expect(create(scope, randomUUID())).rejects.toMatchObject({
          response: { code: "PLAN_NOT_PUBLIC" },
        });
        expect((await counts(scope)).orders).toBe(0);
      }
    });
    it.each([
      "paused",
      "not started",
      "batch expired",
      "voucher expired",
      "wrong tenant",
      "wrong actor",
      "wrong workspace",
      "ambiguous legacy owner",
    ])("rejects %s", async (condition) => {
      const { scope, batchId, voucherId, workspace2 } = await fixture();
      if (condition === "paused")
        await owner.query(
          "update promotion.voucher_batches set status='paused' where id=$1",
          [batchId],
        );
      if (condition === "not started")
        await owner.query(
          "update promotion.voucher_batches set valid_from=now()+interval '1 hour' where id=$1",
          [batchId],
        );
      if (condition === "batch expired")
        await owner.query(
          "update promotion.voucher_batches set valid_from=now()-interval '2 days',valid_until=now()-interval '1 day' where id=$1",
          [batchId],
        );
      if (condition === "voucher expired")
        await owner.query(
          "update promotion.vouchers set expires_at=now() where id=$1",
          [voucherId],
        );
      if (condition === "wrong tenant") scope.tenantId = randomUUID();
      if (condition === "wrong actor") scope.userId = randomUUID();
      if (condition === "wrong workspace")
        await owner.query(
          "update promotion.vouchers set assigned_user_id=null,assigned_workspace_id=$2 where id=$1",
          [voucherId, workspace2],
        );
      if (condition === "ambiguous legacy owner") {
        await owner.query(
          "update promotion.vouchers set assigned_tenant_id=null where id=$1",
          [voucherId],
        );
        await owner.query(
          "update promotion.voucher_batches set tenant_id=null where id=$1",
          [batchId],
        );
      }
      expect(await hasInvitation(runtime, scope)).toBe(false);
    });
    it.each(["batch", "workspace"])(
      "binds legacy invitations only from a deterministic %s owner",
      async (binding) => {
        const { scope, batchId, voucherId } = await fixture();
        await owner.query(
          "update promotion.vouchers set assigned_tenant_id=null where id=$1",
          [voucherId],
        );
        if (binding === "workspace") {
          await owner.query(
            "update promotion.voucher_batches set tenant_id=null where id=$1",
            [batchId],
          );
          await owner.query(
            "update promotion.vouchers set assigned_user_id=null,assigned_workspace_id=$2 where id=$1",
            [voucherId, scope.workspaceId],
          );
        }
        expect(await hasInvitation(runtime, scope)).toBe(true);
        await create(scope, randomUUID());
        expect(
          (
            await owner.query(
              "select assigned_tenant_id from promotion.vouchers where id=$1",
              [voucherId],
            )
          ).rows[0].assigned_tenant_id,
        ).toBe(scope.tenantId);
      },
    );
  },
);
