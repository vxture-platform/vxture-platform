import { describe, expect, it } from "vitest";
import {
  buildConsumeResponse,
  composeQuotaExhaustedNotice,
  parseConsumeBody,
  parseGaugeBody,
  quotaPeriodStartKey,
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
  view: {
    metric: "doc.words",
    limit: 1000,
    remaining,
    priority,
    enforcement: "soft",
  },
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

/**
 * 配额耗尽的运营通告（2026-09-28 第二批 C-2）。
 *
 * 这一条钉三件事，因为三件都会**静默地坏**：
 *   · 通告里出现 UUID —— 全站铁律，页面上没人会去核；
 *   · 去重键不带周期起点 —— 客户端重试会把运营台刷满；
 *   · 去重键超过 reference_id 的 128 列宽 —— 22001，通告静默丢一条。
 */
describe("quotaPeriodStartKey", () => {
  const withStart = (poolId: string, start: Date | null): PoolIdentity => ({
    poolId,
    subscriptionId: null,
    view: {
      metric: "doc.words",
      limit: 100,
      remaining: 0,
      priority: 10,
      enforcement: "soft",
    },
    periodStart: start,
  });

  it("取最晚的那个周期起点（瀑布里混着一次性加油包时它才是当前这一格）", () => {
    expect(
      quotaPeriodStartKey([
        withStart("p1", new Date("2026-09-01T00:00:00.000Z")),
        withStart("p2", null),
        withStart("p3", new Date("2026-09-20T08:30:00.000Z")),
      ]),
    ).toBe("2026-09-20");
  });

  it("一个周期起点都没有（全是不重置的池）→ 回落当月 1 日，不是「这辈子一条」", () => {
    expect(
      quotaPeriodStartKey(
        [withStart("p1", null)],
        new Date("2026-09-28T12:00:00.000Z"),
      ),
    ).toBe("2026-09-01");
  });

  /*
   * 日期键按 Asia/Shanghai 算，不按 UTC。两处各有一个跨午夜的错法，且都只在
   * 每天（每月）那八小时里现形——按 UTC 判的话本地测试机在任何时区都看不出来。
   */
  it("周期起点按北京日历日：库里 10/01 00:00 重置（UTC 09/30 16:00）就是 10-01", () => {
    expect(
      quotaPeriodStartKey([
        withStart("p1", new Date("2026-09-30T16:00:00.000Z")),
      ]),
    ).toBe("2026-10-01");
    // 北京 09/30 23:59:59 仍然是 09-30（差一秒就换格，正是要钉的那条边）。
    expect(
      quotaPeriodStartKey([
        withStart("p1", new Date("2026-09-30T15:59:59.000Z")),
      ]),
    ).toBe("2026-09-30");
  });

  it("回落的「当月」也按北京：北京 10/01 01:00（UTC 09/30 17:00）回落 10-01 不是 09-01", () => {
    expect(
      quotaPeriodStartKey(
        [withStart("p1", null)],
        new Date("2026-09-30T17:00:00.000Z"),
      ),
    ).toBe("2026-10-01");
  });

  it("periodStart 缺省（既有调用方没给）也不炸", () => {
    const pool: PoolIdentity = {
      poolId: "p1",
      subscriptionId: null,
      view: {
        metric: "doc.words",
        limit: 100,
        remaining: 0,
        priority: 10,
        enforcement: "soft",
      },
    };
    expect(
      quotaPeriodStartKey([pool], new Date("2026-02-15T00:00:00.000Z")),
    ).toBe("2026-02-01");
  });
});

describe("composeQuotaExhaustedNotice", () => {
  const NOW = new Date("2026-09-28T12:00:00.000Z");
  const facts = (over: Record<string, unknown> = {}) =>
    ({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      productCode: "karda",
      metric: "doc.words",
      amount: "500",
      remainingTotal: 12,
      periodStartKey: "2026-09-20",
      tenant: { no: "2000000107", name: "示例科技", workspaceName: "默认空间" },
      now: NOW,
      ...over,
    }) as Parameters<typeof composeQuotaExhaustedNotice>[0];

  it("warning、只投 admin、链接走 tenant_no、30 天后退出列表", () => {
    const notice = composeQuotaExhaustedNotice(facts());
    expect(notice.severity).toBe("warning");
    expect(notice.targetPlanes).toEqual(["admin"]);
    expect(notice.link).toBe("/tenants/2000000107");
    expect(notice.expiresAt!.getTime()).toBe(
      NOW.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    /* 租户码上屏必须带 T-（@shared 的 formatPrincipalNo）：裸的十位数字分不出主体类别。 */
    expect(notice.title).toBe(
      "配额已耗尽：示例科技（T-2000000107） · karda / doc.words",
    );
    expect(notice.body).toContain("默认空间");
    expect(notice.body).toContain("本次请求 500");
    expect(notice.body).toContain("扣减后可用合计 12");
  });

  /*
   * 这条通告在**预留被拒**时也会发（gated 为真就发），而原来那段正文写着「请求本身
   * 仍是 200，平台只记录不裁决」——在那一档两句都是假的。运营看到的是这段字，所以
   * 两档各钉一条，并且互相排除：只断言「自己那句在」会让两档共用一段文案也照样绿。
   */
  it("照记那一档：说 200、说只记录不裁决", () => {
    const notice = composeQuotaExhaustedNotice(facts());
    expect(notice.body).toContain("仍是 200");
    expect(notice.body).toContain("只记录不裁决");
    expect(notice.body).not.toContain("平台拒绝了");
  });

  it("预留被拒那一档：说拒绝、说没记这笔，且不再说「仍是 200」", () => {
    const notice = composeQuotaExhaustedNotice(facts({ denied: true }));
    expect(notice.body).toContain("平台拒绝了");
    expect(notice.body).toContain("没有记这笔用量");
    expect(notice.body).toContain("409");
    expect(notice.body).not.toContain("仍是 200");
    expect(notice.body).not.toContain("只记录不裁决");
    /* 标题与去重键两档共用——同一个客户、同一个指标、同一个周期仍然只播一条。 */
    expect(notice.title).toBe(composeQuotaExhaustedNotice(facts()).title);
    expect(notice.referenceId).toBe(
      composeQuotaExhaustedNotice(facts()).referenceId,
    );
  });

  it("标题正文链接里不出现 workspace 的 uuid", () => {
    const notice = composeQuotaExhaustedNotice(facts());
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(notice.title).not.toContain(uuid);
    expect(notice.body).not.toContain(uuid);
    expect(notice.link ?? "").not.toContain(uuid);
    // uuid 只许待在去重键里——它不上屏。
    expect(notice.referenceId).toContain(uuid);
  });

  it("查不到租户号：照发，说「租户未知」，且不给一个点开 404 的链接", () => {
    const notice = composeQuotaExhaustedNotice(
      facts({ tenant: { no: null, name: null, workspaceName: null } }),
    );
    expect(notice.title).toContain("（租户未知）");
    expect(notice.body).toContain("（空间名未知）");
    expect(notice.link).toBeNull();
    expect(notice.referenceId).toContain("quota_exhausted:");
  });

  it("去重键带周期起点：同周期同键，跨周期两键", () => {
    expect(composeQuotaExhaustedNotice(facts()).referenceId).toBe(
      "quota_exhausted:11111111-1111-4111-8111-111111111111:karda:doc.words:2026-09-20",
    );
    expect(
      composeQuotaExhaustedNotice(facts({ periodStartKey: "2026-10-20" }))
        .referenceId,
    ).not.toBe(composeQuotaExhaustedNotice(facts()).referenceId);
  });

  it("超长的指标键不会把 reference_id 顶过 128（22001 会让通告静默丢一条）", () => {
    const longMetric = "m" + "a".repeat(63);
    const notice = composeQuotaExhaustedNotice(
      facts({ metric: longMetric, productCode: "p".repeat(32) }),
    );
    expect(notice.referenceId.length).toBeLessThanOrEqual(128);
    // 截断后仍然一事一条：换一个指标键就是另一个 reference_id。
    const other = composeQuotaExhaustedNotice(
      facts({
        metric: longMetric.slice(0, 63) + "b",
        productCode: "p".repeat(32),
      }),
    );
    expect(other.referenceId).not.toBe(notice.referenceId);
    expect(other.referenceId.length).toBeLessThanOrEqual(128);
  });
});
