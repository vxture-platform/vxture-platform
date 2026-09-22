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

/**
 * 发放：邀请券必须定向到人或工作空间（2026-09-22）。
 *
 * 死券的第二个形态。第一个是「指向公开套餐」（上面那组守的建批次那道）；这一个是
 * **租户级批次走「租户全员」**——那条路径把 `assigned_user_id` 与
 * `assigned_workspace_id` 都写成 NULL，而客户侧的邀请判据认的正是这两列。
 * 于是券发得出去、界面回「发放成功」还带着券码，客户那边始终看不见套餐。
 *
 * 原有的「禁无主券」只管平台级批次（`!batch.tenant_id`），租户级批次那条路是敞的。
 * 两面都写：邀请券拒，其他券型照旧放行——只写前者的话，一个把所有券型的
 * 「租户全员」都拒掉的实现也会绿，而那会拦掉代金券本来支持的发法。
 */
describe("POST /api/commercial/vouchers/assign · invite 必须定向", () => {
  const BATCH_ID = "22222222-2222-4222-8222-222222222222";

  /** 按序回答：begin → 取批次(for update) → …；发行量抢占那条回 rowCount。 */
  function clientOf(kind: string) {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      calls.push(sql);
      if (sql.includes("from promotion.voucher_batches where id")) {
        return {
          rows: [
            {
              id: BATCH_ID,
              /* 租户级批次：原有的「禁无主券」对它不生效，正是缺口所在。 */
              tenant_id: "33333333-3333-4333-8333-333333333333",
              kind,
              code_prefix: null,
              per_user_limit: 1,
              status: "active",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("update promotion.voucher_batches")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const pool = {
      connect: async () => ({ query, release: () => undefined }),
    } as unknown as Pool;
    return { pool, query, calls };
  }

  function operatorReq(): Request & RequestContext {
    return {
      user: { id: OPERATOR_ID },
      operator: { id: OPERATOR_ID },
      capabilities: MANAGE,
      ip: "127.0.0.1",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request & RequestContext;
  }

  it("邀请券 + 租户全员（两个目标都不给）：400，且不发券", async () => {
    const { pool, calls } = clientOf("invite");
    const error = await new CommercialRouter(pool, pool)
      .assignVouchers(operatorReq(), { batchId: BATCH_ID, count: 1 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(String((error as Error).message)).toContain("必须定向");
    /* 拦在发行量抢占之前：券一行都不许落，issued_count 也不许动。 */
    expect(
      calls.some((s) => s.includes("insert into promotion.vouchers")),
    ).toBe(false);
    expect(
      calls.some((s) => s.includes("update promotion.voucher_batches")),
    ).toBe(false);
  });

  it("代金券 + 租户全员：照旧放行（这条发法本来就支持）", async () => {
    const { pool, calls } = clientOf("credit_voucher");
    await new CommercialRouter(pool, pool)
      .assignVouchers(operatorReq(), { batchId: BATCH_ID, count: 1 })
      .catch(() => undefined);

    expect(
      calls.some((s) => s.includes("insert into promotion.vouchers")),
    ).toBe(true);
  });
});
