import { describe, expect, it } from "vitest";
import {
  buildConsumeResponse,
  parseConsumeBody,
  parseGaugeBody,
  type EngineConsumeResult,
  type PoolIdentity,
} from "./usage-view";

const pool = (
  poolId: string,
  subscriptionId: string | null,
  remaining: number,
  priority = 10,
): PoolIdentity => ({
  poolId,
  subscriptionId,
  view: { metric: "doc.words", limit: 1000, remaining, priority },
});

const okResult = (
  partial: Partial<EngineConsumeResult>,
): EngineConsumeResult => ({
  status: "ok",
  consumed: "100",
  perPool: [{ poolId: "p1", took: "100" }],
  replayed: false,
  ...partial,
});

describe("buildConsumeResponse (ADR-11 §11.7 ③)", () => {
  it("maps a full consume to 200 with subscription-keyed breakdown", () => {
    const { statusCode, body } = buildConsumeResponse(
      okResult({}),
      [pool("p1", "sub-1", 500)],
      "doc.words",
    );
    expect(statusCode).toBe(200);
    expect(body).toEqual({
      gated: false,
      consumed: 100,
      remaining_total: 500,
      per_pool_breakdown: [
        {
          subscription_id: "sub-1",
          metric: "doc.words",
          took: 100,
          remaining: 500,
        },
      ],
    });
  });

  it("sums remaining_total across pools in waterfall order", () => {
    const { body } = buildConsumeResponse(
      okResult({
        perPool: [
          { poolId: "p1", took: "60" },
          { poolId: "p2", took: "40" },
        ],
      }),
      [pool("p1", "sub-1", 0), pool("p2", "sub-2", 460, 20)],
      "doc.words",
    );
    expect(body.remaining_total).toBe(460);
    expect(body.per_pool_breakdown).toHaveLength(2);
    expect(body.per_pool_breakdown[1]).toEqual({
      subscription_id: "sub-2",
      metric: "doc.words",
      took: 40,
      remaining: 460,
    });
  });

  it("reports insufficient as 200 + gated, never as an error status", () => {
    // atomic reject: consumed=0 but pools still hold balance — the caller
    // should see the true remaining, not the ADR example's literal 0.
    const { statusCode, body } = buildConsumeResponse(
      okResult({ status: "insufficient", consumed: "0", perPool: [] }),
      [pool("p1", "sub-1", 30)],
      "doc.words",
    );
    expect(statusCode).toBe(200);
    expect(body.gated).toBe(true);
    expect(body.reason).toBe("quota_exhausted");
    expect(body.consumed).toBe(0);
    expect(body.remaining_total).toBe(30);
  });

  it("keeps partial-success consumed in the body (divisible)", () => {
    const { statusCode, body } = buildConsumeResponse(
      okResult({ status: "insufficient", consumed: "70" }),
      [pool("p1", "sub-1", 0)],
      "doc.words",
    );
    expect(statusCode).toBe(200);
    expect(body.consumed).toBe(70);
    expect(body.remaining_total).toBe(0);
  });

  it("echoes the usage event id when the engine wrote one", () => {
    const { body } = buildConsumeResponse(
      okResult({ eventId: "3f2b1a90-0000-4000-8000-000000000001" }),
      [pool("p1", "sub-1", 500)],
      "atlas.chat",
    );
    expect(body.event_id).toBe("3f2b1a90-0000-4000-8000-000000000001");
  });

  it("echoes the event id on a divisible partial success too", () => {
    // The 409-with-consumed>0 rows are the ones hardest to reconcile by hand,
    // so they are exactly the rows that must carry the correlation key.
    const { statusCode, body } = buildConsumeResponse(
      okResult({
        status: "insufficient",
        consumed: "70",
        eventId: "3f2b1a90-0000-4000-8000-000000000002",
      }),
      [pool("p1", "sub-1", 0)],
      "atlas.chat",
    );
    expect(statusCode).toBe(200);
    expect(body.event_id).toBe("3f2b1a90-0000-4000-8000-000000000002");
  });

  it("omits event_id entirely when the engine wrote no event", () => {
    const { body } = buildConsumeResponse(
      okResult({ status: "insufficient", consumed: "0", perPool: [] }),
      [pool("p1", "sub-1", 0)],
      "atlas.chat",
    );
    expect("event_id" in body).toBe(false);
  });

  it("still reports gated in the body so the caller can act on it", () => {
    // The signal survives the status-code change — what is gone is the pretence
    // that the platform is deciding. A caller that wants to stop still can; one
    // that wants to keep serving no longer has to treat a normal outcome as an
    // HTTP error to do so.
    const { statusCode, body } = buildConsumeResponse(
      okResult({ status: "insufficient", consumed: "0" }),
      [pool("p1", "sub-1", 0)],
      "atlas.tokens",
    );
    expect(statusCode).toBe(200);
    expect(body.gated).toBe(true);
    expect(body.reason).toBe("quota_exhausted");
  });

  it("marks idempotent replays and tolerates a since-retired pool", () => {
    const { statusCode, body } = buildConsumeResponse(
      okResult({ replayed: true, perPool: [{ poolId: "gone", took: "100" }] }),
      [],
      "doc.words",
    );
    expect(statusCode).toBe(200);
    expect(body.replayed).toBe(true);
    expect(body.per_pool_breakdown[0]).toEqual({
      subscription_id: null,
      metric: "doc.words",
      took: 100,
      remaining: 0,
    });
  });
});

