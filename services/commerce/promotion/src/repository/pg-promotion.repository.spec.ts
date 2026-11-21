import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  PgPromotionRepository,
  mapTenantVoucherRow,
} from "./pg-promotion.repository";

// SQL-contract tests (product_321 P7/P8b): the availability predicate is the
// security boundary (ownership assertion) and the atomicity mechanism
// (rowCount=1 wins, 230 §5.2). We pin the predicate clauses and the guard
// behavior against a stubbed client — a live-DB race test lands with the PR2
// integration suite.

const SCOPE = { tenantId: "org-1", workspaceId: "ws-1", userId: "u-1" };

let poolQuery: ReturnType<typeof vi.fn>;
let clientQuery: ReturnType<typeof vi.fn>;
let repo: PgPromotionRepository;
let client: PoolClient;

beforeEach(() => {
  poolQuery = vi.fn();
  clientQuery = vi.fn();
  repo = new PgPromotionRepository({ query: poolQuery } as unknown as Pool);
  client = { query: clientQuery } as unknown as PoolClient;
});

const REQUIRED_PREDICATES = [
  "v.status = 'assigned'",
  "v.max_uses = 1 and v.used_count = 0",
  "b.kind in ('discount','credit_voucher')",
  "b.tenant_id is null or b.tenant_id = $1",
  "v.assigned_user_id is null or v.assigned_user_id = $2",
  "v.assigned_workspace_id is null or v.assigned_workspace_id = $3",
  // platform-level batches must be targeted — no ownerless wildcard vouchers
  "b.tenant_id is not null",
  "b.status = 'active'",
  "now() >= b.valid_from and now() < b.valid_until",
  "v.expires_at is null or v.expires_at > now()",
  // not-yet-implemented gate fields must exclude, not silently pass (P7)
  "not (b.effect ? 'applicable_plan_ids')",
  "not (b.effect ? 'min_user_level')",
];

describe("availability predicate (P7 — one predicate, three call sites)", () => {
  it("list, resolve and reserve all carry the full predicate", async () => {
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await repo.listAvailableVouchers(SCOPE);
    await repo.resolveAvailableVoucher(SCOPE, "v-1", "discount");
    await repo.reserve(client, SCOPE, "v-1", "discount");

    const sqls = [
      poolQuery.mock.calls[0]?.[0],
      poolQuery.mock.calls[1]?.[0],
      clientQuery.mock.calls[0]?.[0],
    ] as string[];
    for (const sql of sqls) {
      for (const clause of REQUIRED_PREDICATES) {
        expect(sql).toContain(clause);
      }
    }
  });

  it("scope params bind tenant/user/workspace in fixed positions", async () => {
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await repo.listAvailableVouchers(SCOPE);
    expect(poolQuery.mock.calls[0]?.[1]).toEqual(["org-1", "u-1", "ws-1"]);
  });
});

describe("reserve (230 §5.2 atomic contention)", () => {
  it("returns the batch effect when the single UPDATE wins (rowCount 1)", async () => {
    clientQuery.mockResolvedValue({
      rows: [{ effect: { amount_cents: 10000 } }],
      rowCount: 1,
    });
    const won = await repo.reserve(client, SCOPE, "v-1", "credit_voucher");
    expect(won).toEqual({ effect: { amount_cents: 10000 } });
    const sql = clientQuery.mock.calls[0]?.[0] as string;
    expect(sql).toContain("set status = 'reserved'");
    expect(sql).toContain("used_count = v.used_count + 1");
  });

  it("returns null when the race is lost (rowCount 0) — caller 409s", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await repo.reserve(client, SCOPE, "v-1", "discount")).toBeNull();
  });
});

