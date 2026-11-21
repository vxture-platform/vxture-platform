/**
 * subscription-voucher.itest.spec.ts - Atomic grants and races on disposable PostgreSQL.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// ⚠️ 跨层引用: Exercise supported domain interfaces under real BFF roles.
import {
  PgVoucherManagement,
  PgCustomerVoucherLedger,
  PgVoucherClaims,
  VoucherClaimCredentials,
  type VoucherScope,
} from "@vxture/service-promotion";
// ⚠️ 跨层引用: Verify interoperability with normal paid order acquisition.
import { PgOrderRepository } from "@vxture/service-subscription";
import {
  previewSubscriptionVoucher,
  redeemSubscriptionVoucher,
  subscriptionVoucherResult,
} from "./subscription-voucher-operation";

// ===========================================================================
// Only a runner-owned loopback database with the matching run marker is accepted.
// ===========================================================================
describe.skipIf(process.env["SUBSCRIPTION_VOUCHER_ITEST"] !== "1")(
  "B08 subscription vouchers PostgreSQL",
  () => {
    const operator = "11111111-1111-4111-8111-111111111111",
      reviewer = "22222222-2222-4222-8222-222222222222";
    let owner: Pool,
      admin: Pool,
      customer: Pool,
      management: PgVoucherManagement;
    beforeAll(async () => {
      const runId = process.env["VOUCHER_CONSOLE_OWNED_RUN_ID"];
      expect(runId).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
      );
      const url = new URL(
        process.env["VOUCHER_CONSOLE_OWNED_DATABASE_URL"] ?? "",
      );
      expect(url.protocol).toBe("postgresql:");
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.username).toBe("postgres");
      expect(url.password).toBe("");
      expect(url.pathname).toBe("/voucher_redemption");
      expect(url.search + url.hash).toBe("");
      expect(Number(url.port)).toBeGreaterThan(0);
      const connection = {
        host: "127.0.0.1",
        port: Number(url.port),
        database: "voucher_redemption",
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
          db: "voucher_redemption",
          role: "postgres",
          marker: "codex-voucher-console:" + runId,
        },
      ]);
      admin = new Pool({ ...connection, user: "svc_admin_bff" });
      customer = new Pool({ ...connection, user: "svc_console_bff", max: 10 });
      management = new PgVoucherManagement(admin);
    }, 60000);
    afterAll(async () => {
      await customer?.end();
      await admin?.end();
      await owner?.end();
    }, 60000);
    const command = () => ({
      idempotencyKey: randomUUID(),
      reason: "B08 acceptance",
    });
    async function context(): Promise<VoucherScope> {
      const userId = randomUUID(),
        tenantId = randomUUID(),
        workspaceId = randomUUID();
      await owner.query(
        "insert into account.users(id,account,phone,phone_verified_at) values($1::uuid,$1::text,$2,now())",
        [userId, `+${Date.now()}${Math.floor(Math.random() * 100000)}`],
      );
      await owner.query(
        "insert into tenancy.tenants(id,name,type,owner_user_id) values($1,'B08 tenant','organization',$2)",
        [tenantId, userId],
      );
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1,$2,'B08 workspace')",
        [workspaceId, tenantId],
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
        "insert into tenancy.workspace_memberships(tenant_id,workspace_id,user_id,role_id,role_scope) values($1,$2,$3,$4,'workspace')",
        [tenantId, workspaceId, userId, workspaceRole],
      );
      return { userId, tenantId, workspaceId };
    }
    async function fixture() {
      const scope = await context(),
        productId = randomUUID(),
        bundledId = randomUUID(),
        planId = randomUUID(),
        versionId = randomUUID();
      const code = `b08-${productId}`;
      for (const [id, suffix] of [
        [productId, "primary"],
        [bundledId, "bundled"],
      ]) {
        await owner.query(
          "insert into product.products(id,product_code,product_name,product_type,status,release_stage) values($1,$2,$3,'agent','active','stable')",
          [id, `${code}-${suffix}`, `B08 ${suffix}`],
        );
        await owner.query(
          "insert into product.product_webhooks(product_id,webhook_url) values($1,'https://example.invalid/hook')",
          [id],
        );
      }
      await owner.query(
        "insert into product.product_metrics(product_id,metric_key,merge_strategy,consume_mode,cost_class,reset_period) values($1,'calls','pool','atomic','zero_cost','day')",
        [productId],
      );
      await owner.query(
        "insert into product.plans(id,plan_code,plan_name,is_public) values($1,$2,'B08 grant',false)",
        [planId, code],
      );
      await owner.query(
        "insert into product.plan_versions(id,plan_id,version_no) values($1,$2,1)",
        [versionId, planId],
      );
      await owner.query(
        `insert into product.plan_components(plan_version_id,product_id,tier,component_role,quota,features) values($1,$2,'pro','primary','{"calls":100,"seat.max":5}',array['feature.a']),($1,$3,null,'bundled','{"seat.max":5}','{}')`,
        [versionId, productId, bundledId],
      );
      await owner.query(
        "update product.plan_versions set status='published',is_locked=true where id=$1",
        [versionId],
      );
      await owner.query(
        "update product.plans set current_version_id=$2 where id=$1",
        [planId, versionId],
      );
      const created = await management.createBatch(operator, {
        ...command(),
        kind: "redemption",
        name: "B08 fixed grant",
        effect: {
          plan_version_id: versionId,
          duration_days: 30,
          funding_source: "operator_grant",
        },
        totalCount: 10,
        perUserLimit: 10,
        validFrom: new Date(Date.now() - 86400000).toISOString(),
        validUntil: new Date(Date.now() + 86400000 * 3).toISOString(),
      });
      const revision = (
        await owner.query<{ revision: string }>(
          "select extract(epoch from updated_at)::text revision from promotion.voucher_batches where id=$1",
          [created.batchId],
        )
      ).rows[0]!.revision;
      await management.actOnBatch(reviewer, created.batchId, {
        ...command(),
        action: "review",
        expectedRevision: revision,
      });
      const issued = await management.assign(operator, {
        ...command(),
        batchId: created.batchId,
        count: 1,
        targetTenantId: scope.tenantId,
        targetUserId: scope.userId,
      });
      return {
        scope,
        productId,
        bundledId,
        planId,
        versionId,
        batchId: created.batchId,
        voucherId: issued.voucherIds[0]!,
      };
    }
    const redeem = (
      f: Awaited<ReturnType<typeof fixture>>,
      key = randomUUID(),
    ) =>
      redeemSubscriptionVoucher(customer, f.scope, {
        voucherId: f.voucherId,
        idempotencyKey: key,
      });

    // =========================================================================
    // Durable identity, noncash accounting, frozen grants and queue atomicity.
    // =========================================================================
    it("previews without consuming and commits actual service with no cash artifacts", async () => {
      const f = await fixture();
      const preview = await previewSubscriptionVoucher(
        customer,
        f.scope,
        f.voucherId,
      );
      expect(preview).toMatchObject({
        durationDays: 30,
        fundingSource: "operator_grant",
        autoRenew: false,
      });
      expect(preview.grants).toHaveLength(2);
      expect(
        (
          await owner.query(
            "select used_count from promotion.vouchers where id=$1",
            [f.voucherId],
          )
        ).rows[0].used_count,
      ).toBe(0);
      const result = await redeem(f);
      expect(Date.parse(result.endAt) - Date.parse(result.startAt)).toBe(
        30 * 86400000,
      );
      const sub = (
        await owner.query("select * from metering.subscriptions where id=$1", [
          result.subscriptionId,
        ])
      ).rows[0];
      expect(sub).toMatchObject({
        status: "active",
        subscription_kind: "free",
        activation_method: "redemption",
        auto_renew: false,
        paid_amount: "0.00",
        current_order_id: null,
        cycle_unit: "day",
        cycle_count: 30,
      });
      const pool = (
        await owner.query(
          "select * from metering.quota_pools where subscription_id=$1",
          [result.subscriptionId],
        )
      ).rows[0];
      expect(pool).toMatchObject({
        quota_limit: "100",
        quota_used: "0",
        reset_period: "day",
      });
      expect(new Date(pool.period_anchor)).toEqual(new Date(result.startAt));
      for (const table of ["orders", "payments", "transactions", "invoices"])
        expect(
          (
            await owner.query(
              `select count(*)::int n from billing.${table} where tenant_id=$1`,
              [f.scope.tenantId],
            )
          ).rows[0].n,
        ).toBe(0);
      const evidence = (
        await owner.query(
          "select * from promotion.voucher_redemptions where voucher_id=$1",
          [f.voucherId],
        )
      ).rows[0];
      expect(evidence).toMatchObject({
        subscription_id: result.subscriptionId,
        payment_id: null,
        order_id: null,
        redemption_no: result.redemptionNo,
      });
      expect(evidence.effect_snapshot.resolved_grants).toHaveLength(2);
      const events = await owner.query(
        "select * from provisioning.webhook_deliveries where workspace_id=$1",
        [f.scope.workspaceId],
      );
      expect(events.rows).toHaveLength(4);
      expect(events.rows.every((r) => r.status === "pending")).toBe(true);
      const ledger = await new PgCustomerVoucherLedger(customer).page(f.scope, {
        status: "redeemed",
      });
      expect(ledger.items[0]).toMatchObject({
        voucherId: f.voucherId,
        redemptionNo: result.redemptionNo,
      });
    });
    it("retries concurrently with one subscription, receipt, audit and delivery set", async () => {
      const f = await fixture(),
        key = randomUUID();
      const results = await Promise.all([redeem(f, key), redeem(f, key)]);
      expect(results[1]).toEqual(results[0]);
      expect(await subscriptionVoucherResult(customer, f.scope, key)).toEqual(
        results[0],
      );
      expect(
        (
          await owner.query(
            "select count(*)::int n from metering.subscriptions where workspace_id=$1",
            [f.scope.workspaceId],
          )
        ).rows[0].n,
      ).toBe(1);
      await expect(redeem(f)).rejects.toThrow("不可用");
      await expect(
        redeemSubscriptionVoucher(customer, f.scope, {
          voucherId: randomUUID(),
          idempotencyKey: key,
        }),
      ).rejects.toThrow("参数");
      const other = await context();
      expect(await subscriptionVoucherResult(customer, other, key)).toBeNull();
      await expect(
        redeemSubscriptionVoucher(customer, other, {
          voucherId: f.voucherId,
          idempotencyKey: key,
        }),
      ).rejects.toThrow("不可用");
    });
    it.each(["quota", "audit", "queue"])(
      "rolls back every effect on %s failure, then safely retries",
      async (failure) => {
        const f = await fixture(),
          key = randomUUID();
        const table =
          failure === "quota"
            ? "metering.quota_pools"
            : failure === "audit"
              ? "promotion.voucher_events"
              : "provisioning.webhook_deliveries";
        await owner.query(
          `create function public.b08_fail() returns trigger language plpgsql as $$ begin raise exception 'B08 injected'; end $$; create trigger b08_fail before insert on ${table} for each row execute function public.b08_fail()`,
        );
        try {
          await expect(redeem(f, key)).rejects.toThrow("B08 injected");
        } finally {
          await owner.query(
            `drop trigger b08_fail on ${table};drop function public.b08_fail()`,
          );
        }
        expect(
          (
            await owner.query(
              "select status,used_count from promotion.vouchers where id=$1",
              [f.voucherId],
            )
          ).rows[0],
        ).toMatchObject({ status: "assigned", used_count: 0 });
        expect(
          (
            await owner.query(
              "select count(*)::int n from metering.subscriptions where workspace_id=$1",
              [f.scope.workspaceId],
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          await subscriptionVoucherResult(customer, f.scope, key),
        ).toBeNull();
        await redeem(f, key);
      },
    );
    it.each(["active", "trialing", "expiring", "overdue", "suspended"])(
      "refuses an existing %s subscription",
      async (status) => {
        const f = await fixture();
        await owner.query(
          "insert into metering.subscriptions(tenant_id,workspace_id,plan_version_id,subscription_kind,cycle_unit,start_at,status,created_by_type,created_by_id) values($1,$2,$3,'paid','month',now(),$4,'customer',$5)",
          [
            f.scope.tenantId,
            f.scope.workspaceId,
            f.versionId,
            status,
            f.scope.userId,
          ],
        );
        await expect(redeem(f)).rejects.toThrow("已有");
      },
    );
    it("serializes different vouchers competing for the same product", async () => {
      const f = await fixture();
      const another = await management.assign(operator, {
        ...command(),
        batchId: f.batchId,
        count: 1,
        targetTenantId: f.scope.tenantId,
        targetUserId: f.scope.userId,
      });
      const attempts = await Promise.allSettled([
        redeem(f),
        redeem({ ...f, voucherId: another.voucherIds[0]! }),
      ]);
      expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.voucher_redemptions where tenant_id=$1",
            [f.scope.tenantId],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("serializes redemption against a normal pending purchase", async () => {
      const f = await fixture();
      const results = await Promise.allSettled([
        redeem(f),
        new PgOrderRepository(customer).createOrder({
          tenantId: f.scope.tenantId,
          workspaceId: f.scope.workspaceId,
          planVersionId: f.versionId,
          intent: "new",
          price: 100,
          cycleUnit: "month",
          itemName: "B08",
          createdBy: f.scope.userId,
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const occupied = await owner.query(
        `select (select count(*) from metering.subscriptions where workspace_id=$1)+(select count(*) from billing.orders where workspace_id=$1) n`,
        [f.scope.workspaceId],
      );
      expect(Number(occupied.rows[0].n)).toBe(1);
    });
    it("rechecks batch pause, expiry and workspace ownership", async () => {
      const f = await fixture();
      await previewSubscriptionVoucher(customer, f.scope, f.voucherId);
      await management.actOnBatch(operator, f.batchId, {
        ...command(),
        action: "pause",
      });
      await expect(redeem(f)).rejects.toThrow("不可用");
      await management.actOnBatch(operator, f.batchId, {
        ...command(),
        action: "resume",
      });
      await owner.query(
        "update promotion.vouchers set expires_at=now() where id=$1",
        [f.voucherId],
      );
      await expect(redeem(f)).rejects.toThrow("不可用");
      const other = await context();
      await expect(
        previewSubscriptionVoucher(customer, other, f.voucherId),
      ).rejects.toThrow("不可用");
    });
    it("blocks product lifecycle, release-stage and maintenance changes after preview", async () => {
      const f = await fixture();
      await previewSubscriptionVoucher(customer, f.scope, f.voucherId);
      for (const patch of [
        "status='inactive'",
        "release_stage='preview'",
        "release_stage='sunset'",
        "maintenance_window_id=gen_random_uuid(),maintenance_until=now()+interval '1 hour'",
      ]) {
        await owner.query(`update product.products set ${patch} where id=$1`, [
          f.productId,
        ]);
        await expect(redeem(f)).rejects.toThrow("未开放");
        await owner.query(
          "update product.products set status='active',release_stage='stable',maintenance_window_id=null,maintenance_until=null where id=$1",
          [f.productId],
        );
      }
    });
    it.each(["pending_payment", "pending_verify", "paid"])(
      "refuses an existing %s order",
      async (status) => {
        const f = await fixture();
        const order = await new PgOrderRepository(customer).createOrder({
          tenantId: f.scope.tenantId,
          workspaceId: f.scope.workspaceId,
          planVersionId: f.versionId,
          intent: "new",
          price: 100,
          cycleUnit: "month",
          itemName: "B08",
          createdBy: f.scope.userId,
        });
        await owner.query("update billing.orders set status=$2 where id=$1", [
          order.order.id,
          status,
        ]);
        await expect(
          previewSubscriptionVoucher(customer, f.scope, f.voucherId),
        ).rejects.toThrow("已有");
        await expect(redeem(f)).rejects.toThrow("已有");
      },
    );
    it("enforces the exact assigned workspace and current membership", async () => {
      const f = await fixture(),
        workspaceId = randomUUID();
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1,$2,'Other workspace')",
        [workspaceId, f.scope.tenantId],
      );
      await owner.query(
        "update promotion.vouchers set assigned_workspace_id=$2 where id=$1",
        [f.voucherId, f.scope.workspaceId],
      );
      await expect(
        redeemSubscriptionVoucher(
          customer,
          { ...f.scope, workspaceId },
          { voucherId: f.voucherId, idempotencyKey: randomUUID() },
        ),
      ).rejects.toThrow("不可用");
      const other = await context();
      await expect(
        redeemSubscriptionVoucher(
          customer,
          { ...f.scope, userId: other.userId },
          { voucherId: f.voucherId, idempotencyKey: randomUUID() },
        ),
      ).rejects.toThrow("不可访问");
      await redeem(f);
    });
    it("keeps the approved version when the current catalog advances", async () => {
      const f = await fixture(),
        nextVersion = randomUUID();
      await owner.query(
        "insert into product.plan_versions(id,plan_id,version_no) values($1,$2,2)",
        [nextVersion, f.planId],
      );
      await owner.query(
        "insert into product.plan_components(plan_version_id,product_id,tier,component_role,quota,features) values($1,$2,'pro','primary','{\"calls\":999}',array['changed'])",
        [nextVersion, f.productId],
      );
      await owner.query(
        "update product.plan_versions set status='published',is_locked=true where id=$1",
        [nextVersion],
      );
      await owner.query(
        "update product.plans set current_version_id=$2 where id=$1",
        [f.planId, nextVersion],
      );
      const result = await redeem(f);
      expect(result.versionNo).toBe(1);
      expect(
        (
          await owner.query(
            "select plan_version_id from metering.subscriptions where id=$1",
            [result.subscriptionId],
          )
        ).rows[0].plan_version_id,
      ).toBe(f.versionId);
      expect(
        (
          await owner.query(
            "select quota_limit from metering.quota_pools where subscription_id=$1",
            [result.subscriptionId],
          )
        ).rows[0].quota_limit,
      ).toBe("100");
    });
    it("checks wall-clock expiry after waiting for an acquisition lock", async () => {
      const f = await fixture(),
        block = await owner.connect();
      let attempt: Promise<unknown> | undefined;
      try {
        await block.query("begin");
        await block.query(
          "select id from tenancy.workspaces where id=$1 for no key update",
          [f.scope.workspaceId],
        );
        attempt = redeem(f).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        let waiting = false;
        for (let n = 0; n < 100; n++) {
          const state = await owner.query(
            "select 1 from pg_stat_activity where usename='svc_console_bff' and wait_event_type='Lock' and query like 'select id from tenancy.workspaces%'",
          );
          if (state.rowCount) {
            waiting = true;
            break;
          }
          await setTimeout(20);
        }
        expect(waiting).toBe(true);
        await block.query(
          "update promotion.vouchers set expires_at=clock_timestamp() where id=$1",
          [f.voucherId],
        );
        await block.query("commit");
        expect(await attempt).toMatchObject({
          error: { message: expect.stringContaining("不可用") },
        });
      } finally {
        await block.query("rollback");
        block.release();
        await attempt;
      }
    });
    it("blocks maintenance of a bundled component", async () => {
      const f = await fixture();
      await owner.query(
        "update product.products set maintenance_window_id=gen_random_uuid(),maintenance_until=now()+interval '1 hour' where id=$1",
        [f.bundledId],
      );
      await expect(redeem(f)).rejects.toThrow("未开放");
      expect(
        (
          await new PgCustomerVoucherLedger(customer).page(f.scope, {
            status: "available",
          })
        ).total,
      ).toBe(0);
    });
    it("refuses sales-backed instances even when their batch claims a free grant", async () => {
      const f = await fixture(),
        other = await context();
      const sale = await new PgOrderRepository(customer).createOrder({
        tenantId: other.tenantId,
        workspaceId: other.workspaceId,
        planVersionId: f.versionId,
        intent: "new",
        price: 100,
        cycleUnit: "month",
        itemName: "B08 source",
        createdBy: other.userId,
      });
      await owner.query(
        "update promotion.vouchers set funding_order_id=$2 where id=$1",
        [f.voucherId, sale.order.id],
      );
      await expect(
        previewSubscriptionVoucher(customer, f.scope, f.voucherId),
      ).rejects.toThrow("不可用");
      await expect(redeem(f)).rejects.toThrow("不可用");
      expect(
        (
          await new PgCustomerVoucherLedger(customer).page(f.scope, {
            status: "available",
          })
        ).total,
      ).toBe(0);
    });
    it("supports B07 issuance and claim before subscription redemption", async () => {
      const f = await fixture(),
        credentials = new VoucherClaimCredentials({
          VOUCHER_CLAIM_ACTIVE_KEY: "k1",
          VOUCHER_CLAIM_KEYS: JSON.stringify({ k1: "a1".repeat(32) }),
        });
      const issued = await management.issueClaimCredentials(
        operator,
        f.batchId,
        { ...command(), count: 1 },
        credentials,
      );
      const claims = new PgVoucherClaims(customer, credentials);
      await claims.claim(f.scope, {
        secret: issued.credentials[0]!.secret,
        target: "workspace",
        idempotencyKey: randomUUID(),
      });
      const page = await new PgCustomerVoucherLedger(customer).page(f.scope, {
        status: "available",
      });
      expect(page.total).toBe(2);
      await redeem({ ...f, voucherId: issued.voucherIds[0]! });
    });
  },
);
