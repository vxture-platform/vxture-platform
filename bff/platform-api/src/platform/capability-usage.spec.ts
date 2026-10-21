/**
 * Raw-fact validation and persistence failure regressions.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-10-21
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { parseCapabilityUsage } from "./capability-usage";
import { CapabilityUsageService } from "./capability-usage.service";

// ── Wire validation ──────────────────────────────────────────────────
const id = "11111111-1111-4111-8111-111111111111";
const body = () => ({
  workspace_id: id,
  product: "karda",
  capability_usage: {
    event_id: id,
    call_id: "call-1",
    capability_id: "skill.test",
    metric: "runos.call",
    amount: "1",
    unit: "call",
    occurred_at: "2026-10-20T01:02:03.456Z",
  },
});

describe("capability usage wire validation", () => {
  it("retains exact integers and allows a measured zero sandbox duration", () => {
    const input = body();
    Object.assign(input.capability_usage, {
      metric: "runos.sandbox_mb_ms",
      amount: "9223372036854775807",
      unit: "mb_ms",
    });
    expect(parseCapabilityUsage(input).amount).toBe("9223372036854775807");
    input.capability_usage.amount = "0";
    expect(parseCapabilityUsage(input).amount).toBe("0");
  });
  it.each([
    "tokens",
    "amount",
    "metric",
    "intent",
    "end_user_id",
    "idempotency_key",
    "backfill",
  ])("rejects mixed or unsupported top-level %s", (field) => {
    expect(() => parseCapabilityUsage({ ...body(), [field]: null })).toThrow(
      "invalid_capability_usage",
    );
  });
  it.each([
    { amount: 1 },
    { amount: "01" },
    { amount: "2" },
    { amount: "-1" },
    { amount: "9223372036854775808" },
    { unit: "ms" },
    { metric: "compute.cpu" },
    { event_id: "bad" },
    { occurred_at: "2026-10-20" },
    { occurred_at: "2026-10-20T00:00:00" },
    { occurred_at: "2026-02-30T00:00:00Z" },
    { occurred_at: "2026-01-01T24:00:00Z" },
    { occurred_at: "2099-01-01T00:00:00Z" },
    { user_id: id },
  ])("refuses invalid measurement %j", (change) => {
    const input = body();
    Object.assign(input.capability_usage, change);
    expect(() => parseCapabilityUsage(input)).toThrow(
      "invalid_capability_usage",
    );
  });
});

// ── Commit, replay and rollback ──────────────────────────────────────
function fixture(
  options: {
    replay?: boolean;
    conflict?: boolean;
    unknown?: boolean;
    commitFailure?: boolean;
  } = {},
) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("select p.id"))
      return { rows: options.unknown ? [] : [{ product_id: id }] };
    if (sql.startsWith("insert into"))
      return { rows: options.replay || options.conflict ? [] : [{ id }] };
    if (sql.includes("as matches"))
      return { rows: [{ id, matches: !options.conflict }] };
    if (sql === "commit" && options.commitFailure)
      throw new Error("commit lost");
    return { rows: [] };
  });
  const release = vi.fn();
  const service = new CapabilityUsageService({
    connect: async () => ({ query, release }),
  } as unknown as Pool);
  return { service, query, release };
}

describe("CapabilityUsageService", () => {
  it.each([false, true])(
    "acknowledges only a committed fact, replay=%s",
    async (replay) => {
      const { service, query, release } = fixture({ replay });
      expect(await service.ingest(parseCapabilityUsage(body()))).toEqual({
        recorded: true,
        capability_event_id: id,
        source_event_id: id,
        replayed: replay,
        settlement: "not_configured",
      });
      expect(query.mock.calls.at(-1)?.[0]).toBe("commit");
      expect(
        query.mock.calls.some(([sql]) =>
          /quota_pools|insert into metering\.usage_events/.test(sql),
        ),
      ).toBe(false);
      expect(release).toHaveBeenCalledOnce();
    },
  );
  it.each([
    [{ conflict: true }, "capability_usage_idempotency_conflict"],
    [{ unknown: true }, "unknown_usage_attribution"],
    [{ commitFailure: true }, "commit lost"],
  ] as const)(
    "retains no successful receipt on %j",
    async (options, message) => {
      const { service, query, release } = fixture(options);
      await expect(
        service.ingest(parseCapabilityUsage(body())),
      ).rejects.toThrow(message);
      expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
      expect(release).toHaveBeenCalledOnce();
    },
  );
});
