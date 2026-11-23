/**
 * subscription-notification-atomic.spec.ts - Subscription/outbox transaction failure tests.
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
import { PgSubscriptionRepository } from "./pg-subscription.repository";
import { SubscriptionService } from "../service/subscription.service";
import type {
  CreateSubscriptionInput,
  SubscriptionRecord,
} from "../types/subscription.types";

// ============================================================================
// Strict transaction double: real repositories execute SQL, no database/network.
// This proves composition and failure propagation, not PostgreSQL lock behavior.
// ============================================================================
const before: SubscriptionRecord = {
  id: "sub-1",
  tenantId: "tenant-1",
  workspaceId: "ws-1",
  planVersionId: "pv-1",
  status: "active",
  cycleType: "year",
  cycleCount: 1,
  startAt: new Date("2026-01-01T00:00:00Z"),
  endAt: new Date("2027-01-01T00:00:00Z"),
  trialEndAt: null,
  subscriptionKind: "paid",
  activationMethod: "online_purchase",
  autoRenew: false,
  payAmount: "0.80",
  currency: "CNY",
  createdBy: "user-1",
  updatedBy: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};
const target = new Date("2028-01-01T00:00:00Z");
const createInput: CreateSubscriptionInput = {
  tenantId: before.tenantId,
  workspaceId: before.workspaceId,
  planVersionId: before.planVersionId,
  cycleType: before.cycleType,
  startAt: before.startAt,
  endAt: target,
  autoRenew: false,
  createdBy: before.createdBy,
  createdByType: "customer",
};
const product = (id: string) => ({
  product_id: id,
  product_code: id,
  plan_code: "pro",
});
type Episode = {
  id: string;
  subscription_id: string;
  reason: string;
  extends_term: boolean;
  auto_renew_before: boolean | null;
  maintenance_window_id: string | null;
  expected_resume_at: Date | null;
  paused_at: Date;
  resumed_at: Date | null;
  granted_seconds: number | null;
};
type State = {
  episodes: Episode[];
  maintenance: {
    id: string;
    windowId: string | null;
    until: Date | null;
  } | null;
  row: ReturnType<typeof initialRow> | null;
  effects: string[];
  deliveries: string[];
  history: unknown[][];
};
function initialRow() {
  return {
    id: before.id,
    product_id: "p1",
    tenant_id: before.tenantId,
    workspace_id: before.workspaceId,
    plan_version_id: before.planVersionId,
    status: before.status,
    cycle_unit: before.cycleType,
    cycle_count: 1,
    start_at: before.startAt,
    end_at: before.endAt,
    trial_end_at: null as Date | null,
    subscription_kind: "paid",
    activation_method: "online_purchase",
    auto_renew: false,
    pay_amount: "0.80" as string | null,
    currency: "CNY",
    created_by_id: "user-1",
    created_at: before.createdAt,
    updated_at: before.updatedAt,
    deleted_at: null,
    current_order_id: "order-1",
  };
}

function build() {
  let committed: State = {
    episodes: [],
    maintenance: { id: "p1", windowId: null, until: null },
    row: initialRow(),
    effects: [],
    deliveries: [],
    history: [],
  };
  let pending: State | null = null;
  let transactionBefore: State | null = null;
  const commands: string[] = [];
  const registered = new Set(["p1", "p2"]);
  const versions = new Map([
    ["pv-1", [product("p1")]],
    ["pv-2", [product("p1"), product("p2")]],
  ]);
  const faults = {
    sql: "",
    deliveryNumber: 0,
    conflict: false,
    covered: false,
  };
  const readRows = (state: State, sql: string, values: unknown[]) => {
    const row = state.row;
    const episodes = state.episodes;
    if (sql.startsWith("select config_value from admin.settings")) {
      expect(sql).toContain("subscription.max_suspend_days");
      return [{ config_value: "60" }];
    }
    if (sql.startsWith("select s.id as subscription_id")) {
      expect(sql).toContain("not exists");
      if (
        !row ||
        !["active", "trialing", "expiring", "overdue"].includes(row.status) ||
        !state.maintenance?.windowId ||
        !state.maintenance.until ||
        (values[2] && values[2] !== row.id) ||
        episodes.some(
          (e) => e.subscription_id === row.id && e.resumed_at === null,
        )
      )
        return [];
      return [
        {
          subscription_id: row.id,
          tenant_id: row.tenant_id,
          status: row.status,
          auto_renew: row.auto_renew,
          product_id: row.product_id,
          maintenance_window_id: state.maintenance.windowId,
          maintenance_until: state.maintenance.until,
        },
      ];
    }
    if (sql.startsWith("select sus.id") && sql.includes("sus.reason")) {
      expect(sql).toContain("make_interval(days => $1)");
      return episodes
        .filter(
          (e) =>
            row?.id === e.subscription_id &&
            row.status === "suspended" &&
            e.resumed_at === null &&
            e.paused_at.getTime() + Number(values[0]) * 86_400_000 <=
              Date.now() &&
            (!values[2] || values[2] === e.id),
        )
        .slice(0, Number(values[1]))
        .map((e) => ({ ...e, status: row!.status }));
    }
    if (
      sql.startsWith("select sus.id") &&
      sql.includes("p.maintenance_window_id is distinct")
    ) {
      return episodes
        .filter(
          (e) =>
            row?.id === e.subscription_id &&
            row.status === "suspended" &&
            e.resumed_at === null &&
            e.maintenance_window_id !== null &&
            e.maintenance_window_id !== state.maintenance?.windowId &&
            (!values[1] || e.subscription_id === values[1]) &&
            (!values[2] || e.id === values[2]),
        )
        .slice(0, Number(values[0]))
        .map((e) => ({ ...e, status: row!.status }));
    }
    if (sql.startsWith("select sus.id, sus.subscription_id from")) {
      expect(sql).toContain("limit $2");
      return episodes
        .filter(
          (e) =>
            e.resumed_at !== null &&
            e.granted_seconds === null &&
            (!values[0] || values[0] === e.subscription_id),
        )
        .slice(0, Number(values[1]))
        .map((e) => ({ id: e.id, subscription_id: e.subscription_id }));
    }
    if (
      sql.startsWith("select sus.id") &&
      sql.includes("case when sus.extends_term")
    ) {
      expect(sql).toContain("ceil(extract(epoch");
      expect(sql).toContain("else 0::bigint");
      expect(sql).toContain("for update of sus skip locked");
      expect(sql).toContain("sus.id = any($3)");
      return episodes
        .filter(
          (e) =>
            e.resumed_at !== null &&
            e.granted_seconds === null &&
            (!values[0] || e.subscription_id === values[0]) &&
            (!values[2] || (values[2] as string[]).includes(e.id)),
        )
        .slice(0, Number(values[1]))
        .map((e) => ({
          id: e.id,
          subscription_id: e.subscription_id,
          granted_seconds: String(
            e.extends_term
              ? Math.ceil(
                  (e.resumed_at!.getTime() - e.paused_at.getTime()) /
                    86_400_000,
                ) * 86400
              : 0,
          ),
          has_end_at: row?.end_at !== null,
        }));
    }
    return null;
  };
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
    commands.push(sql);
    if (faults.sql && sql.includes(faults.sql))
      throw new Error("injected SQL failure");
    if (sql === "begin") {
      if (pending) throw new Error("nested transaction");
      transactionBefore = structuredClone(committed);
      pending = structuredClone(committed);
      return { rows: [] };
    }
    if (!pending) throw new Error("query escaped the caller transaction");
    if (sql === "rollback") {
      pending = null;
      return { rows: [] };
    }
    if (sql === "commit") {
      committed = pending;
      pending = null;
      return { rows: [] };
    }
    if (sql.startsWith("select * from metering.subscriptions")) {
      expect(values[0]).toBe(pending.row?.id ?? values[0]);
      if (!sql.includes("for update"))
        expect(
          commands
            .slice(commands.lastIndexOf("begin"))
            .some((command) => command.includes("for update")),
        ).toBe(true);
      expect(sql).toContain("deleted_at is null");
      return { rows: pending.row ? [structuredClone(pending.row)] : [] };
    }
    if (sql.startsWith("select p.id from product.products")) {
      expect(sql).toContain("for share of p");
      expect(values[0]).toBe(pending.row?.id);
      return {
        rows: pending.maintenance ? [{ id: pending.maintenance.id }] : [],
      };
    }
    const selected = readRows(pending, sql, values);
    if (selected) {
      if (
        sql.includes("sus.reason") ||
        sql.includes("p.maintenance_window_id is distinct")
      )
        expect(sql).toContain("for update of sus");
      return { rows: structuredClone(selected) };
    }
    if (sql.startsWith("insert into metering.subscription_suspensions")) {
      if (
        pending.episodes.some(
          (e) => e.subscription_id === values[0] && e.resumed_at === null,
        )
      )
        throw new Error("duplicate open episode");
      pending.episodes.push({
        id: "episode-new",
        subscription_id: String(values[0]),
        reason: String(values[2]),
        extends_term: Boolean(values[4]),
        auto_renew_before: values[5] as boolean | null,
        expected_resume_at: values[6] as Date | null,
        maintenance_window_id: values[10] as string | null,
        paused_at: new Date(),
        resumed_at: null,
        granted_seconds: null,
      });
      pending.effects.push("episode-open");
      return { rows: [{ id: "episode-new" }] };
    }
    if (
      sql.startsWith("update metering.subscription_suspensions set resumed_at")
    ) {
      expect(sql).toContain("($2::uuid is null or id = $2)");
      const episode = pending.episodes.find(
        (e) =>
          e.subscription_id === values[0] &&
          e.resumed_at === null &&
          (!values[1] || e.id === values[1]),
      );
      if (!episode) return { rows: [] };
      episode.resumed_at = new Date();
      pending.effects.push("episode-close");
      return { rows: [{ id: episode.id }] };
    }
    if (
      sql.startsWith(
        "update metering.subscription_suspensions set granted_seconds",
      )
    ) {
      const episode = pending.episodes.find(
        (e) => e.id === values[0] && e.granted_seconds === null,
      );
      if (!episode) throw new Error("settlement lost its locked episode");
      episode.granted_seconds = Number(values[1]);
      pending.effects.push("episode-settle");
      return { rows: [] };
    }
    if (sql.startsWith("update metering.subscriptions set end_at = end_at +")) {
      expect(values[0]).toBe(pending.row?.id);
      if (!pending.row?.end_at)
        throw new Error("cannot extend a perpetual subscription");
      pending.row.end_at = new Date(
        pending.row.end_at.getTime() + Number(values[1]) * 1000,
      );
      pending.effects.push("term");
      return { rows: [] };
    }
    if (sql.startsWith("insert into metering.subscriptions")) {
      if (pending.row)
        throw new Error("fixture already contains a subscription");
      pending.row = {
        ...initialRow(),
        id: "new-sub",
        tenant_id: String(values[0]),
        workspace_id: String(values[1]),
        plan_version_id: String(values[2]),
        subscription_kind: String(values[3]),
        cycle_unit: String(values[4]),
        cycle_count: Number(values[5]),
        start_at: values[6] as Date,
        end_at: values[7] as Date | null,
        trial_end_at: values[8] as Date | null,
        status: String(values[9]),
        activation_method: String(values[10]),
        auto_renew: Boolean(values[11]),
        pay_amount: values[12] === null ? null : String(values[12]),
        currency: String(values[13]),
        created_by_id: String(values[15]),
      };
      pending.effects.push("subscription");
      return { rows: [structuredClone(pending.row)] };
    }
    if (sql.startsWith("update metering.subscriptions set")) {
      const row = pending.row;
      if (
        !row ||
        (values[5] !== null && row.status !== values[5]) ||
        (values[6] !== null && row.current_order_id !== values[6]) ||
        (values[7] &&
          row.end_at?.getTime() !== (values[8] as Date | null)?.getTime())
      )
        return { rows: [] };
      row.status = (values[1] as string | null) ?? row.status;
      row.end_at = (values[2] as Date | null) ?? row.end_at;
      row.auto_renew = (values[3] as boolean | null) ?? row.auto_renew;
      row.plan_version_id = (values[4] as string | null) ?? row.plan_version_id;
      pending.effects.push("subscription");
      return { rows: [structuredClone(row)] };
    }
    if (sql.startsWith("insert into metering.subscription_histories")) {
      pending.history.push(values);
      pending.effects.push("history");
      return { rows: [] };
    }
    if (
      sql.startsWith("update metering.quota_pools") ||
      sql.startsWith("insert into metering.quota_pools") ||
      sql.startsWith("insert into metering.resource_sharing_policies")
    ) {
      pending.effects.push(sql.split(" ").slice(0, 3).join(" "));
      return { rows: [] };
    }
    if (sql.startsWith("select pc.product_id")) {
      return { rows: versions.get(String(values[0])) ?? [] };
    }
    if (sql.startsWith("select distinct prod.product_code")) {
      return {
        rows: faults.conflict
          ? [{ product_code: "p1", new_tier: "pro", existing_tier: "free" }]
          : [],
      };
    }
    if (sql.startsWith("select exists"))
      return { rows: [{ exists: faults.covered }] };
    if (sql.startsWith("insert into provisioning.provisionings")) {
      pending.effects.push("provisioning");
      return { rows: [{ id: "provisioning-1", version: 1 }] };
    }
    if (sql.startsWith("insert into provisioning.webhook_deliveries")) {
      const generic = sql.includes("where exists");
      const productId = String(values[generic ? 4 : 6]);
      if (generic && !registered.has(productId)) return { rows: [] };
      if (faults.deliveryNumber === pending.deliveries.length + 1)
        throw new Error("outbox unavailable");
      pending.deliveries.push(
        String(values[generic ? 5 : 7]) + ":" + productId,
      );
      // Neither business state nor deliveries may become visible before COMMIT.
      expect(committed).toEqual(transactionBefore);
      return { rows: [{ id: "delivery-1" }] };
    }
    throw new Error("unexpected SQL: " + sql);
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (!sql.startsWith("select "))
        throw new Error("pool write escaped transaction");
      const selected = readRows(committed, sql, values);
      if (selected) return { rows: structuredClone(selected) };
      throw new Error("pool query escaped transaction");
    }),
  };
  const repo = new PgSubscriptionRepository(pool as unknown as Pool);
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
  return {
    repo,
    provisioning,
    service: new SubscriptionService(repo, provisioning),
    client,
    pool,
    commands,
    faults,
    versions,
    registered,
    state: () => committed,
    setEpisodes: (episodes: Episode[]) => {
      committed.episodes = episodes;
    },
    setWindow: (windowId: string | null, until: Date | null) => {
      committed.maintenance = { id: "p1", windowId, until };
    },
    setProductMissing: () => {
      committed.maintenance = null;
    },
    setRow: (row: State["row"]) => {
      committed.row = row;
    },
  };
}

// ============================================================================
// Atomic generic updates through the real service/repository/outbox composition.
// ============================================================================
describe("generic subscription update and notification persistence", () => {
  it("locks first and commits the renewal, history and one outbox entry together", async () => {
    const h = build();
    const dispatch = vi.spyOn(h.provisioning, "dispatchPending");
    const result = await h.service.updateSubscription(before.id, {
      endAt: target,
    });
    expect(result.endAt).toEqual(target);
    expect(h.commands[0]).toBe("begin");
    expect(h.commands[1]).toContain("for update");
    expect(h.commands.at(-1)).toBe("commit");
    expect(h.state().effects).toEqual(["subscription", "history"]);
    expect(h.state().deliveries).toEqual(["subscription_changed:p1"]);
    expect(h.pool.query).not.toHaveBeenCalled();
    expect(h.pool.connect).toHaveBeenCalledOnce();
    expect(h.client.release).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rolls the renewal and history back when required notification persistence fails", async () => {
    const h = build();
    h.faults.deliveryNumber = 1;
    await expect(
      h.service.updateSubscription(before.id, { endAt: target }),
    ).rejects.toThrow("outbox unavailable");
    expect(h.state().row?.end_at).toEqual(before.endAt);
    expect(h.state().effects).toEqual([]);
    expect(h.state().history).toEqual([]);
    expect(h.state().deliveries).toEqual([]);
    expect(h.commands.at(-1)).toBe("rollback");
    expect(h.commands).not.toContain("commit");
    expect(h.client.release).toHaveBeenCalledOnce();
  });

  it("rolls back the first product's queued event when the second product fails", async () => {
    const h = build();
    h.versions.set("pv-1", [product("p1"), product("p2")]);
    h.faults.deliveryNumber = 2;
    await expect(
      h.service.updateSubscription(before.id, { endAt: target }),
    ).rejects.toThrow("outbox unavailable");
    expect(
      h.commands.filter((s) =>
        s.startsWith("insert into provisioning.webhook_deliveries"),
      ),
    ).toHaveLength(2);
    expect(h.state().deliveries).toEqual([]);
    expect(h.state().effects).toEqual([]);
    expect(h.commands.at(-1)).toBe("rollback");
  });

  it("includes quota replacement, history and lifecycle/cache notifications in the commit", async () => {
    const h = build();
    await h.service.updateSubscription(before.id, { toPlanVersionId: "pv-2" });
    expect(h.state().row?.plan_version_id).toBe("pv-2");
    expect(h.state().effects).toContain("update metering.quota_pools set");
    expect(h.state().effects).toContain("insert into metering.quota_pools");
    expect(h.state().effects).toContain(
      "insert into metering.resource_sharing_policies",
    );
    expect(h.state().history[0]?.slice(3, 7)).toEqual([
      "pv-1",
      "pv-2",
      "active",
      "active",
    ]);
    expect(h.state().deliveries).toEqual([
      "tenant.provisioned:p1",
      "tenant.provisioned:p2",
      "subscription_changed:p1",
      "subscription_changed:p2",
    ]);
    expect(h.commands.filter((s) => s === "begin")).toHaveLength(1);
    expect(h.commands.filter((s) => s === "commit")).toHaveLength(1);
    expect(h.client.release).toHaveBeenCalledOnce();
  });

  it("rolls quota/history and an already queued lifecycle event back on later failure", async () => {
    const h = build();
    h.faults.deliveryNumber = 2;
    await expect(
      h.service.updateSubscription(before.id, { toPlanVersionId: "pv-2" }),
    ).rejects.toThrow("outbox unavailable");
    expect(h.state().row?.plan_version_id).toBe("pv-1");
    expect(h.state().effects).toEqual([]);
    expect(h.state().history).toEqual([]);
    expect(h.state().deliveries).toEqual([]);
  });

  it("uses the locked database prior state for history and transition decisions", async () => {
    const h = build();
    h.setRow({ ...initialRow(), status: "expired" });
    vi.spyOn(h.repo, "getById").mockRejectedValue(
      new Error("unlocked read forbidden"),
    );
    await h.service.updateSubscription(before.id, {
      status: "active",
      endAt: target,
    });
    expect(h.state().history[0]?.slice(5, 7)).toEqual(["expired", "active"]);
    expect(h.state().deliveries).toEqual([
      "tenant.provisioned:p1",
      "subscription_changed:p1",
    ]);
  });

  it("does not enqueue when only the renewal switch changes", async () => {
    const h = build();
    await h.service.updateSubscription(before.id, { autoRenew: true });
    expect(h.state().row?.auto_renew).toBe(true);
    expect(h.state().deliveries).toEqual([]);
    expect(h.state().history).toHaveLength(1);
  });

  it("retains the existing skip for a product without a webhook registration", async () => {
    const h = build();
    h.registered.clear();
    await h.service.updateSubscription(before.id, { endAt: target });
    expect(h.state().row?.end_at).toEqual(target);
    expect(h.state().deliveries).toEqual([]);
    expect(h.commands.at(-1)).toBe("commit");
  });

  it("uses the same connection to check surviving coverage before deprovisioning", async () => {
    const h = build();
    h.faults.covered = true;
    await h.service.updateSubscription(before.id, { status: "expired" });
    expect(h.state().deliveries).toEqual(["subscription_changed:p1"]);
    expect(h.commands.some((s) => s.startsWith("select exists"))).toBe(true);
    expect(h.pool.query).not.toHaveBeenCalled();
  });

  it("rolls back a tier conflict before any write or queue insertion", async () => {
    const h = build();
    h.faults.conflict = true;
    await expect(
      h.service.updateSubscription(before.id, { toPlanVersionId: "pv-2" }),
    ).rejects.toThrow(/档位不同/);
    expect(h.state().effects).toEqual([]);
    expect(h.commands.at(-1)).toBe("rollback");
    expect(h.pool.query).not.toHaveBeenCalled();
  });

  it.each([
    { expectedStatus: "expired" },
    { expectedCurrentOrderId: "another-order" },
    { expectedEndAt: new Date("2026-01-01T00:00:00Z") },
  ])("a lost CAS %j writes no history or notifications", async (guard) => {
    const h = build();
    await expect(
      h.service.updateSubscription(before.id, { ...guard, endAt: target }),
    ).rejects.toThrow(/不存在/);
    expect(h.state().effects).toEqual([]);
    expect(h.state().deliveries).toEqual([]);
    expect(h.commands.at(-1)).toBe("rollback");
  });

  it("releases the connection and rolls back when the locked row is absent", async () => {
    const h = build();
    h.setRow(null);
    await expect(h.service.updateSubscription(before.id, {})).rejects.toThrow(
      /不存在/,
    );
    expect(h.commands).toHaveLength(3);
    expect(h.commands.at(-1)).toBe("rollback");
    expect(h.client.release).toHaveBeenCalledOnce();
  });

  it.each([
    "for update",
    "insert into metering.subscription_histories",
    "insert into metering.quota_pools",
    "commit",
  ])("does not leave partial state when %s fails", async (sql) => {
    const h = build();
    h.faults.sql = sql;
    await expect(
      h.service.updateSubscription(before.id, { toPlanVersionId: "pv-2" }),
    ).rejects.toThrow("injected SQL failure");
    expect(h.state().effects).toEqual([]);
    expect(h.state().deliveries).toEqual([]);
    expect(h.state().row?.plan_version_id).toBe("pv-1");
    expect(h.commands.at(-1)).toBe("rollback");
    expect(h.client.release).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Explicit lifecycle entrypoints share business/outbox persistence.
// ============================================================================
type LifecycleAction = "create" | "cancel" | "upgrade" | "auto-renew";
function execute(action: LifecycleAction, h: ReturnType<typeof build>) {
  switch (action) {
    case "create":
      h.setRow(null);
      return h.service.createSubscription(createInput);
    case "cancel":
      return h.service.cancelSubscription(
        before.id,
        "operator-1",
        "test cancellation",
        "operator",
        "order-1",
      );
    case "upgrade":
      return h.service.upgradeSubscription(
        before.id,
        "pv-2",
        "operator-1",
        "test upgrade",
      );
    case "auto-renew":
      return h.service.setAutoRenew(before.id, true, { actorId: "user-1" });
  }
}

const actions: LifecycleAction[] = [
  "create",
  "cancel",
  "upgrade",
  "auto-renew",
];
describe.each(actions)("transactional %s entrypoint", (action) => {
  it("commits its state, history and required notifications on one connection", async () => {
    const h = build();
    const dispatch = vi.spyOn(h.provisioning, "dispatchPending");
    const result = await execute(action, h);
    expect(h.state().row?.id).toBe(result.id);
    expect(h.state().history).toHaveLength(1);
    expect(h.commands[0]).toBe("begin");
    expect(h.commands.at(-1)).toBe("commit");
    expect(h.commands.filter((sql) => sql === "begin")).toHaveLength(1);
    expect(h.commands.filter((sql) => sql === "commit")).toHaveLength(1);
    expect(h.pool.connect).toHaveBeenCalledOnce();
    expect(h.pool.query).not.toHaveBeenCalled();
    expect(h.client.release).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    const expected = {
      create: ["tenant.provisioned:p1", "subscription_changed:p1"],
      cancel: ["tenant.deprovisioned:p1", "subscription_changed:p1"],
      upgrade: [
        "tenant.provisioned:p1",
        "tenant.provisioned:p2",
        "subscription_changed:p1",
        "subscription_changed:p2",
      ],
      "auto-renew": ["subscription_changed:p1"],
    };
    expect(h.state().deliveries).toEqual(expected[action]);
    if (action === "create" || action === "upgrade") {
      expect(h.state().effects).toContain("insert into metering.quota_pools");
      expect(h.state().effects).toContain(
        "insert into metering.resource_sharing_policies",
      );
    }
    if (action === "cancel") {
      expect(result.status).toBe("cancelled");
      expect(result.autoRenew).toBe(false);
      expect(h.state().history[0]?.slice(7, 10)).toEqual([
        "operator",
        "operator-1",
        "test cancellation",
      ]);
    }
    if (action === "upgrade") {
      expect(result.planVersionId).toBe("pv-2");
      expect(h.state().history[0]?.slice(7, 10)).toEqual([
        "operator",
        "operator-1",
        "test upgrade",
      ]);
    }
    if (action === "auto-renew") {
      expect(result.autoRenew).toBe(true);
      expect(result.endAt).toEqual(before.endAt);
      expect(result.planVersionId).toBe(before.planVersionId);
      expect(h.state().history[0]?.slice(7, 10)).toEqual([
        "customer",
        "user-1",
        "customer resumed auto-renew",
      ]);
    }
  });

  it("rolls back all business writes when the first required delivery fails", async () => {
    const h = build();
    h.faults.deliveryNumber = 1;
    await expect(execute(action, h)).rejects.toThrow("outbox unavailable");
    expect(h.state().row).toEqual(action === "create" ? null : initialRow());
    expect(h.state().effects).toEqual([]);
    expect(h.state().history).toEqual([]);
    expect(h.state().deliveries).toEqual([]);
    expect(h.commands.at(-1)).toBe("rollback");
    expect(h.commands).not.toContain("commit");
    expect(h.client.release).toHaveBeenCalledOnce();
  });

  it("rolls back previous products if a later product's delivery fails", async () => {
    const h = build();
    h.versions.set("pv-1", [product("p1"), product("p2")]);
    h.faults.deliveryNumber = 2;
    await expect(execute(action, h)).rejects.toThrow("outbox unavailable");
    expect(h.state().row).toEqual(action === "create" ? null : initialRow());
    expect(h.state().effects).toEqual([]);
    expect(h.state().deliveries).toEqual([]);
    expect(
      h.commands.filter((sql) =>
        sql.startsWith("insert into provisioning.webhook_deliveries"),
      ),
    ).toHaveLength(2);
    expect(h.commands.at(-1)).toBe("rollback");
  });

  it.each(["insert into metering.subscription_histories", "commit"])(
    "rolls back and releases when %s fails",
    async (sql) => {
      const h = build();
      h.faults.sql = sql;
      await expect(execute(action, h)).rejects.toThrow("injected SQL failure");
      expect(h.state().row).toEqual(action === "create" ? null : initialRow());
      expect(h.state().effects).toEqual([]);
      expect(h.state().history).toEqual([]);
      expect(h.state().deliveries).toEqual([]);
      expect(h.commands.at(-1)).toBe("rollback");
      expect(h.client.release).toHaveBeenCalledOnce();
    },
  );

  it("retains the generic-notification skip for unregistered webhook products", async () => {
    const h = build();
    h.registered.clear();
    await execute(action, h);
    expect(
      h
        .state()
        .deliveries.some((event) => event.startsWith("subscription_changed:")),
    ).toBe(false);
    expect(h.state().history).toHaveLength(1);
    expect(h.commands.at(-1)).toBe("commit");
  });
});

// ============================================================================
// Existing business guards run against the locked row before persistence.
// ============================================================================
describe("explicit lifecycle business guards", () => {
  it.each(["cancel", "upgrade", "auto-renew"] as const)(
    "%s rejects a missing row before writes and releases the transaction",
    async (action) => {
      const h = build();
      h.setRow(null);
      await expect(execute(action, h)).rejects.toThrow(/不存在/);
      expect(h.state().effects).toEqual([]);
      expect(h.state().deliveries).toEqual([]);
      expect(h.commands.at(-1)).toBe("rollback");
      expect(h.client.release).toHaveBeenCalledOnce();
    },
  );

  it.each(["cancelled", "expired"])(
    "does not cancel a %s subscription",
    async (status) => {
      const h = build();
      h.setRow({ ...initialRow(), status });
      await expect(execute("cancel", h)).rejects.toThrow(
        status === "cancelled" ? "订阅已取消" : "订阅已过期",
      );
      expect(h.state().effects).toEqual([]);
      expect(h.state().deliveries).toEqual([]);
      expect(h.commands.at(-1)).toBe("rollback");
    },
  );

  it("rejects cancellation tied to an order that is no longer current", async () => {
    const h = build();
    h.setRow({
      ...initialRow(),
      current_order_id: "later-order",
      auto_renew: true,
    });
    await expect(execute("cancel", h)).rejects.toThrow("退款撤销需人工核对");
    expect(h.state().row?.status).toBe("active");
    expect(h.state().row?.auto_renew).toBe(true);
    expect(h.state().effects).toEqual([]);
    expect(h.state().deliveries).toEqual([]);
    expect(h.commands.at(-1)).toBe("rollback");
  });

  it.each(["suspended", "expired", "cancelled"])(
    "does not upgrade a %s subscription",
    async (status) => {
      const h = build();
      h.setRow({ ...initialRow(), status });
      await expect(execute("upgrade", h)).rejects.toThrow(
        "只有服务中的订阅可以升级",
      );
      expect(h.state().effects).toEqual([]);
      expect(h.state().deliveries).toEqual([]);
      expect(h.commands.at(-1)).toBe("rollback");
    },
  );

  it.each(["create", "upgrade"] as const)(
    "rejects a %s tier conflict before writes",
    async (action) => {
      const h = build();
      h.faults.conflict = true;
      await expect(execute(action, h)).rejects.toThrow(/档位不同/);
      expect(h.state().effects).toEqual([]);
      expect(h.state().deliveries).toEqual([]);
      expect(h.commands.at(-1)).toBe("rollback");
      expect(h.pool.query).not.toHaveBeenCalled();
    },
  );

  it("does not repeat history or notifications for an already-applied renewal setting", async () => {
    const h = build();
    await execute("auto-renew", h);
    const committed = structuredClone(h.state());
    await execute("auto-renew", h);
    expect(h.state()).toEqual(committed);
    expect(h.client.release).toHaveBeenCalledTimes(2);
  });

  it.each(["cancelled", "expired"])(
    "does not change renewal on a %s subscription",
    async (status) => {
      const h = build();
      h.setRow({ ...initialRow(), status });
      await expect(execute("auto-renew", h)).rejects.toThrow("订阅已终止");
      expect(h.state().effects).toEqual([]);
      expect(h.state().deliveries).toEqual([]);
    },
  );

  it("does not enable renewal on a trial", async () => {
    const h = build();
    h.setRow({ ...initialRow(), subscription_kind: "trial" });
    await expect(execute("auto-renew", h)).rejects.toThrow(
      "试用订阅不支持自动续费",
    );
    expect(h.state().effects).toEqual([]);
    expect(h.state().deliveries).toEqual([]);
  });

  it("keeps cancellation coverage checks in the transaction and preserves another subscription", async () => {
    const h = build();
    h.faults.covered = true;
    await execute("cancel", h);
    expect(h.state().deliveries).toEqual(["subscription_changed:p1"]);
    expect(h.pool.query).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Backward compatibility and explicit transaction ownership.
// ============================================================================
describe("repository update transaction ownership", () => {
  it("still owns transaction completion for legacy direct updates", async () => {
    const h = build();
    await h.repo.update(before.id, before, { endAt: target });
    expect(h.commands[0]).toBe("begin");
    expect(h.commands.at(-1)).toBe("commit");
    expect(h.client.release).toHaveBeenCalledOnce();
  });

  it("still rolls back and releases a legacy update that loses CAS", async () => {
    const h = build();
    expect(
      await h.repo.update(before.id, before, { expectedStatus: "expired" }),
    ).toBeNull();
    expect(h.commands.at(-1)).toBe("rollback");
    expect(h.client.release).toHaveBeenCalledOnce();
  });

  it("leaves completion and release to the caller on a supplied-connection error", async () => {
    const h = build();
    await h.client.query("begin");
    h.faults.sql = "insert into metering.subscription_histories";
    await expect(
      h.repo.update(before.id, before, { endAt: target }, h.client),
    ).rejects.toThrow("injected SQL failure");
    expect(h.pool.connect).not.toHaveBeenCalled();
    expect(h.commands).not.toContain("commit");
    expect(h.commands).not.toContain("rollback");
    expect(h.client.release).not.toHaveBeenCalled();
    await h.client.query("rollback");
    expect(h.state().effects).toEqual([]);
  });

  it("releases its own connection if BEGIN fails", async () => {
    const h = build();
    h.faults.sql = "begin";
    // A failed BEGIN can also reject ROLLBACK; release must still happen.
    await expect(
      h.repo.withLockedSubscription(before.id, async () => before),
    ).rejects.toThrow();
    expect(h.client.release).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Scan candidates are controlled; persistence still uses the real repositories.
// ============================================================================
const scanKinds = ["trial", "paid", "overdue", "expiring"] as const;
type ScanKind = (typeof scanKinds)[number];
function scanFixture(kind: ScanKind) {
  const h = build();
  const endAt = new Date(
    Date.now() + (kind === "expiring" ? 1 : -1) * 86_400_000,
  );
  const row = {
    ...initialRow(),
    status: kind === "trial" ? "trialing" : "active",
    subscription_kind: kind === "trial" ? "trial" : "paid",
    trial_end_at: kind === "trial" ? endAt : null,
    end_at: kind === "trial" ? null : endAt,
    auto_renew: kind === "overdue",
  };
  h.setRow(row);
  const candidate = {
    id: row.id,
    status: row.status,
    tenantId: row.tenant_id,
    endAt,
    trialEndAt: row.trial_end_at,
    productName: "Product",
    planName: "Pro",
  };
  vi.spyOn(h.repo, "findLapsedTrialIds").mockResolvedValue([row.id]);
  vi.spyOn(h.repo, "findExpiredSubscriptionIds").mockResolvedValue([candidate]);
  vi.spyOn(h.repo, "findOverdueCandidates").mockResolvedValue([candidate]);
  vi.spyOn(h.repo, "findExpiringSoon").mockResolvedValue([candidate]);
  vi.spyOn(h.repo, "getNotifyDisplay").mockResolvedValue(candidate);
  const status = kind === "trial" || kind === "paid" ? "expired" : kind;
  const notifier = {
    notify: vi.fn(async () => {
      expect(h.commands.at(-1)).toBe("commit");
      expect(h.state().row?.status).toBe(status);
      expect(h.state().history).toHaveLength(1);
      expect(h.state().deliveries.length).toBeGreaterThan(0);
    }),
  };
  h.service.setCustomerNotifier(notifier);
  const run = async () => {
    if (kind === "trial") return h.service.sweepLapsedTrials();
    if (kind === "paid") return h.service.sweepExpiredSubscriptions(100, 3);
    if (kind === "overdue") return h.service.markOverdue(3);
    return (await h.service.notifyExpiringSoon(3)).marked;
  };
  return { ...h, row, candidate, notifier, run, status };
}

describe.each(scanKinds)("%s scan atomic notification persistence", (kind) => {
  it("commits state, history and required events on one connection before customer notice", async () => {
    const h = scanFixture(kind);
    expect(await h.run()).toBe(1);
    expect(h.state().row?.status).toBe(h.status);
    expect(h.state().history).toHaveLength(1);
    expect(h.state().deliveries).toEqual(
      kind === "paid" || kind === "trial"
        ? ["tenant.deprovisioned:p1", "subscription_changed:p1"]
        : ["subscription_changed:p1"],
    );
    expect(h.commands[0]).toBe("begin");
    expect(h.commands[1]).toContain("for update");
    expect(h.commands.filter((sql) => sql === "commit")).toHaveLength(1);
    expect(h.pool.query).not.toHaveBeenCalled();
    expect(h.pool.connect).toHaveBeenCalledOnce();
    expect(h.client.release).toHaveBeenCalledOnce();
    expect(h.notifier.notify).toHaveBeenCalledOnce();
  });

  it.each([1, 2])(
    "rolls back every write and sends no customer notice if delivery %i fails",
    async (deliveryNumber) => {
      const h = scanFixture(kind);
      h.versions.set("pv-1", [product("p1"), product("p2")]);
      h.faults.deliveryNumber = deliveryNumber;
      expect(await h.run()).toBe(0);
      expect(h.state().row).toEqual(h.row);
      expect(h.state().effects).toEqual([]);
      expect(h.state().history).toEqual([]);
      expect(h.state().deliveries).toEqual([]);
      expect(h.commands.at(-1)).toBe("rollback");
      expect(h.commands).not.toContain("commit");
      expect(h.notifier.notify).not.toHaveBeenCalled();
      expect(h.client.release).toHaveBeenCalledOnce();
    },
  );

  it.each(["insert into metering.subscription_histories", "commit"])(
    "does not count a row when %s fails",
    async (sql) => {
      const h = scanFixture(kind);
      h.faults.sql = sql;
      expect(await h.run()).toBe(0);
      expect(h.state().row).toEqual(h.row);
      expect(h.state().history).toEqual([]);
      expect(h.state().deliveries).toEqual([]);
      expect(h.commands.at(-1)).toBe("rollback");
      expect(h.notifier.notify).not.toHaveBeenCalled();
      expect(h.client.release).toHaveBeenCalledOnce();
    },
  );

  it("retries after rollback exactly once and ignores the already-applied stale candidate", async () => {
    const h = scanFixture(kind);
    h.faults.deliveryNumber = 1;
    expect(await h.run()).toBe(0);
    h.faults.deliveryNumber = 0;
    expect(await h.run()).toBe(1);
    const committed = structuredClone(h.state());
    expect(await h.run()).toBe(0);
    expect(h.state()).toEqual(committed);
    expect(h.state().history).toHaveLength(1);
    expect(h.notifier.notify).toHaveBeenCalledOnce();
    expect(h.client.release).toHaveBeenCalledTimes(3);
  });

  it("keeps committed results if the customer notification channel fails", async () => {
    const h = scanFixture(kind);
    h.notifier.notify.mockRejectedValue(
      new Error("customer channel unavailable"),
    );
    expect(await h.run()).toBe(1);
    expect(h.state().row?.status).toBe(h.status);
    expect(h.state().history).toHaveLength(1);
    expect(h.commands.at(-1)).toBe("commit");
    expect(h.commands).not.toContain("rollback");
  });

  it("does not overwrite a candidate whose status changed before locking", async () => {
    const h = scanFixture(kind);
    h.setRow({ ...h.row, status: "cancelled" });
    expect(await h.run()).toBe(0);
    expect(h.state().row?.status).toBe("cancelled");
    expect(h.state().effects).toEqual([]);
    expect(h.notifier.notify).not.toHaveBeenCalled();
  });

  it("retains generic event skipping for products with no webhook registration", async () => {
    const h = scanFixture(kind);
    h.registered.clear();
    // Notification assertions about a registered delivery do not apply here.
    h.notifier.notify.mockImplementation(async () => undefined);
    expect(await h.run()).toBe(1);
    expect(
      h
        .state()
        .deliveries.filter((event) =>
          event.startsWith("subscription_changed:"),
        ),
    ).toEqual([]);
    expect(h.state().history).toHaveLength(1);
    expect(h.commands.at(-1)).toBe("commit");
  });
});

// ============================================================================
// Stale candidate guards use the locked business state and the scanned term.
// ============================================================================
describe("scan business guards with real repository composition", () => {
  it.each(["paid", "overdue", "expiring"] as const)(
    "%s preserves a renewed term through end-date CAS",
    async (kind) => {
      const h = scanFixture(kind);
      const renewed = { ...h.row, end_at: target };
      h.setRow(renewed);
      expect(await h.run()).toBe(0);
      expect(h.state().row).toEqual(renewed);
      expect(h.state().effects).toEqual([]);
      expect(h.state().history).toEqual([]);
      expect(h.state().deliveries).toEqual([]);
      expect(
        h.commands.some((sql) =>
          sql.startsWith("update metering.subscriptions set"),
        ),
      ).toBe(true);
      expect(h.notifier.notify).not.toHaveBeenCalled();
    },
  );

  it.each(["extended", "converted", "no-cutoff"])(
    "does not expire a %s trial from an old candidate",
    async (change) => {
      const h = scanFixture("trial");
      const row = {
        ...h.row,
        ...(change === "extended"
          ? { trial_end_at: new Date(Date.now() + 86_400_000) }
          : {}),
        ...(change === "converted" ? { subscription_kind: "paid" } : {}),
        ...(change === "no-cutoff" ? { trial_end_at: null } : {}),
      };
      h.setRow(row);
      expect(await h.run()).toBe(0);
      expect(h.state().row).toEqual(row);
      expect(h.state().effects).toEqual([]);
      expect(h.notifier.notify).not.toHaveBeenCalled();
    },
  );

  it.each(["overdue", "expiring"] as const)(
    "%s rechecks auto-renew eligibility under the lock",
    async (kind) => {
      const h = scanFixture(kind);
      h.setRow({ ...h.row, auto_renew: !h.row.auto_renew });
      expect(await h.run()).toBe(0);
      expect(h.state().effects).toEqual([]);
      expect(h.notifier.notify).not.toHaveBeenCalled();
    },
  );

  it("expires a suspended paid subscription without a customer expiry notice", async () => {
    const h = scanFixture("paid");
    h.setRow({ ...h.row, status: "suspended" });
    vi.mocked(h.repo.findExpiredSubscriptionIds).mockResolvedValue([
      { ...h.candidate, status: "suspended" },
    ]);
    expect(await h.run()).toBe(1);
    expect(h.state().row?.status).toBe("expired");
    expect(h.state().deliveries).toEqual([
      "tenant.deprovisioned:p1",
      "subscription_changed:p1",
    ]);
    expect(h.notifier.notify).not.toHaveBeenCalled();
  });

  it("continues after a paid row's transaction rolls back, without partial state leaking", async () => {
    const h = scanFixture("paid");
    h.faults.deliveryNumber = 1;
    const nextRow = { ...h.row, id: "sub-2" };
    vi.mocked(h.repo.findExpiredSubscriptionIds).mockResolvedValue([
      h.candidate,
      { ...h.candidate, id: nextRow.id },
    ]);
    const original = h.repo.withLockedSubscription.bind(h.repo);
    let first = true;
    vi.spyOn(h.repo, "withLockedSubscription").mockImplementation(
      async (id, operation) => {
        if (!first) {
          expect(h.state().row).toEqual(h.row);
          expect(h.state().history).toEqual([]);
          expect(h.state().deliveries).toEqual([]);
          expect(h.commands.at(-1)).toBe("rollback");
          h.setRow(nextRow);
          h.faults.deliveryNumber = 0;
        }
        first = false;
        return original(id, operation);
      },
    );
    h.notifier.notify.mockImplementation(async () => {
      expect(h.commands.at(-1)).toBe("commit");
      expect(h.state().row?.id).toBe(nextRow.id);
    });
    expect(await h.run()).toBe(1);
    expect(h.state().row?.id).toBe(nextRow.id);
    expect(h.state().history).toHaveLength(1);
    expect(h.notifier.notify).toHaveBeenCalledOnce();
    expect(h.client.release).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// Maintenance, suspension episodes and compensation share the business commit.
// ============================================================================
const suspensionKinds = [
  "maintenance-entry",
  "maintenance-release",
  "deadline-resume",
  "deadline-terminate",
  "settlement",
] as const;
type SuspensionKind = (typeof suspensionKinds)[number];
function suspensionFixture(kind: SuspensionKind) {
  const h = build();
  const entry = kind === "maintenance-entry",
    settlement = kind === "settlement";
  const terminate = kind === "deadline-terminate";
  const row = {
    ...initialRow(),
    status: entry || settlement ? "active" : "suspended",
    auto_renew: entry,
  };
  h.setRow(row);
  h.setWindow(entry ? "window-1" : null, entry ? target : null);
  const now = new Date();
  const episode: Episode = {
    id: "episode-1",
    subscription_id: row.id,
    reason: terminate ? "customer_violation" : "platform_ops",
    extends_term: !terminate,
    auto_renew_before: true,
    maintenance_window_id: kind === "maintenance-release" ? "window-1" : null,
    expected_resume_at: null,
    paused_at: new Date(
      now.getTime() -
        (kind.startsWith("deadline") ? 61 * 86_400_000 : 3 * 3_600_000),
    ),
    resumed_at: settlement ? now : null,
    granted_seconds: null,
  };
  h.setEpisodes(entry ? [] : [episode]);
  vi.spyOn(h.repo, "syncMaintenanceExpectedResume").mockResolvedValue([]);
  vi.spyOn(h.repo, "getNotifyDisplay").mockImplementation(async () => ({
    id: h.state().row!.id,
    tenantId: row.tenant_id,
    status: h.state().row!.status,
    endAt: h.state().row!.end_at,
    trialEndAt: null,
    productName: "Product",
    planName: "Pro",
  }));
  const status = entry ? "suspended" : terminate ? "cancelled" : "active";
  const notifier = {
    notify: vi.fn(async () => {
      expect(h.commands.at(-1)).toBe("commit");
      expect(h.state().row?.status).toBe(status);
      expect(h.state().episodes).toHaveLength(1);
      expect(h.state().deliveries.length).toBeGreaterThan(0);
    }),
  };
  h.service.setCustomerNotifier(notifier);
  const run = async () => {
    if (entry || kind === "maintenance-release") {
      const result = await h.service.sweepProductMaintenance();
      return entry ? result.suspended : result.resumed;
    }
    if (settlement) return h.service.settleSuspensionExtension();
    const result = await h.service.sweepOverdueSuspensions();
    return terminate ? result.terminated : result.resumed;
  };
  return {
    ...h,
    row,
    episode,
    status,
    notifier,
    run,
    baseline: structuredClone(h.state()),
  };
}

describe.each(suspensionKinds)(
  "%s atomic business and notification persistence",
  (kind) => {
    it("commits subscription, episode, compensation and required events before customer notice", async () => {
      const h = suspensionFixture(kind);
      const dispatch = vi.spyOn(h.provisioning, "dispatchPending");
      expect(await h.run()).toBe(1);
      expect(h.state().row?.status).toBe(h.status);
      expect(h.commands[0]).toBe("begin");
      expect(h.commands[1]).toContain("for update");
      expect(h.commands.at(-1)).toBe("commit");
      expect(h.pool.connect).toHaveBeenCalledOnce();
      expect(h.client.release).toHaveBeenCalledOnce();
      expect(h.state().history).toHaveLength(kind === "settlement" ? 0 : 1);
      const expectedEvents =
        kind === "maintenance-entry" || kind === "settlement"
          ? ["subscription_changed:p1"]
          : kind === "deadline-terminate"
            ? ["tenant.deprovisioned:p1", "subscription_changed:p1"]
            : ["tenant.provisioned:p1", "subscription_changed:p1"];
      expect(h.state().deliveries).toEqual(expectedEvents);
      if (kind === "maintenance-entry") {
        expect(h.state().row?.auto_renew).toBe(false);
        expect(h.state().episodes[0]).toMatchObject({
          auto_renew_before: true,
          maintenance_window_id: "window-1",
          resumed_at: null,
          granted_seconds: null,
        });
      } else {
        expect(h.state().episodes[0]?.resumed_at).toBeInstanceOf(Date);
        const granted = h.state().episodes[0]!.granted_seconds!;
        expect(granted % 86400).toBe(0);
        if (kind === "deadline-terminate") expect(granted).toBe(0);
        else expect(granted).toBeGreaterThan(0);
        expect(h.state().row?.end_at?.getTime()).toBe(
          h.row.end_at!.getTime() + granted * 1000,
        );
      }
      expect(h.notifier.notify).toHaveBeenCalledTimes(
        kind === "settlement" ? 0 : 1,
      );
      expect(dispatch).not.toHaveBeenCalled();
    });

    it.each([1, 2])(
      "rolls back state, episode, term and history if required delivery %i fails",
      async (deliveryNumber) => {
        const h = suspensionFixture(kind);
        h.versions.set("pv-1", [product("p1"), product("p2")]);
        h.faults.deliveryNumber = deliveryNumber;
        expect(await h.run()).toBe(0);
        expect(h.state()).toEqual(h.baseline);
        expect(h.commands.at(-1)).toBe("rollback");
        expect(h.commands).not.toContain("commit");
        expect(h.notifier.notify).not.toHaveBeenCalled();
        expect(h.client.release).toHaveBeenCalledOnce();
      },
    );

    it("rolls back a failed commit without counting or sending customer notice", async () => {
      const h = suspensionFixture(kind);
      h.faults.sql = "commit";
      expect(await h.run()).toBe(0);
      expect(h.state()).toEqual(h.baseline);
      expect(h.commands.at(-1)).toBe("rollback");
      expect(h.notifier.notify).not.toHaveBeenCalled();
      expect(h.client.release).toHaveBeenCalledOnce();
    });

    it("retries after rollback and does not repeat compensation, history or events", async () => {
      const h = suspensionFixture(kind);
      h.faults.deliveryNumber = 1;
      expect(await h.run()).toBe(0);
      h.faults.deliveryNumber = 0;
      expect(await h.run()).toBe(1);
      const committed = structuredClone(h.state());
      expect(await h.run()).toBe(0);
      expect(h.state()).toEqual(committed);
      expect(h.state().episodes).toHaveLength(1);
      expect(h.notifier.notify).toHaveBeenCalledTimes(
        kind === "settlement" ? 0 : 1,
      );
      expect(h.client.release).toHaveBeenCalledTimes(2);
    });

    if (kind !== "settlement") {
      it("rolls back an audit-history failure before changing the episode", async () => {
        const h = suspensionFixture(kind);
        h.faults.sql = "insert into metering.subscription_histories";
        expect(await h.run()).toBe(0);
        expect(h.state()).toEqual(h.baseline);
        expect(h.commands.at(-1)).toBe("rollback");
        expect(h.notifier.notify).not.toHaveBeenCalled();
      });
      it("preserves committed counts if customer notification fails", async () => {
        const h = suspensionFixture(kind);
        h.notifier.notify.mockRejectedValue(
          new Error("customer channel unavailable"),
        );
        expect(await h.run()).toBe(1);
        expect(h.state().row?.status).toBe(h.status);
        expect(h.commands.at(-1)).toBe("commit");
        expect(h.commands).not.toContain("rollback");
      });
    }
    it("rolls back episode persistence faults with all subscription changes", async () => {
      const h = suspensionFixture(kind);
      h.faults.sql =
        kind === "maintenance-entry"
          ? "insert into metering.subscription_suspensions"
          : kind === "settlement"
            ? "update metering.subscription_suspensions set granted_seconds"
            : "update metering.subscription_suspensions set resumed_at";
      expect(await h.run()).toBe(0);
      expect(h.state()).toEqual(h.baseline);
      expect(h.commands.at(-1)).toBe("rollback");
      expect(h.notifier.notify).not.toHaveBeenCalled();
    });
  },
);

// ============================================================================
// Locked predicate checks preserve episode identity, policy and term semantics.
// ============================================================================
describe("maintenance and compensation business guards", () => {
  it.each([
    "maintenance-release",
    "deadline-resume",
    "deadline-terminate",
  ] as const)(
    "%s rolls back settlement SQL failures, including the preceding status and closure",
    async (kind) => {
      const h = suspensionFixture(kind);
      h.faults.sql =
        "update metering.subscription_suspensions set granted_seconds";
      expect(await h.run()).toBe(0);
      expect(h.state()).toEqual(h.baseline);
      expect(h.notifier.notify).not.toHaveBeenCalled();
      expect(h.commands.at(-1)).toBe("rollback");
    },
  );

  it.each([
    "maintenance-entry",
    "maintenance-release",
    "deadline-resume",
  ] as const)(
    "%s ignores a replaced episode or maintenance window from an old scan",
    async (kind) => {
      const h = suspensionFixture(kind);
      const original = h.repo.withLockedSubscription.bind(h.repo);
      let expected: State;
      vi.spyOn(h.repo, "withLockedSubscription").mockImplementation(
        async (id, operation) => {
          if (kind === "maintenance-entry")
            h.setWindow("window-replaced", target);
          else h.setEpisodes([{ ...h.episode, id: "episode-replaced" }]);
          expected = structuredClone(h.state());
          return original(id, operation);
        },
      );
      expect(await h.run()).toBe(0);
      expect(h.state()).toEqual(expected!);
      expect(h.state().effects).toEqual([]);
      expect(h.notifier.notify).not.toHaveBeenCalled();
    },
  );

  it("does not resume a maintenance episode whose product re-entered that same window", async () => {
    const h = suspensionFixture("maintenance-release");
    const original = h.repo.withLockedSubscription.bind(h.repo);
    vi.spyOn(h.repo, "withLockedSubscription").mockImplementation(
      async (id, operation) => {
        h.setWindow("window-1", target);
        return original(id, operation);
      },
    );
    expect(await h.run()).toBe(0);
    expect(h.state().row?.status).toBe("suspended");
    expect(h.state().effects).toEqual([]);
    expect(h.notifier.notify).not.toHaveBeenCalled();
  });

  it("leaves an existing manual pause alone instead of opening a maintenance episode", async () => {
    const h = suspensionFixture("maintenance-entry");
    h.setEpisodes([{ ...h.episode, maintenance_window_id: null }]);
    const baseline = structuredClone(h.state());
    expect(await h.run()).toBe(0);
    expect(h.state()).toEqual(baseline);
    expect(h.pool.connect).not.toHaveBeenCalled();
  });

  it("records perpetual compensation without inventing an expiry or invalidation", async () => {
    const h = suspensionFixture("settlement");
    h.setRow({ ...h.row, end_at: null });
    expect(await h.run()).toBe(1);
    expect(h.state().row?.end_at).toBeNull();
    expect(h.state().episodes[0]?.granted_seconds).toBe(86400);
    expect(h.state().deliveries).toEqual([]);
    expect(h.state().history).toEqual([]);
  });

  it("records a customer-violation episode as zero without extending its term", async () => {
    const h = suspensionFixture("settlement");
    h.setEpisodes([
      { ...h.episode, extends_term: false, reason: "customer_violation" },
    ]);
    expect(await h.run()).toBe(1);
    expect(h.state().row?.end_at).toEqual(h.row.end_at);
    expect(h.state().episodes[0]?.granted_seconds).toBe(0);
    expect(h.state().deliveries).toEqual([]);
  });

  it.each([null, false] as const)(
    "restores a locked renewal snapshot of %s without guessing",
    async (autoRenewBefore) => {
      const h = suspensionFixture("maintenance-release");
      h.setEpisodes([{ ...h.episode, auto_renew_before: autoRenewBefore }]);
      expect(await h.run()).toBe(1);
      expect(h.state().row?.auto_renew).toBe(false);
      expect(h.state().history).toHaveLength(1);
    },
  );

  it("does not close an episode with a different expected identity", async () => {
    const h = suspensionFixture("maintenance-release");
    await expect(
      h.repo.withLockedSubscription(h.row.id, async (_before, client) => {
        await h.repo.closeSuspension(h.row.id, client, "wrong-episode");
      }),
    ).rejects.toThrow("暂停记录已变化");
    expect(h.state()).toEqual(h.baseline);
    expect(h.commands.at(-1)).toBe("rollback");
    expect(h.client.release).toHaveBeenCalledOnce();
  });

  it("keeps legacy direct settlement transaction completion and release", async () => {
    const h = suspensionFixture("settlement");
    const result = await h.repo.settleResumedSuspensions({
      subscriptionId: h.row.id,
      limit: 100,
    });
    expect(result).toHaveLength(1);
    expect(h.state().episodes[0]?.granted_seconds).toBe(86400);
    expect(h.commands[0]).toBe("begin");
    expect(h.commands.at(-1)).toBe("commit");
    expect(h.client.release).toHaveBeenCalledOnce();
  });

  it("leaves a supplied settlement connection to the caller on failure", async () => {
    const h = suspensionFixture("settlement");
    await h.client.query("begin");
    h.faults.sql =
      "update metering.subscription_suspensions set granted_seconds";
    await expect(
      h.repo.settleResumedSuspensions({ subscriptionId: h.row.id }, h.client),
    ).rejects.toThrow("injected SQL failure");
    expect(h.pool.connect).not.toHaveBeenCalled();
    expect(h.commands).not.toContain("rollback");
    expect(h.client.release).not.toHaveBeenCalled();
    await h.client.query("rollback");
    expect(h.state()).toEqual(h.baseline);
  });

  it("limits compensation to the selected episode ids even if new work appears", async () => {
    const h = suspensionFixture("settlement");
    const extra = { ...h.episode, id: "episode-later" };
    vi.spyOn(h.repo, "findUnsettledSuspensions").mockResolvedValue([
      { id: h.episode.id, subscriptionId: h.row.id },
    ]);
    h.setEpisodes([h.episode, extra]);
    expect(await h.run()).toBe(1);
    expect(h.state().episodes[0]?.granted_seconds).toBe(86400);
    expect(h.state().episodes[1]?.granted_seconds).toBeNull();
    expect(h.state().row?.end_at?.getTime()).toBe(
      h.row.end_at!.getTime() + 86_400_000,
    );
    expect(h.state().deliveries).toHaveLength(1);
  });
});

// ============================================================================
// One failed group must not hold back a later independent subscription.
// ============================================================================
describe("suspension transaction continuation", () => {
  it("continues settlement after a failed required event without leaking partial compensation", async () => {
    const h = suspensionFixture("settlement");
    h.faults.deliveryNumber = 1;
    const later = { ...h.row, id: "sub-2" };
    const laterEpisode = {
      ...h.episode,
      id: "episode-2",
      subscription_id: later.id,
    };
    vi.spyOn(h.repo, "findUnsettledSuspensions").mockResolvedValue([
      { id: h.episode.id, subscriptionId: h.row.id },
      { id: laterEpisode.id, subscriptionId: later.id },
    ]);
    const original = h.repo.withLockedSubscription.bind(h.repo);
    let first = true;
    vi.spyOn(h.repo, "withLockedSubscription").mockImplementation(
      async (id, operation) => {
        if (!first) {
          expect(h.state()).toEqual(h.baseline);
          expect(h.commands.at(-1)).toBe("rollback");
          h.setRow(later);
          h.setEpisodes([laterEpisode]);
          h.faults.deliveryNumber = 0;
        }
        first = false;
        return original(id, operation);
      },
    );
    expect(await h.run()).toBe(1);
    expect(h.state().row?.id).toBe(later.id);
    expect(h.state().row?.end_at?.getTime()).toBe(
      later.end_at!.getTime() + 86_400_000,
    );
    expect(h.state().episodes[0]?.granted_seconds).toBe(86400);
    expect(h.state().deliveries).toEqual(["subscription_changed:p1"]);
    expect(h.client.release).toHaveBeenCalledTimes(2);
  });

  it("does not settle more than the original batch limit of 100 episodes", async () => {
    const h = suspensionFixture("settlement");
    h.setEpisodes(
      Array.from({ length: 101 }, (_, index) => ({
        ...h.episode,
        id: "episode-" + index,
      })),
    );
    expect(await h.run()).toBe(100);
    expect(
      h.state().episodes.filter((e) => e.granted_seconds !== null),
    ).toHaveLength(100);
    expect(
      h.state().episodes.filter((e) => e.granted_seconds === null),
    ).toHaveLength(1);
    expect(h.state().row?.end_at?.getTime()).toBe(
      h.row.end_at!.getTime() + 100 * 86_400_000,
    );
    expect(h.state().deliveries).toHaveLength(1);
    expect(h.pool.connect).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// External writers join the caller transaction; no ownership is transferred.
// ============================================================================
describe("external caller transaction completion", () => {
  async function renew(h: ReturnType<typeof build>) {
    return h.repo.withLockedSubscription(before.id, async (locked, client) => {
      if (!locked) throw new Error("missing locked subscription");
      await h.repo.update(before.id, locked, { endAt: target }, client);
      await h.service.applyExternalStatusChange(before.id, locked, client, {
        reanchorPools: true,
      });
    });
  }
  it("commits a same-status term change, periodic reanchor and two products together", async () => {
    const h = build();
    h.versions.set("pv-1", [product("p1"), product("p2")]);
    await renew(h);
    expect(h.state().row?.end_at).toEqual(target);
    expect(h.state().effects).toContain("update metering.quota_pools set");
    expect(h.state().deliveries).toEqual([
      "subscription_changed:p1",
      "subscription_changed:p2",
    ]);
    expect(h.commands.filter((c) => c === "begin")).toHaveLength(1);
    expect(h.commands.filter((c) => c === "commit")).toHaveLength(1);
    expect(h.pool.connect).toHaveBeenCalledOnce();
    expect(h.pool.query).not.toHaveBeenCalled();
    expect(h.client.release).toHaveBeenCalledOnce();
  });
  it.each(["update metering.quota_pools", "commit", "second-product"])(
    "rolls back the entire external renewal on %s failure and retries once",
    async (failure) => {
      const h = build();
      const baseline = structuredClone(h.state());
      h.versions.set("pv-1", [product("p1"), product("p2")]);
      if (failure === "second-product") h.faults.deliveryNumber = 2;
      else h.faults.sql = failure;
      await expect(renew(h)).rejects.toThrow();
      expect(h.state()).toEqual(baseline);
      expect(h.commands.at(-1)).toBe("rollback");
      h.faults.sql = "";
      h.faults.deliveryNumber = 0;
      await renew(h);
      expect(h.state().row?.end_at).toEqual(target);
      expect(h.state().history).toHaveLength(1);
      expect(h.state().deliveries).toHaveLength(2);
    },
  );
  it("propagates missing post-write state and leaves rollback to its caller", async () => {
    const h = build();
    h.setRow(null);
    await h.client.query("begin");
    await expect(
      h.service.applyExternalStatusChange(before.id, before, h.client),
    ).rejects.toThrow();
    expect(h.commands).toEqual([
      "begin",
      expect.stringContaining("select * from metering.subscriptions"),
    ]);
    expect(h.client.release).not.toHaveBeenCalled();
    await h.client.query("rollback");
  });
});
