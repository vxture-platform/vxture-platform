import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import type { Pool } from "pg";
import type { Request } from "express";

import { CommercialRouter } from "./commercial.router";
import type { RequestContext } from "../types/console.types";

/**
 * 订阅邀请（卡券第六型 `invite`，2026-09-22）。
 *
 * 这里守的是**建批次那一道**：邀请只对「真存在、且真非公开」的套餐有意义。
 * 不校的话会发出两种废券——指向不存在套餐的（永远解锁不了任何东西），和指向
 * 公开套餐的（本来就能买，发了等于骗人）。两种都要等客户点下去才发现。
 *
 * 三面都写：不存在拒、公开拒、非公开放行。只写前两条的话，一个「对谁都拒」的
 * 实现也会绿。
 */

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const MANAGE = ["promotion:campaign.manage"];

function makeReq(): Request & RequestContext {
  return {
    user: { id: OPERATOR_ID },
    capabilities: MANAGE,
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

/** 只读池回答套餐查询；写池回答 insert。 */
function poolsOf(planRow: Record<string, unknown> | undefined) {
  /* 显式写出参数签名：`vi.fn(async () => …)` 推出来的调用元组是空的，
     后面取 `calls[0][1]`（落库参数）会报 TS2493。 */
  const roQuery = vi.fn(async (_sql: string, _params?: unknown[]) => ({
    rows: planRow ? [planRow] : [],
  }));
  const rwQuery = vi.fn(async (_sql: string, _params?: unknown[]) => ({
    rows: [{ id: "batch-1" }],
  }));
  return {
    ro: { query: roQuery } as unknown as Pool,
    rw: { query: rwQuery } as unknown as Pool,
    roQuery,
    rwQuery,
  };
}

const BODY = {
  kind: "invite" as const,
  name: "内测邀请",
  effect: { planCode: "arda-beta-trial" },
  totalCount: 10,
  perUserLimit: 1,
  validFrom: "2026-09-22T00:00:00.000Z",
  validUntil: "2026-12-31T00:00:00.000Z",
};

describe("POST /api/commercial/voucher-batches · invite", () => {
  it("套餐不存在：400，且不落库", async () => {
    const { ro, rw, rwQuery } = poolsOf(undefined);
    const error = await new CommercialRouter(ro, rw)
      .createVoucherBatch(makeReq(), BODY)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(String((error as Error).message)).toContain("找不到套餐");
    expect(rwQuery).not.toHaveBeenCalled();
  });

  it("套餐本来就公开：400，且不落库", async () => {
    const { ro, rw, rwQuery } = poolsOf({
      plan_code: "arda-pro",
      is_public: true,
    });
    const error = await new CommercialRouter(ro, rw)
      .createVoucherBatch(makeReq(), {
        ...BODY,
        effect: { planCode: "arda-pro" },
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(String((error as Error).message)).toContain("本来就对外开放");
    expect(rwQuery).not.toHaveBeenCalled();
  });

  it("非公开套餐：放行并落库", async () => {
    const { ro, rw, rwQuery } = poolsOf({
      plan_code: "arda-beta-trial",
      is_public: false,
    });
    const result = await new CommercialRouter(ro, rw).createVoucherBatch(
      makeReq(),
      BODY,
    );

    expect(result).toEqual({ batchId: "batch-1" });
    expect(rwQuery).toHaveBeenCalledTimes(1);
    /* effect 只装「解锁哪个套餐」——落库的是归一化后的形状，不是请求体原样。 */
    const params = rwQuery.mock.calls[0]?.[1] as unknown[] | undefined;
    expect(JSON.parse(String(params?.[4]))).toEqual({
      planCode: "arda-beta-trial",
    });
  });

  it("effect 既没 planCode 也没 planVersionId：400，且根本不查套餐", async () => {
    const { ro, rw, roQuery, rwQuery } = poolsOf(undefined);
    const error = await new CommercialRouter(ro, rw)
      .createVoucherBatch(makeReq(), { ...BODY, effect: {} })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    /* 形状检查在打库之前——请求体就不对时不该白查一次库。 */
    expect(roQuery).not.toHaveBeenCalled();
    expect(rwQuery).not.toHaveBeenCalled();
  });
});
