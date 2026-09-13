/**
 * runos-contract.spec.ts — admin 侧 Runos **词表**的反向验证。
 *
 * 机制（形状声明、形状变更检出、空集合、未知资源）已在 `@vxture-platform/shared`
 * 自带测试；这一份只钉本仓的两条清单。守卫必须反向验证过：把缺陷退回去，确认它
 * 真的报错。没红过的守卫等于没有。
 */

import { describe, expect, it } from "vitest";

import { RUNOS_CONTRACT, assertRunosContract } from "./runos-contract";

type RunosResource = keyof typeof RUNOS_CONTRACT;

/** 按清单造一份「什么都不缺」的响应：行照 `fields`，形状照 `shape.kind`。 */
function payloadFor(resource: RunosResource, drop: string[] = []): unknown {
  const contract = RUNOS_CONTRACT[resource];
  const row: Record<string, unknown> = Object.fromEntries(
    contract.fields.filter((f) => !drop.includes(f)).map((f) => [f, "x"]),
  );
  /* 迁移已走完（#306 第 3 步），不再有 `migrating` 要拆。迁移期这里曾刻意造 `from`:
     造 `to` 会让这组测试在 runos 还没切的时候「证明」一个尚未存在的形状。 */
  /* admin 这张表里已经没有 `list` 形状的资源了——目录列表切成信封之后一个都不剩。
     真的加回来时类型会立刻指出这里少一支。 */
  const shape = contract.shape;
  if (shape.kind === "single") return row;
  const envelope: Record<string, unknown> = Object.fromEntries(
    (shape.envelopeFields ?? [])
      .filter((f) => !drop.includes(f))
      .map((f) => [f, "x"]),
  );
  return { ...envelope, [shape.rowsKey]: [row], nextCursor: null };
}

function thrown(fn: () => unknown): Record<string, unknown> {
  try {
    fn();
  } catch (error) {
    return (error as { getResponse(): Record<string, unknown> }).getResponse();
  }
  throw new Error("expected a contract violation, got none");
}

describe("完整响应放行（每个资源都按自己声明的形状走一遍）", () => {
  it.each(Object.keys(RUNOS_CONTRACT) as RunosResource[])("%s", (resource) => {
    expect(() =>
      assertRunosContract(payloadFor(resource), resource),
    ).not.toThrow();
  });

  it("空目录是合法结果，不是契约问题", () => {
    /* 空**信封**，不是空数组——目录列表自 #306 起是 `{items, nextCursor, total}`。
       「一条都没有」仍然是合法结果，不是契约问题。 */
    expect(() =>
      assertRunosContract(
        { items: [], nextCursor: null, total: 0 },
        "capabilities",
      ),
    ).not.toThrow();
  });
});

describe("反向验证：把字段退回去要响", () => {
  it.each([
    ["capabilities", "admissionTier", "目录页按它分三档着色，缺了整列变灰"],
    ["capabilities", "category", "v0.5.0 起必填，目录页按它筛选"],
    ["capabilities", "capabilityId", "行标识；displayName 是呈现不是身份"],
    ["capability-detail", "endpoints", "详情抽屉的端点段全靠它"],
    ["capability-detail", "versions", "版本段；上游列表里没有，只有详情有"],
  ] as const)("%s 缺 %s（%s）", (resource, field, _why) => {
    const body = thrown(() =>
      assertRunosContract(payloadFor(resource, [field]), resource),
    );
    expect(body["code"]).toBe("RUNOS_CONTRACT_FIELD_MISSING");
    expect(body["field"]).toBe(field);
    expect(String(body["message"])).toContain(resource);
    expect(body["retryable"]).toBe(false);
  });

  it("一次点名所有缺的字段，不是只报第一个", () => {
    const body = thrown(() =>
      assertRunosContract(
        { items: [{ capabilityId: "c1" }], nextCursor: null, total: 1 },
        "capabilities",
      ),
    );
    expect(String(body["message"])).toContain("primitiveType");
    expect(String(body["message"])).toContain("admissionTier");
    expect(String(body["message"])).toContain("category");
  });
});

describe("形状是声明的，不是嗅出来的", () => {
  it("目录退成第三种形状 → 形状变更，不顺着解析", () => {
    /* `capabilities` 在迁移期（#306 step 3 之前）有**两种**合法形状:裸数组
       与 `{items, nextCursor}`。所以这条不能再用 `{items: []}` 当反例——那是
       迁移的终点形状，缺 `nextCursor` 会正确地报字段缺失而不是形状变更。
       用一个两种都不是的形状:既非数组，也没有 `items`。 */
    const body = thrown(() =>
      assertRunosContract({ rows: [] }, "capabilities"),
    );
    expect(body["code"]).toBe("RUNOS_CONTRACT_SHAPE_CHANGED");
    /* 迁移期这里还要求错误信息里带上 `until`（「什么会结束它」）。迁移走完之后那句话
       不再成立——现在只有一种合法形状，收到别的就是上游改了东西，没有「在途」可言。 */
    expect(String(body["message"])).toContain("capabilities");
  });

  it("详情退成数组 → 形状变更", () => {
    const body = thrown(() =>
      assertRunosContract(
        [payloadFor("capability-detail")],
        "capability-detail",
      ),
    );
    expect(body["code"]).toBe("RUNOS_CONTRACT_SHAPE_CHANGED");
  });

  it("调用点写错资源名 → 未知资源，不是「没配就不查」", () => {
    const body = thrown(() =>
      assertRunosContract([], "endpoints" as unknown as RunosResource),
    );
    expect(body["code"]).toBe("RUNOS_CONTRACT_UNKNOWN_RESOURCE");
  });
});
