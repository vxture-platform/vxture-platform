import { describe, expect, it } from "vitest";
import {
  buildConsumeResponse,
  parseConsumeBody,
  type EngineConsumeResult,
  type PoolIdentity,
} from "./usage-view";

/**
 * B1 接线：`intent` 轴与预留被拒（owner 2026-10-01）。
 *
 * 本文件锁三条性质，每一条都对应一个**看不出来**的坏法：
 *   ① 不传 intent 必须等于 report —— 旧调用方一个字不改、行为不变。若默认成 reserve，
 *      所有既有上报在额度不足时会突然开始收 409。
 *   ② 只有 denied 回 409 —— insufficient（事后报账没覆盖住）仍是 200。弄混会把
 *      2026-08-10 那条裁定推翻，而症状是上报作业开始重试。
 *   ③ 未知 intent 必须拒 —— 静默当成 report 会让一个拼错的 `reserv` 变成「照常放行」，
 *      那是危险的方向：调用方以为自己在问许可，实际在报账。
 */

const pool = (remaining: number): PoolIdentity => ({
  poolId: "p1",
  subscriptionId: "sub-1",
  view: {
    metric: "ai.credit",
    limit: 1000,
    remaining,
    priority: 10,
    enforcement: "hard",
  },
});

const engine = (
  status: EngineConsumeResult["status"],
  consumed = "0",
): EngineConsumeResult => ({
  status,
  consumed,
  perPool: [],
  replayed: false,
});

describe("parseConsumeBody · intent", () => {
  const base = {
    workspace_id: "11111111-1111-1111-1111-111111111111",
    product: "karda",
    metric: "karda.ingest",
    amount: 5,
    idempotency_key: "k-1",
  };

  it("不传 intent → 解析结果里没有 intent（= report，行为不变）", () => {
    const parsed = parseConsumeBody({ ...base });
    expect(parsed.intent).toBeUndefined();
  });

  it("两个合法值都能过", () => {
    expect(parseConsumeBody({ ...base, intent: "report" }).intent).toBe(
      "report",
    );
    expect(parseConsumeBody({ ...base, intent: "reserve" }).intent).toBe(
      "reserve",
    );
  });

  it("未知值当场拒，不静默当 report", () => {
    for (const bad of ["reserv", "RESERVE", "", 1, true, null]) {
      expect(() =>
        parseConsumeBody({ ...base, intent: bad as unknown }),
      ).toThrowError(/invalid_intent/);
    }
  });
});

describe("buildConsumeResponse · 只有 denied 回 409", () => {
  it("denied → 409，带 enforcement=hard 与 reason", () => {
    const { statusCode, body } = buildConsumeResponse(
      engine("denied"),
      [pool(2)],
      "ai.credit",
    );
    expect(statusCode).toBe(409);
    expect(body.gated).toBe(true);
    expect(body.enforcement).toBe("hard");
    expect(body.reason).toBe("quota_exhausted");
    // 被拒 = 什么都没发生：扣减为 0，明细为空。
    expect(body.consumed).toBe(0);
    expect(body.per_pool_breakdown).toEqual([]);
  });

  it("insufficient → 仍是 200（事后报账没覆盖住，不是拒）", () => {
    const { statusCode, body } = buildConsumeResponse(
      engine("insufficient", "5"),
      [pool(0)],
      "ai.credit",
    );
    expect(statusCode).toBe(200);
    expect(body.gated).toBe(true);
    // 这一档**不带** enforcement：它不是一个「你必须服从」的答复。
    expect(body.enforcement).toBeUndefined();
  });

  it("ok → 200，且 gated 为 false", () => {
    const { statusCode, body } = buildConsumeResponse(
      engine("ok", "5"),
      [pool(995)],
      "ai.credit",
    );
    expect(statusCode).toBe(200);
    expect(body.gated).toBe(false);
    expect(body.enforcement).toBeUndefined();
  });
});
