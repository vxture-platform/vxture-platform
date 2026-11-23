/**
 * subscription-notification-atomic.spec.ts - Operator lifecycle/outbox composition faults.
 * @package @vxture/bff-admin
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-23
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { Request } from "express";
// ⚠️ 跨层引用: Exercise the public domain/repository composition without network I/O.
import {
  PgSubscriptionRepository,
  SubscriptionService,
  type OrderService,
} from "@vxture/service-subscription";
// ⚠️ 跨层引用: Required product events use the real durable queue implementation.
import {
  PgProvisioningRepository,
  ProvisioningService,
} from "@vxture/service-provisioning";
import { SubscriptionsRouter } from "./subscriptions.router";
import type { RequestContext } from "../types/console.types";

// ============================================================================
// Strict SQL transaction double. This is not a PostgreSQL/lock/role test.
// All business orchestration, repository methods and queue writes remain real.
// ============================================================================
const ID = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-23T09:00:00.000Z");
const END = new Date("2026-12-23T09:00:00.000Z");
const ANCHOR = new Date("2026-10-23T09:00:00.000Z");
type Action = "renew" | "suspend" | "resume" | "cancel";
function rowFixture(status: string) {
  return {
    id: ID,
    tenant_id: TENANT,
    workspace_id: "ws-test",
    product_id: "p1",
    plan_version_id: "pv-1",
    status,
    cycle_unit: "month",
    cycle_count: 1,
    start_at: ANCHOR,
    end_at: END as Date | null,
    trial_end_at: null,
    auto_renew: status !== "suspended",
    subscription_kind: "paid",
    activation_method: "online_purchase",
    pay_amount: "0.80",
    currency: "CNY",
    created_by_id: "customer-1",
    created_at: ANCHOR,
    updated_at: ANCHOR,
    deleted_at: null as Date | null,
  };
}
type Episode = {
  id: string;
  subscription_id: string;
  reason: string;
  reason_note: string | null;
  extends_term: boolean;
  auto_renew_before: boolean | null;
  paused_at: Date;
  resumed_at: Date | null;
  granted_seconds: number | null;
  expected_resume_at: Date | string | null;
};
type State = {
  row: ReturnType<typeof rowFixture>;
  history: unknown[][];
  episodes: Episode[];
  pools: {
    id: string;
    status: string;
    reset: string;
    anchor: Date;
    used: number;
  }[];
  provisions: Record<string, { status: string; version: number }>;
  deliveries: {
    event: string;
    product: string;
    payload: Record<string, unknown>;
  }[];
};
function request(
  capabilities = ["commerce:subscription.manage"],
): Request & RequestContext {
  return {
    user: { id: ACTOR },
    capabilities,
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

function build(
  action: Action,
  options: {
    status?: string;
    endAt?: Date | null;
    cycle?: string;
    cycleCount?: number;
    extendsTerm?: boolean;
    autoRenewBefore?: boolean | null;
    episode?: boolean;
    covered?: boolean;
    unregistered?: boolean;
  } = {},
) {
  const status =
    options.status ?? (action === "resume" ? "suspended" : "active");
  let committed: State = {
    row: {
      ...rowFixture(status),
      ...(options.endAt !== undefined ? { end_at: options.endAt } : {}),
      cycle_unit: options.cycle ?? "month",
      cycle_count: options.cycleCount ?? 1,
    },
    history: [],
    episodes:
      status === "suspended" && options.episode !== false
        ? [
            {
              id: "episode-1",
              subscription_id: ID,
              reason:
                options.extendsTerm === false
                  ? "customer_violation"
                  : "platform_ops",
              reason_note: "original reason",
              extends_term: options.extendsTerm ?? true,
              auto_renew_before:
                options.autoRenewBefore === undefined
                  ? true
                  : options.autoRenewBefore,
              paused_at: new Date(NOW.getTime() - 86_400_001),
              resumed_at: null,
              granted_seconds: null,
              expected_resume_at: null,
            },
          ]
        : [],
    pools: [
      {
        id: "periodic",
        status: "active",
        reset: "month",
        anchor: ANCHOR,
        used: 7,
      },
      {
        id: "nonperiodic",
        status: "active",
        reset: "none",
        anchor: ANCHOR,
        used: 3,
      },
      {
        id: "inactive",
        status: "closed",
        reset: "month",
        anchor: ANCHOR,
        used: 2,
      },
    ],
    provisions: {},
    deliveries: [],
  };
  const baseline = structuredClone(committed);
  let pending: State | null = null;
  let transactionBefore = baseline;
  let locked = false;
  let commitCount = 0;
  let attemptedDeliveries = 0;
  const commands: string[] = [];
  const faults = { sql: "", delivery: 0 };
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
    commands.push(sql);
    if (faults.sql && sql.includes(faults.sql))
      throw new Error("injected SQL failure");
    if (sql === "begin") {
      if (pending) throw new Error("nested transaction");
      transactionBefore = structuredClone(committed);
      pending = structuredClone(committed);
      locked = false;
      attemptedDeliveries = 0;
      return { rows: [], rowCount: 0 };
    }
    if (!pending) throw new Error("query outside caller transaction");
    if (sql === "rollback") {
      pending = null;
      return { rows: [], rowCount: 0 };
    }
    if (sql === "commit") {
      committed = pending;
      pending = null;
      commitCount++;
      return { rows: [], rowCount: 0 };
    }
    expect(committed).toEqual(transactionBefore);
    const row = pending.row;
    if (
      sql.includes("for update of s") &&
      sql.includes("as effective_end_at")
    ) {
      expect(values).toEqual([ID]);
      expect(sql).toContain("s.deleted_at is null");
      locked = true;
      const open = pending.episodes.find(
        (e) => e.resumed_at === null && e.extends_term,
      );
      return {
        rows: row.deleted_at
          ? []
          : [
              {
                ...row,
                effective_end_at: row.end_at
                  ? new Date(
                      row.end_at.getTime() +
                        (open ? NOW.getTime() - open.paused_at.getTime() : 0),
                    )
                  : null,
              },
            ],
        rowCount: 1,
      };
    }
    if (!locked) throw new Error("business work before subscription lock");
    if (sql.startsWith("update metering.subscriptions s set")) {
      expect(values[0]).toBe(ID);
      expect(sql).toContain("make_interval(");
      expect(sql).toContain(
        "when $3 = 'renew' and s.subscription_kind = 'trial' then 'paid'",
      );
      row.status = String(values[1]);
      if (values[2] === "suspend" || values[2] === "cancel")
        row.auto_renew = false;
      if (values[2] === "cancel") {
        expect(sql).toContain(
          "when $3 = 'cancel' and s.cycle_unit <> 'perpetual' then now()",
        );
        if (row.cycle_unit !== "perpetual") row.end_at = NOW;
      }
      if (values[2] === "renew") {
        if (row.subscription_kind === "trial") row.subscription_kind = "paid";
        if (row.cycle_unit !== "perpetual") {
          const next = new Date(
            Math.max(row.end_at?.getTime() ?? 0, NOW.getTime()),
          );
          if (row.cycle_unit === "month")
            next.setUTCMonth(next.getUTCMonth() + row.cycle_count);
          else if (row.cycle_unit === "year")
            next.setUTCFullYear(next.getUTCFullYear() + row.cycle_count);
          else
            next.setUTCDate(
              next.getUTCDate() +
                row.cycle_count * (row.cycle_unit === "week" ? 7 : 1),
            );
          row.end_at = next;
        }
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("insert into metering.subscription_histories")) {
      expect(values.slice(0, 2)).toEqual([TENANT, ID]);
      expect(values[5]).toBe(ACTOR);
      expect(sql).toContain("'operator'");
      pending.history.push(values);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("insert into metering.subscription_suspensions")) {
      if (pending.episodes.some((e) => e.resumed_at === null))
        throw new Error("duplicate open episode");
      pending.episodes.push({
        id: "episode-new",
        subscription_id: String(values[0]),
        reason: String(values[2]),
        reason_note: values[3] as string | null,
        extends_term: Boolean(values[4]),
        auto_renew_before: values[5] as boolean,
        paused_at: NOW,
        resumed_at: null,
        granted_seconds: null,
        expected_resume_at: values[6] as string | null,
      });
      return { rows: [], rowCount: 1 };
    }
    if (
      sql.startsWith("update metering.subscription_suspensions set resumed_at")
    ) {
      expect(sql).toContain("resumed_at is null");
      const episode = pending.episodes.find((e) => e.resumed_at === null);
      if (!episode) return { rows: [], rowCount: 0 };
      episode.resumed_at = NOW;
      return {
        rows: [
          { id: episode.id, auto_renew_before: episode.auto_renew_before },
        ],
        rowCount: 1,
      };
    }
    if (sql.startsWith("update metering.subscriptions set auto_renew")) {
      row.auto_renew = Boolean(values[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("select * from metering.subscriptions")) {
      expect(values).toEqual([ID]);
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (sql.startsWith("select sus.id") && sql.includes("as granted_seconds")) {
      expect(sql).toContain("for update of sus skip locked");
      expect(values).toEqual([ID, 100, ["episode-1"]]);
      return {
        rows: pending.episodes
          .filter(
            (e) =>
              e.resumed_at &&
              e.granted_seconds === null &&
              (values[2] as string[]).includes(e.id),
          )
          .slice(0, 100)
          .map((e) => ({
            id: e.id,
            subscription_id: ID,
            granted_seconds: String(
              e.extends_term
                ? Math.ceil(
                    (e.resumed_at!.getTime() - e.paused_at.getTime()) /
                      86_400_000,
                  ) * 86400
                : 0,
            ),
            has_end_at: row.end_at !== null,
          })),
        rowCount: 1,
      };
    }
    if (
      sql.startsWith(
        "update metering.subscription_suspensions set granted_seconds",
      )
    ) {
      const episode = pending.episodes.find(
        (e) => e.id === values[0] && e.granted_seconds === null,
      );
      if (!episode) throw new Error("unlocked settlement");
      episode.granted_seconds = Number(values[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("update metering.subscriptions set end_at = end_at +")) {
      if (!row.end_at) throw new Error("perpetual term fabricated");
      row.end_at = new Date(row.end_at.getTime() + Number(values[1]) * 1000);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("update metering.quota_pools set period_anchor")) {
      expect(values).toEqual([ID]);
      expect(sql).toContain("status = 'active' and reset_period <> 'none'");
      for (const pool of pending.pools)
        if (pool.status === "active" && pool.reset !== "none")
          pool.anchor = NOW;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("select pc.product_id")) {
      expect(values).toEqual(["pv-1"]);
      return {
        rows: ["p1", "p2"].map((id) => ({
          product_id: id,
          product_code: id,
          plan_code: "pro",
        })),
        rowCount: 2,
      };
    }
    if (sql.startsWith("select exists"))
      return { rows: [{ exists: options.covered ?? false }], rowCount: 1 };
    if (sql.startsWith("insert into provisioning.provisionings")) {
      const key = String(values[2]),
        old = pending.provisions[key];
      pending.provisions[key] = {
        status: String(values[3]),
        version: (old?.version ?? 0) + 1,
      };
      return {
        rows: [
          { id: "prov-" + key, version: pending.provisions[key]!.version },
        ],
        rowCount: 1,
      };
    }
    if (sql.startsWith("insert into provisioning.webhook_deliveries")) {
      attemptedDeliveries++;
      if (faults.delivery === attemptedDeliveries)
        throw new Error("required outbox unavailable");
      const generic = sql.includes("where exists");
      if (generic && options.unregistered) return { rows: [], rowCount: 0 };
      const event = String(values[generic ? 5 : 7]),
        product = String(values[generic ? 4 : 6]);
      pending.deliveries.push({
        event,
        product,
        payload: JSON.parse(String(values[generic ? 6 : 8])) as Record<
          string,
          unknown
        >,
      });
      return {
        rows: [{ id: "delivery-" + pending.deliveries.length }],
        rowCount: 1,
      };
    }
    throw new Error("unexpected transaction SQL: " + sql);
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (text: string) => {
      const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (pending) throw new Error("pool access before caller commit");
      if (!sql.startsWith("select "))
        throw new Error("pool write outside transaction");
      if (!sql.startsWith("select s.id, s.tenant_id, s.end_at"))
        throw new Error("unexpected domain pool read: " + sql);
      return {
        rows: [
          { ...committed.row, plan_name: "Pro", product_name: "Test product" },
        ],
      };
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
  const service = new SubscriptionService(repo, provisioning);
  const notices: State[] = [];
  const notifier = {
    notify: vi.fn(async () => {
      expect(pending).toBeNull();
      expect(commitCount).toBe(1);
      notices.push(structuredClone(committed));
    }),
  };
  service.setCustomerNotifier(notifier);
  const settlements: State[] = [];
  // Independent money settlement is a controlled application port, never a transfer.
  const settleAfterCancel = vi.fn(async () => {
    expect(pending).toBeNull();
    expect(commitCount).toBe(1);
    settlements.push(structuredClone(committed));
  });
  const ro = {
    query: vi.fn(async (text: string) => {
      const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
      expect(pending).toBeNull();
      expect(commitCount).toBe(1);
      if (sql.includes("from metering.subscriptions s"))
        return {
          rows: [
            {
              ...committed.row,
              raw_status: committed.row.status,
              effective_end_at: committed.row.end_at,
              current_order_no: "ORD-TEST",
              created_by_type: "customer",
              tenant_code: "test",
              tenant_name: "Test tenant",
              tenant_type: "organization",
              tenant_status: "active",
              industry: null,
              country_code: null,
              plan_code: "pro",
              plan_name: "Pro",
              solution_code: null,
              solution_name: null,
              operator_name: null,
              tier_code: "pro",
              quota_limit_sum: null,
              seat_max: null,
              seat_used: null,
              quota_used_sum: null,
            },
          ],
        };
      if (
        sql.includes("from product.plan_components") ||
        sql.includes("from metering.subscription_histories") ||
        sql.includes("from metering.subscription_renewals") ||
        sql.includes("from metering.subscription_suspensions")
      )
        return { rows: [] };
      throw new Error("unexpected detail SQL: " + sql);
    }),
  };
  const router = new SubscriptionsRouter(
    ro as unknown as Pool,
    pool as unknown as Pool,
    service,
    { settleAfterCancel } as unknown as OrderService,
  );
  const body = {
    action,
    reason: "operator audit note",
    suspendReason: "platform_ops",
    expectedResumeAt: "2026-11-25T09:00:00.000Z",
  };
  return {
    router,
    service,
    repo,
    provisioning,
    client,
    pool,
    ro,
    commands,
    faults,
    baseline,
    notifier,
    notices,
    settleAfterCancel,
    settlements,
    state: () => committed,
    commits: () => commitCount,
    run: () => router.runSubscriptionAction(request(), ID, body),
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

// ============================================================================
// Successful actions preserve the original business axes and post-commit ports.
// ============================================================================
describe("operator action and required product outbox atomicity", () => {
  it.each(["renew", "suspend", "resume", "cancel"] as const)(
    "%s commits state/history/episode/queues once before optional effects",
    async (action) => {
      const h = build(action);
      const dispatch = vi.spyOn(h.provisioning, "dispatchPending");
      const result = await h.run();
      expect(h.commits()).toBe(1);
      expect(h.commands.filter((c) => c === "begin")).toHaveLength(1);
      expect(h.commands.at(-1)).toBe("commit");
      expect(h.client.release).toHaveBeenCalledOnce();
      expect(h.pool.connect).toHaveBeenCalledOnce();
      expect(result.rawStatus).toBe(
        action === "suspend"
          ? "suspended"
          : action === "cancel"
            ? "cancelled"
            : "active",
      );
      expect(h.state().history).toHaveLength(1);
      expect(h.state().history[0]?.[2]).toBe(
        {
          renew: "renewed",
          suspend: "suspended",
          resume: "resumed",
          cancel: "cancelled",
        }[action],
      );
      expect(
        h
          .state()
          .deliveries.filter((d) => d.event === "subscription_changed")
          .map((d) => d.product),
      ).toEqual(["p1", "p2"]);
      expect(
        h.state().deliveries.filter((d) => d.event !== "subscription_changed"),
      ).toHaveLength(action === "resume" || action === "cancel" ? 2 : 0);
      for (const delivery of h.state().deliveries) {
        expect(delivery.payload).toEqual(
          expect.objectContaining({
            workspace_id: "ws-test",
            tenant_id: TENANT,
            application: delivery.product,
          }),
        );
      }
      if (action === "resume") {
        expect(h.state().episodes[0]?.granted_seconds).toBe(172800);
        expect(h.state().row.end_at?.getTime()).toBe(
          END.getTime() + 172_800_000,
        );
        expect(h.state().row.auto_renew).toBe(true);
        expect(h.notices[0]?.row.end_at).toEqual(h.state().row.end_at);
      }
      if (action === "suspend") {
        expect(h.state().row.auto_renew).toBe(false);
        expect(h.state().episodes[0]).toEqual(
          expect.objectContaining({
            reason: "platform_ops",
            reason_note: "operator audit note",
            extends_term: true,
            auto_renew_before: true,
            granted_seconds: null,
          }),
        );
      }
      expect(h.notifier.notify).toHaveBeenCalledTimes(
        action === "cancel" ? 0 : 1,
      );
      expect(h.settleAfterCancel).toHaveBeenCalledTimes(
        action === "cancel" ? 1 : 0,
      );
      expect(h.state().pools).toEqual(h.baseline.pools);
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  for (const action of ["renew", "suspend", "resume", "cancel"] as const) {
    const failures = [
      "update metering.subscriptions s set",
      "insert into metering.subscription_histories",
      "select pc.product_id",
      "delivery-1",
      "delivery-2",
      "commit",
    ];
    if (action === "suspend")
      failures.push("insert into metering.subscription_suspensions");
    if (action === "resume")
      failures.push(
        "update metering.subscription_suspensions set resumed_at",
        "update metering.subscriptions set auto_renew",
        "select sus.id",
        "update metering.subscription_suspensions set granted_seconds",
        "update metering.subscriptions set end_at = end_at +",
        "insert into provisioning.provisionings",
        "delivery-4",
      );
    if (action === "cancel")
      failures.push("insert into provisioning.provisionings", "delivery-4");
    it.each(failures)(
      action + " rolls back and safely retries after %s failure",
      async (failure) => {
        const h = build(action);
        if (failure.startsWith("delivery-"))
          h.faults.delivery = Number(failure.slice(9));
        else h.faults.sql = failure;
        await expect(h.run()).rejects.toThrow(
          h.faults.delivery
            ? "required outbox unavailable"
            : "injected SQL failure",
        );
        expect(h.commits()).toBe(0);
        expect(h.state()).toEqual(h.baseline);
        expect(h.commands.at(-1)).toBe("rollback");
        if (failure === "commit") {
          expect(h.commands.slice(-2)).toEqual(["commit", "rollback"]);
        } else {
          expect(h.commands).not.toContain("commit");
        }
        expect(h.client.release).toHaveBeenCalledOnce();
        expect(h.notifier.notify).not.toHaveBeenCalled();
        expect(h.settleAfterCancel).not.toHaveBeenCalled();
        expect(h.ro.query).not.toHaveBeenCalled();
        h.faults.sql = "";
        h.faults.delivery = 0;
        await h.run();
        expect(h.commits()).toBe(1);
        expect(h.state().history).toHaveLength(1);
        expect(h.state().deliveries).toHaveLength(
          action === "resume" || action === "cancel" ? 4 : 2,
        );
        if (action === "renew")
          expect(h.state().row.end_at).toEqual(
            new Date("2027-01-23T09:00:00.000Z"),
          );
        if (action === "resume")
          expect(h.state().row.end_at?.getTime()).toBe(
            END.getTime() + 172_800_000,
          );
        expect(h.pool.connect).toHaveBeenCalledTimes(2);
        expect(h.client.release).toHaveBeenCalledTimes(2);
      },
    );
  }
});

// ============================================================================
// Original guards, reason snapshots, compensation and conditional reanchoring.
// ============================================================================
describe("operator term and protection regression", () => {
  it.each(["renew", "cancel"] as const)(
    "%s from suspended closes and settles the original episode before events",
    async (action) => {
      const h = build(action, { status: "suspended" });
      await h.run();
      expect(h.state().episodes[0]?.resumed_at).toEqual(NOW);
      expect(h.state().episodes[0]?.granted_seconds).toBe(172800);
      expect(h.state().row.auto_renew).toBe(action === "renew");
      const base = action === "renew" ? new Date("2027-01-23T09:00:00Z") : NOW;
      expect(h.state().row.end_at?.getTime()).toBe(
        base.getTime() + 172_800_000,
      );
      expect(
        h.commands.findIndex((c) =>
          c.startsWith("update metering.subscriptions set end_at = end_at +"),
        ),
      ).toBeLessThan(
        h.commands.findIndex((c) =>
          c.startsWith("insert into provisioning.webhook_deliveries"),
        ),
      );
    },
  );
  it("preserves a perpetual term through cancellation, queue failure and retry", async () => {
    const h = build("cancel", { cycle: "perpetual", endAt: null });
    h.faults.delivery = 4;

    await expect(h.run()).rejects.toThrow("required outbox unavailable");
    expect(h.state()).toEqual(h.baseline);
    expect(h.commits()).toBe(0);
    expect(h.settleAfterCancel).not.toHaveBeenCalled();

    h.faults.delivery = 0;
    await h.run();
    expect(h.commits()).toBe(1);
    expect(h.state().row).toMatchObject({
      status: "cancelled",
      end_at: null,
      auto_renew: false,
    });
    expect(h.state().history).toHaveLength(1);
    expect(
      h
        .state()
        .deliveries.map((delivery) => delivery.event)
        .sort(),
    ).toEqual([
      "subscription_changed",
      "subscription_changed",
      "tenant.deprovisioned",
      "tenant.deprovisioned",
    ]);
    expect(h.settleAfterCancel).toHaveBeenCalledOnce();
    expect(h.settlements[0]?.row.status).toBe("cancelled");
  });

  it.each([false, null] as const)(
    "restores only the recorded auto-renew preference %s",
    async (autoRenewBefore) => {
      const h = build("resume", { autoRenewBefore });
      await h.run();
      expect(h.state().row.auto_renew).toBe(false);
      expect(
        h.commands.some((c) =>
          c.startsWith("update metering.subscriptions set auto_renew"),
        ),
      ).toBe(autoRenewBefore !== null);
    },
  );
  it("records zero compensation for customer violation without extending the term", async () => {
    const h = build("resume", { extendsTerm: false });
    await h.run();
    expect(h.state().episodes[0]?.granted_seconds).toBe(0);
    expect(h.state().row.end_at).toEqual(END);
  });
  it("does not fabricate a perpetual end date while recording owed compensation", async () => {
    const h = build("resume", { cycle: "perpetual", endAt: null });
    await h.run();
    expect(h.state().row.end_at).toBeNull();
    expect(h.state().episodes[0]?.granted_seconds).toBe(172800);
  });
  it("legacy suspended row without an episode preserves missing renewal intent", async () => {
    const h = build("resume", { episode: false });
    await h.run();
    expect(h.state().row.auto_renew).toBe(false);
    expect(h.state().row.end_at).toEqual(END);
  });
  it("settles only the episode closed by this action, leaving historical work to the sweep", async () => {
    const h = build("resume");
    const current = h.state().episodes[0]!;
    const historical = {
      ...current,
      id: "older-episode",
      resumed_at: current.paused_at,
    };
    h.state().episodes.unshift(historical);
    await h.run();
    expect(h.state().episodes[0]).toEqual(historical);
    expect(h.state().episodes[1]?.granted_seconds).toBe(172800);
    expect(h.state().row.end_at?.getTime()).toBe(END.getTime() + 172_800_000);
  });
  it("only an expired renewal reanchors active periodic pools without resetting usage", async () => {
    const h = build("renew", {
      status: "expired",
      endAt: new Date("2026-11-01T09:00:00Z"),
    });
    await h.run();
    expect(h.state().pools).toEqual(
      h.baseline.pools.map((p) =>
        p.id === "periodic" ? { ...p, anchor: NOW } : p,
      ),
    );
    expect(h.state().row.end_at).toEqual(new Date("2026-12-23T09:00:00Z"));
  });
  it("reanchor failure aborts the entire expired renewal and product queues", async () => {
    const h = build("renew", {
      status: "expired",
      endAt: new Date("2026-11-01T09:00:00Z"),
    });
    h.faults.sql = "update metering.quota_pools";
    await expect(h.run()).rejects.toThrow("injected SQL failure");
    expect(h.state()).toEqual(h.baseline);
    expect(h.notifier.notify).not.toHaveBeenCalled();
    h.faults.sql = "";
    await h.run();
    expect(h.state().pools[0]?.anchor).toEqual(NOW);
    expect(h.state().history).toHaveLength(1);
  });
  it("perpetual renewal retains no end date or term notice and preserves the existing null-term reanchor rule", async () => {
    const h = build("renew", { cycle: "perpetual", endAt: null });
    await h.run();
    expect(h.state().row.end_at).toBeNull();
    expect(h.state().deliveries).toEqual([]);
    expect(h.state().pools).toEqual(
      h.baseline.pools.map((p) =>
        p.id === "periodic" ? { ...p, anchor: NOW } : p,
      ),
    );
    expect(h.notifier.notify).not.toHaveBeenCalled();
  });
  it.each(["day", "week", "month", "year"])(
    "retains the database calendar-cycle %s renewal SQL",
    async (cycle) => {
      const h = build("renew", { cycle, cycleCount: 2 });
      await h.run();
      expect(
        h.commands.find((c) =>
          c.startsWith("update metering.subscriptions s set"),
        ),
      ).toContain("s.cycle_count");
      expect(h.state().row.end_at!.getTime()).toBeGreaterThan(END.getTime());
    },
  );
  it("trial renewal preserves the original paid-kind conversion and renewed history", async () => {
    const h = build("renew", { status: "trialing" });
    h.baseline.row.subscription_kind = "trial";
    h.state().row.subscription_kind = "trial";
    await h.run();
    expect(h.state().row.subscription_kind).toBe("paid");
    expect(h.state().history[0]?.[2]).toBe("renewed");
  });
  it("surviving coverage suppresses deprovisioning while retaining both cache events", async () => {
    const h = build("cancel", { covered: true });
    await h.run();
    expect(h.state().provisions).toEqual({});
    expect(h.state().deliveries.map((d) => d.event)).toEqual([
      "subscription_changed",
      "subscription_changed",
    ]);
  });
  it("unregistered products skip generic events without changing lifecycle queue policy", async () => {
    const h = build("resume", { unregistered: true });
    await h.run();
    expect(h.state().deliveries.map((d) => d.event)).toEqual([
      "tenant.provisioned",
      "tenant.provisioned",
    ]);
  });
  it("authorization fails before any read or transaction", async () => {
    const h = build("renew");
    await expect(
      h.router.runSubscriptionAction(request([]), ID, { action: "renew" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.pool.connect).not.toHaveBeenCalled();
    expect(h.ro.query).not.toHaveBeenCalled();
  });
  it.each(["renew", "suspend", "cancel"] as const)(
    "cancelled terminal guard blocks %s without product or money effects",
    async (action) => {
      const h = build(action, { status: "cancelled" });
      await expect(h.run()).rejects.toBeInstanceOf(ConflictException);
      expect(h.state()).toEqual(h.baseline);
      expect(h.commands.at(-1)).toBe("rollback");
      expect(h.settleAfterCancel).not.toHaveBeenCalled();
    },
  );
  it("resuming an expired violation is rejected using the effective term", async () => {
    const h = build("resume", {
      endAt: new Date("2026-11-01T09:00:00Z"),
      extendsTerm: false,
    });
    await expect(h.run()).rejects.toBeInstanceOf(ConflictException);
    expect(h.state()).toEqual(h.baseline);
  });
  it("platform suspension compensation keeps an otherwise lapsed term resumable", async () => {
    const h = build("resume", { endAt: new Date(NOW.getTime() - 86_400_000) });
    await h.run();
    expect(h.state().row.end_at!.getTime()).toBe(NOW.getTime() + 86_400_000);
  });
  it("a repeated resume is rejected without a second compensation or queue entry", async () => {
    const h = build("resume");
    await h.run();
    const after = structuredClone(h.state());
    // A fresh request is rejected by the unchanged status guard before any write.
    await expect(h.run()).rejects.toBeInstanceOf(ConflictException);
    expect(h.state()).toEqual(after);
    expect(h.state().episodes[0]?.granted_seconds).toBe(172800);
  });
});
