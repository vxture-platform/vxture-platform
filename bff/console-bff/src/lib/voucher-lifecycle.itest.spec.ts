/**
 * voucher-lifecycle.itest.spec.ts - HTTP card lifecycles on real database roles.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// ⚠️ 跨层引用: Exercise supported issuance and ledger APIs with actual BFF roles.
import {
  PgPromotionRepository,
  PgVoucherManagement,
  PromotionService,
  VoucherClaimCredentials,
  type CreateBatchCommand,
  type VoucherClaimResult,
  type VoucherScope,
} from "@vxture/service-promotion";
// ⚠️ 跨层引用: Billing owns the verified receipt and wallet source allocations.
import { PgRechargeCardFunding, PgWalletLedger } from "@vxture/service-billing";
// ⚠️ 跨层引用: Only the claim-key configuration is replaced by a test fixture.
import { VxConfigService } from "@vxture/core-config";
import { CapabilityGuard } from "../auth/capability";
import { RP_REDIS } from "../oidc/oidc-rp.tokens";
import {
  PromotionRouter,
  type ConsoleVoucherView,
} from "../routers/promotion.router";
import type { Capability, RequestContext } from "../types/console.types";
import type { ExtensionResult } from "./subscription-extension-operation";
import type { SubscriptionVoucherResult } from "./subscription-voucher-operation";
import type { RechargeResult } from "./recharge-card-operation";

// ===========================================================================
// The runner owns the database; rate storage and sessions are controlled fixtures.
// ===========================================================================
describe.skipIf(process.env["VOUCHER_LIFECYCLE_ITEST"] !== "1")(
  "B12 HTTP card lifecycle",
  () => {
    // The HTTP fixture models the atomic rate store without an external Redis.
    const counters = new Map<string, { count: number; until: number }>();
    const rateStore = {
      available: true,
      async eval(_script: string, count: number, ...keys: string[]) {
        if (!this.available) throw new Error("Isolated rate store unavailable");
        expect(count).toBe(2);
        const now = Date.now();
        const values = keys.map((key) => {
          const old = counters.get(key);
          const next =
            old && old.until > now
              ? { ...old, count: old.count + 1 }
              : { count: 1, until: now + 60000 };
          counters.set(key, next);
          return next.count;
        });
        return values[0]! > 20 || values[1]! > 100 ? 0 : 1;
      },
    };
    const sessions = new Map<
      string,
      { scope: VoucherScope; capabilities: Capability[] }
    >();
    const operator = "11111111-1111-4111-8111-111111111111";
    const reviewer = "22222222-2222-4222-8222-222222222222";
    const auth = {
      VOUCHER_CLAIM_ACTIVE_KEY: "b12",
      VOUCHER_CLAIM_KEYS: JSON.stringify({ b12: "b1".repeat(32) }),
    };
    const credentials = new VoucherClaimCredentials(auth);
    let owner: Pool, admin: Pool, customer: Pool;
    let management: PgVoucherManagement, app: INestApplication, base: string;
    const command = () => ({
      idempotencyKey: randomUUID(),
      reason: "B12 acceptance",
    });
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
      expect(url.pathname).toBe("/voucher_http");
      expect(url.search + url.hash).toBe("");
      expect(Number(url.port)).toBeGreaterThan(0);
      const connection = {
        host: "127.0.0.1",
        port: Number(url.port),
        database: "voucher_http",
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
          db: "voucher_http",
          role: "postgres",
          marker: "codex-voucher-console:" + runId,
        },
      ]);
      admin = new Pool({ ...connection, user: "svc_admin_bff", max: 20 });
      customer = new Pool({ ...connection, user: "svc_console_bff", max: 20 });
      management = new PgVoucherManagement(
        admin,
        new PgRechargeCardFunding(admin),
      );

      @Module({
        controllers: [PromotionRouter],
        providers: [
          { provide: "COMMERCE_PG_POOL", useValue: customer },
          {
            provide: PromotionService,
            useValue: new PromotionService(new PgPromotionRepository(customer)),
          },
          { provide: VxConfigService, useValue: { auth } },
          { provide: RP_REDIS, useValue: rateStore },
          { provide: APP_GUARD, useClass: CapabilityGuard },
        ],
      })
      class TestModule {}
      app = await NestFactory.create(TestModule, { logger: false });
      // This middleware stands in for upstream verified sessions, not authentication.
      app.use(
        (req: Request & RequestContext, _res: Response, next: NextFunction) => {
          const session = sessions.get(req.header("x-b12-session") ?? "");
          if (session) {
            req.user = {
              id: session.scope.userId,
              name: "B12 customer",
              email: "",
              roleLabel: "",
              timezone: null,
            };
            req.tenant = {
              id: session.scope.tenantId,
              name: "B12 tenant",
              mode: "tenant",
              workspace: "B12 workspace",
              tenantType: "organization",
            };
            req.activeWorkspaceId = session.scope.workspaceId;
            req.capabilities = session.capabilities;
          }
          next();
        },
      );
      await app.listen(0, "127.0.0.1");
      base = `${await app.getUrl()}/api/promotion`;
    }, 60000);
    afterAll(async () => {
      await app?.close();
      await customer?.end();
      await admin?.end();
      await owner?.end();
    }, 60000);

    // ========================================================================
    // Fixtures are written as owner; every business command uses an actual role.
    // ========================================================================
    async function scope(): Promise<VoucherScope> {
      const userId = randomUUID(),
        tenantId = randomUUID(),
        workspaceId = randomUUID();
      await owner.query(
        "insert into account.users(id,account,phone,phone_verified_at) values($1::uuid,$1::text,$2,now())",
        [userId, `+${Date.now()}${Math.floor(Math.random() * 100000)}`],
      );
      await owner.query(
        "insert into tenancy.tenants(id,name,type,owner_user_id) values($1,'B12 tenant','organization',$2)",
        [tenantId, userId],
      );
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name,is_default) values($1,$2,'B12 workspace',true)",
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
    function session(
      s: VoucherScope,
      capabilities: Capability[] = ["tenant.billing.manage"],
    ) {
      const token = randomUUID();
      sessions.set(token, { scope: s, capabilities });
      return token;
    }
    async function http<T = Record<string, unknown>>(
      token: string,
      path: string,
      body?: unknown,
    ) {
      const response = await fetch(`${base}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "x-b12-session": token, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await response.json()) as T;
      return {
        status: response.status,
        cache: response.headers.get("cache-control"),
        contentType: response.headers.get("content-type"),
        data,
      };
    }
    async function batch(
      s: VoucherScope,
      kind: CreateBatchCommand["kind"],
      effect: Record<string, unknown>,
      totalCount = 20,
      perUserLimit = 20,
    ) {
      const created = await management.createBatch(operator, {
        ...command(),
        kind,
        effect,
        name: `B12 ${kind}`,
        tenantId: s.tenantId,
        totalCount,
        perUserLimit,
        validFrom: new Date(Date.now() - 86400000).toISOString(),
        validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
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
      return created.batchId;
    }
    async function issue(
      s: VoucherScope,
      kind: CreateBatchCommand["kind"],
      effect: Record<string, unknown>,
      fundingPaymentId?: string,
    ) {
      const batchId = await batch(s, kind, effect);
      const issued = await management.issueClaimCredentials(
        operator,
        batchId,
        {
          ...command(),
          count: 1,
          ...(fundingPaymentId ? { fundingPaymentId } : {}),
        },
        credentials,
      );
      return {
        batchId,
        id: issued.voucherIds[0]!,
        secret: issued.credentials[0]!.secret,
      };
    }
    async function claim(
      token: string,
      secret: string,
      target: "user" | "workspace" = "user",
    ) {
      const result = await http<VoucherClaimResult>(token, "claims", {
        secret,
        target,
        idempotencyKey: randomUUID(),
      });
      expect(result.status, JSON.stringify(result.data)).toBe(201);
      expect(result.cache).toBe("no-store");
      return result.data;
    }
    async function plan() {
      const productId = randomUUID(),
        planId = randomUUID(),
        versionId = randomUUID();
      await owner.query(
        "insert into product.products(id,product_code,product_name,product_type,status,release_stage) values($1,$2,'B12 product','agent','active','stable')",
        [productId, `b12-${productId}`],
      );
      await owner.query(
        "insert into product.product_webhooks(product_id,webhook_url) values($1,'https://example.invalid/b12')",
        [productId],
      );
      await owner.query(
        "insert into product.product_metrics(product_id,metric_key,merge_strategy,consume_mode,cost_class,reset_period) values($1,'calls','pool','atomic','zero_cost','day')",
        [productId],
      );
      await owner.query(
        "insert into product.plans(id,plan_code,plan_name,is_public) values($1,$2,'B12 fixed plan',false)",
        [planId, `b12-${planId}`],
      );
      await owner.query(
        "insert into product.plan_versions(id,plan_id,version_no) values($1,$2,1)",
        [versionId, planId],
      );
      await owner.query(
        "insert into product.plan_components(plan_version_id,product_id,tier,component_role,quota,features) values($1,$2,'pro','primary','{\"calls\":100,\"seat.max\":5}',array['b12.feature'])",
        [versionId, productId],
      );
      await owner.query(
        "update product.plan_versions set status='published',is_locked=true where id=$1",
        [versionId],
      );
      await owner.query(
        "update product.plans set current_version_id=$2 where id=$1",
        [planId, versionId],
      );
      return { versionId, productId };
    }
    async function payment(s: VoucherScope) {
      const id = randomUUID(),
        invoice = randomUUID(),
        transaction = randomUUID();
      await owner.query(
        "insert into billing.invoices(id,tenant_id,bill_no,bill_cycle,cycle_start_date,cycle_end_date,total_amount,payable_amount,paid_amount,bill_status,bill_type,created_by_type) values($1,$2,$3,'202611','2026-11-01','2026-11-30',100,100,100,'paid','one_off','system')",
        [invoice, s.tenantId, `INV-${invoice}`],
      );
      await owner.query(
        "insert into billing.transactions(id,tenant_id,bill_id,transaction_no,trade_type,source_method,amount,currency,balance_before,balance_after,trade_status,actor_type) values($1,$2,$3,$4,'recharge','offline',100,'CNY',0,0,'success','system')",
        [transaction, s.tenantId, invoice, `TXN-${transaction}`],
      );
      await owner.query(
        "insert into billing.payments(id,tenant_id,bill_id,transaction_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status,paid_at) values($1,$2,$3,$4,$5,'offline',100,100,'paid',now())",
        [id, s.tenantId, invoice, transaction, `PAY-${id}`],
      );
      return id;
    }

    // ========================================================================
    // The real HTTP guard must reject requests before malformed money can execute.
    // ========================================================================
    it.each([
      "recharges/preview",
      "recharges",
      "redemptions/preview",
      "redemptions",
      "extensions/preview",
      "extensions",
    ])("requires billing management for POST %s", async (path) => {
      expect((await http("", path, {})).status).toBe(401);
      const token = session(await scope(), ["tenant.billing.read"]);
      expect((await http(token, path, {})).status).toBe(403);
    });
    it.each(["claims", "recharges", "redemptions", "extensions"])(
      "returns JSON null for a missing %s receipt",
      async (path) => {
        const token = session(await scope());
        const response = await http<null>(
          token,
          `${path}/result?idempotencyKey=${randomUUID()}`,
        );
        expect(response.status).toBe(200);
        expect(response.cache).toBe("no-store");
        expect(response.contentType).toMatch(/^application\/json\b/);
        expect(response.data).toBeNull();
      },
    );
    it("protects result recovery and does not accept tenant IDs from query strings", async () => {
      const s = await scope(),
        token = session(s, ["tenant.billing.read"]);
      expect((await http("", "vouchers/page")).status).toBe(401);
      expect(
        (await http(token, `recharges/result?idempotencyKey=${randomUUID()}`))
          .status,
      ).toBe(403);
      const response = await http<{
        items: ConsoleVoucherView[];
        total: number;
      }>(token, `vouchers/page?tenantId=${randomUUID()}&status=all`);
      expect(response.status).toBe(200);
      expect(response.cache).toBe("no-store");
      expect(response.data.total).toBe(0);
    });
    it("issues, previews and claims all six kinds with normalized HTTP amounts", async () => {
      const s = await scope(),
        token = session(s),
        p = await plan();
      const effects: [CreateBatchCommand["kind"], Record<string, unknown>][] = [
        ["discount", { discount_type: "fixed", value: 29 }],
        ["credit_voucher", { amount_cents: 1234 }],
        ["invite", { plan_version_id: p.versionId }],
        [
          "redemption",
          {
            plan_version_id: p.versionId,
            duration_days: 30,
            funding_source: "operator_grant",
          },
        ],
        ["extension", { extend_days: 7 }],
        [
          "recharge_card",
          { face_value_cents: 0, bonus_cents: 29, bonus_expires_in_days: 90 },
        ],
      ];
      const secrets: string[] = [];
      for (const [kind, effect] of effects) {
        const card = await issue(s, kind, effect);
        secrets.push(card.secret);
        const preview = await http(token, "claims/preview", {
          secret: card.secret,
          target: "workspace",
        });
        expect(preview.status, JSON.stringify(preview.data)).toBe(201);
        expect(preview.data.kind).toBe(kind);
        await claim(token, card.secret, "workspace");
      }
      const page = await http<{ items: ConsoleVoucherView[]; total: number }>(
        token,
        "vouchers/page?status=all&pageSize=10",
      );
      expect(page.data.total).toBe(6);
      expect(page.data.items.find((v) => v.kind === "discount")).toMatchObject({
        discountValue: 0.29,
        currency: "CNY",
      });
      expect(
        page.data.items.find((v) => v.kind === "credit_voucher"),
      ).toMatchObject({ amount: "12.34" });
      expect(
        page.data.items.find((v) => v.kind === "recharge_card"),
      ).toMatchObject({
        amount: "0.00",
        bonusAmount: "0.29",
        bonusExpiresInDays: 90,
      });
      expect(
        page.data.items.find((v) => v.kind === "redemption"),
      ).toMatchObject({ durationDays: 30 });
      expect(page.data.items.find((v) => v.kind === "extension")).toMatchObject(
        { extendDays: 7 },
      );
      const events = (
        await owner.query(
          "select metadata from promotion.voucher_events where actor_id=$1",
          [s.userId],
        )
      ).rows;
      for (const secret of secrets) {
        expect(JSON.stringify(page.data)).not.toContain(secret);
        expect(JSON.stringify(events)).not.toContain(secret);
      }
    });
    it("claims a fixed subscription then extends it through HTTP without resetting quota", async () => {
      const s = await scope(),
        token = session(s),
        p = await plan();
      const card = await issue(s, "redemption", {
        plan_version_id: p.versionId,
        duration_days: 30,
        funding_source: "operator_grant",
      });
      await claim(token, card.secret, "workspace");
      expect(
        (await http(token, "redemptions/preview", { voucherId: card.id }))
          .status,
      ).toBe(201);
      const key = randomUUID(),
        body = { voucherId: card.id, idempotencyKey: key };
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          http<SubscriptionVoucherResult>(token, "redemptions", body),
        ),
      );
      for (const result of results) {
        expect(result.status, JSON.stringify(result.data)).toBe(201);
        expect(result.data).toEqual(results[0]!.data);
      }
      const result = results[0]!.data;
      expect(
        (await http(token, `redemptions/result?idempotencyKey=${key}`)).data,
      ).toEqual(result);
      await owner.query(
        "update metering.quota_pools set quota_used=37 where subscription_id=$1",
        [result.subscriptionId],
      );
      const extension = await issue(s, "extension", { extend_days: 7 });
      await claim(token, extension.secret, "workspace");
      const preview = await http<{
        targets: {
          subscriptionId: string;
          planVersionId: string;
          previousEndAt: string;
        }[];
      }>(token, "extensions/preview", { voucherId: extension.id });
      expect(preview.status).toBe(201);
      const target = preview.data.targets[0]!;
      const extended = await http<ExtensionResult>(token, "extensions", {
        voucherId: extension.id,
        subscriptionId: target.subscriptionId,
        expectedPlanVersionId: target.planVersionId,
        expectedEndAt: target.previousEndAt,
        idempotencyKey: randomUUID(),
      });
      expect(extended.status, JSON.stringify(extended.data)).toBe(201);
      expect(Date.parse(extended.data.endAt) - Date.parse(result.endAt)).toBe(
        7 * 86400000,
      );
      expect(
        (
          await owner.query(
            "select quota_used::text from metering.quota_pools where subscription_id=$1",
            [result.subscriptionId],
          )
        ).rows[0],
      ).toEqual({ quota_used: "37" });
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.payments where tenant_id=$1",
            [s.tenantId],
          )
        ).rows[0]!.n,
      ).toBe(0);
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.voucher_redemptions where workspace_id=$1",
            [s.workspaceId],
          )
        ).rows[0]!.n,
      ).toBe(2);
    });
    it.each([true, false])(
      "keeps one principal and bonus posting under 16 HTTP requests (same key=%s)",
      async (sameKey) => {
        const s = await scope(),
          token = session(s),
          paymentId = await payment(s);
        const card = await issue(
          s,
          "recharge_card",
          {
            face_value_cents: 10000,
            bonus_cents: 1000,
            bonus_expires_in_days: 90,
          },
          paymentId,
        );
        await claim(token, card.secret);
        const preview = await http<{ confirmation: string }>(
          token,
          "recharges/preview",
          { voucherId: card.id },
        );
        expect(preview.status).toBe(201);
        const key = randomUUID();
        const results = await Promise.all(
          Array.from({ length: 16 }, () =>
            http<RechargeResult>(token, "recharges", {
              voucherId: card.id,
              confirmation: preview.data.confirmation,
              idempotencyKey: sameKey ? key : randomUUID(),
            }),
          ),
        );
        const success = results.filter((r) => r.status === 201);
        expect(success).toHaveLength(sameKey ? 16 : 1);
        for (const r of results) expect([201, 400, 409]).toContain(r.status);
        expect(
          await new PgWalletLedger(customer).summary(s.tenantId),
        ).toMatchObject({
          balance: "110.00",
          principalBalance: "100.00",
          bonusBalance: "10.00",
        });
        const money = (
          await owner.query(
            "select (select count(*)::int from billing.wallet_operations o join billing.credits c on c.id=o.credit_id where c.tenant_id=$1) operations,(select count(*)::int from billing.transactions where tenant_id=$1 and trade_type='recharge') receipts,(select count(*)::int from promotion.voucher_redemptions where voucher_id=$2) redemptions",
            [s.tenantId, card.id],
          )
        ).rows[0];
        expect(money).toEqual({ operations: 2, receipts: 1, redemptions: 1 });
        if (sameKey) {
          expect(
            (await http(token, `recharges/result?idempotencyKey=${key}`)).data,
          ).toEqual(success[0]!.data);
          const other = session(await scope());
          expect(
            (await http(other, `recharges/result?idempotencyKey=${key}`)).data,
          ).toBeNull();
          expect(
            (
              await http(token, "recharges", {
                voucherId: card.id,
                confirmation: preview.data.confirmation,
                idempotencyKey: key,
                fundingPaymentId: paymentId,
              })
            ).status,
          ).toBe(400);
        }
      },
    );
    it("does not overspend the last issuance allowance under 16 independent requests", async () => {
      const s = await scope(),
        b = await batch(
          s,
          "recharge_card",
          { face_value_cents: 0, bonus_cents: 100 },
          1,
        );
      const results = await Promise.allSettled(
        Array.from({ length: 16 }, () =>
          management.issueClaimCredentials(
            operator,
            b,
            { ...command(), count: 1 },
            credentials,
          ),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await owner.query(
            "select issued_count from promotion.voucher_batches where id=$1",
            [b],
          )
        ).rows[0]!.issued_count,
      ).toBe(1);
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.vouchers where batch_id=$1",
            [b],
          )
        ).rows[0]!.n,
      ).toBe(1);
    });
    it("binds at most one of 16 credentials at the customer's cumulative limit", async () => {
      const s = await scope(),
        token = session(s),
        b = await batch(s, "credit_voucher", { amount_cents: 1000 }, 16, 1);
      const issued = await management.issueClaimCredentials(
        operator,
        b,
        { ...command(), count: 16 },
        credentials,
      );
      const results = await Promise.all(
        issued.credentials.map((card) =>
          http(token, "claims", {
            secret: card.secret,
            target: "user",
            idempotencyKey: randomUUID(),
          }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      for (const r of results) expect([201, 400]).toContain(r.status);
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.vouchers where batch_id=$1 and claimed_at is not null",
            [b],
          )
        ).rows[0]!.n,
      ).toBe(1);
    });
    it("keeps a workspace card out of another session workspace despite body overrides", async () => {
      const s = await scope(),
        token = session(s);
      const otherWorkspace = randomUUID();
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1,$2,'B12 other workspace')",
        [otherWorkspace, s.tenantId],
      );
      const other = session({ ...s, workspaceId: otherWorkspace });
      const card = await issue(s, "recharge_card", {
        face_value_cents: 0,
        bonus_cents: 100,
      });
      await claim(token, card.secret, "workspace");
      expect(
        (
          await http(other, "recharges/preview", {
            voucherId: card.id,
            workspaceId: s.workspaceId,
          })
        ).status,
      ).toBe(400);
      const page = await http<{ total: number }>(
        other,
        `vouchers/page?status=all&workspaceId=${s.workspaceId}`,
      );
      expect(page.data.total).toBe(0);
      const p = await http<{ confirmation: string }>(
        token,
        "recharges/preview",
        { voucherId: card.id },
      );
      const key = randomUUID();
      expect(
        (
          await http(token, "recharges", {
            voucherId: card.id,
            confirmation: p.data.confirmation,
            idempotencyKey: key,
          })
        ).status,
      ).toBe(201);
      expect(
        (await http(other, `recharges/result?idempotencyKey=${key}`)).data,
      ).toBeNull();
    });
    it("enforces HTTP user limits and fails closed with the controlled rate-store fixture", async () => {
      const s = await scope(),
        token = session(s),
        card = await issue(s, "credit_voucher", { amount_cents: 100 });
      for (let index = 0; index < 20; index++)
        expect(
          (await http(token, "claims/preview", { secret: card.secret })).status,
        ).toBe(201);
      expect(
        (await http(token, "claims/preview", { secret: card.secret })).status,
      ).toBe(429);
      rateStore.available = false;
      expect(
        (await http(token, "claims/preview", { secret: card.secret })).status,
      ).toBe(503);
      expect(
        (
          await owner.query(
            "select status,used_count from promotion.vouchers where id=$1",
            [card.id],
          )
        ).rows[0],
      ).toEqual({ status: "issued", used_count: 0 });
    });
  },
);