describe("reservation ownership guards", () => {
  it("refuses finalize before any write when the order and invoice do not match", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(
      repo.finalize(client, {
        orderId: "order",
        invoiceId: "invoice",
        reservationId: "reservation",
        voucherId: "voucher",
        kind: "discount",
        scope: SCOPE,
        effectSnapshot: {},
      }),
    ).rejects.toMatchObject({
      response: { code: "VOUCHER_RESERVATION_CONFLICT" },
    });
    expect(clientQuery.mock.calls[0]?.[1]).toEqual(["order", "invoice"]);
    expect(
      clientQuery.mock.calls.some(([sql]) =>
        /insert|update promotion/.test(String(sql)),
      ),
    ).toBe(false);
  });
  it("refuses release before any write when the order and invoice do not match", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(
      repo.release(
        client,
        "voucher",
        { orderId: "order", invoiceId: "invoice" },
        "reservation",
      ),
    ).rejects.toMatchObject({
      response: { code: "VOUCHER_RESERVATION_CONFLICT" },
    });
    expect(clientQuery).toHaveBeenCalledOnce();
  });
});
// ============================================================================
// Customer ledger states, independent of the legacy projection
// ============================================================================

const NOW = new Date("2026-11-19T08:00:00Z");
const ledgerRow = (
  overrides: Partial<Parameters<typeof mapTenantVoucherRow>[0]> = {},
): Parameters<typeof mapTenantVoucherRow>[0] => ({
  id: "voucher",
  code: "VX-TEST",
  kind: "credit_voucher",
  batch_name: "Batch",
  effect: { amount_cents: 5000, currency: "CNY" },
  status: "assigned",
  used_count: 0,
  max_uses: 1,
  batch_status: "active",
  valid_from: new Date("2026-11-01T00:00:00Z"),
  valid_until: new Date("2026-12-01T00:00:00Z"),
  expires_at: null,
  redeemed_at: null,
  last_redeemed_at: null,
  redemption_no: null,
  ...overrides,
});

describe("customer voucher availability", () => {
  it.each(["paused", "archived"] as const)(
    "distinguishes %s from expiration",
    (state) => {
      const row = mapTenantVoucherRow(ledgerRow({ batch_status: state }), NOW);
      expect(row.availabilityStatus).toBe(state);
      expect(row.displayStatus).toBe("expired");
    },
  );

  it("shows future vouchers as not started while retaining legacy status", () => {
    const row = mapTenantVoucherRow(
      ledgerRow({ valid_from: new Date("2026-11-20T00:00:00Z") }),
      NOW,
    );
    expect(row.availabilityStatus).toBe("not_started");
    expect(row.displayStatus).toBe("expired");
  });

  it.each(["valid_until", "expires_at"] as const)(
    "expires exactly at %s",
    (field) => {
      expect(
        mapTenantVoucherRow(ledgerRow({ [field]: NOW }), NOW)
          .availabilityStatus,
      ).toBe("expired");
    },
  );

  it("starts exactly at valid_from and uses the earlier expiry", () => {
    const row = mapTenantVoucherRow(
      ledgerRow({
        valid_from: NOW,
        expires_at: new Date("2026-11-25T00:00:00Z"),
      }),
      NOW,
    );
    expect(row.availabilityStatus).toBe("available");
    expect(row.expiresAt.toISOString()).toBe("2026-11-25T00:00:00.000Z");
  });

  it.each(["reserved", "redeemed", "revoked"] as const)(
    "preserves %s after batch expiry or suspension",
    (status) => {
      expect(
        mapTenantVoucherRow(
          ledgerRow({ status, valid_until: NOW, batch_status: "paused" }),
          NOW,
        ).availabilityStatus,
      ).toBe(status);
    },
  );

  it.each(["recharge_card", "redemption", "extension", "unknown"])(
    "does not advertise disabled kind %s as usable",
    (kind) => {
      expect(
        mapTenantVoucherRow(ledgerRow({ kind }), NOW).availabilityStatus,
      ).toBe("unavailable");
    },
  );

  it("includes invitation vouchers without changing the settlement kinds", () => {
    expect(
      mapTenantVoucherRow(
        ledgerRow({ kind: "invite", effect: { planCode: "private-pro" } }),
        NOW,
      ),
    ).toMatchObject({ kind: "invite", availabilityStatus: "available" });
  });

  it.each([
    { effect: { amount_cents: -1 } },
    {
      kind: "discount",
      effect: { discount_type: "percent", value: Number.NaN },
    },
    { effect: { amount_cents: 5000, min_user_level: 4 } },
    { used_count: 1 },
  ])("does not mark unusable configuration as available: %j", (overrides) => {
    expect(
      mapTenantVoucherRow(ledgerRow(overrides), NOW).availabilityStatus,
    ).toBe("unavailable");
  });
});
