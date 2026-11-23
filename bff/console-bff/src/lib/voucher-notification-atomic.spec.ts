/**
 * voucher-notification-atomic.spec.ts - Offline redemption/extension transaction faults.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-23
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  redeemSubscriptionVoucher,
  previewSubscriptionVoucher,
  subscriptionVoucherResult,
  type SubscriptionVoucherResult,
} from "./subscription-voucher-operation";
import {
  extendSubscriptionVoucher,
  previewSubscriptionExtension,
  subscriptionExtensionResult,
  type ExtensionCommand,
  type ExtensionResult,
} from "./subscription-extension-operation";

// ============================================================================
// Real BFF, domain and outbox code execute every query against this strict double.
// PostgreSQL syntax, grants, concurrent locks and restart recovery remain N01-A3.
// ============================================================================
const ids = {
  tenant: "11111111-1111-4111-8111-111111111111",
  workspace: "22222222-2222-4222-8222-222222222222",
  user: "33333333-3333-4333-8333-333333333333",
  voucher: "44444444-4444-4444-8444-444444444444",
  batch: "55555555-5555-4555-8555-555555555555",
  subscription: "66666666-6666-4666-8666-666666666666",
  plan: "77777777-7777-4777-8777-777777777777",
  product: "88888888-8888-4888-8888-888888888888",
  bundled: "99999999-9999-4999-8999-999999999999",
  other: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const scope = {
  tenantId: ids.tenant,
  workspaceId: ids.workspace,
  userId: ids.user,
};
const instant = new Date("2026-11-23T08:00:00Z"),
  end = new Date("2027-01-01T00:00:00Z");
type Kind = "redemption" | "extension";
type Scope = typeof scope;
function subscriptionRow() {
  return {
    id: ids.subscription,
    tenant_id: ids.tenant,
    workspace_id: ids.workspace,
    product_id: ids.product,
    plan_version_id: ids.plan,
    cycle_unit: "year",
    cycle_count: 1,
    start_at: new Date("2026-01-01T00:00:00Z"),
    end_at: end,
    trial_end_at: null,
    status: "active",
    subscription_kind: "paid",
    activation_method: "offline_purchase",
    auto_renew: true,
    next_renewal_at: end as Date | null,
    pay_amount: "1.00",
    paid_amount: "1.00",
    currency: "CNY",
    created_by_id: ids.user,
    created_at: instant,
    updated_at: instant,
    deleted_at: null,
  };
}
type Receipt = {
  key: string;
  hash: string;
  actor: string;
  type: string;
  result: SubscriptionVoucherResult | ExtensionResult;
};
type State = {
  subscription: ReturnType<typeof subscriptionRow> | null;
  voucher: {
    used: number;
    status: string;
    tenant: string;
    workspace: string;
    user: string;
  };
  pools: {
    source: string;
    status: string;
    expiresAt: Date;
    used: number;
    anchor: Date;
  }[];
  histories: unknown[][];
  operations: Receipt[];
  redemptions: unknown[][];
  events: unknown[][];
  deliveries: {
    key: string;
    event: string;
    productId: string;
    payload: Record<string, unknown>;
  }[];
  provisioning: number;
  cacheDeletes: number;
  sharing: number;
};
function build(kind: Kind) {
  const grants = [
    {
      product_id: ids.product,
      product_code: "test",
      product_name: "Test",
      component_role: "primary",
      tier: "pro",
      quota: { "ai.credit": 20 },
      features: ["chat"],
      status: "active",
      release_stage: "stable",
      maintenance_window_id: null as string | null,
      deleted_at: null,
    },
    {
      product_id: ids.bundled,
      product_code: "bundled",
      product_name: "Bundled",
      component_role: "bundled",
      tier: null,
      quota: { "ai.credit": 10 },
      features: [],
      status: "active",
      release_stage: "beta",
      maintenance_window_id: null as string | null,
      deleted_at: null,
    },
  ];
  const effect: Record<string, unknown> =
    kind === "redemption"
      ? {
          effect_version: 1,
          currency: "CNY",
          plan_version_id: ids.plan,
          duration_days: 30,
          funding_source: "operator_grant",
        }
      : {
          effect_version: 1,
          currency: "CNY",
          extend_days: 30,
          applicable_product_codes: ["test"],
        };
  let committed: State = {
    subscription: kind === "extension" ? subscriptionRow() : null,
    voucher: {
      used: 0,
      status: "assigned",
      tenant: ids.tenant,
      workspace: ids.workspace,
      user: ids.user,
    },
    pools:
      kind === "extension"
        ? [
            {
              source: "subscription",
              status: "active",
              expiresAt: end,
              used: 7,
              anchor: instant,
            },
            {
              source: "subscription",
              status: "active",
              expiresAt: new Date("2026-12-01T00:00:00Z"),
              used: 3,
              anchor: instant,
            },
            {
              source: "addon",
              status: "active",
              expiresAt: end,
              used: 2,
              anchor: instant,
            },
          ]
        : [],
    histories: [],
    operations: [],
    redemptions: [],
    events: [],
    deliveries: [],
    provisioning: 0,
    cacheDeletes: 0,
    sharing: 0,
  };
  let pending: State | null = null,
    beforeTransaction: State | null = null;
  const commands: string[] = [],
    contexts = new Set([JSON.stringify(scope)]);
  const registered = new Set<string>([ids.product, ids.bundled]);
  const faults = {
    sql: "",
    delivery: 0,
    access: true,
    published: true,
    voucher: true,
    occupied: false,
    openOrder: false,
    suspension: false,
    consumeCas: false,
  };
  const rows = (result: unknown[], rowCount = result.length) => ({
    rows: structuredClone(result),
    rowCount,
  });
  const readRows = (state: State, sql: string, values: unknown[]) => {
    if (sql.startsWith("select t.name tenant_name,w.name workspace_name")) {
      const current = {
        tenantId: String(values[0]),
        workspaceId: String(values[2]),
        userId: String(values[1]),
      };
      return faults.access && contexts.has(JSON.stringify(current))
        ? [{ tenant_name: "Test tenant", workspace_name: "Test workspace" }]
        : [];
    }
    if (
      sql.startsWith(
        "select request_hash,result from promotion.voucher_operations",
      ) ||
      sql.startsWith("select result from promotion.voucher_operations")
    ) {
      const operationType = sql.includes("'subscription_redemption'")
        ? "subscription_redemption"
        : "subscription_extension";
      return state.operations
        .filter(
          (r) =>
            r.actor === values[0] &&
            r.key === values[1] &&
            r.type === operationType &&
            (values.length < 4 ||
              (r.result.tenantId === values[2] &&
                r.result.workspaceId === values[3])),
        )
        .map((r) => ({ request_hash: r.hash, result: r.result }));
    }
    if (sql.startsWith("select v.id,v.batch_id,v.code,b.effect")) {
      expect(sql).toContain("b.status='active'");
      expect(sql).toContain("v.used_count=0");
      expect(sql).toContain("b.valid_until>clock_timestamp()");
      expect(sql).toContain("v.funding_order_id is null");
      expect(sql).toContain("v.claimed_at is not null");
      return faults.voucher &&
        values[0] === ids.voucher &&
        values[1] === state.voucher.tenant &&
        values[2] === state.voucher.user &&
        values[3] === state.voucher.workspace &&
        values[4] === kind &&
        state.voucher.used === 0 &&
        state.voucher.status === "assigned"
        ? [
            {
              id: ids.voucher,
              batch_id: ids.batch,
              code: "TEST-VOUCHER",
              effect,
            },
          ]
        : [];
    }
    if (sql.startsWith("select p.plan_name,p.plan_code,v.version_no")) {
      expect(values[0]).toBe(ids.plan);
      return faults.published
        ? [{ plan_name: "Test Pro", plan_code: "test-pro", version_no: 1 }]
        : [];
    }
    if (sql.startsWith("select pc.product_id,pr.product_code")) return grants;
    if (
      sql.startsWith("select 1 from metering.subscriptions where workspace_id")
    ) {
      expect(sql).toContain("union all select 1 from billing.orders");
      return state.subscription || faults.occupied || faults.openOrder
        ? [{ occupied: 1 }]
        : [];
    }
    if (sql.startsWith("select s.id,s.plan_version_id,s.status,s.end_at")) {
      expect(sql).toContain("s.subscription_kind<>'trial'");
      expect(sql).toContain("s.cycle_unit<>'perpetual'");
      expect(sql).toContain(
        "not exists(select 1 from metering.subscription_suspensions",
      );
      expect(sql).toContain("not exists(select 1 from billing.orders");
      const s = state.subscription;
      return s &&
        s.tenant_id === values[0] &&
        s.workspace_id === values[1] &&
        (!values[3] || s.id === values[3]) &&
        (!values[2] || (values[2] as string[]).includes("test")) &&
        ["active", "expiring", "overdue"].includes(s.status) &&
        s.subscription_kind !== "trial" &&
        s.cycle_unit !== "perpetual" &&
        !faults.suspension &&
        !faults.openOrder &&
        grants.every(
          (p) =>
            p.status === "active" &&
            !p.maintenance_window_id &&
            ["beta", "stable"].includes(p.release_stage),
        )
        ? [
            {
              ...s,
              product_code: "test",
              product_name: "Test",
              plan_name: "Test Pro",
              version_no: 1,
            },
          ]
        : [];
    }
    if (sql === "select clock_timestamp() now") return [{ now: instant }];
    return null;
  };
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
    commands.push(sql);
    if (faults.sql && sql.includes(faults.sql))
      throw new Error("injected SQL failure");
    if (sql === "begin") {
      if (pending) throw new Error("nested transaction");
      beforeTransaction = structuredClone(committed);
      pending = structuredClone(committed);
      return rows([]);
    }
    if (!pending) throw new Error("transaction query escaped caller");
    if (sql === "rollback") {
      pending = null;
      return rows([]);
    }
    if (sql === "commit") {
      committed = pending;
      pending = null;
      return rows([]);
    }
    const state = pending;
    if (sql.startsWith("select pg_advisory_xact_lock")) return rows([]);
    if (sql.startsWith("select id from tenancy.workspaces")) {
      expect(sql).toContain("for no key update");
      expect(values).toEqual([ids.workspace, ids.tenant]);
      return rows([{ id: ids.workspace }]);
    }
    if (sql.startsWith("select id from metering.subscriptions")) {
      expect(sql).toContain("for update");
      return rows(
        state.subscription &&
          state.subscription.id === values[0] &&
          state.subscription.tenant_id === values[1] &&
          state.subscription.workspace_id === values[2]
          ? [{ id: values[0] }]
          : [],
      );
    }
    if (sql.startsWith("select pr.id from product.products")) {
      expect(sql).toContain("for share of pr");
      return rows(grants.map((p) => ({ id: p.product_id })));
    }
    if (sql.startsWith("select b.id from promotion.voucher_batches")) {
      expect(sql).toContain("for update of b");
      return rows([{ id: ids.batch }]);
    }
    if (sql.startsWith("select c.product_id,p.product_code"))
      return rows(
        grants.map((p) => ({
          product_id: p.product_id,
          product_code: p.product_code,
        })),
      );
    const selected = readRows(state, sql, values);
    if (selected !== null) return rows(selected);
    // No business effect or queue entry may escape before COMMIT.
    expect(committed).toEqual(beforeTransaction);
    if (sql.startsWith("insert into metering.subscriptions")) {
      if (state.subscription) throw new Error("duplicate subscription");
      state.subscription = {
        ...subscriptionRow(),
        tenant_id: String(values[0]),
        workspace_id: String(values[1]),
        plan_version_id: String(values[2]),
        subscription_kind: String(values[3]),
        cycle_unit: String(values[4]),
        cycle_count: Number(values[5]),
        start_at: values[6] as Date,
        end_at: values[7] as Date,
        status: String(values[9]),
        activation_method: String(values[10]),
        auto_renew: Boolean(values[11]),
        next_renewal_at: null,
        pay_amount: String(values[12]),
        currency: String(values[13]),
      };
      return rows([state.subscription]);
    }
    if (sql.startsWith("insert into metering.quota_pools")) {
      expect(values).toEqual([ids.subscription, ids.workspace, ids.plan]);
      state.pools = grants.map(() => ({
        source: "subscription",
        status: "active",
        expiresAt: state.subscription!.end_at,
        used: 0,
        anchor: instant,
      }));
      return rows([]);
    }
    if (sql.startsWith("insert into metering.resource_sharing_policies")) {
      state.sharing++;
      return rows([]);
    }
    if (sql.startsWith("insert into metering.subscription_histories")) {
      state.histories.push(values);
      return rows([]);
    }
    if (sql === "update metering.subscriptions set paid_amount=0 where id=$1") {
      state.subscription!.paid_amount = "0";
      return rows([]);
    }
    if (sql.startsWith("delete from metering.entitlement_caches")) {
      state.cacheDeletes++;
      return rows([]);
    }
    if (sql.startsWith("update metering.quota_pools set expires_at")) {
      expect(sql).toContain("pool_source='subscription'");
      expect(sql).toContain(
        "expires_at=(select end_at from metering.subscriptions",
      );
      const days = Number(values[1]);
      for (const p of state.pools)
        if (
          p.source === "subscription" &&
          p.status === "active" &&
          p.expiresAt.getTime() === state.subscription!.end_at.getTime()
        )
          p.expiresAt = new Date(p.expiresAt.getTime() + days * 86400000);
      return rows([]);
    }
    if (sql.startsWith("update metering.subscriptions set end_at=end_at+")) {
      const s = state.subscription!;
      const ms = Number(values[1]) * 86400000;
      s.end_at = new Date(s.end_at.getTime() + ms);
      if (s.auto_renew && s.next_renewal_at)
        s.next_renewal_at = new Date(s.next_renewal_at.getTime() + ms);
      return rows([{ end_at: s.end_at }]);
    }
    if (sql.startsWith("insert into promotion.voucher_operations")) {
      const op = {
        key: String(values[2]),
        hash: String(values[3]),
        actor: String(values[1]),
        type:
          kind === "redemption"
            ? "subscription_redemption"
            : "subscription_extension",
        result: JSON.parse(String(values[5])) as Receipt["result"],
      };
      if (
        state.operations.some(
          (r) => r.key === op.key && r.actor === op.actor && r.type === op.type,
        )
      )
        throw new Error("duplicate receipt");
      state.operations.push(op);
      return rows([]);
    }
    if (sql.startsWith("update promotion.vouchers set status='redeemed'")) {
      expect(sql).toContain(
        "status='assigned' and used_count=0 and max_uses=1",
      );
      if (
        faults.consumeCas ||
        state.voucher.used !== 0 ||
        state.voucher.status !== "assigned"
      )
        return rows([]);
      state.voucher.used++;
      state.voucher.status = "redeemed";
      return rows([], 1);
    }
    if (sql.startsWith("insert into promotion.voucher_redemptions")) {
      state.redemptions.push(values);
      return rows([{ id: "redemption-1" }]);
    }
    if (sql.startsWith("insert into promotion.voucher_events")) {
      state.events.push(values);
      return rows([]);
    }
    if (sql.startsWith("insert into provisioning.provisionings")) {
      state.provisioning++;
      return rows([{ id: "provisioning-1", version: 1 }]);
    }
    if (sql.startsWith("insert into provisioning.webhook_deliveries")) {
      const generic = sql.includes("where exists"),
        productId = String(values[generic ? 4 : 6]);
      if (generic && !registered.has(productId)) return rows([]);
      if (state.deliveries.length + 1 === faults.delivery)
        throw new Error("outbox unavailable");
      const key = String(values[1]);
      if (state.deliveries.some((d) => d.key === key)) return rows([]);
      state.deliveries.push({
        key,
        event: String(values[generic ? 5 : 7]),
        productId,
        payload: JSON.parse(String(values[generic ? 6 : 8])) as Record<
          string,
          unknown
        >,
      });
      return rows([{ id: "delivery-1" }]);
    }
    throw new Error("unexpected SQL: " + sql);
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      if (pending) throw new Error("pool query escaped open transaction");
      const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (!sql.startsWith("select "))
        throw new Error("pool write escaped transaction");
      const selected = readRows(committed, sql, values);
      if (selected === null) throw new Error("unexpected pool SQL: " + sql);
      return rows(selected);
    }),
  };
  const db = pool as unknown as Pool;
  const command: ExtensionCommand = {
    voucherId: ids.voucher,
    subscriptionId: ids.subscription,
    expectedEndAt: end.toISOString(),
    expectedPlanVersionId: ids.plan,
    idempotencyKey: "atomic-request-1",
  };
  const apply = (
    patch: Partial<ExtensionCommand> = {},
    current: Scope = scope,
  ) =>
    kind === "redemption"
      ? redeemSubscriptionVoucher(db, current, { ...command, ...patch })
      : extendSubscriptionVoucher(db, current, { ...command, ...patch });
  const recover = (key = command.idempotencyKey, current: Scope = scope) =>
    kind === "redemption"
      ? subscriptionVoucherResult(db, current, key)
      : subscriptionExtensionResult(db, current, key);
  const preview = () =>
    kind === "redemption"
      ? previewSubscriptionVoucher(db, scope, ids.voucher)
      : previewSubscriptionExtension(db, scope, ids.voucher);
  return {
    apply,
    recover,
    preview,
    command,
    client,
    pool,
    commands,
    faults,
    grants,
    effect,
    registered,
    state: () => committed,
    mutate: (fn: (s: State) => void) => fn(committed),
    allowScope: (current: Scope) => contexts.add(JSON.stringify(current)),
  };
}

// ============================================================================
// Full composition, invisible pending effects, rollback and identical retries.
// ============================================================================
describe.each(["redemption", "extension"] as const)(
  "%s required notification atomicity",
  (kind) => {
    it("commits effect, quota, history, receipt, consumption, audit and each product notification together", async () => {
      const h = build(kind),
        before = structuredClone(h.state());
      const result = await h.apply();
      expect(result.subscriptionId).toBe(ids.subscription);
      expect(h.state().voucher).toMatchObject({ status: "redeemed", used: 1 });
      expect(h.state().operations).toHaveLength(1);
      expect(h.state().redemptions).toHaveLength(1);
      expect(h.state().events).toHaveLength(1);
      expect(h.state().histories).toHaveLength(1);
      expect(h.state().cacheDeletes).toBe(1);
      expect(h.state().deliveries).toHaveLength(kind === "redemption" ? 4 : 2);
      expect(h.state().deliveries.map((d) => d.productId)).toEqual(
        kind === "redemption"
          ? [ids.product, ids.product, ids.bundled, ids.bundled]
          : [ids.product, ids.bundled],
      );
      expect(h.commands[0]).toBe("begin");
      expect(h.commands.at(-1)).toBe("commit");
      expect(h.commands.filter((c) => c === "begin")).toHaveLength(1);
      expect(h.commands.filter((c) => c === "commit")).toHaveLength(1);
      expect(h.pool.connect).toHaveBeenCalledOnce();
      expect(h.client.release).toHaveBeenCalledOnce();
      expect(h.pool.query).not.toHaveBeenCalled();
      if (kind === "redemption") {
        expect(h.state().subscription).toMatchObject({
          activation_method: "redemption",
          subscription_kind: "free",
          auto_renew: false,
          pay_amount: "0",
          paid_amount: "0",
        });
        expect(Date.parse(result.endAt)).toBe(
          instant.getTime() + 30 * 86400000,
        );
      } else {
        expect(h.state().subscription?.end_at.getTime()).toBe(
          end.getTime() + 30 * 86400000,
        );
        expect(
          h.state().pools.map((p) => ({ used: p.used, anchor: p.anchor })),
        ).toEqual(
          before.pools.map((p) => ({ used: p.used, anchor: p.anchor })),
        );
        expect(h.state().pools[0]!.expiresAt.getTime()).toBe(
          end.getTime() + 30 * 86400000,
        );
        expect(h.state().pools.slice(1)).toEqual(before.pools.slice(1));
      }
    });
    const failures = [
      [
        "subscription",
        kind === "redemption"
          ? "insert into metering.subscriptions"
          : "update metering.subscriptions set end_at=end_at+",
      ],
      [
        "quota",
        kind === "redemption"
          ? "insert into metering.quota_pools"
          : "update metering.quota_pools set expires_at",
      ],
      ["history", "insert into metering.subscription_histories"],
      ["cache", "delete from metering.entitlement_caches"],
      ["receipt", "insert into promotion.voucher_operations"],
      ["consume", "update promotion.vouchers"],
      ["redemption evidence", "insert into promotion.voucher_redemptions"],
      ["audit", "insert into promotion.voucher_events"],
      ["commit", "commit"],
    ];
    it.each(failures)(
      "rolls back %s failure, recovers no receipt, then retries exactly once",
      async (_name, sql) => {
        const h = build(kind),
          before = structuredClone(h.state());
        h.faults.sql = sql!;
        await expect(h.apply()).rejects.toThrow("injected SQL failure");
        expect(h.state()).toEqual(before);
        expect(h.commands.at(-1)).toBe("rollback");
        if (_name === "commit") {
          // A rejected COMMIT was attempted; the state must still match before.
          expect(h.commands.slice(-2)).toEqual(["commit", "rollback"]);
        } else {
          expect(h.commands).not.toContain("commit");
        }
        expect(await h.recover()).toBeNull();
        h.faults.sql = "";
        const result = await h.apply(),
          after = structuredClone(h.state());
        expect(await h.recover()).toEqual(result);
        expect(await h.apply()).toEqual(result);
        expect(h.state()).toEqual(after);
        expect(after.events).toHaveLength(1);
        expect(after.redemptions).toHaveLength(1);
        expect(after.voucher.used).toBe(1);
        expect(after.subscription?.end_at.getTime()).toBe(
          (kind === "redemption" ? instant : end).getTime() + 30 * 86400000,
        );
        expect(h.client.release).toHaveBeenCalledTimes(3);
      },
    );
    it.each(kind === "redemption" ? [1, 2, 3, 4] : [1, 2])(
      "rolls back all effects when queued delivery %i fails",
      async (delivery) => {
        const h = build(kind),
          before = structuredClone(h.state());
        h.faults.delivery = delivery;
        await expect(h.apply()).rejects.toThrow("outbox unavailable");
        expect(h.state()).toEqual(before);
        expect(h.state().deliveries).toHaveLength(0);
        expect(await h.recover()).toBeNull();
        h.faults.delivery = 0;
        await h.apply();
        expect(h.state().deliveries).toHaveLength(
          kind === "redemption" ? 4 : 2,
        );
      },
    );
    it("rolls every effect back on a failed voucher-consumption CAS", async () => {
      const h = build(kind),
        before = structuredClone(h.state());
      h.faults.consumeCas = true;
      await expect(h.apply()).rejects.toThrow(/已被使用/);
      expect(h.state()).toEqual(before);
      expect(await h.recover()).toBeNull();
    });
    it("recovers a lost response and replays the same receipt without another effect or notification", async () => {
      const h = build(kind),
        result = await h.apply(),
        after = structuredClone(h.state());
      expect(await h.recover()).toEqual(result);
      expect(await h.apply()).toEqual(result);
      expect(h.state()).toEqual(after);
    });
    it("rejects a changed voucher under a used request key and keeps the original receipt", async () => {
      const h = build(kind),
        result = await h.apply(),
        after = structuredClone(h.state());
      await expect(h.apply({ voucherId: ids.other })).rejects.toThrow(
        /参数或上下文/,
      );
      expect(h.state()).toEqual(after);
      expect(await h.recover()).toEqual(result);
    });
    it.each(["tenantId", "workspaceId", "userId"] as const)(
      "never returns a receipt to another %s",
      async (field) => {
        const h = build(kind);
        await h.apply();
        const after = structuredClone(h.state());
        const other = { ...scope, [field]: ids.other };
        h.allowScope(other);
        expect(await h.recover(h.command.idempotencyKey, other)).toBeNull();
        await expect(h.apply({}, other)).rejects.toThrow();
        expect(h.state()).toEqual(after);
      },
    );
    it("revalidates access before replaying an already committed receipt", async () => {
      const h = build(kind);
      await h.apply();
      const after = structuredClone(h.state());
      h.faults.access = false;
      await expect(h.apply()).rejects.toThrow(/不可访问/);
      await expect(h.recover()).rejects.toThrow(/不可访问/);
      expect(h.state()).toEqual(after);
    });
    it("does not consume again under a new request key", async () => {
      const h = build(kind);
      await h.apply();
      const after = structuredClone(h.state());
      await expect(h.apply({ idempotencyKey: "new-key" })).rejects.toThrow();
      expect(h.state()).toEqual(after);
    });
    it("previews without reserving, writing a receipt, changing service or opening a transaction", async () => {
      const h = build(kind),
        before = structuredClone(h.state());
      expect(await h.preview()).toBeDefined();
      expect(h.state()).toEqual(before);
      expect(h.pool.connect).not.toHaveBeenCalled();
      expect(h.commands).toHaveLength(0);
    });
    it("locks destination before batch and voucher consumption", async () => {
      const h = build(kind);
      await h.apply();
      const workspace = h.commands.findIndex((c) =>
          c.includes("for no key update"),
        ),
        batch = h.commands.findIndex((c) => c.includes("for update of b")),
        voucher = h.commands.findIndex((c) => c.includes("for update of v"));
      expect(workspace).toBeGreaterThan(0);
      expect(batch).toBeGreaterThan(workspace);
      expect(voucher).toBeGreaterThan(batch);
      if (kind === "extension")
        expect(
          h.commands.findIndex(
            (c) =>
              c.includes("from metering.subscriptions") &&
              c.includes("for update"),
          ),
        ).toBeLessThan(batch);
    });
    it("omits only generic notifications for products without a webhook registration", async () => {
      const h = build(kind);
      h.registered.clear();
      await h.apply();
      expect(h.state().voucher.used).toBe(1);
      expect(h.state().deliveries.map((d) => d.event)).toEqual(
        kind === "redemption"
          ? ["tenant.provisioned", "tenant.provisioned"]
          : [],
      );
    });
    it.each(["voucherId", "idempotencyKey"] as const)(
      "rejects malformed %s before opening a transaction",
      async (field) => {
        const h = build(kind);
        await expect(h.apply({ [field]: "invalid input" })).rejects.toThrow();
        expect(h.pool.connect).not.toHaveBeenCalled();
        expect(h.pool.query).not.toHaveBeenCalled();
      },
    );
  },
);

// ============================================================================
// Existing business guards remain in the real domain, with no test-only bypass.
// ============================================================================
describe("redemption catalog and extension baseline guards", () => {
  it.each(["occupied", "openOrder"] as const)(
    "rejects a redemption %s without any side effect",
    async (gate) => {
      const h = build("redemption"),
        before = structuredClone(h.state());
      h.faults[gate] = true;
      await expect(h.apply()).rejects.toThrow(/已有/);
      expect(h.state()).toEqual(before);
    },
  );
  it("rejects an unpublished fixed redemption plan", async () => {
    const h = build("redemption"),
      before = structuredClone(h.state());
    h.faults.published = false;
    await expect(h.apply()).rejects.toThrow(/未发布/);
    expect(h.state()).toEqual(before);
  });
  it.each(["maintenance", "retired", "stage"])(
    "rejects a bundled product's %s gate",
    async (gate) => {
      const h = build("redemption"),
        before = structuredClone(h.state());
      if (gate === "maintenance")
        h.grants[1]!.maintenance_window_id = ids.other;
      else if (gate === "retired") h.grants[1]!.status = "inactive";
      else h.grants[1]!.release_stage = "development";
      await expect(h.apply()).rejects.toThrow(/未开放/);
      expect(h.state()).toEqual(before);
    },
  );
  it.each([0, 3651, 1.5])(
    "rejects redemption duration %s before changing service",
    async (days) => {
      const h = build("redemption"),
        before = structuredClone(h.state());
      h.effect.duration_days = days;
      await expect(h.apply()).rejects.toThrow();
      expect(h.state()).toEqual(before);
    },
  );
  it.each([
    "expectedEndAt",
    "expectedPlanVersionId",
    "subscriptionId",
  ] as const)(
    "rejects a stale extension %s without consuming",
    async (field) => {
      const h = build("extension"),
        before = structuredClone(h.state());
      await expect(
        h.apply({
          [field]:
            field === "expectedEndAt" ? "2027-01-02T00:00:00Z" : ids.other,
        }),
      ).rejects.toThrow();
      expect(h.state()).toEqual(before);
    },
  );
  it.each([
    "expectedEndAt",
    "expectedPlanVersionId",
    "subscriptionId",
  ] as const)("binds the extension receipt to %s", async (field) => {
    const h = build("extension");
    await h.apply();
    const after = structuredClone(h.state());
    await expect(
      h.apply({
        [field]: field === "expectedEndAt" ? "2027-01-02T00:00:00Z" : ids.other,
      }),
    ).rejects.toThrow(/参数或上下文/);
    expect(h.state()).toEqual(after);
  });
  it.each([
    "trial",
    "perpetual",
    "suspended",
    "openOrder",
    "episode",
    "maintenance",
  ])("retains the extension %s exclusion", async (gate) => {
    const h = build("extension");
    h.mutate((s) => {
      if (gate === "trial") s.subscription!.subscription_kind = "trial";
      else if (gate === "perpetual") s.subscription!.cycle_unit = "perpetual";
      else if (gate === "suspended") s.subscription!.status = "suspended";
    });
    if (gate === "openOrder") h.faults.openOrder = true;
    else if (gate === "episode") h.faults.suspension = true;
    else if (gate === "maintenance")
      h.grants[1]!.maintenance_window_id = ids.other;
    const before = structuredClone(h.state());
    await expect(h.apply()).rejects.toThrow(/重新预览/);
    expect(h.state()).toEqual(before);
  });
  it("extends by exactly 24-hour days without changing status, plan, renewal choice, payment or quota usage", async () => {
    const h = build("extension"),
      before = structuredClone(h.state().subscription);
    await h.apply();
    const after = h.state().subscription!;
    expect(after).toEqual({
      ...before,
      end_at: new Date(end.getTime() + 30 * 86400000),
      next_renewal_at: new Date(end.getTime() + 30 * 86400000),
    });
  });
  it("retains disabled renewal and its null next-renewal date", async () => {
    const h = build("extension");
    h.mutate((s) => {
      s.subscription!.auto_renew = false;
      s.subscription!.next_renewal_at = null;
    });
    await h.apply();
    expect(h.state().subscription).toMatchObject({
      auto_renew: false,
      next_renewal_at: null,
    });
  });
  it("rejects an unknown SQL path instead of silently accepting an untested write", async () => {
    const h = build("redemption");
    await h.client.query("begin");
    await expect(
      h.client.query("update unapproved.table set value=1"),
    ).rejects.toThrow("unexpected SQL");
    await h.client.query("rollback");
  });
});
