/**
 * upstream-contract.spec.ts — 断言机制本身的正反两面。
 *
 * 守卫必须**反向验证过**：把缺陷退回去，确认它真的报错。没红过的守卫等于没有——
 * 它会在真正需要它的那天安静地放行。
 *
 * 这一份钉的是**机制**（形状声明、形状变更检出、空集合、未知资源）。各上游的词表与
 * 它们踩过的真实漂移，在消费方仓内各自的 `*-contract.spec.ts`——那是「我方读哪些字段」，
 * 属于消费方的事实；只有**怎么查**是共用的。
 */

import { describe, expect, it } from "vitest";

import {
  makeContractAssert,
  type ContractTable,
  type ContractViolation,
} from "./upstream-contract";

const TABLE = {
  bare: { shape: { kind: "list" }, fields: ["id", "state"] },
  paged: { shape: { kind: "page", rowsKey: "items" }, fields: ["id", "state"] },
  envelope: { shape: { kind: "page", rowsKey: "rows" }, fields: ["id"] },
  one: { shape: { kind: "single" }, fields: ["id", "total"] },
} as const satisfies ContractTable;

/**
 * 机制不认识 HTTP，所以这里注入一个最朴素的抛法：把违约描述原样挂在 Error 上。
 * 真实调用方注入的是自己的错误封套（opera-bff 的 `ApiError`、admin-bff 的
 * `BadGatewayException`），而机制对两者一无所知——那正是它能被两个 BFF 共用的原因。
 */
class TestViolation extends Error {
  constructor(readonly detail: ContractViolation) {
    super(detail.message);
  }
}

const assertX = makeContractAssert(
  "TestUp",
  "TESTUP",
  TABLE,
  (v) => new TestViolation(v),
);

function thrown(fn: () => unknown): ContractViolation {
  try {
    fn();
  } catch (error) {
    return (error as TestViolation).detail;
  }
  throw new Error("expected a contract violation, got none");
}

describe("形状齐了就放行", () => {
  it("裸数组", () => {
    const p = [{ id: "1", state: "active" }];
    expect(assertX(p, "bare")).toBe(p);
  });

  it("分页信封 —— **原样返回信封**，不能把 nextCursor 吃掉", () => {
    const p = { items: [{ id: "1", state: "active" }], nextCursor: "abc" };
    expect(assertX(p, "paged")).toBe(p);
  });

  it("单个对象", () => {
    const p = { id: "1", total: 3 };
    expect(assertX(p, "one")).toBe(p);
  });

  it("上游多给字段不是错——加字段是兼容变更", () => {
    const p = [{ id: "1", state: "active", brandNew: 1 }];
    expect(assertX(p, "bare")).toBe(p);
  });

  it("值是 null 不算缺失——null 是一个答案，undefined 才是没答", () => {
    const p = [{ id: "1", state: null }];
    expect(assertX(p, "bare")).toBe(p);
  });

  it("空集合放行：没有行就没有形状可查", () => {
    expect(assertX([], "bare")).toEqual([]);
    expect(assertX({ items: [], nextCursor: null }, "paged")).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});

describe("字段缺失 → 点名", () => {
  it("裸数组里缺字段", () => {
    const body = thrown(() => assertX([{ id: "1" }], "bare"));
    expect(body.code).toBe("TESTUP_CONTRACT_FIELD_MISSING");
    expect(body.field).toBe("state");
  });

  it("**查进信封里面**，不是停在信封上", () => {
    const body = thrown(() =>
      assertX({ items: [{ id: "1" }], nextCursor: null }, "paged"),
    );
    expect(body.field).toBe("state");
  });

  it("一次点名所有缺的，不是只报第一个", () => {
    const body = thrown(() => assertX([{}], "bare"));
    expect(body.message).toContain("id");
    expect(body.message).toContain("state");
  });
});

/**
 * 这一组是第二版设计的**全部理由**。
 *
 * 第一版靠"看见有 rows 键就当信封"来嗅形状。它能跑，但有一个致命性质：**嗅探会静默适应
 * 上游的形状变化**——而"悄悄适应上游变化"正是这整套断言要消灭的东西。分页信封哪天变成
 * 裸数组，嗅探版本会顺从地继续检查、一声不吭，而那意味着 `nextCursor` 没了，页面从此
 * 安静地只显示第一页。
 */
describe("形状变更本身就是违约（声明式的意义）", () => {
  it("声明 page，收到裸数组 → 报 SHAPE_CHANGED，不顺着新形状解析", () => {
    const body = thrown(() => assertX([{ id: "1", state: "a" }], "paged"));
    expect(body.code).toBe("TESTUP_CONTRACT_SHAPE_CHANGED");
    expect(body.message).toContain("分页信封");
    expect(body.message).toContain("数组");
    /* 消息里要说清"为什么不顺着解析"——否则下一个人会以为这是过度严格。 */
    expect(body.message).toContain("nextCursor");
  });

  it("声明 page，信封里没有那个行键 → 同样报", () => {
    const body = thrown(() => assertX({ rows: [{ id: "1" }] }, "paged"));
    expect(body.code).toBe("TESTUP_CONTRACT_SHAPE_CHANGED");
    expect(body.message).toContain("items");
  });

  it("声明 list，收到信封 → 报（反方向也要挡）", () => {
    const body = thrown(() => assertX({ items: [{ id: "1" }] }, "bare"));
    expect(body.code).toBe("TESTUP_CONTRACT_SHAPE_CHANGED");
    expect(body.message).toContain("裸数组");
  });

  it("声明 single，收到数组 → 报", () => {
    const body = thrown(() => assertX([{ id: "1", total: 1 }], "one"));
    expect(body.code).toBe("TESTUP_CONTRACT_SHAPE_CHANGED");
  });

  it("两个上游的行键不同（items / rows），各按各的声明查", () => {
    const p = { rows: [{ id: "1" }], nextCursor: null };
    expect(assertX(p, "envelope")).toBe(p);
    /* 同一份载荷用 items 的声明去查就该报——行键是数据，不是猜出来的。 */
    expect(thrown(() => assertX(p, "paged")).code).toBe(
      "TESTUP_CONTRACT_SHAPE_CHANGED",
    );
  });

  it("单个对象读到空响应体放行——那不是形状变了", () => {
    expect(assertX(undefined, "one")).toBe(undefined);
  });
});

describe("表里没有这条资源", () => {
  /** 查不到表的守卫就是没有守卫，所以不能静默放行。 */
  it("资源名写错 / 新增读忘了加表 → 报，不放行", () => {
    const body = thrown(() =>
      (assertX as (p: unknown, r: string) => unknown)([{ id: "1" }], "typo"),
    );
    expect(body.code).toBe("TESTUP_CONTRACT_UNKNOWN_RESOURCE");
    expect(body.message).toContain("typo");
  });
});
