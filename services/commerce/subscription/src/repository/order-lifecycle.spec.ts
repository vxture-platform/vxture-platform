/**
 * Only the same lifecycle cancellation may be replayed.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { PgOrderRepository } from "./pg-order.repository";

// ============================================================================
// Account deletion retries do not authorize ordinary order cancellation replays
// ============================================================================
function build(matched = true) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => ({
    rows: sql.includes("select * from billing.orders")
      ? [{ id: "order", status: "cancelled" }]
      : sql.includes("billing.order_events") && matched
        ? [{ ok: 1 }]
        : [],
    rowCount: 1,
  }));
  const release = vi.fn();
  return {
    query,
    release,
    repo: new PgOrderRepository({
      connect: async () => ({ query, release }),
    } as never),
  };
}
describe("lifecycle order cancellation retry", () => {
  it("returns the already cancelled order only for the matching customer and request", async () => {
    const f = build();
    expect(
      await f.repo.cancelOrder(
        "order",
        { actorType: "customer", actorId: "user" },
        "cancelled",
        "op",
      ),
    ).toMatchObject({ id: "order", status: "cancelled" });
    expect(f.query.mock.calls[2]![1]).toEqual([
      "order",
      "user",
      "account_deletion:op",
    ]);
    expect(f.query.mock.calls[2]![0]).toContain("actor_type='customer'");
    expect(f.query.mock.calls.at(-1)![0]).toBe("commit");
  });
  it("rejects an unrelated prior cancellation", async () => {
    const f = build(false);
    await expect(
      f.repo.cancelOrder(
        "order",
        { actorType: "customer", actorId: "user" },
        "cancelled",
        "other-op",
      ),
    ).rejects.toThrow();
    expect(f.query.mock.calls.at(-1)![0]).toBe("rollback");
  });
  it("does not change ordinary cancellation behavior", async () => {
    const f = build();
    await expect(
      f.repo.cancelOrder(
        "order",
        { actorType: "customer", actorId: "user" },
        "cancelled",
      ),
    ).rejects.toThrow();
    expect(
      f.query.mock.calls.some(([s]) => s.includes("billing.order_events")),
    ).toBe(false);
  });
  it("never grants the lifecycle replay exception to a workforce actor", async () => {
    const f = build();
    await expect(
      f.repo.cancelOrder(
        "order",
        { actorType: "operator", actorId: "operator" },
        "cancelled",
        "op",
      ),
    ).rejects.toThrow();
    expect(f.release).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Opt-in PostgreSQL verification against a dedicated, empty QA database
// ============================================================================
describe.skipIf(process.env.BALANCE_PG_INTEGRATION !== "1")(
  "wallet PostgreSQL transactions",
  () => {
    let pool: import("pg").Pool;
    let subRepo: import("./pg-subscription.repository").PgSubscriptionRepository;
    let ownedSchema = false;
    beforeAll(async () => {
      if (!process.env.PGDATABASE?.startsWith("checkout_balance_qa_"))
        throw new Error("Dedicated checkout QA database required");
      const { Pool } = await import("pg");
      const { readFile } = await import("node:fs/promises");
      const { PgSubscriptionRepository } =
        await import("./pg-subscription.repository");
      pool = new Pool();
      await pool.query("create schema billing");
      ownedSchema = true;
      const ddl = await readFile(
        new URL(
          "../../../../../deploy/database/ddl/52_billing.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await pool.query(
        ddl.replace(
          "('online','offline','voucher','balance')",
          "('online','offline','voucher')",
        ),
      );
      const migration = await readFile(
        new URL(
          "../../../../../deploy/database/migrations/2026-11-11-balance-order-payment.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await pool.query(migration);
      await pool.query(migration);
      subRepo = new PgSubscriptionRepository(pool);
    });
    afterAll(async () => {
      if (ownedSchema) await pool.query("drop schema billing cascade");
      await pool?.end();
    });
    async function fixture(tenantId?: string) {
      const { randomUUID } = await import("node:crypto");
      const tenant = tenantId ?? randomUUID();
      const actor = randomUUID();
      if (!tenantId)
        await pool.query(
          "insert into billing.credits(tenant_id,balance,currency) values($1,100,'CNY')",
          [tenant],
        );
      const order = await pool.query(
        "insert into billing.orders(order_no,tenant_id,workspace_id,product_id,plan_version_id,intent,cycle_unit,list_amount,payable_amount,created_by_type) values($1,$2,$3,$4,$5,'new','month',100,100,'customer') returning id",
        [randomUUID(), tenant, randomUUID(), randomUUID(), randomUUID()],
      );
      const invoice = await pool.query(
        "insert into billing.invoices(tenant_id,order_id,bill_no,bill_cycle,cycle_start_date,cycle_end_date,total_amount,payable_amount,created_by_type) values($1,$2,$3,'202611',current_date,current_date+30,100,100,'customer') returning id",
        [tenant, order.rows[0].id, randomUUID()],
      );
      return {
        tenantId: tenant,
        orderId: order.rows[0].id as string,
        invoiceId: invoice.rows[0].id as string,
        actorId: actor,
        currency: "CNY",
        amountYuan: "60.00",
      };
    }
    async function debit(
      f: Awaited<ReturnType<typeof fixture>>,
      failAfterDebit = false,
    ) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await subRepo.settleBalanceTx(client, f);
        if (failAfterDebit) throw new Error("simulated downstream error");
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
    it("serializes competing orders and never overdraws the same wallet", async () => {
      const a = await fixture();
      const b = await fixture(a.tenantId);
      const outcomes = await Promise.allSettled([debit(a), debit(b)]);
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      const wallet = await pool.query(
        "select balance::text,total_consumed::text from billing.credits where tenant_id=$1",
        [a.tenantId],
      );
      expect(wallet.rows[0]).toEqual({
        balance: "40.00",
        total_consumed: "60.00",
      });
      const ledger = await pool.query(
        "select amount::text,balance_before::text,balance_after::text from billing.transactions where tenant_id=$1",
        [a.tenantId],
      );
      expect(ledger.rows).toEqual([
        { amount: "-60.00", balance_before: "100.00", balance_after: "40.00" },
      ]);
    });
    it("rolls back wallet, ledger, payment and invoice if a later step fails", async () => {
      const f = await fixture();
      await expect(debit(f, true)).rejects.toThrow("downstream");
      expect(
        (
          await pool.query(
            "select balance::text from billing.credits where tenant_id=$1",
            [f.tenantId],
          )
        ).rows[0].balance,
      ).toBe("100.00");
      expect(
        (
          await pool.query(
            "select count(*)::int as n from billing.payments where tenant_id=$1",
            [f.tenantId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "select count(*)::int as n from billing.transactions where tenant_id=$1",
            [f.tenantId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "select paid_amount::text from billing.invoices where id=$1",
            [f.invoiceId],
          )
        ).rows[0].paid_amount,
      ).toBe("0.00");
    });
    it("rejects currency mismatches without moving funds", async () => {
      const f = await fixture();
      await expect(debit({ ...f, currency: "USD" })).rejects.toThrow("币种");
      expect(
        (
          await pool.query(
            "select balance::text from billing.credits where tenant_id=$1",
            [f.tenantId],
          )
        ).rows[0].balance,
      ).toBe("100.00");
    });
    it("uses the order lock to make concurrent duplicate settlement idempotent", async () => {
      const f = await fixture();
      const orders = new PgOrderRepository(pool);
      const pay = () =>
        orders.withOrderTx(f.orderId, async ({ client, invoice }) => {
          if (invoice?.billStatus === "paid") return "already_paid";
          await subRepo.settleBalanceTx(client, f);
          await subRepo.settleInvoiceByVouchersTx(client, {
            ...f,
            voucherLegYuan: "40.00",
          });
          await orders.markPaidTx(client, f.orderId);
          return "paid";
        });
      expect((await Promise.all([pay(), pay()])).sort()).toEqual([
        "already_paid",
        "paid",
      ]);
      expect(
        (
          await pool.query(
            "select balance::text from billing.credits where tenant_id=$1",
            [f.tenantId],
          )
        ).rows[0].balance,
      ).toBe("40.00");
      expect(
        (
          await pool.query(
            "select paid_amount::text,payment_method from billing.invoices where id=$1",
            [f.invoiceId],
          )
        ).rows[0],
      ).toEqual({ paid_amount: "100.00", payment_method: "balance" });
    });

    it("returns only the wallet-paid leg and cannot credit it twice", async () => {
      const f = await fixture();
      await debit(f);
      const orders = new PgOrderRepository(pool);
      const { randomUUID } = await import("node:crypto");
      await pool.query(
        "update billing.orders set status='fulfilled',fulfilled_at=now(),subscription_id=$2 where id=$1",
        [f.orderId, randomUUID()],
      );
      const pay = await pool.query(
        "select id from billing.payments where bill_id=$1",
        [f.invoiceId],
      );
      const result = await pool.query(
        "insert into billing.refunds(tenant_id,bill_id,pay_record_id,order_id,refund_no,refund_amount,audit_status,created_by_type,created_by_id) values($1,$2,$3,$4,$5,60,'approved','customer',$6) returning id",
        [
          f.tenantId,
          f.invoiceId,
          pay.rows[0].id,
          f.orderId,
          randomUUID(),
          f.actorId,
        ],
      );
      const refund = (await orders.getRefundById(result.rows[0].id))!;
      const order = (await orders.getById(f.orderId))!;
      const input = {
        refund,
        order,
        actor: { actorType: "operator" as const, actorId: f.actorId },
      };
      const returned = await orders.executeRefund(input);
      expect(returned.refund).toMatchObject({
        refundStatus: "success",
        transferChannel: "balance",
      });
      expect(returned.refund.transferInitiatedAt).not.toBeNull();
      await expect(orders.executeRefund(input)).rejects.toThrow();
      expect(
        (
          await pool.query(
            "select balance::text,total_consumed::text from billing.credits where tenant_id=$1",
            [f.tenantId],
          )
        ).rows[0],
      ).toEqual({ balance: "100.00", total_consumed: "0.00" });
      expect(
        (
          await pool.query(
            "select amount::text,balance_before::text,balance_after::text from billing.transactions where tenant_id=$1 and trade_type='refund'",
            [f.tenantId],
          )
        ).rows,
      ).toEqual([
        { amount: "60.00", balance_before: "40.00", balance_after: "100.00" },
      ]);
    });
    it("rejects a refund exceeding the original wallet debit", async () => {
      const f = await fixture();
      await debit(f);
      const orders = new PgOrderRepository(pool);
      const { randomUUID } = await import("node:crypto");
      await pool.query(
        "update billing.orders set status='fulfilled',fulfilled_at=now(),subscription_id=$2 where id=$1",
        [f.orderId, randomUUID()],
      );
      const order = (await orders.getById(f.orderId))!;
      await expect(
        orders.executeRefund({
          order,
          actor: { actorType: "operator", actorId: f.actorId },
          refund: {
            id: randomUUID(),
            amount: "100.00",
            currency: "CNY",
          } as never,
        }),
      ).rejects.toThrow("原余额付款范围");
      expect(
        (
          await pool.query(
            "select balance::text from billing.credits where tenant_id=$1",
            [f.tenantId],
          )
        ).rows[0].balance,
      ).toBe("40.00");
    });

    it("honors the payment rejection deadline anchor", async () => {
      const f = await fixture();
      const orders = new PgOrderRepository(pool);
      await pool.query(
        "update billing.orders set created_at=now()-interval '2 hours',payment_ttl_minutes=30 where id=$1",
        [f.orderId],
      );
      const order = (await orders.getById(f.orderId))!;
      const client = await pool.connect();
      try {
        expect(await orders.isPaymentExpiredTx(client, order)).toBe(true);
        await pool.query(
          "insert into billing.order_events(order_id,event_type,actor_type) values($1,'payment_rejected','system')",
          [f.orderId],
        );
        expect(await orders.isPaymentExpiredTx(client, order)).toBe(false);
      } finally {
        client.release();
      }
    });
    it("does not mix a prior external payment with a new wallet debit", async () => {
      const f = await fixture();
      await pool.query(
        "insert into billing.payments(tenant_id,bill_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status) values($1,$2,$3,'offline',40,40,'paid')",
        [f.tenantId, f.invoiceId, f.orderId],
      );
      await expect(debit(f)).rejects.toThrow("已有外部付款");
      expect(
        (
          await pool.query(
            "select balance::text from billing.credits where tenant_id=$1",
            [f.tenantId],
          )
        ).rows[0].balance,
      ).toBe("100.00");
    });
  },
);