describe("parseConsumeBody (§11.7 body)", () => {
  const valid = {
    workspace_id: "11111111-2222-3333-4444-555555555555",
    product: "arda",
    metric: "doc.words",
    amount: 100,
    idempotency_key: "arda-job-42",
  };

  it("parses a valid body and stringifies numeric amount", () => {
    expect(parseConsumeBody(valid)).toEqual({
      workspaceId: valid.workspace_id,
      productCode: "arda",
      metric: "doc.words",
      amount: "100",
      idempotencyKey: "arda-job-42",
    });
  });

  it("accepts bigint-scale numeric strings without precision loss", () => {
    expect(
      parseConsumeBody({ ...valid, amount: "900719925474099212" }).amount,
    ).toBe("900719925474099212");
  });

  it.each([
    ["workspace_id", { workspace_id: "nope" }, "invalid_workspace_id"],
    ["product", { product: "Arda!" }, "invalid_product"],
    ["metric", { metric: "" }, "invalid_metric"],
    ["amount zero", { amount: 0 }, "invalid_amount"],
    ["amount negative", { amount: -5 }, "invalid_amount"],
    ["amount fractional", { amount: 1.5 }, "invalid_amount"],
    ["amount non-numeric", { amount: "10x" }, "invalid_amount"],
    [
      "idempotency_key missing",
      { idempotency_key: undefined },
      "invalid_idempotency_key",
    ],
    [
      "idempotency_key overlong",
      { idempotency_key: "k".repeat(129) },
      "invalid_idempotency_key",
    ],
  ])("rejects invalid %s", (_label, override, code) => {
    expect(() => parseConsumeBody({ ...valid, ...override })).toThrow(code);
  });
});

describe("parseGaugeBody (D5 gauge body)", () => {
  const valid = {
    workspace_id: "00000000-0000-4000-cccc-000000000001",
    product: "arda",
    metric: "storage.bytes",
    value: 5368709120,
    observed_at: "2026-07-09T01:00:00Z",
  };

  it("accepts a valid gauge body incl. value 0 and bigint-string value", () => {
    const r = parseGaugeBody(valid);
    expect(r.value).toBe("5368709120");
    expect(r.observedAt.toISOString()).toBe("2026-07-09T01:00:00.000Z");
    expect(parseGaugeBody({ ...valid, value: 0 }).value).toBe("0"); // gauge allows 0
    expect(
      parseGaugeBody({ ...valid, value: "9223372036854775807" }).value,
    ).toBe("9223372036854775807");
  });

  it.each([
    ["invalid_workspace_id", { workspace_id: "not-a-uuid" }],
    ["invalid_product", { product: "" }],
    ["invalid_metric", { metric: "" }],
    ["invalid_value", { value: -1 }],
    ["invalid_value", { value: 1.5 }],
    ["invalid_value", { value: "abc" }],
    ["invalid_value", { value: "9223372036854775808" }], // > bigint(8) max
    ["invalid_observed_at", { observed_at: "not-a-date" }],
    ["invalid_observed_at", { observed_at: undefined }],
  ])("rejects %s", (code, override) => {
    expect(() => parseGaugeBody({ ...valid, ...override })).toThrow(code);
  });
});
