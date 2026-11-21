/**
 * order-wallet-balance.itest.spec.ts - Balance settlement with real source evidence.
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
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// ⚠️ 跨层引用: the application verifies the real domain services together.
import { PgWalletLedger, type WalletContext } from "@vxture/service-billing";
import {
  PgOrderRepository,
  PgSubscriptionRepository,
  OrderService,
} from "@vxture/service-subscription";
import { orderServiceProvider } from "../providers/commerce-services.provider";
import type { FactoryProvider } from "@nestjs/common";

// ============================================================================
// All connections belong to this new loopback-only container; no configured URLs.
// ============================================================================
describe.skipIf(process.env.WALLET_BALANCE_ITEST !== "1")(
  "source-aware balance settlement",
  () => {
    const runId = randomUUID();
    const container = `codex-order-wallet-${runId.slice(0, 12)}`;
    let containerId = "";
    let orders: PgOrderRepository, sub: PgSubscriptionRepository;
    let owner: Pool,
      runtime: Pool,
      ledger: PgWalletLedger,
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
        "S07_R2B_CONTAINER_OWNERSHIP=" +
          JSON.stringify({ name: container, id: containerId, runId }),
      );
      const info = JSON.parse(docker(["inspect", container]))[0];
      expect(info.Id).toBe(containerId);
      expect(info.Config.Labels["codex.run"]).toBe(runId);
      expect(info.HostConfig.PortBindings["5432/tcp"]).toEqual([
        { HostIp: "127.0.0.1", HostPort: "" },
      ]);
      console.info(`S07_R2B_CONTAINER_CREATED=${container}`);
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
      ledger = new PgWalletLedger(runtime);
      orders = new PgOrderRepository(runtime);
      sub = new PgSubscriptionRepository(runtime);
      orders.setWalletSettlement(ledger);
      sub.setWalletSettlement(ledger);
    }, 60000);
    afterAll(async () => {
      try {
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
            console.info(`S07_R2B_CONTAINER_CLEANED=${container}`);
          }
        }
      }
    }, 60000);
    // ========================================================================
    // Persisted fixtures and caller-owned transactions.
    // ========================================================================
    async function fixture(fund = true) {
      const scope: WalletContext = {
        tenantId: randomUUID(),
        actorId: randomUUID(),
        actorType: "customer",
        currency: "CNY",
      };
      await owner.query(
        "insert into account.users(id,account,phone,phone_verified_at) values($1::uuid,$1::text,$2,now())",
        [scope.actorId, `+${Date.now()}${Math.floor(Math.random() * 100000)}`],
      );
      await owner.query(
        "insert into tenancy.tenants(id,name,type,owner_user_id) values($1::uuid,'Wallet QA','organization',$2)",
        [scope.tenantId, scope.actorId],
      );
      const workspace = randomUUID(),
        product = randomUUID(),
        plan = randomUUID(),
        version = randomUUID();
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1::uuid,$2,'Wallet QA')",
        [workspace, scope.tenantId],
      );
      const tenantRole = randomUUID(),
        workspaceRole = randomUUID();
      await owner.query(
        "insert into access.roles(id,role_code,scope) values($1::uuid,$1::text,'tenant'),($2::uuid,$2::text,'workspace')",
        [tenantRole, workspaceRole],
      );
      await owner.query(
        "insert into tenancy.tenant_memberships(tenant_id,user_id,role_id,role_scope) values($1,$2,$3,'tenant')",
        [scope.tenantId, scope.actorId, tenantRole],
      );
      await owner.query(
        "insert into tenancy.workspace_memberships(tenant_id,workspace_id,user_id,role_id,role_scope) values($1,$2,$3,$4,'workspace')",
        [scope.tenantId, workspace, scope.actorId, workspaceRole],
      );
      await owner.query(
        "insert into product.products(id,product_code,product_type,product_name) values($1::uuid,$1::text,'agent','Wallet QA')",
        [product],
      );
      await owner.query(
        "insert into product.plans(id,plan_code,plan_name) values($1::uuid,$1::text,'Wallet QA')",
        [plan],
      );
      await owner.query(
        "insert into product.plan_versions(id,plan_id,version_no) values($1::uuid,$2,1)",
        [version, plan],
      );
      const subscriptionId = randomUUID();
      await owner.query(
        "insert into metering.subscriptions(id,tenant_id,workspace_id,plan_version_id,product_id,subscription_kind,cycle_unit,start_at,created_by_type,created_by_id) values($1,$2,$3,$4,$5,'paid','month',now(),'customer',$6)",
        [
          subscriptionId,
          scope.tenantId,
          workspace,
          version,
          product,
          scope.actorId,
        ],
      );
      const orderId = randomUUID(),
        invoiceId = randomUUID();
      await owner.query(
        "insert into billing.orders(id,order_no,tenant_id,workspace_id,product_id,plan_version_id,intent,cycle_unit,list_amount,payable_amount,created_by_type,created_by_id) values($1::uuid,$1::text,$2,$3,$4,$5,'new','month',100,100,'customer',$6)",
        [orderId, scope.tenantId, workspace, product, version, scope.actorId],
      );
      await owner.query(
        "insert into billing.invoices(id,order_id,tenant_id,bill_no,bill_cycle,cycle_start_date,cycle_end_date,total_amount,payable_amount,created_by_type) values($1::uuid,$2,$3,$1::text,'202611',current_date,current_date+30,100,100,'customer')",
        [invoiceId, orderId, scope.tenantId],
      );
      if (fund)
        await ledger.post(scope, {
          action: "bonus",
          amountCents: 10000,
          idempotencyKey: randomUUID(),
        });
      return {
        ...scope,
        orderId,
        invoiceId,
        subscriptionId,
        amountYuan: "60.00",
      };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    async function debit(f: Fixture, fail = false, repository = sub) {
      return orders.withOrderTx(f.orderId, async ({ client }) => {
        const id = await repository.settleBalanceTx(client, f);
        if (fail) throw new Error("downstream rollback");
        return id;
      });
    }
    async function wallet(f: Fixture) {
      return (
        await owner.query(
          "select balance::text,total_consumed::text from billing.credits where tenant_id=$1",
          [f.tenantId],
        )
      ).rows[0];
    }
    async function request(f: Fixture, amount = "60.00", channel = "balance") {
      await owner.query(
        "update billing.orders set status='fulfilled',fulfilled_at=now(),subscription_id=$2 where id=$1",
        [f.orderId, f.subscriptionId],
      );
      const payment = (
        await owner.query(
          "select id from billing.payments where bill_id=$1 and pay_source=$2",
          [f.invoiceId, channel === "balance" ? "balance" : "offline"],
        )
      ).rows[0];
      const id = randomUUID();
      await owner.query(
        "insert into billing.refunds(id,tenant_id,order_id,bill_id,pay_record_id,refund_no,refund_amount,currency,audit_status,refund_status,created_by_type,created_by_id,transfer_initiated_at) values($1::uuid,$2,$3,$4,$5,$1::text,$6,'CNY','approved',$7::varchar,'customer',$8,case when $7::varchar='processing' then now() else null end)",
        [
          id,
          f.tenantId,
          f.orderId,
          f.invoiceId,
          payment.id,
          amount,
          channel === "balance" ? "pending" : "processing",
          f.actorId,
        ],
      );
      if (channel !== "balance") {
        // Cash fixtures now carry the same frozen source evidence as requests.
        const source = {
          id: payment.id as string,
          source: "offline",
          cents: 6000,
          currency: "CNY",
          targetCents: Math.round(Number(amount) * 100),
        };
        await owner.query(
          "update billing.refunds set calculation_snapshot=$2::jsonb where id=$1",
          [
            id,
            JSON.stringify({
              version: 1,
              alpha: 0,
              usage: 0,
              cashTargetCents: 6000,
              targets: [{ ...source, targetCents: 6000 }],
              cash: [source],
            }),
          ],
        );
        await owner.query(
          "insert into billing.refund_allocations(refund_id,payment_id,currency,amount) values($1,$2,'CNY',$3)",
          [id, payment.id, amount],
        );
      }
      return {
        refund: (await orders.getRefundById(id))!,
        order: (await orders.getById(f.orderId))!,
        actor: { actorType: "operator" as const, actorId: f.actorId },
      };
    }
    async function cash(f: Fixture) {
      await owner.query(
        "insert into billing.payments(tenant_id,bill_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status,paid_at) values($1::uuid,$2,$3,'offline',60,60,'paid',now())",
        [f.tenantId, f.invoiceId, randomUUID()],
      );
    }
    async function leftover(f: Fixture) {
      await owner.query(
        "update billing.orders set intent='upgrade',status='paid',leftover_amount=20,from_subscription_id=$2 where id=$1",
        [f.orderId, f.subscriptionId],
      );
      return orders.grantLeftoverToPrepaid((await orders.getById(f.orderId))!, {
        actorType: "operator",
        actorId: f.actorId,
      });
    }

    // ========================================================================
    // Checkout source proof, atomicity, replay and isolation.
    // ========================================================================
    it("runs wallet postings as the actual restricted console role", async () => {
      expect(
        (await runtime.query("select current_user")).rows[0].current_user,
      ).toBe("svc_console_bff");
      await expect(
        runtime.query("delete from billing.wallet_operations"),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("settles and restores under the actual restricted Admin database role", async () => {
      const f = await fixture(false);
      const admin = new Pool({ ...runtime.options, user: "svc_admin_bff" });
      try {
        expect(
          (await admin.query("select current_user")).rows[0].current_user,
        ).toBe("svc_admin_bff");
        const sourceWallet = new PgWalletLedger(admin),
          repository = new PgSubscriptionRepository(admin);
        repository.setWalletSettlement(sourceWallet);
        await sourceWallet.post(f, {
          action: "bonus",
          amountCents: 10000,
          idempotencyKey: randomUUID(),
        });
        const client = await admin.connect();
        try {
          await client.query("begin");
          await repository.settleBalanceTx(client, f);
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally {
          client.release();
        }
        const input = await request(f);
        const refunds = new PgOrderRepository(admin);
        refunds.setWalletSettlement(sourceWallet);
        await refunds.executeRefund(input);
        expect(await wallet(f)).toEqual({
          balance: "100.00",
          total_consumed: "0.00",
        });
      } finally {
        await admin.end();
      }
    });
    it("binds a single immutable consume transaction to invoice and payment", async () => {
      const f = await fixture();
      const id = await debit(f);
      expect(await wallet(f)).toEqual({
        balance: "40.00",
        total_consumed: "60.00",
      });
      const proof = (
        await owner.query(
          "select p.transaction_id,t.bill_id,t.amount::text,o.action from billing.payments p join billing.transactions t on t.id=p.transaction_id join billing.wallet_operations o on o.transaction_id=t.id where p.id=$1",
          [id],
        )
      ).rows[0];
      expect(proof).toMatchObject({
        bill_id: f.invoiceId,
        amount: "-60.00",
        action: "consume",
      });
      expect(await debit(f)).toBe(id);
      expect(await wallet(f)).toEqual({
        balance: "40.00",
        total_consumed: "60.00",
      });
    });
    it("serializes order-locked duplicate requests", async () => {
      const f = await fixture();
      const ids = await Promise.all([debit(f), debit(f)]);
      expect(ids[0]).toBe(ids[1]);
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.payments where bill_id=$1",
            [f.invoiceId],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("serializes direct invoice retries without an outer order lock", async () => {
      const f = await fixture();
      const pay = async () => {
        const client = await runtime.connect();
        try {
          await client.query("begin");
          const id = await sub.settleBalanceTx(client, f);
          await client.query("commit");
          return id;
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally {
          client.release();
        }
      };
      const ids = await Promise.all([pay(), pay()]);
      expect(ids[0]).toBe(ids[1]);
      expect(await wallet(f)).toEqual({
        balance: "40.00",
        total_consumed: "60.00",
      });
    });
    it("rejects competing orders without overdrawing the same wallet", async () => {
      const f = await fixture();
      const second = randomUUID(),
        invoice = randomUUID();
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1::uuid,$2,'Other QA')",
        [second, f.tenantId],
      );
      const orderId = randomUUID();
      await owner.query(
        "insert into billing.orders(id,order_no,tenant_id,workspace_id,product_id,plan_version_id,intent,cycle_unit,list_amount,payable_amount,created_by_type) select $2::uuid,$2::text,tenant_id,$3,product_id,plan_version_id,'new','month',100,100,'customer' from billing.orders where id=$1",
        [f.orderId, orderId, second],
      );
      await owner.query(
        "insert into billing.invoices(id,tenant_id,order_id,bill_no,bill_cycle,cycle_start_date,cycle_end_date,total_amount,payable_amount,created_by_type) values($1::uuid,$2,$3,$1::text,'202611',current_date,current_date+30,100,100,'customer')",
        [invoice, f.tenantId, orderId],
      );
      const results = await Promise.allSettled([
        debit(f),
        debit({ ...f, orderId, invoiceId: invoice }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await wallet(f)).balance).toBe("40.00");
    });
    it("rolls back debit, source entries, payment and invoice on later failure", async () => {
      const f = await fixture();
      await expect(debit(f, true)).rejects.toThrow("downstream");
      expect(await wallet(f)).toEqual({
        balance: "100.00",
        total_consumed: "0.00",
      });
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.payments where bill_id=$1",
            [f.invoiceId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await owner.query(
            "select paid_amount::text from billing.invoices where id=$1",
            [f.invoiceId],
          )
        ).rows[0].paid_amount,
      ).toBe("0.00");
    });
    it("rejects currency mismatch, cross-tenant invoice and changed replay amount", async () => {
      const f = await fixture(),
        other = await fixture();
      await expect(debit({ ...f, currency: "USD" })).rejects.toThrow("币种");
      await expect(debit({ ...f, tenantId: other.tenantId })).rejects.toThrow(
        "归属",
      );
      await debit(f);
      await expect(debit({ ...f, amountYuan: "50.00" })).rejects.toThrow(
        "已改变",
      );
      expect((await wallet(other)).balance).toBe("100.00");
    });
    it("rejects an unverified legacy balance without inventing sources", async () => {
      const f = await fixture(false);
      await owner.query(
        "insert into billing.credits(tenant_id,balance) values($1::uuid,100)",
        [f.tenantId],
      );
      await expect(debit(f)).rejects.toThrow("历史钱包");
      expect((await wallet(f)).balance).toBe("100.00");
    });
    it("retains the external-payment exclusion and fails closed without wiring", async () => {
      const f = await fixture();
      await cash(f);
      await expect(debit(f)).rejects.toThrow("已有外部付款");
      const g = await fixture();
      await expect(
        debit(g, false, new PgSubscriptionRepository(runtime)),
      ).rejects.toThrow("未接入");
    });
    it("keeps the rejection deadline anchor and voucher leg settlement", async () => {
      const f = await fixture();
      await owner.query(
        "update billing.orders set created_at=now()-interval '2 hours',payment_ttl_minutes=30 where id=$1",
        [f.orderId],
      );
      await orders.withOrderTx(f.orderId, async ({ client, order }) => {
        expect(await orders.isPaymentExpiredTx(client, order)).toBe(true);
        await client.query(
          "insert into billing.order_events(order_id,event_type,actor_type) values($1::uuid,'payment_rejected','system')",
          [f.orderId],
        );
        expect(await orders.isPaymentExpiredTx(client, order)).toBe(false);
        await sub.settleBalanceTx(client, f);
        await sub.settleInvoiceByVouchersTx(client, {
          ...f,
          voucherLegYuan: "40.00",
        });
        await orders.markPaidTx(client, f.orderId);
      });
      expect(
        (
          await owner.query(
            "select paid_amount::text,payment_method,bill_status from billing.invoices where id=$1",
            [f.invoiceId],
          )
        ).rows[0],
      ).toEqual({
        paid_amount: "100.00",
        payment_method: "balance",
        bill_status: "paid",
      });
    });

    // ========================================================================
    // Refund restoration and exact non-cash leftover reversal.
    // ========================================================================
    it("restores the proven original consumption once under concurrent refunds", async () => {
      const f = await fixture();
      await debit(f);
      const input = await request(f);
      const results = await Promise.allSettled([
        orders.executeRefund(input),
        orders.executeRefund(input),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await wallet(f)).toEqual({
        balance: "100.00",
        total_consumed: "0.00",
      });
      const row = (
        await owner.query(
          "select r.transfer_channel,t.bill_id,t.amount::text,t.trade_type from billing.refunds r join billing.transactions t on t.id=r.transaction_id where r.id=$1",
          [input.refund.id],
        )
      ).rows[0];
      expect(row).toEqual({
        transfer_channel: "balance",
        bill_id: f.invoiceId,
        amount: "60.00",
        trade_type: "refund",
      });
    });
    it("uses locked refund values rather than caller amounts or status", async () => {
      const f = await fixture();
      await debit(f);
      const input = await request(f, "25.00");
      input.refund.amount = "999.00";
      await orders.executeRefund(input);
      expect(await wallet(f)).toEqual({
        balance: "65.00",
        total_consumed: "35.00",
      });
    });
    it("rejects over-refunds, wrong refund ownership and rejected audit", async () => {
      const f = await fixture();
      await debit(f);
      const input = await request(f, "61.00");
      await expect(orders.executeRefund(input)).rejects.toThrow(
        "原余额付款范围",
      );
      const other = await fixture();
      await debit(other);
      const wrong = await request(other);
      await expect(
        orders.executeRefund({ ...input, refund: wrong.refund }),
      ).rejects.toThrow("归属");
      await owner.query(
        "update billing.refunds set audit_status='rejected' where id=$1",
        [input.refund.id],
      );
      await expect(orders.executeRefund(input)).rejects.toThrow("已审核");
      expect((await wallet(f)).balance).toBe("40.00");
    });
    it("blocks historical balance receipts without a matching source debit", async () => {
      const f = await fixture();
      await owner.query(
        "insert into billing.payments(tenant_id,bill_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status,paid_at) values($1::uuid,$2,$3,'balance',60,60,'paid',now())",
        [f.tenantId, f.invoiceId, randomUUID()],
      );
      const input = await request(f);
      await expect(orders.executeRefund(input)).rejects.toThrow("来源无法核实");
      expect((await wallet(f)).balance).toBe("100.00");
    });
    it("cannot route a mixed balance and external payment to cash", async () => {
      const f = await fixture();
      await debit(f);
      await cash(f);
      const input = await request(f, "60.00", "cash");
      await expect(orders.executeRefund(input)).rejects.toThrow(
        "不能转为现金退款",
      );
      expect((await wallet(f)).balance).toBe("40.00");
      await owner.query(
        "update billing.refunds set refund_status='pending' where id=$1",
        [input.refund.id],
      );
      await expect(
        orders.markRefundTransferInitiated({
          ...input,
          channel: "alipay",
          reference: "blocked",
          transferDate: null,
          payoutAccountLabel: null,
          recipient: null,
          remark: null,
        }),
      ).rejects.toThrow("不能发起现金退款");
    });
    it("retains the external transfer processing requirement and cash ledger", async () => {
      const f = await fixture();
      await cash(f);
      const input = await request(f, "60.00", "cash");
      await owner.query(
        "update billing.refunds set refund_status='pending' where id=$1",
        [input.refund.id],
      );
      await expect(orders.executeRefund(input)).rejects.toThrow("可执行");
      await orders.markRefundTransferInitiated({
        ...input,
        channel: "bank_transfer",
        reference: "QA-transfer",
        transferDate: null,
        payoutAccountLabel: null,
        recipient: null,
        remark: null,
      });
      await orders.executeRefund(input);
      expect((await wallet(f)).balance).toBe("100.00");
      expect(
        (
          await owner.query(
            "select t.amount::text from billing.refunds r join billing.transactions t on t.id=r.transaction_id where r.id=$1",
            [input.refund.id],
          )
        ).rows[0].amount,
      ).toBe("-60.00");
    });
    it("restores the original principal and bonus without reviving expired bonus", async () => {
      const f = await fixture(false),
        invoice = randomUUID(),
        transaction = randomUUID(),
        payment = randomUUID();
      await owner.query(
        "insert into billing.invoices(id,tenant_id,bill_no,bill_cycle,cycle_start_date,cycle_end_date,total_amount,payable_amount,paid_amount,bill_status,bill_type,created_by_type) values($1::uuid,$2,$1::text,'202611',current_date,current_date+30,100,100,100,'paid','one_off','system')",
        [invoice, f.tenantId],
      );
      await owner.query(
        "insert into billing.transactions(id,tenant_id,bill_id,transaction_no,trade_type,source_method,amount,currency,balance_before,balance_after,trade_status,actor_type) values($1::uuid,$2,$3,$1::text,'recharge','offline',100,'CNY',0,0,'success','system')",
        [transaction, f.tenantId, invoice],
      );
      await owner.query(
        "insert into billing.payments(id,tenant_id,bill_id,transaction_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status,paid_at) values($1::uuid,$2,$3,$4,$1::text,'offline',100,100,'paid',now())",
        [payment, f.tenantId, invoice, transaction],
      );
      await ledger.post(f, {
        action: "principal",
        amountCents: 10000,
        paymentId: payment,
        idempotencyKey: randomUUID(),
      });
      await ledger.post(f, {
        action: "bonus",
        amountCents: 5000,
        expiresAt: new Date(Date.now() + 2000).toISOString(),
        idempotencyKey: randomUUID(),
      });
      await debit(f);
      const input = await request(f);
      await owner.query("select pg_sleep(2.1)");
      await orders.executeRefund(input);
      expect(await ledger.summary(f.tenantId)).toMatchObject({
        principalBalance: "100.00",
        bonusBalance: "0.00",
        availableBalance: "100.00",
      });
      expect((await wallet(f)).total_consumed).toBe("0.00");
      const result = (
        await owner.query(
          "select o.result from billing.refunds r join billing.wallet_operations o on o.transaction_id=r.transaction_id where r.id=$1",
          [input.refund.id],
        )
      ).rows[0].result;
      expect(result).toMatchObject({
        restoredAmount: "60.00",
        expiredAmount: "50.00",
        amount: "10.00",
      });
    });
    it("grants leftover from the persisted order once across actor retries", async () => {
      const f = await fixture();
      expect(await leftover(f)).toBe(true);
      const order = (await orders.getById(f.orderId))!;
      expect(
        await orders.grantLeftoverToPrepaid(
          { ...order, leftoverAmount: "999.00" },
          { actorType: "operator", actorId: randomUUID() },
        ),
      ).toBe(false);
      expect((await wallet(f)).balance).toBe("120.00");
      const summary = await ledger.summary(f.tenantId);
      expect(summary.principalBalance).toBe("0.00");
    });
    it("reclaims only the exact leftover source and preserves unrelated bonus", async () => {
      const f = await fixture();
      await cash(f);
      await leftover(f);
      const input = await request(f, "60.00", "cash");
      await orders.executeRefund(input);
      expect((await wallet(f)).balance).toBe("100.00");
    });
    it("rejects spent leftover and rolls back the entire refund", async () => {
      const f = await fixture(false);
      await cash(f);
      await leftover(f);
      await ledger.post(f, {
        action: "consume",
        amountCents: 100,
        idempotencyKey: randomUUID(),
      });
      await ledger.post(f, {
        action: "bonus",
        amountCents: 10000,
        idempotencyKey: randomUUID(),
      });
      const input = await request(f, "60.00", "cash");
      await expect(orders.executeRefund(input)).rejects.toThrow("剩余不足");
      expect((await wallet(f)).balance).toBe("119.00");
      expect((await orders.getRefundById(input.refund.id))!.refundStatus).toBe(
        "processing",
      );
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.transactions where tenant_id=$1 and trade_type='refund'",
            [f.tenantId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("rejects missing leftover evidence without a negative wallet adjustment", async () => {
      const f = await fixture();
      await cash(f);
      await owner.query(
        "update billing.orders set leftover_amount=20 where id=$1",
        [f.orderId],
      );
      const input = await request(f, "60.00", "cash");
      await expect(orders.executeRefund(input)).rejects.toThrow("折抵赠额来源");
      expect((await wallet(f)).balance).toBe("100.00");
    });
    it("rolls back restoration when a later wallet operation fails", async () => {
      const f = await fixture();
      await debit(f);
      await leftover(f);
      const input = await request(f);
      orders.setWalletSettlement({
        postInTransaction: async (client, context, command) => {
          if (command.action === "reclaim")
            throw new Error("injected reversal failure");
          return ledger.postInTransaction(client, context, command);
        },
      });
      try {
        await expect(orders.executeRefund(input)).rejects.toThrow("injected");
      } finally {
        orders.setWalletSettlement(ledger);
      }
      expect(await wallet(f)).toEqual({
        balance: "60.00",
        total_consumed: "60.00",
      });
      expect((await orders.getRefundById(input.refund.id))!.refundStatus).toBe(
        "pending",
      );
    });
    it("wires Admin order mutations through the real composition factory", () => {
      const spy = vi.spyOn(OrderService.prototype, "setWalletSettlement");
      try {
        const service = (
          orderServiceProvider as FactoryProvider<OrderService>
        ).useFactory(runtime, {}, {});
        expect(service).toBeInstanceOf(OrderService);
        expect(spy).toHaveBeenCalledExactlyOnceWith(expect.any(PgWalletLedger));
      } finally {
        spy.mockRestore();
      }
    });
  },
);
