/**
 * subscription-extension.itest.spec.ts - Atomic extensions and races on disposable PostgreSQL.
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
import {
  PgOrderRepository,
  PgSubscriptionRepository,
} from "@vxture/service-subscription";
import {
  previewSubscriptionExtension,
  extendSubscriptionVoucher,
  subscriptionExtensionResult,
  type ExtensionCommand,
} from "./subscription-extension-operation";

// ===========================================================================
// Only a runner-owned loopback database with the matching run marker is accepted.
// ===========================================================================
describe.skipIf(process.env["SUBSCRIPTION_EXTENSION_ITEST"] !== "1")(
  "B09 subscription vouchers PostgreSQL",
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
      expect(url.pathname).toBe("/voucher_extension");
      expect(url.search + url.hash).toBe("");
      expect(Number(url.port)).toBeGreaterThan(0);
      const connection = {
        host: "127.0.0.1",
        port: Number(url.port),
        database: "voucher_extension",
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
          db: "voucher_extension",
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
      reason: "B09 acceptance",
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
        "insert into tenancy.tenants(id,name,type,owner_user_id) values($1,'B09 tenant','organization',$2)",
        [tenantId, userId],
      );
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1,$2,'B09 workspace')",
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
      const code = `b09-${productId}`;
      for (const [id, suffix] of [
        [productId, "primary"],
        [bundledId, "bundled"],
      ]) {
        await owner.query(
          "insert into product.products(id,product_code,product_name,product_type,status,release_stage) values($1,$2,$3,'agent','active','stable')",
          [id, `${code}-${suffix}`, `B09 ${suffix}`],
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
        "insert into product.plans(id,plan_code,plan_name,is_public) values($1,$2,'B09 grant',false)",
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
        kind: "extension",
        name: "B09 fixed grant",
        effect: {
          extend_days: 30,
          applicable_product_codes: [`${code}-primary`],
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
      const sub = await new PgSubscriptionRepository(customer).create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        planVersionId: versionId,
        cycleType: "month",
        cycleCount: 1,
        startAt: new Date("2026-01-31T01:02:03.456Z"),
        endAt: new Date("2026-12-31T01:02:03.456Z"),
        autoRenew: true,
        payAmount: 125,
        currency: "CNY",
        createdBy: scope.userId,
        status: "active",
        subscriptionKind: "paid",
        activationMethod: "online_purchase",
      });
      await owner.query(
        "update metering.subscriptions set paid_amount=125,next_renewal_at=end_at-interval '7 days' where id=$1",
        [sub.id],
      );
      await owner.query(
        "update metering.quota_pools set quota_used=47,expires_at=$2 where subscription_id=$1",
        [sub.id, sub.endAt],
      );
      return {
        subscriptionId: sub.id,
        scope,
        productId,
        bundledId,
        planId,
        versionId,
        batchId: created.batchId,
        voucherId: issued.voucherIds[0]!,
      };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    async function confirm(
      f: Fixture,
      changes: Partial<ExtensionCommand> = {},
    ): Promise<ExtensionCommand> {
      const preview = await previewSubscriptionExtension(
        customer,
        f.scope,
        f.voucherId,
      );
      const target = preview.targets[0]!;
      return {
        voucherId: f.voucherId,
        subscriptionId: f.subscriptionId,
        expectedEndAt: target?.previousEndAt ?? "2026-12-31T01:02:03.456Z",
        expectedPlanVersionId: f.versionId,
        idempotencyKey: randomUUID(),
        ...changes,
      };
    }
    const apply = async (f: Fixture, changes: Partial<ExtensionCommand> = {}) =>
      extendSubscriptionVoucher(customer, f.scope, await confirm(f, changes));
    const voucher = async (f: Fixture) =>
      (
        await owner.query(
          "select status,used_count from promotion.vouchers where id=$1",
          [f.voucherId],
        )
      ).rows[0];
    const subscription = async (f: Fixture) =>
      (
        await owner.query("select * from metering.subscriptions where id=$1", [
          f.subscriptionId,
        ])
      ).rows[0]!;

    // =======================================================================
    // Date-only effects preserve all monetary, status and quota facts.
    // =======================================================================
    it.each(["active", "expiring", "overdue"])(
      "extends %s without a cash leg, tier change or quota reset",
      async (status) => {
        const f = await fixture();
        await owner.query(
          "update metering.subscriptions set status=$2 where id=$1",
          [f.subscriptionId, status],
        );
        const before = await subscription(f);
        const poolsBefore = (
          await owner.query(
            "select * from metering.quota_pools where subscription_id=$1",
            [f.subscriptionId],
          )
        ).rows;
        const p = await previewSubscriptionExtension(
          customer,
          f.scope,
          f.voucherId,
        );
        expect(p.targets).toHaveLength(1);
        expect(await voucher(f)).toMatchObject({ used_count: 0 });
        expect(
          (await new PgCustomerVoucherLedger(customer).page(f.scope)).total,
        ).toBe(1);
        const result = await apply(f);
        expect(result.previousEndAt).toBe(before.end_at.toISOString());
        expect(Date.parse(result.endAt) - before.end_at.getTime()).toBe(
          30 * 86400000,
        );
        const after = await subscription(f);
        for (const field of [
          "start_at",
          "plan_version_id",
          "product_id",
          "subscription_kind",
          "cycle_unit",
          "cycle_count",
          "status",
          "auto_renew",
          "pay_amount",
          "paid_amount",
          "current_order_id",
          "activation_method",
          "renewal_source",
          "payment_mandate_id",
        ])
          expect(after[field]).toEqual(before[field]);
        expect(
          after.next_renewal_at.getTime() - before.next_renewal_at.getTime(),
        ).toBe(30 * 86400000);
        const poolsAfter = (
          await owner.query(
            "select * from metering.quota_pools where subscription_id=$1",
            [f.subscriptionId],
          )
        ).rows;
        expect(poolsAfter).toHaveLength(poolsBefore.length);
        for (const [i, pool] of poolsAfter.entries()) {
          expect(pool).toMatchObject({
            quota_used: "47",
            quota_limit: "100",
            period_anchor: poolsBefore[i].period_anchor,
            current_period_start: poolsBefore[i].current_period_start,
          });
          expect(pool.expires_at).toEqual(after.end_at);
        }
        expect(await voucher(f)).toMatchObject({
          status: "redeemed",
          used_count: 1,
        });
        const evidence = (
          await owner.query(
            "select * from promotion.voucher_redemptions where voucher_id=$1",
            [f.voucherId],
          )
        ).rows[0];
        expect(evidence).toMatchObject({
          kind: "extension",
          subscription_id: f.subscriptionId,
          payment_id: null,
          transaction_id: null,
          effect_snapshot: {
            previous_end_at: result.previousEndAt,
            end_at: result.endAt,
            quota_reset: false,
          },
        });
        expect(
          (
            await owner.query(
              "select count(*)::int n from provisioning.webhook_deliveries where workspace_id=$1 and event_type='subscription_changed'",
              [f.scope.workspaceId],
            )
          ).rows[0].n,
        ).toBe(2);
        expect(
          (
            await owner.query(
              "select count(*)::int n from billing.orders where workspace_id=$1",
              [f.scope.workspaceId],
            )
          ).rows[0].n,
        ).toBe(0);
      },
    );
    it.each(["trialing", "suspended", "expired", "cancelled"])(
      "rejects %s without consuming the voucher",
      async (status) => {
        const f = await fixture(),
          c = await confirm(f);
        await owner.query(
          "update metering.subscriptions set status=$2 where id=$1",
          [f.subscriptionId, status],
        );
        expect(
          (await previewSubscriptionExtension(customer, f.scope, f.voucherId))
            .targets,
        ).toHaveLength(0);
        expect(
          (await new PgCustomerVoucherLedger(customer).page(f.scope)).total,
        ).toBe(0);
        await expect(
          extendSubscriptionVoucher(customer, f.scope, c),
        ).rejects.toThrow("重新预览");
        expect(await voucher(f)).toMatchObject({ used_count: 0 });
      },
    );
    it.each([
      "end_at=null",
      "subscription_kind='trial',auto_renew=false",
      "cycle_unit='perpetual',end_at=null",
    ])("rejects unsupported terms: %s", async (patch) => {
      const f = await fixture(),
        c = await confirm(f);
      await owner.query(
        `update metering.subscriptions set ${patch} where id=$1`,
        [f.subscriptionId],
      );
      await expect(
        extendSubscriptionVoucher(customer, f.scope, c),
      ).rejects.toThrow("重新预览");
      expect(
        (await new PgCustomerVoucherLedger(customer).page(f.scope)).total,
      ).toBe(0);
    });
    it("does not extend independent pool grants or overrides and invalidates the cache", async () => {
      const f = await fixture();
      await owner.query(
        "update metering.quota_pools set expires_at=end_at-interval '1 day' from metering.subscriptions s where s.id=subscription_id and s.id=$1",
        [f.subscriptionId],
      );
      await owner.query(
        "insert into metering.subscription_entitlement_overrides(subscription_id,product_id,override_tier_code,expires_at) values($1,$2,'pro',now()+interval '3 days')",
        [f.subscriptionId, f.productId],
      );
      const expiry = (
        await owner.query(
          "select expires_at from metering.quota_pools where subscription_id=$1",
          [f.subscriptionId],
        )
      ).rows[0].expires_at;
      const override = (
        await owner.query(
          "select * from metering.subscription_entitlement_overrides where subscription_id=$1",
          [f.subscriptionId],
        )
      ).rows[0];
      await owner.query(
        "insert into metering.entitlement_caches(workspace_id,product_id,payload,expires_at) values($1,$2,'{}',now()+interval '1 hour')",
        [f.scope.workspaceId, f.productId],
      );
      await apply(f);
      expect(
        (
          await owner.query(
            "select expires_at from metering.quota_pools where subscription_id=$1",
            [f.subscriptionId],
          )
        ).rows[0].expires_at,
      ).toEqual(expiry);
      expect(
        (
          await owner.query(
            "select * from metering.subscription_entitlement_overrides where subscription_id=$1",
            [f.subscriptionId],
          )
        ).rows[0],
      ).toEqual(override);
      expect(
        (
          await owner.query(
            "select count(*)::int n from metering.entitlement_caches where workspace_id=$1",
            [f.scope.workspaceId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("extends overdue time from the original date, never from now and never reactivates", async () => {
      const f = await fixture();
      await owner.query(
        "update metering.subscriptions set status='overdue',end_at=now()-interval '60 days' where id=$1",
        [f.subscriptionId],
      );
      const result = await apply(f);
      expect(Date.parse(result.endAt)).toBeLessThan(Date.now());
      expect((await subscription(f)).status).toBe("overdue");
    });
    it("replays identical concurrent requests and refuses changed target, scope or baseline", async () => {
      const f = await fixture(),
        c = await confirm(f);
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          extendSubscriptionVoucher(customer, f.scope, c),
        ),
      );
      for (const r of results) expect(r).toEqual(results[0]);
      expect(
        await subscriptionExtensionResult(customer, f.scope, c.idempotencyKey),
      ).toEqual(results[0]);
      for (const change of [
        { subscriptionId: randomUUID() },
        { expectedEndAt: "2030-01-01T00:00:00Z" },
        { expectedPlanVersionId: randomUUID() },
      ])
        await expect(
          extendSubscriptionVoucher(customer, f.scope, { ...c, ...change }),
        ).rejects.toThrow("参数或上下文");
      expect(
        (
          await owner.query(
            "select count(*)::int n from metering.subscription_histories where subscription_id=$1 and change_type='voucher_extended'",
            [f.subscriptionId],
          )
        ).rows[0].n,
      ).toBe(1);
      const other = await context();
      await expect(
        extendSubscriptionVoucher(customer, other, c),
      ).rejects.toThrow("不可展期");
      expect(
        await subscriptionExtensionResult(customer, other, c.idempotencyKey),
      ).toBeNull();
    });
    it("serializes two vouchers, rejects a stale preview, then adds the second term after refresh", async () => {
      const f = await fixture();
      const issued = await management.assign(operator, {
        ...command(),
        batchId: f.batchId,
        count: 1,
        targetTenantId: f.scope.tenantId,
        targetUserId: f.scope.userId,
      });
      const other = { ...f, voucherId: issued.voucherIds[0]! };
      const a = await confirm(f),
        b = await confirm(other);
      const outcomes = await Promise.allSettled([
        extendSubscriptionVoucher(customer, f.scope, a),
        extendSubscriptionVoucher(customer, f.scope, b),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const remaining = outcomes[0]!.status === "fulfilled" ? other : f;
      const second = await apply(remaining);
      expect(Date.parse(second.endAt) - Date.parse(a.expectedEndAt)).toBe(
        60 * 86400000,
      );
    });
    it.each(["history", "receipt", "audit", "queue", "pool"])(
      "rolls back the entire effect on %s failure and retries safely",
      async (failure) => {
        const f = await fixture(),
          c = await confirm(f),
          before = await subscription(f);
        const table = {
          history: "metering.subscription_histories",
          receipt: "promotion.voucher_operations",
          audit: "promotion.voucher_events",
          queue: "provisioning.webhook_deliveries",
          pool: "metering.quota_pools",
        }[failure]!;
        await owner.query(
          `create function public.b09_fail() returns trigger language plpgsql as $$ begin raise exception 'B09 injected'; end $$; create trigger b09_fail before insert or update on ${table} for each row execute function public.b09_fail()`,
        );
        try {
          await expect(
            extendSubscriptionVoucher(customer, f.scope, c),
          ).rejects.toThrow("B09 injected");
        } finally {
          await owner.query(
            `drop trigger b09_fail on ${table};drop function public.b09_fail()`,
          );
        }
        expect(await subscription(f)).toEqual(before);
        expect(await voucher(f)).toMatchObject({
          status: "assigned",
          used_count: 0,
        });
        expect(
          await subscriptionExtensionResult(
            customer,
            f.scope,
            c.idempotencyKey,
          ),
        ).toBeNull();
        expect(
          (
            await owner.query(
              "select count(*)::int n from promotion.voucher_redemptions where voucher_id=$1",
              [f.voucherId],
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          (
            await owner.query(
              "select count(*)::int n from provisioning.webhook_deliveries where workspace_id=$1",
              [f.scope.workspaceId],
            )
          ).rows[0].n,
        ).toBe(0);
        await extendSubscriptionVoucher(customer, f.scope, c);
      },
    );
    it("rejects a different tenant, workspace and foreign subscription", async () => {
      const f = await fixture(),
        other = await fixture(),
        c = await confirm(f);
      await expect(
        extendSubscriptionVoucher(customer, other.scope, {
          ...c,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow("不可展期");
      await expect(
        extendSubscriptionVoucher(customer, f.scope, {
          ...c,
          subscriptionId: other.subscriptionId,
        }),
      ).rejects.toThrow("不可展期");
      await owner.query(
        "update promotion.vouchers set assigned_workspace_id=$2 where id=$1",
        [f.voucherId, other.scope.workspaceId],
      );
      await expect(
        extendSubscriptionVoucher(customer, f.scope, c),
      ).rejects.toThrow("不可用");
      expect(await voucher(f)).toMatchObject({ used_count: 0 });
    });
    it.each(["pending_payment", "pending_verify", "paid"])(
      "requires resolving an existing %s renewal first",
      async (status) => {
        const f = await fixture(),
          c = await confirm(f);
        const order = await new PgOrderRepository(customer).createOrder({
          tenantId: f.scope.tenantId,
          workspaceId: f.scope.workspaceId,
          planVersionId: f.versionId,
          fromSubscriptionId: f.subscriptionId,
          intent: "renew",
          price: 100,
          cycleUnit: "month",
          itemName: "B09 renewal",
          createdBy: f.scope.userId,
        });
        await owner.query("update billing.orders set status=$2 where id=$1", [
          order.order.id,
          status,
        ]);
        await expect(
          extendSubscriptionVoucher(customer, f.scope, c),
        ).rejects.toThrow("重新预览");
        expect(
          (await new PgCustomerVoucherLedger(customer).page(f.scope)).total,
        ).toBe(0);
      },
    );
    it("does not match an allowlist through a bundled product", async () => {
      const f = await fixture();
      const code = (
        await owner.query(
          "select product_code from product.products where id=$1",
          [f.bundledId],
        )
      ).rows[0].product_code;
      await owner.query(
        "update promotion.voucher_batches set effect=jsonb_set(effect,'{applicable_product_codes}',$2::jsonb) where id=$1",
        [f.batchId, JSON.stringify([code])],
      );
      expect(
        (await previewSubscriptionExtension(customer, f.scope, f.voucherId))
          .targets,
      ).toHaveLength(0);
      expect(
        (await new PgCustomerVoucherLedger(customer).page(f.scope)).total,
      ).toBe(0);
    });
    it("supports unrestricted product scope without broadening a malformed scope", async () => {
      const f = await fixture();
      await owner.query(
        "update promotion.voucher_batches set effect=effect-'applicable_product_codes' where id=$1",
        [f.batchId],
      );
      expect(
        (await previewSubscriptionExtension(customer, f.scope, f.voucherId))
          .targets,
      ).toHaveLength(1);
      for (const codes of [null, [], [1], ["arda", "arda"], "arda"]) {
        await owner.query(
          "update promotion.voucher_batches set effect=jsonb_set(effect,'{applicable_product_codes}',$2::jsonb) where id=$1",
          [f.batchId, JSON.stringify(codes)],
        );
        await expect(
          previewSubscriptionExtension(customer, f.scope, f.voucherId),
        ).rejects.toThrow();
        expect(
          (await new PgCustomerVoucherLedger(customer).page(f.scope)).total,
        ).toBe(0);
      }
    });
    it("rechecks maintenance, batch pause and the half-open expiry window", async () => {
      const f = await fixture(),
        c = await confirm(f);
      await owner.query(
        "update product.products set maintenance_window_id=gen_random_uuid(),maintenance_until=now()+interval '1 hour' where id=$1",
        [f.bundledId],
      );
      await expect(
        extendSubscriptionVoucher(customer, f.scope, c),
      ).rejects.toThrow("重新预览");
      expect(
        (await new PgCustomerVoucherLedger(customer).page(f.scope)).total,
      ).toBe(0);
      await owner.query(
        "update product.products set maintenance_window_id=null,maintenance_until=null where id=$1",
        [f.bundledId],
      );
      await management.actOnBatch(operator, f.batchId, {
        ...command(),
        action: "pause",
      });
      await expect(
        extendSubscriptionVoucher(customer, f.scope, c),
      ).rejects.toThrow("不可用");
      await management.actOnBatch(operator, f.batchId, {
        ...command(),
        action: "resume",
      });
      await owner.query(
        "update promotion.vouchers set expires_at=clock_timestamp() where id=$1",
        [f.voucherId],
      );
      await expect(
        extendSubscriptionVoucher(customer, f.scope, c),
      ).rejects.toThrow("不可用");
    });
    it.each(["status='suspended'", "end_at=end_at+interval '1 month'"])(
      "rechecks concurrent lifecycle changes after waiting: %s",
      async (patch) => {
        const f = await fixture(),
          c = await confirm(f),
          block = await owner.connect();
        let attempt: Promise<unknown> = Promise.resolve();
        try {
          await block.query("begin");
          await block.query(
            "select id from metering.subscriptions where id=$1 for update",
            [f.subscriptionId],
          );
          attempt = extendSubscriptionVoucher(customer, f.scope, c).catch(
            (error: unknown) => ({ error }),
          );
          let waited = false;
          for (let n = 0; n < 100; n++) {
            if (
              (
                await owner.query(
                  "select 1 from pg_stat_activity where usename='svc_console_bff' and wait_event_type='Lock' and query like '%metering.subscriptions%'",
                )
              ).rowCount
            ) {
              waited = true;
              break;
            }
            await setTimeout(20);
          }
          expect(waited).toBe(true);
          await block.query(
            `update metering.subscriptions set ${patch} where id=$1`,
            [f.subscriptionId],
          );
          await block.query("commit");
          expect(await attempt).toMatchObject({
            error: { message: expect.stringContaining("重新预览") },
          });
          expect(await voucher(f)).toMatchObject({ used_count: 0 });
        } finally {
          await block.query("rollback");
          block.release();
          await attempt;
        }
      },
    );
    it("never consumes the same voucher twice with different request keys", async () => {
      const f = await fixture(),
        a = await confirm(f),
        b = { ...a, idempotencyKey: randomUUID() };
      const outcomes = await Promise.allSettled([
        extendSubscriptionVoucher(customer, f.scope, a),
        extendSubscriptionVoucher(customer, f.scope, b),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.voucher_redemptions where voucher_id=$1",
            [f.voucherId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(await voucher(f)).toMatchObject({ used_count: 1 });
    });
    it("refuses a changed plan after preview and preserves the new version", async () => {
      const f = await fixture(),
        other = await fixture(),
        c = await confirm(f);
      await owner.query(
        "update metering.subscriptions set plan_version_id=$2 where id=$1",
        [f.subscriptionId, other.versionId],
      );
      await expect(
        extendSubscriptionVoucher(customer, f.scope, c),
      ).rejects.toThrow("重新预览");
      expect((await subscription(f)).plan_version_id).toBe(other.versionId);
      expect(await voucher(f)).toMatchObject({ used_count: 0 });
    });
    it("prevents an expiry scan snapshot from terminating an extended subscription", async () => {
      const f = await fixture(),
        repo = new PgSubscriptionRepository(customer);
      await owner.query(
        "update metering.subscriptions set end_at=now()-interval '1 day' where id=$1",
        [f.subscriptionId],
      );
      const scanned = (await repo.findExpiredSubscriptionIds(10000, 0)).find(
        (s) => s.id === f.subscriptionId,
      )!;
      expect(scanned).toBeDefined();
      const before = (await repo.getById(f.subscriptionId))!;
      await apply(f);
      expect(
        await repo.update(f.subscriptionId, before, {
          status: "expired",
          expectedStatus: scanned.status,
          expectedEndAt: scanned.endAt,
          operatorType: "system",
        }),
      ).toBeNull();
      expect((await subscription(f)).status).toBe("active");
    });
    it("supports issuing, claiming and then extending in the same customer scope", async () => {
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
      expect(
        (
          await claims.preview(
            f.scope,
            issued.credentials[0]!.secret,
            "workspace",
          )
        ).kind,
      ).toBe("extension");
      await claims.claim(f.scope, {
        secret: issued.credentials[0]!.secret,
        target: "workspace",
        idempotencyKey: randomUUID(),
      });
      await apply({ ...f, voucherId: issued.voucherIds[0]! });
      expect(
        (
          await new PgCustomerVoucherLedger(customer).page(f.scope, {
            status: "redeemed",
          })
        ).total,
      ).toBe(1);
    });
  },
);
