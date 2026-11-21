/**
 * voucher-subscription.itest.spec.ts - Transactional voucher subscriptions and source-aware refunds.
 * @package @vxture/bff-admin
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// ⚠️ 跨层引用: the application composes isolated domains through public APIs.
import { PgWalletLedger } from "@vxture/service-billing";
import {
  PromotionService,
  PgPromotionRepository,
  PgVoucherManagement,
  SubscriptionVouchers,
  type VoucherScope,
  type CreateBatchCommand,
} from "@vxture/service-promotion";
import {
  OrderService,
  PgOrderRepository,
  PgSubscriptionRepository,
  SubscriptionService,
  SubscriptionRedemption,
  SubscriptionExtension,
} from "@vxture/service-subscription";
import {
  PgProvisioningRepository,
  ProvisioningService,
} from "@vxture/service-provisioning";
import { OrdersRouter } from "./orders.router";

// ============================================================================
// Disposable loopback database with complete DDL and real application roles.
// ============================================================================
describe.skipIf(process.env.VOUCHER_SUBSCRIPTION_ITEST !== "1")(
  "voucher subscription acceptance",
  () => {
    const runId = randomUUID();
    const container = `codex-voucher-sub-${runId.slice(0, 12)}`;
    let containerId = "";
    let owner: Pool,
      runtime: Pool,
      admin: Pool,
      started = false;
    const docker = (args: string[]) =>
      execFileSync("docker", args, {
        encoding: "utf8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    beforeAll(async () => {
      containerId = docker([
        "run",
        "--detach",
        "--pull=never",
        "--name",
        container,
        "--label",
        `codex.run=${runId}`,
        "--env",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "--publish",
        "127.0.0.1::5432",
        "postgres:18-alpine",
      ]).trim();
      started = true;
      console.info(
        "S07_R2C2_CONTAINER_OWNERSHIP=" +
          JSON.stringify({ name: container, id: containerId, runId }),
      );
      const info = JSON.parse(docker(["inspect", container]))[0];
      expect(info.Id).toBe(containerId);
      expect(info.Config.Labels["codex.run"]).toBe(runId);
      expect(info.HostConfig.PortBindings["5432/tcp"]).toEqual([
        { HostIp: "127.0.0.1", HostPort: "" },
      ]);
      console.info(`S07_R2C2_CONTAINER_CREATED=${container}`);
      for (let attempt = 0; ; attempt++)
        try {
          docker([
            "exec",
            container,
            "pg_isready",
            "-h",
            "127.0.0.1",
            "-U",
            "postgres",
          ]);
          break;
        } catch (error) {
          if (attempt === 40) throw error;
          await setTimeout(250);
        }
      const port = Number(
        docker(["port", container, "5432/tcp"]).trim().split(":").at(-1),
      );
      owner = new Pool({
        host: "127.0.0.1",
        port,
        user: "postgres",
        database: "postgres",
        password: "",
        ssl: false,
        connectionTimeoutMillis: 10000,
        statement_timeout: 20000,
        idle_in_transaction_session_timeout: 20000,
      });
      const dir = fileURLToPath(
        new URL("../../../../deploy/database/ddl/", import.meta.url),
      );
      for (const name of readdirSync(dir)
        .filter((n) => /^\d.*\.sql$/.test(n))
        .sort())
        await owner.query(readFileSync(`${dir}/${name}`, "utf8"));
      await owner.query(
        "alter role svc_console_bff login;alter role svc_auth_bff login;alter role svc_admin_bff login",
      );
      runtime = new Pool({
        host: "127.0.0.1",
        port,
        user: "svc_console_bff",
        database: "postgres",
        password: "",
        ssl: false,
        connectionTimeoutMillis: 10000,
        statement_timeout: 20000,
        idle_in_transaction_session_timeout: 20000,
      });
      admin = new Pool({ ...runtime.options, user: "svc_admin_bff" });
    }, 60000);
    afterAll(async () => {
      try {
        await admin?.end();
        await runtime?.end();
      } finally {
        try {
          await owner?.end();
        } finally {
          if (started) {
            const info = JSON.parse(docker(["inspect", container]))[0];
            expect(info.Id).toBe(containerId);
            expect(info.Config.Labels["codex.run"]).toBe(runId);
            docker(["rm", "--force", "--volumes", container]);
            console.info(`S07_R2C2_CONTAINER_CLEANED=${container}`);
          }
        }
      }
    }, 60000);

    // ============================================================================
    // Synthetic constrained catalog fixtures and real application composition.
    // ============================================================================
    const creator = randomUUID(),
      reviewer = randomUUID();
    const command = () => ({
      idempotencyKey: randomUUID(),
      reason: "S07-R2c2 acceptance",
    });
    const management = () => new PgVoucherManagement(admin);
    function services(pool = runtime) {
      const repository = new PgOrderRepository(pool),
        subscriptions = new PgSubscriptionRepository(pool);
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
      const service = new OrderService(
        repository,
        subscriptions,
        lifecycle,
        promotion,
      );
      service.setWalletSettlement(new PgWalletLedger(pool));
      return { repository, subscriptions, lifecycle, promotion, service };
    }
    async function tx<T>(
      work: (client: PoolClient) => Promise<T>,
      pool = runtime,
    ) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await work(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
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
    async function consume(
      client: PoolClient,
      f: Fixture,
      v: { id: string; batch_id: string },
      sub: string,
      snapshot: object,
      kind: "redemption" | "extension",
    ) {
      const operation = randomUUID();
      await client.query(
        "insert into promotion.voucher_operations(id,actor_realm,actor_id,operation_type,idempotency_key,request_hash,batch_id,result) values($1::uuid,'customer',$2,$3,$1::text,$1::text,$4,'{}')",
        [operation, f.scope.userId, `subscription_${kind}`, v.batch_id],
      );
      return SubscriptionVouchers.consume(
        client,
        f.scope,
        v,
        operation,
        sub,
        snapshot,
        `QA-${operation}`,
        kind,
      );
    }
    async function redeem(f: Fixture, id: string, fail = false) {
      return tx(async (client) => {
        await client.query(
          "select id from tenancy.workspaces where id=$1 and tenant_id=$2 for no key update",
          [f.scope.workspaceId, f.scope.tenantId],
        );
        await SubscriptionVouchers.context(client, f.scope);
        const candidate = await SubscriptionVouchers.read(client, f.scope, id);
        const domain = new SubscriptionRedemption(runtime),
          plan = await domain.plan(
            client,
            candidate.terms.plan_version_id,
            true,
          );
        await domain.assertEmpty(
          client,
          f.scope.workspaceId,
          plan.primary.product_id,
        );
        const v = await SubscriptionVouchers.read(client, f.scope, id, true);
        const start = (
          await client.query<{ now: Date }>("select clock_timestamp() now")
        ).rows[0]!.now;
        const sub = await domain.create(
          client,
          f.scope,
          plan,
          v.terms.duration_days,
          start,
        );
        await consume(
          client,
          f,
          v,
          sub.id,
          { ...v.effect, resolved_grants: plan.grants },
          "redemption",
        );
        if (fail) throw new Error("controlled downstream failure");
        return sub;
      });
    }
    async function extend(
      f: Fixture,
      id: string,
      sub: string,
      expected: { endAt: string; planVersionId: string },
      fail = false,
    ) {
      return tx(async (client) => {
        await client.query(
          "select id from tenancy.workspaces where id=$1 for no key update",
          [f.scope.workspaceId],
        );
        await SubscriptionVouchers.context(client, f.scope);
        await SubscriptionExtension.lock(client, f.scope, sub);
        const v = await SubscriptionVouchers.readExtension(
          client,
          f.scope,
          id,
          true,
        );
        const target = await SubscriptionExtension.target(
          client,
          f.scope,
          sub,
          v.terms.applicable_product_codes,
          expected,
        );
        const end = await SubscriptionExtension.apply(
          client,
          f.scope,
          target,
          v.terms.extend_days,
          `QA-${id}`,
        );
        await consume(
          client,
          f,
          v,
          sub,
          { ...v.effect, end_at: end.toISOString() },
          "extension",
        );
        if (fail) throw new Error("controlled downstream failure");
        return end;
      });
    }
    async function order(f: Fixture) {
      return services().service.createOrder({
        tenantId: f.scope.tenantId,
        workspaceId: f.scope.workspaceId,
        planVersionId: f.versionId,
        cycleUnit: "month",
        price: 100,
        createdBy: f.scope.userId,
        intent: "new",
        itemName: "Subscription QA",
      });
    }
    const operatorRequest = (operatorId = creator) =>
      ({
        user: { id: operatorId },
        headers: {},
        capabilities: ["commerce:payment.settle", "commerce:order.read"],
      }) as unknown as Parameters<OrdersRouter["confirmOfflinePayment"]>[0];
    async function checkout(
      f: Fixture,
      channel: "balance" | "alipay" = "alipay",
      amount = 2000,
    ) {
      const v = await voucher(f, "credit_voucher", amount),
        o = await order(f),
        app = services();
      if (channel === "balance")
        await new PgWalletLedger(runtime).post(
          {
            tenantId: f.scope.tenantId,
            actorId: f.scope.userId,
            actorType: "customer",
            currency: "CNY",
          },
          { action: "bonus", amountCents: 10000, idempotencyKey: randomUUID() },
        );
      const result = await app.service.declarePayment({
        orderId: o.order.id,
        tenantId: f.scope.tenantId,
        userId: f.scope.userId,
        payChannel: channel,
        creditVoucherId: v,
        payerName: "Synthetic payer",
      });
      const adminApp = services(admin),
        router = new OrdersRouter(
          admin,
          admin,
          adminApp.service,
          adminApp.promotion,
        );
      if (channel === "alipay" && amount < 10000)
        await router.confirmOfflinePayment(operatorRequest(), o.order.id, {
          paidAmount: (10000 - amount) / 100,
          offlinePayType: "other",
          payerName: "Synthetic payer",
          paidAt: new Date().toISOString(),
          reason: "Synthetic acceptance",
        });
      return { ...o, voucherId: v, app, adminApp, router, result };
    }
    async function approved(
      c: Awaited<ReturnType<typeof checkout>>,
      amount?: string,
    ) {
      const refund = await c.adminApp.service.createOperatorRefund({
        orderId: c.order.id,
        operatorId: creator,
        reason: "Synthetic source-aware refund",
        ...(amount ? { amount } : {}),
      });
      await c.adminApp.service.auditRefund(refund.id, {
        decision: "approved",
        remark: "Synthetic approval",
        operatorId: reviewer,
      });
      return refund;
    }
    const actor = { actorType: "operator" as const, actorId: reviewer };
    async function count(sql: string, values: string[]) {
      return Number((await owner.query(sql, values)).rows[0].n);
    }
    async function state(id: string) {
      return (
        await owner.query(
          "select status,used_count from promotion.vouchers where id=$1",
          [id],
        )
      ).rows[0];
    }

    // ============================================================================
    // Caller-owned rollback and serialized acquisition slots.
    // ============================================================================
    it("uses restricted roles and protects immutable refund snapshots", async () => {
      expect(
        (await runtime.query("select current_user")).rows[0].current_user,
      ).toBe("svc_console_bff");
      expect(
        (await admin.query("select current_user")).rows[0].current_user,
      ).toBe("svc_admin_bff");
      await expect(
        admin.query("update billing.refunds set calculation_snapshot='{}'"),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("creates fixed primary and bundled grants, quota and evidence without cash", async () => {
      const f = await fixture(),
        v = await voucher(f),
        sub = await redeem(f, v);
      expect(sub).toMatchObject({
        status: "active",
        subscriptionKind: "free",
        autoRenew: false,
        payAmount: "0.00",
      });
      expect(sub.endAt!.getTime() - sub.startAt.getTime()).toBe(30 * 86400000);
      expect(await state(v)).toEqual({ status: "redeemed", used_count: 1 });
      const pools = (
        await owner.query(
          "select quota_limit::text,quota_used::text,period_anchor from metering.quota_pools where subscription_id=$1",
          [sub.id],
        )
      ).rows;
      expect(pools).toHaveLength(1);
      expect(pools[0]).toMatchObject({ quota_limit: "100", quota_used: "0" });

      for (const table of ["orders", "payments", "invoices", "transactions"])
        expect(
          await count(
            `select count(*) n from billing.${table} where tenant_id=$1`,
            [f.scope.tenantId],
          ),
        ).toBe(0);
    });
    it("rolls subscription, quota and redemption back after downstream failure", async () => {
      const f = await fixture(),
        v = await voucher(f);
      await expect(redeem(f, v, true)).rejects.toThrow("controlled downstream");
      expect(await state(v)).toEqual({ status: "assigned", used_count: 0 });
      expect(
        await count(
          "select count(*) n from metering.subscriptions where tenant_id=$1",
          [f.scope.tenantId],
        ),
      ).toBe(0);
      expect(
        await count(
          "select count(*) n from provisioning.webhook_deliveries where tenant_id=$1",
          [f.scope.tenantId],
        ),
      ).toBe(0);
      await redeem(f, v);
    });
    it("serializes different vouchers competing for one subscription slot", async () => {
      const f = await fixture(),
        a = await voucher(f),
        b = await voucher(f);
      const results = await Promise.allSettled([redeem(f, a), redeem(f, b)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        await count(
          "select count(*) n from metering.subscriptions where tenant_id=$1",
          [f.scope.tenantId],
        ),
      ).toBe(1);
    });
    it("consumes one voucher at most once under concurrent redemption", async () => {
      const f = await fixture(),
        v = await voucher(f);
      const results = await Promise.allSettled([redeem(f, v), redeem(f, v)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        await count(
          "select count(*) n from promotion.voucher_redemptions where voucher_id=$1",
          [v],
        ),
      ).toBe(1);
    });
    it("rejects a foreign scope before subscription acquisition", async () => {
      const f = await fixture(),
        g = await fixture(),
        v = await voucher(f);
      await expect(redeem(g, v)).rejects.toThrow();
      expect(await state(v)).toMatchObject({ used_count: 0 });
    });
    it("honors the pending-order slot used by paid purchases", async () => {
      const f = await fixture(),
        v = await voucher(f);
      await order(f);
      await expect(redeem(f, v)).rejects.toThrow();
      expect(await state(v)).toMatchObject({ used_count: 0 });
    });
    it("rejects an unavailable bundled catalog component", async () => {
      const f = await fixture(),
        v = await voucher(f);
      await owner.query(
        "update product.products set status='inactive' where id=$1",
        [f.bundledId],
      );
      await expect(redeem(f, v)).rejects.toThrow();
      expect(await state(v)).toMatchObject({ used_count: 0 });
    });
    it("extends term pools without increasing quota or resetting usage and anchors", async () => {
      const f = await fixture(),
        v = await voucher(f),
        sub = await redeem(f, v),
        e = await voucher(f, "extension");
      await owner.query(
        "update metering.quota_pools set quota_used=17,expires_at=$2 where subscription_id=$1",
        [sub.id, sub.endAt],
      );
      const before = (
        await owner.query(
          "select quota_limit,quota_used,period_anchor,current_period_start,expires_at from metering.quota_pools where subscription_id=$1",
          [sub.id],
        )
      ).rows[0];
      const end = await extend(f, e, sub.id, {
        endAt: sub.endAt!.toISOString(),
        planVersionId: f.versionId,
      });
      expect(end.getTime() - sub.endAt!.getTime()).toBe(7 * 86400000);
      const after = (
        await owner.query(
          "select quota_limit,quota_used,period_anchor,current_period_start,expires_at from metering.quota_pools where subscription_id=$1",
          [sub.id],
        )
      ).rows[0];
      expect({ ...after, expires_at: before.expires_at }).toEqual(before);
      expect(after.expires_at.getTime() - before.expires_at.getTime()).toBe(
        7 * 86400000,
      );
      expect(await state(e)).toMatchObject({
        status: "redeemed",
        used_count: 1,
      });
    });
    it("rejects stale extension previews and leaves their voucher available", async () => {
      const f = await fixture(),
        sub = await redeem(f, await voucher(f)),
        a = await voucher(f, "extension"),
        b = await voucher(f, "extension");
      const expected = {
        endAt: sub.endAt!.toISOString(),
        planVersionId: f.versionId,
      };
      await extend(f, a, sub.id, expected);
      await expect(extend(f, b, sub.id, expected)).rejects.toThrow();
      expect(await state(b)).toMatchObject({ used_count: 0 });
    });
    it("rolls term changes and voucher consumption back on downstream failure", async () => {
      const f = await fixture(),
        sub = await redeem(f, await voucher(f)),
        e = await voucher(f, "extension");
      await expect(
        extend(
          f,
          e,
          sub.id,
          { endAt: sub.endAt!.toISOString(), planVersionId: f.versionId },
          true,
        ),
      ).rejects.toThrow("controlled downstream");
      expect((await services().subscriptions.getById(sub.id))!.endAt).toEqual(
        sub.endAt,
      );
      expect(await state(e)).toMatchObject({ used_count: 0 });
    });
    it("expiry CAS cannot cancel a subscription extended after the scan", async () => {
      const f = await fixture(),
        sub = await redeem(f, await voucher(f));
      await extend(f, await voucher(f, "extension"), sub.id, {
        endAt: sub.endAt!.toISOString(),
        planVersionId: f.versionId,
      });
      expect(
        await services().subscriptions.update(sub.id, sub, {
          status: "expired",
          operatorType: "system",
          expectedStatus: "active",
          expectedEndAt: sub.endAt,
        }),
      ).toBeNull();
      expect((await services().subscriptions.getById(sub.id))!.status).toBe(
        "active",
      );
    });
    it.each(["suspended", "trial", "perpetual"])(
      "rejects %s extension targets",
      async (mode) => {
        const f = await fixture(),
          sub = await redeem(f, await voucher(f)),
          e = await voucher(f, "extension");
        if (mode === "suspended")
          await owner.query(
            "update metering.subscriptions set status='suspended' where id=$1",
            [sub.id],
          );
        if (mode === "trial")
          await owner.query(
            "update metering.subscriptions set subscription_kind='trial' where id=$1",
            [sub.id],
          );
        if (mode === "perpetual")
          await owner.query(
            "update metering.subscriptions set cycle_unit='perpetual',end_at=null where id=$1",
            [sub.id],
          );
        await expect(
          extend(f, e, sub.id, {
            endAt: sub.endAt!.toISOString(),
            planVersionId: f.versionId,
          }),
        ).rejects.toThrow();
        expect(await state(e)).toMatchObject({ used_count: 0 });
      },
    );

    // ============================================================================
    // Exact settlement identities, source-aware refunds and durable recovery.
    // ============================================================================
    it("settles balance plus voucher with one proven debit and an exact redemption", async () => {
      const f = await fixture(),
        c = await checkout(f, "balance");
      expect(c.result.outcome).toBe("activated");
      expect(await state(c.voucherId)).toMatchObject({
        status: "redeemed",
        used_count: 1,
      });
      const rows = (
        await owner.query(
          "select pay_source,paid_amount::text from billing.payments where bill_id=$1 order by pay_source",
          [c.invoiceId],
        )
      ).rows;
      expect(rows).toEqual([
        { pay_source: "balance", paid_amount: "80.00" },
        { pay_source: "voucher", paid_amount: "20.00" },
      ]);
      expect((await c.app.service.getOrder(c.order.id)).status).toBe(
        "fulfilled",
      );
      expect(
        (
          await c.app.service.declarePayment({
            orderId: c.order.id,
            tenantId: f.scope.tenantId,
            userId: f.scope.userId,
            payChannel: "balance",
            creditVoucherId: c.voucherId,
          })
        ).outcome,
      ).toBe("already_settled");
      expect(
        await count(
          "select count(*) n from billing.wallet_operations o join billing.credits c on c.id=o.credit_id where c.tenant_id=$1 and o.action='consume'",
          [f.scope.tenantId],
        ),
      ).toBe(1);
    });
    it("settles a voucher-only order without cash or wallet payments", async () => {
      const f = await fixture(),
        c = await checkout(f, "alipay", 10000);
      expect(c.result.outcome).toBe("activated");
      expect(
        (
          await owner.query(
            "select pay_source from billing.payments where bill_id=$1",
            [c.invoiceId],
          )
        ).rows,
      ).toEqual([{ pay_source: "voucher" }]);
      expect(
        (await c.app.service.getRefundEligibility(c.order.id)).reasons,
      ).toContain("zero_amount");
    });
    it("rejects and redeclares without an old credential releasing a new reservation", async () => {
      const f = await fixture(),
        v = await voucher(f, "credit_voucher"),
        o = await order(f),
        app = services(),
        a = services(admin),
        router = new OrdersRouter(admin, admin, a.service, a.promotion);
      const input = {
        orderId: o.order.id,
        tenantId: f.scope.tenantId,
        userId: f.scope.userId,
        payChannel: "alipay" as const,
        creditVoucherId: v,
      };
      const first = await app.service.declarePayment(input);
      const old = (
        await owner.query(
          "select id,effect_snapshot from promotion.voucher_reservations where declaration_payment_id=$1",
          [first.paymentId],
        )
      ).rows[0];
      await router.rejectPaymentDeclaration(operatorRequest(), o.order.id, {
        reason: "Synthetic rejection",
      });
      expect(await state(v)).toMatchObject({ status: "assigned" });
      const second = await app.service.declarePayment(input);
      expect(second.paymentId).not.toBe(first.paymentId);
      await expect(
        tx((client) =>
          app.promotion.releaseReserved(client, {
            orderId: o.order.id,
            invoiceId: o.invoiceId,
            declarationPaymentId: first.paymentId!,
            creditVoucherId: v,
            creditReservationId: old.id,
          }),
        ),
      ).resolves.toEqual([]);
      expect(await state(v)).toMatchObject({ status: "reserved" });
    });
    it("restores original wallet sources and compensates the voucher exactly once", async () => {
      const f = await fixture(),
        c = await checkout(f, "balance"),
        refund = await approved(c);
      expect(
        (await c.adminApp.repository.getRefundById(refund.id))!.refundStatus,
      ).toBe("success");
      expect(
        (
          await owner.query(
            "select balance::text,total_consumed::text from billing.credits where tenant_id=$1",
            [f.scope.tenantId],
          )
        ).rows[0],
      ).toEqual({ balance: "100.00", total_consumed: "0.00" });
      expect(
        (
          await owner.query(
            "select calculation_snapshot from billing.refunds where id=$1",
            [refund.id],
          )
        ).rows[0].calculation_snapshot,
      ).toMatchObject({
        cash: [],
        wallet: [{ source: "balance", targetCents: 8000 }],
      });
      expect(
        await count(
          "select count(*) n from billing.refund_allocations where refund_id=$1",
          [refund.id],
        ),
      ).toBe(0);
      await c.adminApp.service.reconcileRefundSettlements();
      await c.adminApp.service.executeRefund(refund.id, actor);
      await c.adminApp.service.reconcileRefundSettlements();
      expect(
        await count(
          "select count(*) n from promotion.vouchers where replacement_of_redemption_id in(select id from promotion.voucher_redemptions where voucher_id=$1)",
          [c.voucherId],
        ),
      ).toBe(1);
    });
    it("retains partial wallet refunds for manual voucher review", async () => {
      const f = await fixture(),
        c = await checkout(f, "balance"),
        refund = await approved(c, "40.00");
      expect(
        (await c.adminApp.repository.getRefundById(refund.id))!.refundStatus,
      ).toBe("success");
      expect(
        (
          await owner.query(
            "select balance::text from billing.credits where tenant_id=$1",
            [f.scope.tenantId],
          )
        ).rows[0].balance,
      ).toBe("60.00");
      await c.adminApp.service.reconcileRefundSettlements();
      expect(
        (
          await owner.query(
            "select status,reason from promotion.voucher_compensations where order_id=$1",
            [c.order.id],
          )
        ).rows,
      ).toEqual([
        {
          status: "manual_required",
          reason: "unproven_value_or_incomplete_wallet_return",
        },
      ]);
      expect(
        await count(
          "select count(*) n from promotion.vouchers where replacement_of_redemption_id in(select id from promotion.voucher_redemptions where voucher_id=$1)",
          [c.voucherId],
        ),
      ).toBe(0);
    });
    it("reverses a voucher-only cancellation without creating a cash refund", async () => {
      const f = await fixture(),
        c = await checkout(f, "alipay", 10000);
      const current = await c.app.service.getOrder(c.order.id);
      await c.adminApp.lifecycle.cancelSubscription(
        current.subscriptionId!,
        reviewer,
        "Synthetic noncash cancellation",
        "operator",
        c.order.id,
      );
      expect(
        await c.adminApp.service.settleAfterCancel({
          subscriptionId: current.subscriptionId!,
          tenantId: f.scope.tenantId,
          actorUserId: reviewer,
          actorType: "operator",
        }),
      ).toEqual({ outcome: "no_charge" });
      expect((await c.app.service.getOrder(c.order.id)).status).toBe(
        "refunded",
      );
      expect(
        await count(
          "select count(*) n from billing.refunds where order_id=$1",
          [c.order.id],
        ),
      ).toBe(0);
      await c.adminApp.service.reconcileRefundSettlements();
      expect(
        (
          await owner.query(
            "select status,amount_cents::text from promotion.voucher_compensations where order_id=$1",
            [c.order.id],
          )
        ).rows,
      ).toEqual([{ status: "completed", amount_cents: "10000" }]);
    });
    it("reserves only cash value, retries failed transfers and recovers one replacement", async () => {
      const f = await fixture(),
        c = await checkout(f),
        refund = await approved(c);
      expect(refund.amount).toBe("80.00");
      expect(
        (
          await owner.query(
            "select amount::text,status from billing.refund_allocations where refund_id=$1",
            [refund.id],
          )
        ).rows,
      ).toEqual([{ amount: "80.00", status: "reserved" }]);
      await expect(
        c.adminApp.service.executeRefund(refund.id, actor),
      ).rejects.toThrow();
      await c.adminApp.service.initiateRefundTransfer(
        refund.id,
        { channel: "alipay", reference: randomUUID() },
        actor,
      );
      await c.adminApp.service.failRefund(
        refund.id,
        "Synthetic failure",
        actor,
      );
      expect(
        (
          await owner.query(
            "select status from billing.refund_allocations where refund_id=$1",
            [refund.id],
          )
        ).rows[0].status,
      ).toBe("released");
      await c.adminApp.service.initiateRefundTransfer(
        refund.id,
        { channel: "alipay", reference: randomUUID() },
        actor,
      );
      const results = await Promise.allSettled([
        c.adminApp.service.executeRefund(refund.id, actor),
        c.adminApp.service.executeRefund(refund.id, actor),
      ]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      await c.adminApp.service.reconcileRefundSettlements();
      expect(
        await count(
          "select count(*) n from billing.transactions where related_no=$1 and trade_type='refund'",
          [refund.refundNo],
        ),
      ).toBe(1);
      expect(
        (
          await owner.query(
            "select status,amount_cents::text from promotion.voucher_compensations where order_id=$1",
            [c.order.id],
          )
        ).rows,
      ).toEqual([{ status: "completed", amount_cents: "2000" }]);
    });
    it("allocates a refund across multiple cash receipts without using voucher capacity", async () => {
      const f = await fixture(),
        c = await checkout(f);
      await owner.query(
        "update billing.payments set total_amount=40,paid_amount=40 where bill_id=$1 and pay_source='offline'",
        [c.invoiceId],
      );
      await owner.query(
        "insert into billing.payments(tenant_id,bill_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status,paid_at) values($1,$2,$3,'online',40,40,'paid',clock_timestamp())",
        [f.scope.tenantId, c.invoiceId, randomUUID()],
      );
      const refund = await approved(c);
      expect(
        (
          await owner.query(
            "select amount::text from billing.refund_allocations where refund_id=$1 order by payment_id",
            [refund.id],
          )
        ).rows,
      ).toEqual([{ amount: "40.00" }, { amount: "40.00" }]);
      await c.adminApp.service.initiateRefundTransfer(
        refund.id,
        { channel: "alipay", reference: randomUUID() },
        actor,
      );
      await c.adminApp.service.executeRefund(refund.id, actor);
      expect(
        (await c.adminApp.repository.getRefundById(refund.id))!.refundStatus,
      ).toBe("success");
    });
    it("rejects changed voucher source evidence before approving a refund", async () => {
      const f = await fixture(),
        c = await checkout(f);
      const refund = await c.adminApp.service.createOperatorRefund({
        orderId: c.order.id,
        operatorId: creator,
        reason: "Synthetic frozen evidence",
      });
      await owner.query(
        "update billing.payments set paid_amount=19 where bill_id=$1 and pay_source='voucher'",
        [c.invoiceId],
      );
      await expect(
        c.adminApp.service.auditRefund(refund.id, {
          decision: "approved",
          remark: "Synthetic approval",
          operatorId: reviewer,
        }),
      ).rejects.toThrow();
      expect(
        (await c.adminApp.repository.getRefundById(refund.id))!.auditStatus,
      ).toBe("pending");
    });
    it("rolls financial changes back if compensation persistence fails", async () => {
      const f = await fixture(),
        c = await checkout(f),
        refund = await approved(c);
      await c.adminApp.service.initiateRefundTransfer(
        refund.id,
        { channel: "alipay", reference: randomUUID() },
        actor,
      );
      const failure = vi
        .spyOn(c.adminApp.promotion, "queueRefundCompensations")
        .mockRejectedValueOnce(new Error("controlled compensation failure"));
      try {
        await expect(
          c.adminApp.service.executeRefund(refund.id, actor),
        ).rejects.toThrow("controlled compensation");
      } finally {
        failure.mockRestore();
      }
      expect(
        (await c.adminApp.repository.getRefundById(refund.id))!.refundStatus,
      ).toBe("processing");
      expect((await c.app.service.getOrder(c.order.id)).status).toBe(
        "fulfilled",
      );
      expect(
        await count(
          "select count(*) n from billing.transactions where related_no=$1 and trade_type='refund'",
          [refund.refundNo],
        ),
      ).toBe(0);
      await c.adminApp.service.executeRefund(refund.id, actor);
    });
    it("retains an intention after cancellation failure and recovers it next pass", async () => {
      const f = await fixture(),
        c = await checkout(f),
        refund = await approved(c);
      await c.adminApp.service.initiateRefundTransfer(
        refund.id,
        { channel: "alipay", reference: randomUUID() },
        actor,
      );
      const failure = vi
        .spyOn(c.adminApp.lifecycle, "cancelSubscription")
        .mockRejectedValueOnce(new Error("controlled effect failure"));
      try {
        await c.adminApp.service.executeRefund(refund.id, actor);
      } finally {
        failure.mockRestore();
      }
      expect(
        (
          await owner.query(
            "select status from promotion.voucher_compensations where order_id=$1",
            [c.order.id],
          )
        ).rows[0].status,
      ).toBe("pending");
      await c.adminApp.service.reconcileRefundSettlements();
      expect(
        (
          await owner.query(
            "select status from promotion.voucher_compensations where order_id=$1",
            [c.order.id],
          )
        ).rows[0].status,
      ).toBe("completed");
    });
    it("routes a partial cash return to manual voucher review", async () => {
      const f = await fixture(),
        c = await checkout(f),
        refund = await approved(c, "40.00");
      await c.adminApp.service.initiateRefundTransfer(
        refund.id,
        { channel: "alipay", reference: randomUUID() },
        actor,
      );
      await c.adminApp.service.executeRefund(refund.id, actor);
      await c.adminApp.service.reconcileRefundSettlements();
      expect(
        (
          await owner.query(
            "select status from promotion.voucher_compensations where order_id=$1",
            [c.order.id],
          )
        ).rows[0].status,
      ).toBe("manual_required");
      expect(
        await count(
          "select count(*) n from promotion.vouchers where replacement_of_redemption_id in(select id from promotion.voucher_redemptions where voucher_id=$1)",
          [c.voucherId],
        ),
      ).toBe(0);
    });
    it("rejects an unproven historical balance source before creating a refund", async () => {
      const f = await fixture(),
        c = await checkout(f);
      await owner.query(
        "update billing.payments set pay_source='balance',transaction_id=null where bill_id=$1 and pay_source='offline'",
        [c.invoiceId],
      );
      await expect(
        c.adminApp.service.createOperatorRefund({
          orderId: c.order.id,
          operatorId: creator,
          reason: "Synthetic unproven source",
        }),
      ).rejects.toThrow();
      expect(
        await count(
          "select count(*) n from billing.refunds where order_id=$1",
          [c.order.id],
        ),
      ).toBe(0);
    });
    it("rejects payment currency mismatch rather than hiding evidence", async () => {
      const f = await fixture(),
        c = await checkout(f);
      await owner.query(
        "update billing.payments set currency='USD' where bill_id=$1 and pay_source='offline'",
        [c.invoiceId],
      );
      await expect(
        c.adminApp.service.getRefundEligibility(c.order.id),
      ).rejects.toThrow();
    });
  },
);
