/**
 * voucher-promotion.itest.spec.ts - Real-role voucher ownership and funding acceptance.
 * @package @vxture/bff-admin
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// ⚠️ 跨层引用: the application composes independent domain services via public exports.
import { PgRechargeCardFunding } from "@vxture/service-billing";
import {
  PgVoucherManagement,
  PgVoucherClaims,
  VoucherClaimCredentials,
  PgCustomerVoucherLedger,
  PromotionService,
  PgPromotionRepository,
  SubscriptionVouchers,
  RechargeCards,
  type VoucherScope,
  type CreateBatchCommand,
  type ReservedVoucher,
} from "@vxture/service-promotion";

// ============================================================================
// New loopback-only database, full schema and actual application roles.
// ============================================================================
describe.skipIf(process.env.VOUCHER_PROMOTION_ITEST !== "1")(
  "voucher domain acceptance",
  () => {
    const runId = randomUUID();
    const container = `codex-voucher-domain-${runId.slice(0, 12)}`;
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
        "S07_R2C1_CONTAINER_OWNERSHIP=" +
          JSON.stringify({ name: container, id: containerId, runId }),
      );
      const info = JSON.parse(docker(["inspect", container]))[0];
      expect(info.Id).toBe(containerId);
      expect(info.Config.Labels["codex.run"]).toBe(runId);
      expect(info.HostConfig.PortBindings["5432/tcp"]).toEqual([
        { HostIp: "127.0.0.1", HostPort: "" },
      ]);
      console.info(`S07_R2C1_CONTAINER_CREATED=${container}`);
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
            console.info(`S07_R2C1_CONTAINER_CLEANED=${container}`);
          }
        }
      }
    }, 60000);

    // ========================================================================
    // Persisted fixtures never disable constraints, triggers or role checks.
    // ========================================================================
    const creator = randomUUID(),
      reviewer = randomUUID();
    const credentials = new VoucherClaimCredentials({
      VOUCHER_CLAIM_ACTIVE_KEY: "isolated",
      VOUCHER_CLAIM_KEYS: JSON.stringify({
        isolated: randomBytes(32).toString("hex"),
      }),
    });
    const command = () => ({
      idempotencyKey: randomUUID(),
      reason: "Isolated acceptance",
    });
    const management = () =>
      new PgVoucherManagement(admin, new PgRechargeCardFunding(admin));
    const promotion = () =>
      new PromotionService(new PgPromotionRepository(runtime));
    const claims = () => new PgVoucherClaims(runtime, credentials);
    async function tx<T>(
      work: (client: PoolClient) => Promise<T>,
      pool = runtime,
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const value = await work(client);
        await client.query("commit");
        return value;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
    async function fixture(): Promise<VoucherScope> {
      const scope = {
        tenantId: randomUUID(),
        userId: randomUUID(),
        workspaceId: randomUUID(),
      };
      await owner.query(
        "insert into account.users(id,account,phone,phone_verified_at) values($1::uuid,$1::text,$2,now())",
        [scope.userId, `+${Date.now()}${Math.floor(Math.random() * 100000)}`],
      );
      await owner.query(
        "insert into tenancy.tenants(id,name,type,owner_user_id) values($1,'Voucher QA','organization',$2)",
        [scope.tenantId, scope.userId],
      );
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1,$2,'Voucher QA')",
        [scope.workspaceId, scope.tenantId],
      );
      return scope;
    }
    async function batch(
      scope: VoucherScope,
      overrides: Partial<CreateBatchCommand> = {},
      review = true,
    ) {
      const config: CreateBatchCommand = {
        ...command(),
        kind: "credit_voucher",
        name: "Voucher QA",
        effect: { amount_cents: 2000 },
        totalCount: 10,
        perUserLimit: 10,
        tenantId: scope.tenantId,
        validFrom: new Date(Date.now() - 60000).toISOString(),
        validUntil: new Date(Date.now() + 86400000 * 10).toISOString(),
        returnPolicy:
          overrides.kind &&
          !["discount", "credit_voucher"].includes(overrides.kind)
            ? "none"
            : "full_reversal_only",
        ...overrides,
      };
      const { batchId } = await management().createBatch(creator, config);
      if (review) await reviewBatch(batchId);
      return { batchId, config };
    }
    async function reviewBatch(id: string, actor = reviewer) {
      const row = (
        await owner.query(
          "select extract(epoch from updated_at)::text revision from promotion.voucher_batches where id=$1",
          [id],
        )
      ).rows[0];
      return management().actOnBatch(actor, id, {
        ...command(),
        action: "review",
        expectedRevision: row.revision,
      });
    }
    async function assign(scope: VoucherScope, batchId: string) {
      return management().assign(creator, {
        ...command(),
        batchId,
        count: 1,
        targetTenantId: scope.tenantId,
        targetUserId: scope.userId,
      });
    }
    async function issue(
      scope: VoucherScope,
      count = 1,
      overrides: Partial<CreateBatchCommand> = {},
    ) {
      const b = await batch(scope, overrides);
      return {
        ...b,
        issued: await management().issueClaimCredentials(
          creator,
          b.batchId,
          { ...command(), count },
          credentials,
        ),
      };
    }
    async function order(scope: VoucherScope) {
      const product = randomUUID(),
        plan = randomUUID(),
        version = randomUUID(),
        orderId = randomUUID(),
        invoiceId = randomUUID();
      await owner.query(
        "insert into product.products(id,product_code,product_type,product_name) values($1::uuid,$1::text,'agent','Voucher QA')",
        [product],
      );
      await owner.query(
        "insert into product.plans(id,plan_code,plan_name) values($1::uuid,$1::text,'Voucher QA')",
        [plan],
      );
      await owner.query(
        "insert into product.plan_versions(id,plan_id,version_no) values($1,$2,1)",
        [version, plan],
      );
      await owner.query(
        "insert into billing.orders(id,order_no,tenant_id,workspace_id,product_id,plan_version_id,intent,cycle_unit,list_amount,payable_amount,created_by_type) values($1::uuid,$1::text,$2,$3,$4,$5,'new','month',100,100,'customer')",
        [orderId, scope.tenantId, scope.workspaceId, product, version],
      );
      await owner.query(
        "insert into billing.invoices(id,tenant_id,order_id,bill_no,bill_cycle,cycle_start_date,cycle_end_date,total_amount,payable_amount,created_by_type) values($1::uuid,$2,$3,$1::text,'202611',current_date,current_date+30,100,100,'customer')",
        [invoiceId, scope.tenantId, orderId],
      );
      return { orderId, invoiceId };
    }
    async function reserve(
      scope: VoucherScope,
      voucherId: string,
      context: { orderId: string; invoiceId: string },
      fail = false,
    ) {
      return tx(async (client) => {
        const vouchers = await promotion().reserveForOrder(client, {
          scope,
          creditVoucherId: voucherId,
        });
        await promotion().recordReservations(client, context, scope, vouchers, {
          voucherOffCents: 2000,
        });
        if (fail) throw new Error("downstream rollback");
        return vouchers[0]!;
      });
    }
    async function state(id: string) {
      return (
        await owner.query(
          "select status,used_count from promotion.vouchers where id=$1",
          [id],
        )
      ).rows[0];
    }
    async function countRows(table: string, column: string, id: string) {
      // Table and column names are fixed by test code, never supplied externally.
      return (
        await owner.query(
          `select count(*)::int n from ${table} where ${column}=$1`,
          [id],
        )
      ).rows[0].n as number;
    }
    async function sale(scope: VoucherScope, source = "offline") {
      const invoice = randomUUID(),
        transaction = randomUUID(),
        payment = randomUUID();
      await owner.query(
        "insert into billing.invoices(id,tenant_id,bill_no,bill_cycle,cycle_start_date,cycle_end_date,total_amount,payable_amount,paid_amount,bill_status,bill_type,created_by_type) values($1::uuid,$2,$1::text,'202611',current_date,current_date+30,100,100,100,'paid','one_off','system')",
        [invoice, scope.tenantId],
      );
      await owner.query(
        "insert into billing.transactions(id,tenant_id,bill_id,transaction_no,trade_type,source_method,amount,currency,balance_before,balance_after,trade_status,actor_type) values($1::uuid,$2,$3,$1::text,'recharge','offline',100,'CNY',0,0,'success','system')",
        [transaction, scope.tenantId, invoice],
      );
      await owner.query(
        "insert into billing.payments(id,tenant_id,bill_id,transaction_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status,paid_at) values($1::uuid,$2,$3,$4,$1::text,$5,100,100,'paid',now())",
        [payment, scope.tenantId, invoice, transaction, source],
      );
      return payment;
    }

    // ========================================================================
    // Review, budget serialization, durable receipts and one-time secret delivery.
    // ========================================================================
    it("uses restricted roles and rejects destructive audit mutations", async () => {
      expect(
        (await runtime.query("select current_user")).rows[0].current_user,
      ).toBe("svc_console_bff");
      expect(
        (await admin.query("select current_user")).rows[0].current_user,
      ).toBe("svc_admin_bff");
      for (const pool of [admin, runtime])
        await expect(
          pool.query("delete from promotion.voucher_events"),
        ).rejects.toMatchObject({ code: "42501" });
      await expect(
        runtime.query("update promotion.voucher_events set reason='tampered'"),
      ).rejects.toMatchObject({ code: "42501" });
      expect(
        (
          await runtime.query(
            "select rolsuper,rolbypassrls from pg_roles where rolname=current_user",
          )
        ).rows[0],
      ).toEqual({ rolsuper: false, rolbypassrls: false });
    });
    it("requires separate review and rejects stale revisions", async () => {
      const s = await fixture(),
        b = await batch(s, {}, false);
      await expect(reviewBatch(b.batchId, creator)).rejects.toThrow("另一位");
      await expect(
        management().actOnBatch(reviewer, b.batchId, {
          ...command(),
          action: "review",
          expectedRevision: "1.000000",
        }),
      ).rejects.toThrow("变化");
      await expect(
        management().issueClaimCredentials(
          creator,
          b.batchId,
          { ...command(), count: 1 },
          credentials,
        ),
      ).rejects.toThrow("状态");
      await reviewBatch(b.batchId);
      expect(
        (
          await management().issueClaimCredentials(
            creator,
            b.batchId,
            { ...command(), count: 1 },
            credentials,
          )
        ).voucherIds,
      ).toHaveLength(1);
    });
    it("delivers secrets once and replays only a matching durable receipt", async () => {
      const s = await fixture(),
        b = await batch(s),
        c = { ...command(), count: 1 };
      const first = await management().issueClaimCredentials(
        creator,
        b.batchId,
        c,
        credentials,
      );
      const retry = await management().issueClaimCredentials(
        creator,
        b.batchId,
        c,
        credentials,
      );
      expect(first.credentials).toHaveLength(1);
      expect(retry.credentials).toEqual([]);
      expect(retry.replayed).toBe(true);
      expect(retry.voucherIds).toEqual(first.voucherIds);
      await expect(
        management().issueClaimCredentials(
          creator,
          b.batchId,
          { ...c, count: 2 },
          credentials,
        ),
      ).rejects.toThrow("已改变");
      const receipt = (
        await owner.query(
          "select result from promotion.voucher_operations where actor_id=$1 and idempotency_key=$2",
          [creator, c.idempotencyKey],
        )
      ).rows[0].result;
      expect(JSON.stringify(receipt)).not.toContain(
        first.credentials[0]!.secret,
      );
      expect(
        await countRows(
          "promotion.voucher_events",
          "voucher_id",
          first.voucherIds[0]!,
        ),
      ).toBe(1);
    });
    it("serializes parallel duplicate issuance and enforces total budget", async () => {
      const s = await fixture(),
        b = await batch(s, { totalCount: 1 }),
        c = { ...command(), count: 1 };
      const results = await Promise.all([
        management().issueClaimCredentials(creator, b.batchId, c, credentials),
        management().issueClaimCredentials(creator, b.batchId, c, credentials),
      ]);
      expect(results[0]!.voucherIds).toEqual(results[1]!.voucherIds);
      expect(results.flatMap((r) => r.credentials)).toHaveLength(1);
      await expect(
        management().issueClaimCredentials(
          creator,
          b.batchId,
          { ...command(), count: 1 },
          credentials,
        ),
      ).rejects.toThrow("不足");
      expect(await countRows("promotion.vouchers", "batch_id", b.batchId)).toBe(
        1,
      );
    });
    it("rejects competing distinct issuance requests without overissue", async () => {
      const s = await fixture(),
        b = await batch(s, { totalCount: 1 });
      const r = await Promise.allSettled(
        [1, 2].map(() =>
          management().issueClaimCredentials(
            creator,
            b.batchId,
            { ...command(), count: 1 },
            credentials,
          ),
        ),
      );
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(await countRows("promotion.vouchers", "batch_id", b.batchId)).toBe(
        1,
      );
    });
    it("separates budget request and approval and freezes economic configuration", async () => {
      const s = await fixture(),
        b = await batch(s, { totalCount: 1 });
      const request = await management().actOnBatch(creator, b.batchId, {
        ...command(),
        action: "request_budget",
        totalCount: 2,
      });
      await expect(
        management().actOnBatch(creator, b.batchId, {
          ...command(),
          action: "approve_budget",
          requestOperationId: request.operationId,
        }),
      ).rejects.toThrow("自行审批");
      await management().actOnBatch(reviewer, b.batchId, {
        ...command(),
        action: "approve_budget",
        requestOperationId: request.operationId,
      });
      await management().issueClaimCredentials(
        creator,
        b.batchId,
        { ...command(), count: 2 },
        credentials,
      );
      await expect(
        management().actOnBatch(creator, b.batchId, {
          ...command(),
          action: "configure",
          configuration: b.config,
        }),
      ).rejects.toThrow("冻结");
      await expect(
        management().actOnBatch(reviewer, b.batchId, {
          ...command(),
          action: "approve_budget",
          requestOperationId: request.operationId,
        }),
      ).rejects.toThrow("已处理");
    });
    it("allows replay-only recovery but cannot start a new operation", async () => {
      const s = await fixture(),
        b = await batch(s),
        c = {
          ...command(),
          batchId: b.batchId,
          count: 1,
          targetTenantId: s.tenantId,
          targetUserId: s.userId,
        };
      const prior = await management().assign(creator, c),
        replay = new PgVoucherManagement(admin, undefined, {
          replayOnly: true,
        });
      expect(await replay.assign(creator, c)).toEqual(prior);
      await expect(
        replay.assign(creator, { ...c, ...command() }),
      ).rejects.toThrow("step_up_required");
      expect(await countRows("promotion.vouchers", "batch_id", b.batchId)).toBe(
        1,
      );
    });

    // ========================================================================
    // Claim ownership, current context, lifetime limits and read-side truth.
    // ========================================================================
    it("keeps preview read only and binds a user claim once under concurrency", async () => {
      const s = await fixture(),
        v = await issue(s),
        secret = v.issued.credentials[0]!.secret,
        c = { secret, target: "user" as const, idempotencyKey: randomUUID() };
      expect(await claims().preview(s, secret)).toMatchObject({
        tenantName: "Voucher QA",
        kind: "credit_voucher",
      });
      expect(await state(v.issued.voucherIds[0]!)).toMatchObject({
        status: "issued",
      });
      const r = await Promise.all([claims().claim(s, c), claims().claim(s, c)]);
      expect(r[0]).toEqual(r[1]);
      expect(
        await PgVoucherClaims.result(runtime, s, c.idempotencyKey),
      ).toEqual(r[0]);
      expect(
        await countRows(
          "promotion.voucher_events",
          "voucher_id",
          r[0]!.voucherId,
        ),
      ).toBe(2);
      await expect(
        claims().claim(s, { ...c, target: "workspace" }),
      ).rejects.toThrow("已改变");
      await expect(claims().preview(s, secret)).rejects.toThrow("不可用");
    });
    it("rejects cross-tenant scope, display codes and a mismatched workspace", async () => {
      const s = await fixture(),
        other = await fixture(),
        v = await issue(s),
        token = v.issued.credentials[0]!;
      await expect(claims().preview(other, token.secret)).rejects.toThrow(
        "不可用",
      );
      await expect(claims().preview(s, token.code)).rejects.toThrow("不可用");
      await expect(
        claims().preview(
          { ...s, workspaceId: other.workspaceId },
          token.secret,
        ),
      ).rejects.toThrow("不可访问");
      expect(
        await PgVoucherClaims.result(runtime, other, randomUUID()),
      ).toBeNull();
      expect(await state(token.voucherId)).toMatchObject({ status: "issued" });
    });
    it("allows only one competing claimant and hides receipts across tenants", async () => {
      const s = await fixture(),
        other = await fixture(),
        v = await issue(s, 1, { tenantId: null }),
        secret = v.issued.credentials[0]!.secret,
        key = randomUUID();
      const r = await Promise.allSettled(
        [s, other].map((scope) =>
          claims().claim(scope, {
            secret,
            target: "workspace",
            idempotencyKey: key,
          }),
        ),
      );
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const loser = r[0]!.status === "fulfilled" ? other : s;
      expect(await PgVoucherClaims.result(runtime, loser, key)).toBeNull();
      expect(
        await countRows(
          "promotion.voucher_events",
          "voucher_id",
          v.issued.voucherIds[0]!,
        ),
      ).toBe(2);
    });
    it("counts revoked claims against lifetime limits", async () => {
      const s = await fixture(),
        v = await issue(s, 2, { perUserLimit: 1 });
      await claims().claim(s, {
        secret: v.issued.credentials[0]!.secret,
        target: "user",
        idempotencyKey: randomUUID(),
      });
      await management().revoke(creator, v.issued.voucherIds[0]!, command());
      await expect(
        claims().claim(s, {
          secret: v.issued.credentials[1]!.secret,
          target: "user",
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow("不可用");
      await expect(assign(s, v.batchId)).rejects.toThrow("累计");
      expect(await state(v.issued.voucherIds[1]!)).toMatchObject({
        status: "issued",
      });
    });
    it("serializes separate claims against a single user limit", async () => {
      const s = await fixture(),
        v = await issue(s, 2, { perUserLimit: 1 });
      const r = await Promise.allSettled(
        v.issued.credentials.map((c) =>
          claims().claim(s, {
            secret: c.secret,
            target: "workspace",
            idempotencyKey: randomUUID(),
          }),
        ),
      );
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.vouchers where batch_id=$1 and status='assigned'",
            [v.batchId],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("checks live membership even when recovering a committed receipt", async () => {
      const s = await fixture(),
        v = await issue(s),
        c = {
          secret: v.issued.credentials[0]!.secret,
          target: "user" as const,
          idempotencyKey: randomUUID(),
        };
      await claims().claim(s, c);
      await owner.query(
        "update account.users set status='disabled' where id=$1",
        [s.userId],
      );
      await expect(
        PgVoucherClaims.result(runtime, s, c.idempotencyKey),
      ).rejects.toThrow("不可访问");
      await expect(claims().claim(s, c)).rejects.toThrow("不可访问");
    });
    it("reports paused/archived/revoked states and excludes anonymous inventory", async () => {
      const s = await fixture(),
        v = await issue(s, 2),
        ledger = new PgCustomerVoucherLedger(runtime);
      expect((await ledger.page(s, { status: "all" })).total).toBe(0);
      await claims().claim(s, {
        secret: v.issued.credentials[0]!.secret,
        target: "workspace",
        idempotencyKey: randomUUID(),
      });
      expect((await ledger.page(s)).items[0]).toMatchObject({
        holderScope: "workspace",
        availabilityStatus: "available",
        returnPolicy: "full_reversal_only",
      });
      await management().actOnBatch(creator, v.batchId, {
        ...command(),
        action: "pause",
      });
      expect((await ledger.page(s, { status: "paused" })).total).toBe(1);
      await expect(
        claims().preview(s, v.issued.credentials[1]!.secret),
      ).rejects.toThrow("不可用");
      await management().actOnBatch(creator, v.batchId, {
        ...command(),
        action: "archive",
      });
      expect((await ledger.page(s, { status: "archived" })).total).toBe(1);
      await management().revoke(creator, v.issued.voucherIds[0]!, command());
      expect((await ledger.page(s, { status: "revoked" })).total).toBe(1);
      await expect(ledger.page(s, { pageSize: 2 })).rejects.toThrow("参数");
    });

    // ========================================================================
    // Exact order/invoice reservation, terminal replay and downstream rollback.
    // ========================================================================
    it("rolls back reservation, operation and event when downstream work fails", async () => {
      const s = await fixture(),
        b = await batch(s),
        v = await assign(s, b.batchId),
        o = await order(s);
      await expect(reserve(s, v.voucherIds[0]!, o, true)).rejects.toThrow(
        "downstream",
      );
      expect(await state(v.voucherIds[0]!)).toEqual({
        status: "assigned",
        used_count: 0,
      });
      expect(
        await countRows(
          "promotion.voucher_reservations",
          "voucher_id",
          v.voucherIds[0]!,
        ),
      ).toBe(0);
      expect(
        await countRows(
          "promotion.voucher_events",
          "voucher_id",
          v.voucherIds[0]!,
        ),
      ).toBe(1);
    });
    it("permits only one competing order reservation and exposes its order number", async () => {
      const s = await fixture(),
        b = await batch(s),
        v = await assign(s, b.batchId),
        orders = await Promise.all([order(s), order(s)]);
      const r = await Promise.allSettled(
        orders.map((o) => reserve(s, v.voucherIds[0]!, o)),
      );
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const page = await new PgCustomerVoucherLedger(runtime).page(s, {
        status: "reserved",
      });
      expect(page.items[0]!.orderNo).toBe(
        orders[r[0]!.status === "fulfilled" ? 0 : 1]!.orderId,
      );
    });
    it("cannot release another order and a stale release cannot free a later reservation", async () => {
      const s = await fixture(),
        b = await batch(s),
        v = await assign(s, b.batchId),
        o = await order(s),
        other = await order(s),
        id = v.voucherIds[0]!,
        first = await reserve(s, id, o);
      const release = (context: typeof o, r: ReservedVoucher) =>
        tx((c) =>
          promotion().releaseReserved(c, {
            ...context,
            creditVoucherId: id,
            creditReservationId: r.reservationId,
          }),
        );
      await expect(release(other, first)).rejects.toThrow("不一致");
      expect(await release(o, first)).toEqual([id]);
      const second = await reserve(s, id, other);
      expect(second.reservationId).not.toBe(first.reservationId);
      expect(await release(o, first)).toEqual([]);
      expect(await state(id)).toEqual({ status: "reserved", used_count: 1 });
    });
    it("finalizes once from frozen effects, rejects other orders and refuses release after consumption", async () => {
      const s = await fixture(),
        b = await batch(s),
        v = await assign(s, b.batchId),
        o = await order(s),
        other = await order(s),
        id = v.voucherIds[0]!,
        r = await reserve(s, id, o);
      const input = {
        ...o,
        voucherId: id,
        reservationId: r.reservationId,
        kind: "credit_voucher" as const,
        scope: s,
        effectSnapshot: { amount_cents: 999999 },
      };
      await expect(
        tx((c) => promotion().finalizeReserved(c, [{ ...input, ...other }])),
      ).rejects.toThrow("不一致");
      const first = await tx((c) => promotion().finalizeReserved(c, [input]));
      expect(await tx((c) => promotion().finalizeReserved(c, [input]))).toEqual(
        first,
      );
      const row = (
        await owner.query(
          "select effect_snapshot from promotion.voucher_redemptions where voucher_id=$1",
          [id],
        )
      ).rows[0];
      expect(row.effect_snapshot).toMatchObject({ amount_cents: 2000 });
      await expect(
        tx((c) =>
          promotion().releaseReserved(c, {
            ...o,
            creditVoucherId: id,
            creditReservationId: r.reservationId,
          }),
        ),
      ).rejects.toThrow("不一致");
      expect(
        await countRows("promotion.voucher_redemptions", "voucher_id", id),
      ).toBe(1);
    });
    it("rejects a foreign financial destination and rolls back a finalized voucher on later failure", async () => {
      const s = await fixture(),
        b = await batch(s),
        v = await assign(s, b.batchId),
        o = await order(s),
        other = await order(s),
        id = v.voucherIds[0]!,
        r = await reserve(s, id, o),
        payment = randomUUID();
      await owner.query(
        "insert into billing.payments(id,tenant_id,bill_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status) values($1::uuid,$2,$3,$1::text,'voucher',20,20,'paid')",
        [payment, s.tenantId, other.invoiceId],
      );
      const input = {
        ...o,
        voucherId: id,
        reservationId: r.reservationId,
        kind: "credit_voucher" as const,
        scope: s,
        effectSnapshot: r.effectSnapshot,
      };
      await expect(
        tx((c) =>
          promotion().finalizeReserved(c, [{ ...input, paymentId: payment }]),
        ),
      ).rejects.toThrow("不一致");
      await expect(
        tx(async (c) => {
          await promotion().finalizeReserved(c, [input]);
          throw new Error("after finalize");
        }),
      ).rejects.toThrow("after finalize");
      expect(await state(id)).toEqual({ status: "reserved", used_count: 1 });
      expect(
        await countRows("promotion.voucher_redemptions", "voucher_id", id),
      ).toBe(0);
    });
    it("releases orphaned reservations only for the exact order invoice", async () => {
      const s = await fixture(),
        b = await batch(s),
        v = await assign(s, b.batchId),
        o = await order(s),
        id = v.voucherIds[0]!;
      await reserve(s, id, o);
      await tx((c) => promotion().releaseOrderReservations(c, o, "expired"));
      expect(await state(id)).toEqual({ status: "assigned", used_count: 0 });
      expect(
        (
          await owner.query(
            "select release_reason from promotion.voucher_reservations where voucher_id=$1",
            [id],
          )
        ).rows[0].release_reason,
      ).toBe("expired");
    });

    // ========================================================================
    // Principal cards require proven sales; issuance and release are atomic.
    // ========================================================================
    it("rejects principal issuance without source or through unbacked assignment", async () => {
      const s = await fixture(),
        b = await batch(s, {
          kind: "recharge_card",
          effect: { face_value_cents: 10000, bonus_cents: 500 },
        });
      await expect(
        management().issueClaimCredentials(
          creator,
          b.batchId,
          { ...command(), count: 1 },
          credentials,
        ),
      ).rejects.toThrow("收款");
      await expect(assign(s, b.batchId)).rejects.toThrow("来源");
      expect(await countRows("promotion.vouchers", "batch_id", b.batchId)).toBe(
        0,
      );
    });
    it("reserves verified cash exactly once and rejects overfunding or balance sources", async () => {
      const s = await fixture(),
        payment = await sale(s),
        balance = await sale(s, "balance"),
        b = await batch(s, {
          kind: "recharge_card",
          effect: { face_value_cents: 10000, bonus_cents: 500 },
        });
      await expect(
        management().issueClaimCredentials(
          creator,
          b.batchId,
          { ...command(), count: 1, fundingPaymentId: balance },
          credentials,
        ),
      ).rejects.toThrow();
      const c = { ...command(), count: 1, fundingPaymentId: payment },
        v = await management().issueClaimCredentials(
          creator,
          b.batchId,
          c,
          credentials,
        );
      expect(
        (
          await management().issueClaimCredentials(
            creator,
            b.batchId,
            c,
            credentials,
          )
        ).voucherIds,
      ).toEqual(v.voucherIds);
      await expect(
        management().issueClaimCredentials(
          creator,
          b.batchId,
          { ...command(), count: 1, fundingPaymentId: payment },
          credentials,
        ),
      ).rejects.toThrow();
      await claims().claim(s, {
        secret: v.credentials[0]!.secret,
        target: "user",
        idempotencyKey: randomUUID(),
      });
      expect(
        await RechargeCards.read(runtime, s, v.voucherIds[0]!),
      ).toMatchObject({
        payment_id: payment,
        terms: { face_value_cents: 10000, bonus_cents: 500 },
      });
      expect((await new PgCustomerVoucherLedger(runtime).page(s)).total).toBe(
        1,
      );
      await management().revoke(creator, v.voucherIds[0]!, command());
      expect(
        (
          await owner.query(
            "select status from billing.wallet_card_allocations where voucher_id=$1",
            [v.voucherIds[0]],
          )
        ).rows[0].status,
      ).toBe("released");
    });
    it("rolls back newly issued cards, allocation, budget and receipts if funding hooks fail", async () => {
      const s = await fixture(),
        payment = await sale(s),
        b = await batch(s, {
          kind: "recharge_card",
          effect: { face_value_cents: 10000, bonus_cents: 0 },
        }),
        funding = new PgRechargeCardFunding(admin),
        c = { ...command(), count: 1, fundingPaymentId: payment };
      const failing = new PgVoucherManagement(admin, {
        lockSource: (client, source) => funding.lockSource(client, source),
        reserve: async (client, allocation) => {
          await funding.reserve(client, allocation);
          throw new Error("allocation failure");
        },
        lockRelease: (client, id) => funding.lockRelease(client, id),
        release: (client, id) => funding.release(client, id),
      });
      await expect(
        failing.issueClaimCredentials(creator, b.batchId, c, credentials),
      ).rejects.toThrow("allocation failure");
      expect(await countRows("promotion.vouchers", "batch_id", b.batchId)).toBe(
        0,
      );
      expect(
        await countRows(
          "billing.wallet_card_allocations",
          "payment_id",
          payment,
        ),
      ).toBe(0);
      expect(
        (
          await owner.query(
            "select issued_count from promotion.voucher_batches where id=$1",
            [b.batchId],
          )
        ).rows[0].issued_count,
      ).toBe(0);
      expect(
        await management().issueClaimCredentials(
          creator,
          b.batchId,
          c,
          credentials,
        ),
      ).toMatchObject({ replayed: false });
    });
    it("reads bonus-only recharge and extension terms with tenant isolation", async () => {
      const s = await fixture(),
        other = await fixture(),
        b = await batch(s, {
          kind: "recharge_card",
          effect: { face_value_cents: 0, bonus_cents: 500 },
        }),
        v = await assign(s, b.batchId);
      expect(
        await RechargeCards.read(runtime, s, v.voucherIds[0]!),
      ).toMatchObject({
        payment_id: null,
        terms: { face_value_cents: 0, bonus_cents: 500 },
      });
      await expect(
        RechargeCards.read(runtime, other, v.voucherIds[0]!),
      ).rejects.toThrow("不可用");
      const e = await batch(s, {
          kind: "extension",
          effect: { extend_days: 7 },
        }),
        extension = await assign(s, e.batchId);
      expect(
        await SubscriptionVouchers.readExtension(
          runtime,
          s,
          extension.voucherIds[0]!,
        ),
      ).toMatchObject({ terms: { extend_days: 7 } });
      await expect(
        SubscriptionVouchers.read(runtime, s, extension.voucherIds[0]!),
      ).rejects.toThrow("不可用");
    });

    // ========================================================================
    // Compensation intent and recovery never repeat the original money movement.
    // ========================================================================
    it("persists one refund intent and recovers a noncash replacement once", async () => {
      const s = await fixture(),
        b = await batch(s),
        v = await assign(s, b.batchId),
        o = await order(s),
        id = v.voucherIds[0]!,
        r = await reserve(s, id, o),
        payment = randomUUID();
      await owner.query(
        "insert into billing.payments(id,tenant_id,bill_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status) values($1::uuid,$2,$3,$1::text,'voucher',20,20,'paid')",
        [payment, s.tenantId, o.invoiceId],
      );
      await tx((c) =>
        promotion().finalizeReserved(c, [
          {
            ...o,
            voucherId: id,
            reservationId: r.reservationId,
            kind: "credit_voucher",
            scope: s,
            effectSnapshot: r.effectSnapshot,
            paymentId: payment,
          },
        ]),
      );
      const evidence = {
        targets: [{ id: payment, source: "voucher", targetCents: 2000 }],
        cashTargetCents: 0,
        refundedCashCents: 0,
      };
      await expect(
        tx(async (c) => {
          await promotion().queueRefundCompensations(
            c,
            o.orderId,
            null,
            evidence,
          );
          throw new Error("refund rollback");
        }),
      ).rejects.toThrow("refund rollback");
      expect(
        await countRows(
          "promotion.voucher_compensations",
          "order_id",
          o.orderId,
        ),
      ).toBe(0);
      expect(
        await tx((c) =>
          promotion().queueRefundCompensations(c, o.orderId, null, evidence),
        ),
      ).toBe(1);
      expect(
        await tx((c) =>
          promotion().queueRefundCompensations(c, o.orderId, null, evidence),
        ),
      ).toBe(0);
      const subscription = randomUUID();
      await owner.query(
        "insert into metering.subscriptions(id,tenant_id,workspace_id,plan_version_id,product_id,subscription_kind,cycle_unit,start_at,status,created_by_type,current_order_id) select $2::uuid,tenant_id,workspace_id,plan_version_id,product_id,'free','month',now(),'cancelled','system',id from billing.orders where id=$1",
        [o.orderId, subscription],
      );
      await owner.query(
        "update billing.orders set status='refunded',fulfilled_at=now(),subscription_id=$2 where id=$1",
        [o.orderId, subscription],
      );
      const results = await Promise.all([
        promotion().recoverRefundCompensations(),
        promotion().recoverRefundCompensations(),
      ]);
      expect(results.reduce((n, x) => n + x.failed, 0)).toBe(0);
      const row = (
        await owner.query(
          "select status,replacement_voucher_id from promotion.voucher_compensations where order_id=$1",
          [o.orderId],
        )
      ).rows[0];
      expect(row.status).toBe("completed");
      expect(row.replacement_voucher_id).toBeTruthy();
      expect(
        await countRows(
          "promotion.vouchers",
          "replacement_of_redemption_id",
          (
            await owner.query(
              "select id from promotion.voucher_redemptions where voucher_id=$1",
              [id],
            )
          ).rows[0].id,
        ),
      ).toBe(1);
      expect(await promotion().recoverRefundCompensations()).toEqual({
        completed: 0,
        failed: 0,
      });
      expect(await state(id)).toEqual({ status: "redeemed", used_count: 1 });
    });
    async function settledCredit(
      scope: VoucherScope,
      returnPolicy: "none" | "full_reversal_only" = "full_reversal_only",
    ) {
      const b = await batch(scope, { returnPolicy }),
        v = await assign(scope, b.batchId),
        o = await order(scope),
        id = v.voucherIds[0]!,
        r = await reserve(scope, id, o),
        payment = randomUUID();
      await owner.query(
        "insert into billing.payments(id,tenant_id,bill_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status) values($1::uuid,$2,$3,$1::text,'voucher',20,20,'paid')",
        [payment, scope.tenantId, o.invoiceId],
      );
      await tx((c) =>
        promotion().finalizeReserved(c, [
          {
            ...o,
            voucherId: id,
            reservationId: r.reservationId,
            kind: "credit_voucher",
            scope,
            effectSnapshot: r.effectSnapshot,
            paymentId: payment,
          },
        ]),
      );
      return { ...o, id, payment };
    }
    it("requires complete cash reversal and proven voucher value before approving replacement", async () => {
      const s = await fixture(),
        o = await settledCredit(s);
      const evidence = {
        targets: [{ id: o.payment, source: "voucher", targetCents: 2000 }],
        cashTargetCents: 5000,
        refundedCashCents: 4999,
      };
      await tx((c) =>
        promotion().queueRefundCompensations(c, o.orderId, null, evidence),
      );
      const row = (
        await owner.query(
          "select status,amount_cents::text,reason from promotion.voucher_compensations where order_id=$1",
          [o.orderId],
        )
      ).rows[0];
      expect(row).toEqual({
        status: "manual_required",
        amount_cents: "2000",
        reason: "unproven_value_or_incomplete_cash_return",
      });
      expect(
        await tx((c) =>
          promotion().queueRefundCompensations(c, o.orderId, null, {
            ...evidence,
            refundedCashCents: 5000,
          }),
        ),
      ).toBe(0);
      expect(await promotion().recoverRefundCompensations()).toEqual({
        completed: 0,
        failed: 0,
      });
      expect(
        await countRows(
          "promotion.vouchers",
          "batch_id",
          (
            await owner.query(
              "select id from promotion.voucher_compensations where order_id=$1",
              [o.orderId],
            )
          ).rows[0].id,
        ),
      ).toBe(0);
    });
    it("does not infer a return promise or invent an unknown voucher allocation", async () => {
      const s = await fixture(),
        none = await settledCredit(s, "none"),
        unknown = await settledCredit(s);
      const evidence = {
        targets: [],
        cashTargetCents: 0,
        refundedCashCents: 0,
      };
      expect(
        await tx((c) =>
          promotion().queueRefundCompensations(c, none.orderId, null, evidence),
        ),
      ).toBe(0);
      expect(
        await tx((c) =>
          promotion().queueRefundCompensations(
            c,
            unknown.orderId,
            null,
            evidence,
          ),
        ),
      ).toBe(1);
      expect(
        (
          await owner.query(
            "select status,amount_cents::text from promotion.voucher_compensations where order_id=$1",
            [unknown.orderId],
          )
        ).rows[0],
      ).toEqual({ status: "manual_required", amount_cents: "0" });
    });
    it("cannot approve reservation ownership using another tenant's order", async () => {
      const s = await fixture(),
        other = await fixture(),
        b = await batch(s),
        v = await assign(s, b.batchId),
        foreign = await order(other);
      await expect(reserve(s, v.voucherIds[0]!, foreign)).rejects.toThrow(
        "不一致",
      );
      expect(await state(v.voucherIds[0]!)).toEqual({
        status: "assigned",
        used_count: 0,
      });
      expect(
        await countRows(
          "promotion.voucher_reservations",
          "order_id",
          foreign.orderId,
        ),
      ).toBe(0);
    });
    it("separates claim cutoff from use lifetime and caps validity at batch expiry", async () => {
      const s = await fixture(),
        v = await issue(s, 2, {
          useValidDays: 1,
          claimUntil: new Date(Date.now() + 1500).toISOString(),
        });
      const first = await claims().claim(s, {
        secret: v.issued.credentials[0]!.secret,
        target: "user",
        idempotencyKey: randomUUID(),
      });
      const lifetime = (
        await owner.query<{
          claimed_at: Date;
          expires_at: Date;
          valid_until: Date;
        }>(
          "select v.claimed_at,v.expires_at,b.valid_until from promotion.vouchers v join promotion.voucher_batches b on b.id=v.batch_id where v.id=$1",
          [first.voucherId],
        )
      ).rows[0]!;
      // Both instants come from the database; host/VM clock skew is irrelevant.
      expect(
        lifetime.expires_at.getTime() - lifetime.claimed_at.getTime(),
      ).toBe(86400000);
      expect(Date.parse(first.expiresAt)).toBe(
        Math.min(
          lifetime.claimed_at.getTime() + 86400000,
          lifetime.valid_until.getTime(),
        ),
      );
      await setTimeout(1600);
      await expect(
        claims().preview(s, v.issued.credentials[1]!.secret),
      ).rejects.toThrow("不可用");
      expect((await new PgCustomerVoucherLedger(runtime).page(s)).total).toBe(
        1,
      );
      expect(
        await promotion().resolveForQuote(s, first.voucherId, "credit_voucher"),
      ).not.toBeNull();
    });
  },
);
