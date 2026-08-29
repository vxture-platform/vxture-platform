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
  /* 本仓的表只有 list 与 single 两种形状——admin 对 Runos 没有信封读。 */
  return contract.shape.kind === "list" ? [row] : row;
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
    expect(() => assertRunosContract([], "capabilities")).not.toThrow();
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
      assertRunosContract([{ capabilityId: "c1" }], "capabilities"),
    );
    expect(String(body["message"])).toContain("primitiveType");
    expect(String(body["message"])).toContain("admissionTier");
    expect(String(body["message"])).toContain("category");
  });
});

describe("形状是声明的，不是嗅出来的", () => {
  it("列表退成对象 → 形状变更，不顺着解析", () => {
    const body = thrown(() =>
      assertRunosContract({ items: [] }, "capabilities"),
    );
    expect(body["code"]).toBe("RUNOS_CONTRACT_SHAPE_CHANGED");
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
