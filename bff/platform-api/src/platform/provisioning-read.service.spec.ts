/**
 * Reconciliation pagination and retained-state regressions.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-10-12
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { ProvisioningReadService } from "./provisioning-read.service";
import {
  provisioningReadPoolProvider,
  ProvisioningReadPoolLifecycle,
} from "../providers/pg-pool.provider";
import type { VxConfigService } from "@vxture/core-config";

// ── Fixtures ──────────────────────────────────────────────────────────

const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const row = (n: number) => ({
  id: id(n),
  created_at: "2026-10-12T01:02:03.123456Z",
  workspace_id: id(n + 100),
  tenant_id: id(200),
  state: "provisioned",
  seq: n,
  updated_at: "2026-10-12T03:04:05.234567Z",
});
const build = () => {
  const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  return {
    pool,
    service: new ProvisioningReadService(pool as unknown as Pool),
  };
};
const cursor = (overrides: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      v: 1,
      product: "arda",
      createdAt: row(1).created_at,
      id: id(1),
      ...overrides,
    }),
  ).toString("base64url");

// ── Pagination and validation ─────────────────────────────────────────

describe("ProvisioningReadService", () => {
  it("returns only the wire fields, including pending and revoked facts", async () => {
    const { pool, service } = build();
    pool.query.mockResolvedValue({
      rows: [
        { ...row(1), state: "pending", seq: 0 },
        { ...row(2), state: "deprovisioned" },
      ],
    });
    const result = await service.list("arda", {});
    expect(result).toEqual({
      items: [
        {
          workspace_id: id(101),
          tenant_id: id(200),
          state: "pending",
          seq: 0,
          updated_at: row(1).updated_at,
        },
        {
          workspace_id: id(102),
          tenant_id: id(200),
          state: "deprovisioned",
          seq: 2,
          updated_at: row(2).updated_at,
        },
      ],
      nextCursor: null,
    });
    expect(pool.query.mock.calls[0]?.[1]).toEqual(["arda", null, null, 101]);
  });

  it("round-trips microseconds and UUID tie-breaker without skipping a page boundary", async () => {
    const { pool, service } = build();
    pool.query.mockResolvedValueOnce({ rows: [row(1), row(2)] });
    const first = await service.list("arda", { limit: "1" });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe(cursor());
    pool.query.mockResolvedValueOnce({ rows: [row(2)] });
    const next = await service.list("arda", {
      limit: "1",
      cursor: first.nextCursor,
    });
    expect(next.nextCursor).toBeNull();
    expect(pool.query.mock.calls[1]?.[1]).toEqual([
      "arda",
      "2026-10-12T01:02:03.123456Z",
      id(1),
      2,
    ]);
    const sql = pool.query.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/p.product_code = \$1/);
    expect(sql).toMatch(
      /pr.status in \('pending', 'provisioned', 'deprovisioned'\)/,
    );
    expect(sql).toMatch(/order by pr.created_at, pr.id/);
    expect(sql).not.toMatch(/order by pr.updated_at/);
  });

  it("clamps a valid high limit and returns an empty final page", async () => {
    const { pool, service } = build();
    expect(await service.list("arda", { limit: "999" })).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(pool.query.mock.calls[0]?.[1]).toEqual(["arda", null, null, 201]);
  });

  it.each([
    "",
    "0",
    "-1",
    "1.1",
    "1e2",
    " 1",
    "9007199254740992",
    ["1", "2"],
    {},
  ])("rejects malformed limit %j before reading", async (limit) => {
    const { pool, service } = build();
    await expect(service.list("arda", { limit })).rejects.toThrow("Limit must");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "broken",
    "!",
    [cursor()],
    cursor({ product: "other" }),
    cursor({ v: 2 }),
    cursor({ id: "not-uuid" }),
    cursor({ createdAt: "2026-02-30T01:02:03.123456Z" }),
    cursor({ createdAt: "2026-10-12T01:02:03.123Z" }),
    cursor({ extra: true }),
  ])("rejects invalid or foreign cursor %j", async (raw) => {
    const { pool, service } = build();
    await expect(service.list("arda", { cursor: raw })).rejects.toThrow(
      "Invalid provisioning cursor",
    );
    expect(pool.query).not.toHaveBeenCalled();
  });

  it.each(["product", "product_id", "workspace_id", "workspace", "tenant_id"])(
    "rejects caller-declared filter %s",
    async (key) => {
      const { pool, service } = build();
      await expect(service.list("arda", { [key]: "other" })).rejects.toThrow(
        "Only cursor and limit",
      );
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  it("maps storage failure to a retryable error without exposing internal details", async () => {
    const { pool, service } = build();
    pool.query.mockRejectedValue(new Error("database unavailable"));
    await expect(service.list("arda", {})).rejects.toMatchObject({
      status: 503,
      response: {
        code: "PROVISIONING_READ_UNAVAILABLE",
        message: "Provisioning reconciliation is temporarily unavailable.",
        retryable: true,
      },
    });
  });
});

// ── Read-only session lifecycle ───────────────────────────────────────

describe("reconciliation pool", () => {
  it("uses reporting connection and read-only sessions, even on primary fallback", async () => {
    for (const url of ["postgres://localhost/reporting", undefined]) {
      const pool = provisioningReadPoolProvider.useFactory({
        database: {
          REPORTING_RO_DATABASE_URL: url,
          DATABASE_URL: "postgres://localhost/primary",
          DB_POOL_MAX: 3,
        },
      } as unknown as VxConfigService);
      expect(pool.options.connectionString).toBe(
        url ?? "postgres://localhost/primary",
      );
      expect(pool.options.options).toBe("-c default_transaction_read_only=on");
      await new ProvisioningReadPoolLifecycle(pool).onApplicationShutdown();
      expect(pool.ended).toBe(true);
    }
  });
});
