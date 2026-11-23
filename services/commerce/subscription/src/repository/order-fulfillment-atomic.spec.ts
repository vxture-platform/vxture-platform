/**
 * order-fulfillment-atomic.spec.ts - Order fulfillment and required outbox atomicity.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-23
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  PgProvisioningRepository,
  ProvisioningService,
} from "@vxture/service-provisioning";
import { PgOrderRepository } from "./pg-order.repository";
import { PgSubscriptionRepository } from "./pg-subscription.repository";
import { OrderService } from "../service/order.service";
import { SubscriptionService } from "../service/subscription.service";
import type { OrderIntent } from "../types/order.types";
import type { WalletSettlementPort } from "../types/wallet-settlement.types";

// ============================================================================
// Real services/repositories over a strict transaction double. This does not
// establish PostgreSQL syntax, permissions, concurrent locks or crash recovery.
// ============================================================================
const now = new Date("2026-11-23T08:00:00Z");
const actor = { actorType: "customer" as const, actorId: "user-1" };
function subscriptionRow() {
  return {
    id: "sub-1",
    tenant_id: "tenant-1",
    workspace_id: "ws-1",
    product_id: "p1",
    plan_version_id: "pv-1",
    status: "active",
    cycle_unit: "year",
    cycle_count: 1,
    start_at: new Date("2026-01-01T00:00:00Z"),
    end_at: new Date("2027-01-01T00:00:00Z") as Date | null,
    trial_end_at: null,
    subscription_kind: "paid",
    activation_method: "online_purchase",
    auto_renew: false,
    pay_amount: "1.00",
    paid_amount: "1.00",
    currency: "CNY",
    created_by_id: "user-1",
    created_at: now,
    updated_at: now,
    deleted_at: null,
    current_order_id: "old-order" as string | null,
  };
}
function orderRow(intent: OrderIntent) {
  return {
    id: "order-1",
    order_no: "ORD-TEST-1",
    tenant_id: "tenant-1",
    workspace_id: "ws-1",
    product_id: "p1",
    plan_version_id: intent === "upgrade" ? "pv-2" : "pv-1",
    intent,
    cycle_unit: "year",
    cycle_count: 1,
    from_subscription_id: intent === "new" ? null : "sub-1",
    subscription_id: null as string | null,
    list_amount: "1.00",
    credit_amount: "0.00",
    payable_amount: "1.00",
    leftover_amount: intent === "upgrade" ? "0.25" : "0.00",
    currency: "CNY",
    proration: null,
    status: "paid",
    payment_ttl_minutes: 30,
    auto_renew: false,
    declared_at: null,
    paid_at: now,
    fulfilled_at: null as Date | null,
    closed_at: null,
    close_reason: null,
    created_by_type: "customer",
    created_by_id: "user-1",
    operator_remark: null,
    created_at: now,
    updated_at: now,
  };
}
type State = {
  order: ReturnType<typeof orderRow>;
  subscription: ReturnType<typeof subscriptionRow> | null;
  quotaUsed: number;
  resets: number;
  anchors: number;
  materialized: number;
  histories: unknown[][];
  events: unknown[][];
  deliveries: string[];
  provisioning: number;
  bonusCents: number;
};
function build(intent: OrderIntent) {
  let committed: State = {
    order: orderRow(intent),
    subscription: intent === "new" ? null : subscriptionRow(),
    quotaUsed: 7,
    resets: 0,
    anchors: 0,
    materialized: 0,
    histories: [],
    events: [],
    deliveries: [],
    provisioning: 0,
    bonusCents: 0,
  };
  let pending: State | null = null;
  let prior: State | null = null;
  const commands: string[] = [];
  const faults = {
    sql: "",
    delivery: 0,
    wallet: false,
    cas: false,
    registered: true,
    conflict: false,
    legacy: false,
  };
  const copyRows = (rows: unknown[]) => ({ rows: structuredClone(rows) });
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
    commands.push(sql);
    if (faults.sql && sql.includes(faults.sql))
      throw new Error("injected SQL failure");
    if (sql === "begin") {
      if (pending) throw new Error("nested transaction");
      prior = structuredClone(committed);
      pending = structuredClone(committed);
      return copyRows([]);
    }
    if (!pending) throw new Error("query outside transaction");
    if (sql === "rollback") {
      pending = null;
      return copyRows([]);
    }
    if (sql === "commit") {
      committed = pending;
      pending = null;
      return copyRows([]);
    }
    const state = pending,
      row = state.subscription;
    if (sql.startsWith("select * from billing.orders")) {
      expect(values[0]).toBe(state.order.id);
      return copyRows([state.order]);
    }
    if (sql.startsWith("select id, bill_no, bill_status")) {
      expect(sql).toContain("for update");
      return copyRows([
        {
          id: "invoice-1",
          bill_no: "INV-TEST-1",
          bill_status: "paid",
          total_amount: "1.00",
          payable_amount: "1.00",
          paid_amount: "0.80",
          currency: "CNY",
        },
      ]);
    }
    if (
      sql === "select id from tenancy.workspaces where id=$1 for no key update"
    ) {
      expect(values).toEqual([state.order.workspace_id]);
      return copyRows([{ id: values[0] }]);
    }
    if (sql.startsWith("select * from metering.subscriptions")) {
      expect(values[0]).toBe("sub-1");
      return copyRows(row ? [row] : []);
    }
    if (sql.startsWith("select s.* from metering.subscriptions")) {
      expect(sql).toContain("for update of s");
      expect(sql).toContain("s.current_order_id is null");
      expect(values).toEqual([
        state.order.workspace_id,
        state.order.plan_version_id,
      ]);
      return copyRows(
        row?.current_order_id === null &&
          ["active", "trialing", "expiring", "overdue"].includes(row.status)
          ? [row]
          : [],
      );
    }
    if (sql.startsWith("select s.status from metering.subscriptions")) {
      expect(values[2]).toBeNull();
      return copyRows(
        row &&
          ["active", "trialing", "expiring", "overdue", "suspended"].includes(
            row.status,
          )
          ? [{ status: row.status }]
          : [],
      );
    }
    if (sql.startsWith("select (pv_from.plan_id = pv_to.plan_id)")) {
      return copyRows([
        {
          same_plan: values[1] === "pv-1" || values[1] === "pv-1b",
          same_product: true,
          to_is_current: true,
          to_plan_status: "active",
          to_plan_code: "pro",
          from_tier: "starter",
          to_tier: "pro",
        },
      ]);
    }
    if (sql.startsWith("select distinct prod.product_code"))
      return copyRows(
        faults.conflict
          ? [{ product_code: "p1", new_tier: "pro", existing_tier: "starter" }]
          : [],
      );
    if (sql.startsWith("insert into metering.subscriptions")) {
      if (row) throw new Error("unexpected second subscription");
      state.subscription = {
        ...subscriptionRow(),
        tenant_id: String(values[0]),
        workspace_id: String(values[1]),
        plan_version_id: String(values[2]),
        subscription_kind: String(values[3]),
        cycle_unit: String(values[4]),
        cycle_count: Number(values[5]),
        start_at: values[6] as Date,
        end_at: values[7] as Date | null,
        status: String(values[9]),
        activation_method: String(values[10]),
        auto_renew: Boolean(values[11]),
        pay_amount: String(values[12]),
        currency: String(values[13]),
        current_order_id: null,
      };
      return copyRows([state.subscription]);
    }
    if (sql.startsWith("update metering.subscriptions set status")) {
      if (!row || (values[5] !== null && values[5] !== row.status))
        return copyRows([]);
      row.status = (values[1] as string | null) ?? row.status;
      row.end_at = (values[2] as Date | null) ?? row.end_at;
      row.auto_renew = (values[3] as boolean | null) ?? row.auto_renew;
      row.plan_version_id = (values[4] as string | null) ?? row.plan_version_id;
      return copyRows([row]);
    }
    if (sql.startsWith("update metering.subscriptions set cycle_unit")) {
      if (!row) throw new Error("terms target missing");
      expect(values[0]).toBe(row.id);
      row.cycle_unit = String(values[1]);
      row.cycle_count = Number(values[2]);
      row.pay_amount = row.paid_amount = String(values[3]);
      row.current_order_id = String(values[4]);
      if (sql.includes("start_at = now()")) {
        row.start_at = now;
        row.end_at = new Date("2027-11-23T08:00:00Z");
      }
      return copyRows([]);
    }
    if (sql.startsWith("update metering.subscriptions set paid_amount")) {
      if (!row) throw new Error("terms target missing");
      row.paid_amount = String(values[1]);
      row.current_order_id = String(values[2]);
      return copyRows([]);
    }
    if (sql.startsWith("insert into metering.subscription_histories")) {
      state.histories.push(values);
      return copyRows([]);
    }
    if (sql.startsWith("insert into metering.quota_pools")) {
      state.materialized++;
      state.quotaUsed = 0;
      return copyRows([]);
    }
    if (sql.startsWith("insert into metering.resource_sharing_policies"))
      return copyRows([]);
    if (sql.startsWith("update metering.quota_pools set status = 'retired'"))
      return copyRows([]);
    if (sql.startsWith("insert into metering.quota_pool_resets")) {
      if (state.quotaUsed > 0) state.resets++;
      return copyRows([]);
    }
    if (sql.startsWith("update metering.quota_pools set quota_used = 0")) {
      state.quotaUsed = 0;
      return copyRows([]);
    }
    if (sql.startsWith("update metering.quota_pools set period_anchor")) {
      state.anchors++;
      return copyRows([]);
    }
    if (sql.startsWith("select pc.product_id"))
      return copyRows([
        { product_id: "p1", product_code: "test", plan_code: "pro" },
      ]);
    if (sql.startsWith("select exists")) return copyRows([{ exists: false }]);
    if (sql.startsWith("insert into provisioning.provisionings")) {
      state.provisioning++;
      return copyRows([{ id: "provisioning-1", version: state.provisioning }]);
    }
    if (sql.startsWith("insert into provisioning.webhook_deliveries")) {
      const generic = sql.includes("where exists");
      if (generic && !faults.registered) return copyRows([]);
      if (state.deliveries.length + 1 === faults.delivery)
        throw new Error("outbox unavailable");
      expect(committed).toEqual(prior);
      state.deliveries.push(String(values[generic ? 5 : 7]));
      return copyRows([{ id: "delivery-1" }]);
    }
    if (sql.startsWith("select l.amount::text from billing.wallet_operations"))
      return copyRows(
        state.bonusCents
          ? [{ amount: (state.bonusCents / 100).toFixed(2) }]
          : [],
      );
    if (sql.startsWith("select id from billing.transactions"))
      return copyRows(faults.legacy ? [{ id: "legacy" }] : []);
    if (sql.startsWith("update billing.orders set status = 'fulfilled'")) {
      expect(sql).toContain("status = 'paid'");
      if (faults.cas || state.order.status !== "paid") return copyRows([]);
      state.order.status = "fulfilled";
      state.order.subscription_id = String(values[1]);
      state.order.fulfilled_at = now;
      return copyRows([{ id: state.order.id }]);
    }
    if (sql.startsWith("insert into billing.order_events")) {
      state.events.push(values);
      return copyRows([]);
    }
    throw new Error("unexpected SQL: " + sql);
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(async (text: string) => {
      if (pending)
        throw new Error("pool query while fulfillment transaction open");
      const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (sql.startsWith("select pl.plan_name"))
        return copyRows([{ product_name: "Test", plan_name: "Pro" }]);
      if (sql.startsWith("select coalesce(sum(p.paid_amount)"))
        return copyRows([{ amount: "0.80" }]);
      throw new Error("pool query escaped transaction: " + sql);
    }),
  };
  const orderRepo = new PgOrderRepository(pool as unknown as Pool);
  const subRepo = new PgSubscriptionRepository(pool as unknown as Pool);
  const provisioning = new ProvisioningService(
    new PgProvisioningRepository(pool as unknown as Pool),
    {
      maxAttempts: 3,
      backoffBaseSec: 1,
      backoffCapSec: 10,
      leaseSeconds: 30,
      batchSize: 5,
      timeoutMs: 1000,
    },
    { resolve: () => null },
    { deliveryFailed: vi.fn() },
  );
  const subscriptions = new SubscriptionService(subRepo, provisioning);
  const service = new OrderService(
    orderRepo,
    {} as never,
    subscriptions,
    {} as never,
  );
  const notify = vi.fn(async () => {
    expect(pending).toBeNull();
    expect(committed.order.status).toBe("fulfilled");
    expect(commands.at(-1)).toBe("commit");
  });
  service.setCustomerNotifier({ notify });
  const post: WalletSettlementPort["postInTransaction"] = vi.fn(
    async (transaction, context, command) => {
      expect(transaction).toBe(client);
      expect(context.tenantId).toBe("tenant-1");
      expect(command).toEqual({
        action: "bonus",
        amountCents: 25,
        idempotencyKey: "order-leftover:order-1",
      });
      if (!pending) throw new Error("wallet escaped transaction");
      pending.bonusCents += 25;
      if (faults.wallet) throw new Error("wallet unavailable");
      return { operationId: "op-1", transactionId: "txn-1", lotId: "lot-1" };
    },
  );
  orderRepo.setWalletSettlement({ postInTransaction: post });
  return {
    service,
    orderRepo,
    subRepo,
    subscriptions,
    provisioning,
    client,
    pool,
    commands,
    faults,
    notify,
    post,
    state: () => committed,
    mutate: (fn: (s: State) => void) => fn(committed),
  };
}

// ============================================================================
// Full fulfillment: rollback every pending effect, then retry exactly once.
// ============================================================================
describe.each(["new", "renew", "upgrade"] as const)(
  "atomic %s order fulfillment",
  (intent) => {
    it("commits business state, quota, event and required outbox before customer messaging", async () => {
      const h = build(intent);
      const result = await h.service.fulfill("order-1", actor);
      expect(result.order.status).toBe("fulfilled");
      expect(result.subscription.id).toBe("sub-1");
      expect(h.state().subscription?.current_order_id).toBe("order-1");
      expect(h.state().subscription?.paid_amount).toBe("1.00");
      expect(h.state().events).toHaveLength(1);
      expect(h.state().deliveries.length).toBeGreaterThan(0);
      expect(h.state().bonusCents).toBe(intent === "upgrade" ? 25 : 0);
      expect(h.commands.filter((c) => c === "begin")).toHaveLength(1);
      expect(h.commands.filter((c) => c === "commit")).toHaveLength(1);
      expect(
        h.commands.findIndex((c) => c.includes("for no key update")),
      ).toBeLessThan(
        h.commands.findIndex((c) => c.includes("metering.subscriptions")),
      );
      expect(h.pool.connect).toHaveBeenCalledOnce();
      expect(h.client.release).toHaveBeenCalledOnce();
      expect(h.notify).toHaveBeenCalledOnce();
      expect(h.pool.query).toHaveBeenCalledTimes(2);
    });
    for (const failure of [
      "terms",
      "history",
      "outbox",
      "status",
      "event",
      "commit",
    ] as const) {
      it(`rolls back ${failure} failure and retries without duplicating service or money`, async () => {
        const h = build(intent),
          before = structuredClone(h.state());
        if (failure === "outbox") h.faults.delivery = 1;
        else
          h.faults.sql = {
            terms:
              intent === "new" ? "set paid_amount = $2" : "set cycle_unit = $2",
            history: "insert into metering.subscription_histories",
            status: "update billing.orders set status = 'fulfilled'",
            event: "insert into billing.order_events",
            commit: "commit",
          }[failure];
        await expect(h.service.fulfill("order-1", actor)).rejects.toThrow();
        expect(h.state()).toEqual(before);
        expect(h.commands.at(-1)).toBe("rollback");
        expect(h.notify).not.toHaveBeenCalled();
        expect(h.pool.query).not.toHaveBeenCalled();
        h.faults.sql = "";
        h.faults.delivery = 0;
        await h.service.fulfill("order-1", actor);
        const after = structuredClone(h.state());
        expect(after.order.status).toBe("fulfilled");
        expect(after.events).toHaveLength(1);
        expect(after.bonusCents).toBe(intent === "upgrade" ? 25 : 0);
        if (intent === "renew") {
          expect(after.subscription?.end_at).toEqual(
            new Date("2028-01-01T00:00:00Z"),
          );
          expect(after.resets).toBe(1);
          expect(after.anchors).toBe(0);
        }
        if (intent === "new") expect(after.materialized).toBe(1);
        await h.service.fulfill("order-1", actor);
        expect(h.state()).toEqual(after);
        expect(h.notify).toHaveBeenCalledOnce();
        expect(h.client.release).toHaveBeenCalledTimes(3);
      });
    }
    it("rolls every effect back when the paid-to-fulfilled CAS does not land", async () => {
      const h = build(intent),
        before = structuredClone(h.state());
      h.faults.cas = true;
      await expect(h.service.fulfill("order-1", actor)).rejects.toThrow(
        /履约未落地/,
      );
      expect(h.state()).toEqual(before);
      expect(h.notify).not.toHaveBeenCalled();
    });
    it("keeps committed fulfillment when optional customer messaging fails", async () => {
      const h = build(intent);
      h.notify.mockRejectedValueOnce(new Error("customer channel unavailable"));
      await expect(h.service.fulfill("order-1", actor)).resolves.toMatchObject({
        order: { status: "fulfilled" },
      });
      expect(h.state().events).toHaveLength(1);
      expect(h.commands.at(-1)).toBe("commit");
    });
  },
);

describe("fulfillment edge and legacy transaction ownership", () => {
  it("rolls back a posted noncash leftover when its wallet port fails", async () => {
    const h = build("upgrade"),
      before = structuredClone(h.state());
    h.faults.wallet = true;
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow(
      "wallet unavailable",
    );
    expect(h.state()).toEqual(before);
    h.faults.wallet = false;
    await h.service.fulfill("order-1", actor);
    expect(h.state().bonusCents).toBe(25);
  });
  it("rejects unknown historic leftover funding without duplicating a legacy grant", async () => {
    const h = build("upgrade"),
      before = structuredClone(h.state());
    h.faults.legacy = true;
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow(
      /历史折抵/,
    );
    expect(h.state()).toEqual(before);
    expect(h.post).not.toHaveBeenCalled();
  });
  it("adopts a locked historical orphan without creating another subscription", async () => {
    const h = build("new");
    h.mutate((s) => {
      s.subscription = { ...subscriptionRow(), current_order_id: null };
    });
    await h.service.fulfill("order-1", actor);
    expect(h.state().subscription?.current_order_id).toBe("order-1");
    expect(h.state().materialized).toBe(0);
    expect(h.state().histories).toHaveLength(0);
    expect(h.commands.some((c) => c.includes("for update of s"))).toBe(true);
  });
  it("retains a historical orphan unchanged if its later order event fails", async () => {
    const h = build("new");
    h.mutate((s) => {
      s.subscription = { ...subscriptionRow(), current_order_id: null };
    });
    const before = structuredClone(h.state());
    h.faults.sql = "insert into billing.order_events";
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow();
    expect(h.state()).toEqual(before);
  });
  it("replays an already fulfilled order without lifecycle writes, settlement reload or customer message", async () => {
    const h = build("renew");
    h.mutate((s) => {
      s.order.status = "fulfilled";
      s.order.subscription_id = "sub-1";
    });
    const before = structuredClone(h.state());
    await h.service.fulfill("order-1", actor);
    expect(h.state()).toEqual(before);
    expect(h.pool.query).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
    expect(
      h.commands.some(
        (c) => c.startsWith("update ") || c.startsWith("insert "),
      ),
    ).toBe(false);
  });
  it("keeps same-version renewal and auto-renew changes in the order transaction", async () => {
    const h = build("renew");
    h.mutate((s) => {
      s.order.auto_renew = true;
    });
    await h.service.fulfill("order-1", actor);
    expect(h.state().subscription?.auto_renew).toBe(true);
    expect(h.state().histories).toHaveLength(2);
    expect(h.state().deliveries).toHaveLength(2);
    expect(h.pool.connect).toHaveBeenCalledOnce();
  });
  it("rolls back terms and expiry when the later auto-renew notification fails", async () => {
    const h = build("renew");
    h.mutate((s) => {
      s.order.auto_renew = true;
    });
    const before = structuredClone(h.state());
    h.faults.delivery = 2;
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow(
      "outbox unavailable",
    );
    expect(h.state()).toEqual(before);
  });
  it("reanchors a revived expired renewal once, while a live renewal keeps its anchor", async () => {
    const h = build("renew");
    h.mutate((s) => {
      s.subscription!.status = "expired";
      s.subscription!.end_at = new Date("2020-01-01T00:00:00Z");
    });
    await h.service.fulfill("order-1", actor);
    expect(h.state().anchors).toBe(1);
    expect(h.state().resets).toBe(1);
    await h.service.fulfill("order-1", actor);
    expect(h.state().anchors).toBe(1);
  });
  it("continues same-version renewal without a generic queue entry for an unregistered product", async () => {
    const h = build("renew");
    h.faults.registered = false;
    await h.service.fulfill("order-1", actor);
    expect(h.state().order.status).toBe("fulfilled");
    expect(h.state().deliveries).toHaveLength(0);
  });
  it.each(["tenant", "workspace", "suspended"])(
    "rejects stale %s source under the order transaction",
    async (kind) => {
      const h = build("renew");
      h.mutate((s) => {
        if (kind === "tenant") s.subscription!.tenant_id = "other";
        else if (kind === "workspace") s.subscription!.workspace_id = "other";
        else s.subscription!.status = "suspended";
      });
      const before = structuredClone(h.state());
      await expect(h.service.fulfill("order-1", actor)).rejects.toThrow();
      expect(h.state()).toEqual(before);
      expect(h.commands.some((c) => c.includes("limit 1 for update"))).toBe(
        true,
      );
    },
  );
  it("rejects an unpaid order before acquiring a workspace or changing a subscription", async () => {
    const h = build("new");
    h.mutate((s) => {
      s.order.status = "pending_verify";
    });
    const before = structuredClone(h.state());
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow(/未收款/);
    expect(h.state()).toEqual(before);
    expect(h.commands.some((c) => c.includes("for no key update"))).toBe(false);
  });
  it("does not adopt an ordinary claimed subscription as an orphan", async () => {
    const h = build("new");
    h.mutate((s) => {
      s.subscription = subscriptionRow();
    });
    const before = structuredClone(h.state());
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow();
    expect(h.state()).toEqual(before);
  });
  it("rejects conflicting tiers before creating a new subscription", async () => {
    const h = build("new"),
      before = structuredClone(h.state());
    h.faults.conflict = true;
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow();
    expect(h.state()).toEqual(before);
  });
  it.each(["terms", "mark", "leftover"])(
    "retains legacy %s repository transaction ownership",
    async (operation) => {
      const h = build("upgrade");
      const order = await h.orderRepo.withOrderTx(
        "order-1",
        async ({ order }) => order,
      );
      h.commands.length = 0;
      h.pool.connect.mockClear();
      vi.mocked(h.client.release).mockClear();
      if (operation === "terms")
        await h.orderRepo.applySubscriptionTerms("sub-1", {
          mode: "renew",
          cycleUnit: "year",
          cycleCount: 1,
          payAmount: "1.00",
          orderId: "order-1",
        });
      else if (operation === "mark")
        await h.orderRepo.markFulfilled("order-1", "sub-1", actor);
      else await h.orderRepo.grantLeftoverToPrepaid(order, actor);
      expect(h.commands[0]).toBe("begin");
      expect(h.commands.at(-1)).toBe("commit");
      expect(h.pool.connect).toHaveBeenCalledOnce();
      expect(h.client.release).toHaveBeenCalledOnce();
    },
  );
  it.each(["terms", "mark", "leftover"])(
    "retains legacy %s rollback and release on failure",
    async (operation) => {
      const h = build("upgrade");
      const order = await h.orderRepo.withOrderTx(
        "order-1",
        async ({ order }) => order,
      );
      h.commands.length = 0;
      h.faults.sql =
        operation === "terms"
          ? "set cycle_unit = $2"
          : operation === "mark"
            ? "insert into billing.order_events"
            : "select id from billing.transactions";
      const work =
        operation === "terms"
          ? h.orderRepo.applySubscriptionTerms("sub-1", {
              mode: "renew",
              cycleUnit: "year",
              cycleCount: 1,
              payAmount: "1.00",
              orderId: "order-1",
            })
          : operation === "mark"
            ? h.orderRepo.markFulfilled("order-1", "sub-1", actor)
            : h.orderRepo.grantLeftoverToPrepaid(order, actor);
      const before = structuredClone(h.state());
      await expect(work).rejects.toThrow();
      expect(h.state()).toEqual(before);
      expect(h.commands.at(-1)).toBe("rollback");
      expect(h.client.release).toHaveBeenCalledTimes(2);
    },
  );
});

// ============================================================================
// Same-version terms, prior sources and caller-owned early-return boundaries.
// ============================================================================
describe("order terms and source edge cases", () => {
  it("queues one required refresh when an upgrade is already on the ordered version", async () => {
    const h = build("upgrade");
    h.mutate((s) => {
      s.subscription!.plan_version_id = s.order.plan_version_id;
    });
    await h.service.fulfill("order-1", actor);
    expect(h.state().deliveries).toEqual(["subscription_changed"]);
    expect(h.state().provisioning).toBe(0);
    expect(h.state().anchors).toBe(1);
    expect(h.state().order.status).toBe("fulfilled");
  });
  it("rolls same-version terms and leftover back if their required refresh fails", async () => {
    const h = build("upgrade");
    h.mutate((s) => {
      s.subscription!.plan_version_id = s.order.plan_version_id;
    });
    const before = structuredClone(h.state());
    h.faults.delivery = 1;
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow(
      "outbox unavailable",
    );
    expect(h.state()).toEqual(before);
    expect(h.notify).not.toHaveBeenCalled();
    h.faults.delivery = 0;
    await h.service.fulfill("order-1", actor);
    expect(h.state().bonusCents).toBe(25);
    expect(h.state().deliveries).toHaveLength(1);
  });
  it("rolls a periodic quota reanchor failure back with the upgrade and outbox", async () => {
    const h = build("upgrade"),
      before = structuredClone(h.state());
    h.faults.sql = "set period_anchor";
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow();
    expect(h.state()).toEqual(before);
    expect(h.notify).not.toHaveBeenCalled();
  });
  it("rolls a consumable quota reset failure back with renewal and required outbox", async () => {
    const h = build("renew"),
      before = structuredClone(h.state());
    h.faults.sql = "set quota_used = 0";
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow();
    expect(h.state()).toEqual(before);
    expect(h.notify).not.toHaveBeenCalled();
  });
  it("keeps cross-version renewal materialization, old quota and history atomic", async () => {
    const h = build("renew");
    h.mutate((s) => {
      s.order.plan_version_id = "pv-1b";
    });
    const before = structuredClone(h.state());
    h.faults.sql = "insert into billing.order_events";
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow();
    expect(h.state()).toEqual(before);
    h.faults.sql = "";
    await h.service.fulfill("order-1", actor);
    expect(h.state().subscription?.plan_version_id).toBe("pv-1b");
    expect(h.state().materialized).toBe(1);
    expect(h.state().resets).toBe(0);
  });
  it("rejects a cross-tenant orphan even when the workspace identifier matches", async () => {
    const h = build("new");
    h.mutate((s) => {
      s.subscription = {
        ...subscriptionRow(),
        tenant_id: "other",
        current_order_id: null,
      };
    });
    const before = structuredClone(h.state());
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow(
      /归属不匹配/,
    );
    expect(h.state()).toEqual(before);
    expect(h.notify).not.toHaveBeenCalled();
  });
  it("does not post an already-recorded matching noncash source a second time", async () => {
    const h = build("upgrade");
    h.mutate((s) => {
      s.bonusCents = 25;
    });
    await h.service.fulfill("order-1", actor);
    expect(h.state().bonusCents).toBe(25);
    expect(h.post).not.toHaveBeenCalled();
    expect(h.commands.filter((c) => c === "commit")).toHaveLength(1);
  });
  it("rejects a prior noncash source amount mismatch and rolls all service changes back", async () => {
    const h = build("upgrade");
    h.mutate((s) => {
      s.bonusCents = 50;
    });
    const before = structuredClone(h.state());
    await expect(h.service.fulfill("order-1", actor)).rejects.toThrow(
      /来源金额不匹配/,
    );
    expect(h.state()).toEqual(before);
    expect(h.post).not.toHaveBeenCalled();
  });
  it.each(["zero", "prior"])(
    "does not complete the caller transaction on the %s leftover early return",
    async (kind) => {
      const h = build("upgrade");
      h.mutate((s) => {
        if (kind === "zero") s.order.leftover_amount = "0.00";
        else s.bonusCents = 25;
      });
      const before = structuredClone(h.state());
      await expect(
        h.orderRepo.withOrderTx("order-1", async ({ client, order }) => {
          expect(
            await h.orderRepo.grantLeftoverToPrepaid(order, actor, client),
          ).toBe(false);
          expect(h.commands).not.toContain("commit");
          expect(h.client.release).not.toHaveBeenCalled();
          throw new Error("caller abort");
        }),
      ).rejects.toThrow("caller abort");
      expect(h.state()).toEqual(before);
      expect(h.commands.at(-1)).toBe("rollback");
      expect(h.pool.connect).toHaveBeenCalledOnce();
      expect(h.client.release).toHaveBeenCalledOnce();
    },
  );
  it("requires an explicit transaction for a locked subscription read", async () => {
    const h = build("renew");
    await expect(h.subRepo.getById("sub-1", undefined, true)).rejects.toThrow(
      /requires a transaction/,
    );
    expect(h.pool.query).not.toHaveBeenCalled();
    expect(h.pool.connect).not.toHaveBeenCalled();
  });
});
