/**
 * voucher-management.itest.spec.ts - Operator HTTP handlers on disposable PostgreSQL.
 * @package @vxture/bff-admin
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import type { Request } from "express";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { CommercialRouter } from "./commercial.router";
import type { RequestContext } from "../types/console.types";

// ===========================================================================
// Isolated database: never connects to an existing database or configured URL.
// ===========================================================================
describe.skipIf(process.env["VOUCHER_MANAGEMENT_ITEST"] !== "1")(
  "B06 operator batch PostgreSQL",
  () => {
    const runId = randomUUID();
    const container = `codex-voucher-s07-r3b-mgmt-${runId.slice(0, 12)}`;
    let containerId = "";
    const operator = "11111111-1111-4111-8111-111111111111",
      reviewer = "22222222-2222-4222-8222-222222222222";
    let owner: Pool,
      runtime: Pool,
      router: CommercialRouter,
      started = false;
    const docker = (args: string[], input?: string) =>
      execFileSync("docker", args, {
        windowsHide: true,
        encoding: "utf8",
        ...(input === undefined ? {} : { input }),
        timeout: 60000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
    const req = (id = operator, capabilities = ["promotion:campaign.manage"]) =>
      ({ user: { id }, capabilities }) as unknown as Request & RequestContext;
    const command = () => ({
      idempotencyKey: randomUUID(),
      reason: "B06 operator verification",
    });
    beforeAll(async () => {
      containerId = docker([
        "run",
        "--detach",
        "--pull=never",
        "--label",
        `codex.run=${runId}`,
        "--name",
        container,
        "--env",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "--publish",
        "127.0.0.1::5432",
        "postgres:18-alpine",
      ]).trim();
      started = true;
      console.log(
        "S07_R3B_CONTAINER_OWNERSHIP=" +
          JSON.stringify({ id: containerId, name: container, runId }),
      );
      const info = JSON.parse(docker(["inspect", containerId]))[0];
      expect(info.Id).toBe(containerId);
      expect(info.Config.Labels["codex.run"]).toBe(runId);
      expect(info.HostConfig.PortBindings["5432/tcp"][0].HostIp).toBe(
        "127.0.0.1",
      );
      for (let attempt = 0; ; attempt++) {
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
      }
      const port = Number(
        docker(["port", container, "5432/tcp"]).trim().split(":").at(-1),
      );
      owner = new Pool({
        host: "127.0.0.1",
        port,
        user: "postgres",
        database: "postgres",
      });
      const directory = fileURLToPath(
        new URL("../../../../deploy/database/ddl/", import.meta.url),
      );
      for (const file of readdirSync(directory)
        .filter((name) => /^\d.*\.sql$/.test(name))
        .sort())
        await owner.query(readFileSync(`${directory}/${file}`, "utf8"));
      await owner.query("alter role svc_admin_bff login");
      runtime = new Pool({
        host: "127.0.0.1",
        port,
        user: "svc_admin_bff",
        database: "postgres",
      });
      router = new CommercialRouter(runtime, runtime);
    }, 60000);
    afterAll(async () => {
      try {
        await runtime?.end();
        await owner?.end();
      } finally {
        if (started) {
          const info = JSON.parse(docker(["inspect", containerId]))[0];
          expect(info.Id).toBe(containerId);
          expect(info.Config.Labels["codex.run"]).toBe(runId);
          docker(["rm", "--force", "--volumes", containerId]);
          expect(
            docker([
              "ps",
              "-aq",
              "--no-trunc",
              "--filter",
              "name=^/" + container + "$",
            ]).trim(),
          ).toBe("");
          console.log("S07_R3B_CONTAINER_CLEANED=" + container);
        }
      }
    }, 60000);
    async function reviewCommand(id: string) {
      return {
        ...command(),
        action: "review" as const,
        expectedRevision: (await router.voucherBatchDetail(req(), id)).revision,
      };
    }
    async function fixture(name = "B06 read") {
      const user = randomUUID(),
        tenant = randomUUID();
      await owner.query(
        "insert into account.users(id,account,phone,phone_verified_at) values ($1::uuid,$1::text,$2,now())",
        [user, `+${Date.now()}${Math.floor(Math.random() * 10000)}`],
      );
      await owner.query(
        "insert into tenancy.tenants(id,name,type,owner_user_id) values ($1,'B06','organization',$2)",
        [tenant, user],
      );
      const input = {
        ...command(),
        kind: "credit_voucher" as const,
        name,
        effect: { amount_cents: 1000 },
        totalCount: 30,
        perUserLimit: 30,
        tenantId: tenant,
        validFrom: new Date(Date.now() - 86400000).toISOString(),
        validUntil: new Date(Date.now() + 86400000).toISOString(),
      };
      const { batchId } = await router.createVoucherBatch(req(), input);
      return { user, tenant, batchId, input };
    }

    // =========================================================================
    // Real read SQL, guarded commands and immutable receipts under the BFF role
    // =========================================================================
    it("creates draft, reviews, assigns and pages instances/events without credentials", async () => {
      const f = await fixture();
      expect(await router.voucherBatchDetail(req(), f.batchId)).toMatchObject({
        status: "draft",
        issuedCount: 0,
        returnPolicy: "none",
        claimedCount: 0,
      });
      await router.actOnVoucherBatch(
        req(reviewer),
        f.batchId,
        await reviewCommand(f.batchId),
      );
      await router.assignVouchers(req(), {
        ...command(),
        batchId: f.batchId,
        count: 21,
        targetUserId: f.user,
      });
      const detail = await router.voucherBatchDetail(req(), f.batchId);
      expect(detail).toMatchObject({
        status: "active",
        issuedCount: 21,
        claimedCount: 21,
        reservedCount: 0,
        redeemedCount: 0,
        expiredCount: 0,
        revokedCount: 0,
      });
      const a = await router.voucherBatchInstances(req(), f.batchId, "1"),
        b = await router.voucherBatchInstances(req(), f.batchId, "2");
      expect(a.total).toBe(21);
      expect(a.items).toHaveLength(20);
      expect(b.items).toHaveLength(1);
      expect(new Set([...a.items, ...b.items].map((v) => v.id)).size).toBe(21);
      expect(JSON.stringify(a)).not.toContain("claim_token");
      const events = await router.voucherBatchEvents(req(), f.batchId, "1");
      expect(events.total).toBe(23);
      expect(events.items).toHaveLength(20);
      expect(events.items[0]).toMatchObject({
        actorRealm: "operator",
        eventType: "voucher_assigned",
        reason: "B06 operator verification",
      });
      await expect(
        runtime.query("update promotion.voucher_operations set result='{}'"),
      ).rejects.toThrow("permission denied");
      await expect(
        runtime.query("delete from promotion.voucher_events"),
      ).rejects.toThrow("permission denied");
    });
    it("lists all pages with server filters and explicit draft/archive states", async () => {
      const f = await fixture("B06 unique paged lookup");
      const draft = await router.listPromotionsPage(
        req(),
        "1",
        "20",
        "draft",
        "coupon",
        "unique paged lookup",
      );
      expect(draft.total).toBe(1);
      expect(draft.items[0]).toMatchObject({
        id: f.batchId,
        status: "draft",
        batchStatus: "draft",
        totalCount: 30,
        issuedCount: 0,
      });
      await router.actOnVoucherBatch(req(), f.batchId, {
        ...command(),
        action: "archive",
      });
      const archived = await router.listPromotionsPage(
        req(),
        "1",
        "20",
        "archived",
        "all",
        "unique paged lookup",
      );
      expect(archived.total).toBe(1);
      expect(archived.items[0]?.status).toBe("archived");
      expect(
        (
          await router.listPromotionsPage(
            req(),
            "2",
            "20",
            "archived",
            "all",
            "unique paged lookup",
          )
        ).items,
      ).toEqual([]);
      await expect(router.listPromotionsPage(req(), "0")).rejects.toThrow(
        "非法",
      );
    });
    it("shows pending budget requests and clears them after separate approval", async () => {
      const f = await fixture();
      await router.actOnVoucherBatch(
        req(reviewer),
        f.batchId,
        await reviewCommand(f.batchId),
      );
      const request = await router.actOnVoucherBatch(req(), f.batchId, {
        ...command(),
        action: "request_budget",
        totalCount: 40,
      });
      expect(
        (await router.voucherBatchDetail(req(), f.batchId))
          .pendingBudgetRequests,
      ).toMatchObject([
        { id: request.operationId, totalCount: 40, requestedBy: operator },
      ]);
      await router.actOnVoucherBatch(req(reviewer), f.batchId, {
        ...command(),
        action: "approve_budget",
        requestOperationId: request.operationId,
      });
      expect(await router.voucherBatchDetail(req(), f.batchId)).toMatchObject({
        totalCount: 40,
        pendingBudgetRequests: [],
      });
    });
    it("recovers only the authenticated operator receipt by key", async () => {
      const f = await fixture();
      const receipt = await router.voucherOperationReceipt(
        req(),
        f.input.idempotencyKey,
        "batch_create",
      );
      expect(receipt?.result).toEqual({ batchId: f.batchId });
      expect(
        await router.voucherOperationReceipt(
          req(reviewer),
          f.input.idempotencyKey,
          "batch_create",
        ),
      ).toBeNull();
      await expect(
        router.voucherOperationReceipt(
          req(operator, ["commerce:billing.read"]),
          f.input.idempotencyKey,
          "batch_create",
        ),
      ).rejects.toThrow();
    });
    it("allows authorized read-only access and rejects malformed paging and identities", async () => {
      const f = await fixture();
      expect(
        await router.voucherBatchDetail(
          req(operator, ["commerce:billing.read"]),
          f.batchId,
        ),
      ).toMatchObject({ id: f.batchId });
      await expect(
        router.voucherBatchDetail(req(operator, []), f.batchId),
      ).rejects.toThrow();
      await expect(
        router.voucherBatchInstances(req(), f.batchId, "1.5"),
      ).rejects.toThrow("page");
      await expect(
        router.voucherBatchEvents(req(), "invalid", "1"),
      ).rejects.toThrow("batchId");
    });

    it("reports extension evidence without borrowing the subscription's purchase bill", async () => {
      const f = await fixture(),
        workspace = randomUUID(),
        product = randomUUID(),
        plan = randomUUID(),
        version = randomUUID(),
        subscription = randomUUID(),
        order = randomUUID();
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1,$2,'B09 read')",
        [workspace, f.tenant],
      );
      await owner.query(
        "insert into product.products(id,product_code,product_name,product_type) values($1,$2,'B09 read','agent')",
        [product, `b09-${product}`],
      );
      await owner.query(
        "insert into product.plans(id,plan_code,plan_name) values($1,$2,'B09 plan')",
        [plan, `b09-${plan}`],
      );
      await owner.query(
        "insert into product.plan_versions(id,plan_id,version_no) values($1,$2,1)",
        [version, plan],
      );
      await owner.query(
        `insert into product.plan_components(plan_version_id,product_id,tier,component_role,quota) values($1,$2,'pro','primary','{"seat.max":1}')`,
        [version, product],
      );
      const tenantRole = randomUUID(),
        workspaceRole = randomUUID();
      await owner.query(
        "insert into access.roles(id,role_code,scope) values($1::uuid,$1::text,'tenant'),($2::uuid,$2::text,'workspace')",
        [tenantRole, workspaceRole],
      );
      await owner.query(
        "insert into tenancy.tenant_memberships(tenant_id,user_id,role_id,role_scope) values($1,$2,$3,'tenant')",
        [f.tenant, f.user, tenantRole],
      );
      await owner.query(
        "insert into tenancy.workspace_memberships(tenant_id,workspace_id,user_id,role_id,role_scope) values($1,$2,$3,$4,'workspace')",
        [f.tenant, workspace, f.user, workspaceRole],
      );
      await owner.query(
        "insert into metering.subscriptions(id,tenant_id,workspace_id,plan_version_id,subscription_kind,cycle_unit,start_at,end_at,created_by_type,created_by_id) values($1,$2,$3,$4,'paid','month',now(),now()+interval '30 days','customer',$5)",
        [subscription, f.tenant, workspace, version, f.user],
      );
      await owner.query(
        "insert into billing.orders(id,order_no,tenant_id,workspace_id,product_id,plan_version_id,intent,cycle_unit,list_amount,payable_amount,status,subscription_id,fulfilled_at,created_by_type) values($1,$2,$3,$4,$5,$6,'new','month',100,100,'fulfilled',$7,now(),'customer')",
        [
          order,
          `ORD-${order}`,
          f.tenant,
          workspace,
          product,
          version,
          subscription,
        ],
      );
      await owner.query(
        "update metering.subscriptions set current_order_id=$2 where id=$1",
        [subscription, order],
      );
      const { batchId } = await router.createVoucherBatch(req(), {
        ...f.input,
        ...command(),
        kind: "extension",
        effect: { extend_days: 30 },
      });
      await router.actOnVoucherBatch(
        req(reviewer),
        batchId,
        await reviewCommand(batchId),
      );
      const assigned = await router.assignVouchers(req(), {
        ...command(),
        batchId,
        count: 1,
        targetTenantId: f.tenant,
        targetUserId: f.user,
      });
      const voucher = assigned.voucherIds[0]!;
      const redemption = `EV-${randomUUID()}`;
      await owner.query(
        "insert into promotion.voucher_redemptions(redemption_no,voucher_id,tenant_id,workspace_id,user_id,kind,effect_snapshot,subscription_id) values($1,$2,$3,$4,$5,'extension','{\"effect_version\":1,\"extend_days\":30}',$6)",
        [redemption, voucher, f.tenant, workspace, f.user, subscription],
      );
      const records = await router.listPromotionRedemptions(
        req(operator, ["commerce:billing.read"]),
      );
      expect(
        records.find((row) => row.redemptionNo === redemption),
      ).toMatchObject({
        kind: "extension",
        benefitLabel: "展期 30 天",
        subscriptionId: subscription,
        billId: "",
        billNo: "",
        billStatus: null,
        orderNo: null,
      });
      expect(
        (
          await router.listPromotions(req(operator, ["commerce:billing.read"]))
        ).find((row) => row.id === batchId)?.discountLabel,
      ).toContain("展期 30 天");
      expect(
        (await router.voucherBatchInstances(req(), batchId)).items[0],
      ).toMatchObject({
        subscriptionId: subscription,
        redemptionNo: redemption,
      });
    });

    it("keeps the real invoice for credit vouchers linked through a payment", async () => {
      const f = await fixture(),
        workspace = randomUUID(),
        invoice = randomUUID(),
        payment = randomUUID();
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1,$2,'B09 cash read')",
        [workspace, f.tenant],
      );
      await router.actOnVoucherBatch(
        req(reviewer),
        f.batchId,
        await reviewCommand(f.batchId),
      );
      const issued = await router.assignVouchers(req(), {
        ...command(),
        batchId: f.batchId,
        count: 1,
        targetTenantId: f.tenant,
        targetUserId: f.user,
      });
      await owner.query(
        "insert into billing.invoices(id,tenant_id,bill_no,bill_cycle,cycle_start_date,cycle_end_date,total_amount,payable_amount,currency,bill_status,created_by_type) values($1,$2,$3,'202611','2026-11-01','2026-11-30',100,100,'CNY','paid','system')",
        [invoice, f.tenant, `INV-${invoice}`],
      );
      await owner.query(
        "insert into billing.payments(id,tenant_id,bill_id,pay_order_no,total_amount,paid_amount,pay_status) values($1,$2,$3,$4,10,10,'paid')",
        [payment, f.tenant, invoice, `PAY-${payment}`],
      );
      const redemption = `RDM-${randomUUID()}`;
      await owner.query(
        "insert into promotion.voucher_redemptions(redemption_no,voucher_id,tenant_id,workspace_id,user_id,kind,effect_snapshot,payment_id) values($1,$2,$3,$4,$5,'credit_voucher','{\"amount_cents\":1000}',$6)",
        [
          redemption,
          issued.voucherIds[0],
          f.tenant,
          workspace,
          f.user,
          payment,
        ],
      );
      const records = await router.listPromotionRedemptions(
        req(operator, ["commerce:billing.read"]),
      );
      expect(
        records.find((row) => row.redemptionNo === redemption),
      ).toMatchObject({
        billId: invoice,
        billNo: `INV-${invoice}`,
        billStatus: "paid",
        orderAmount: 100,
        payableAmount: 100,
        benefitLabel: "¥10.00",
      });
    });
  },
);
