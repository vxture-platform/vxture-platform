/**
 * atlas-contract.spec.ts — admin 侧 Atlas **词表**的反向验证。
 *
 * 机制（形状声明、形状变更检出、空集合、未知资源）已在
 * `@vxture-platform/shared` 自带测试；这一份只钉本仓的清单，尤其是
 * **2026-08-24 之前完全没被守住的那条读**。
 *
 * 守卫必须反向验证过：把缺陷退回去，确认它真的报错。没红过的守卫等于没有。
 */

import { describe, expect, it } from "vitest";

import { ATLAS_CONTRACT, assertAtlasContract } from "./atlas-contract";

type AtlasResource = keyof typeof ATLAS_CONTRACT;

/** 按清单造一份「什么都不缺」的响应：行照 `fields`，信封照 `shape.envelopeFields`。 */
function payloadFor(resource: AtlasResource, drop: string[] = []): unknown {
  const contract = ATLAS_CONTRACT[resource];
  const row: Record<string, unknown> = Object.fromEntries(
    contract.fields.filter((f) => !drop.includes(f)).map((f) => [f, "x"]),
  );
  /* 本仓的表目前只有 list 与 page 两种形状，所以不写 `single` 分支——
     TS 会把它判成不可能的比较（这一层的表是 `as const`，联合被收窄了）。 */
  const shape = contract.shape;
  if (shape.kind === "list") return [row];
  const envelope: Record<string, unknown> = Object.fromEntries(
    (shape.envelopeFields ?? [])
      .filter((f) => !drop.includes(f))
      .map((f) => [f, "x"]),
  );
  return { ...envelope, [shape.rowsKey]: [row] };
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
  it.each(Object.keys(ATLAS_CONTRACT) as AtlasResource[])("%s", (resource) => {
    expect(() =>
      assertAtlasContract(payloadFor(resource), resource),
    ).not.toThrow();
  });
});

describe("反向验证：把 2026-08-23 实测到的漂移退回去", () => {
  /**
   * 每一条都对应一个真实缺陷，而且**当初全都不报错**——类型只是注解，
   * `atlasRequest<T>()` 只做断言不做校验，页面读到 undefined 继续渲染。
   */
  it.each([
    ["providers", "state", "六个记录当初全都还声明着 isActive"],
    ["models", "modelType", "少了它分不出对话模型与向量模型"],
    ["policies", "rateLimitRpm", "旧类型按一套上游不存在的限流模型说话"],
    ["quotas", "effectiveAt", "配额没有 state，生效与否全看这个窗口"],
    ["price-rules", "billingMode", "计价口径，缺了整行没法解释"],
  ] as const)("%s 缺 %s（%s）", (resource, field, _why) => {
    const body = thrown(() =>
      assertAtlasContract(payloadFor(resource, [field]), resource),
    );
    expect(body["code"]).toBe("ATLAS_CONTRACT_FIELD_MISSING");
    expect(body["field"]).toBe(field);
    expect(String(body["message"])).toContain(resource);
    expect(body["retryable"]).toBe(false);
  });

  it("一次点名所有缺的字段，不是只报第一个", () => {
    const body = thrown(() => assertAtlasContract([{ id: "m1" }], "models"));
    expect(String(body["message"])).toContain("modelCode");
    expect(String(body["message"])).toContain("state");
  });
});

/**
 * 这一组是把机制换成共用实现的**全部理由**。
 *
 * 本仓此前自带一份只认裸数组的守卫，于是 `usage-summaries`（信封）**整条被静默跳过**
 * ——而恰恰是它的类型整体陈旧：`id` / `statType` / `totalRequests` / `successRequests`
 * / `failedRequests` / `totalCostAmount` / `currency` / `updatedAt`，上游一个都不发。
 * 唯一没炸的原因是页面只读了恰好还在的 `totalTokens`。
 */
describe("usage-summaries —— 换机制之前完全没被守住的那条读", () => {
  it("是信封，行键 `items`", () => {
    const shape = ATLAS_CONTRACT["usage-summaries"].shape;
    expect(shape.kind).toBe("page");
    expect(shape.kind === "page" && shape.rowsKey).toBe("items");
  });

  it("退回裸数组会被判形状变更，而不是顺着新形状解析", () => {
    const body = thrown(() =>
      assertAtlasContract([{ cycleMonth: "2026-08" }], "usage-summaries"),
    );
    expect(body["code"]).toBe("ATLAS_CONTRACT_SHAPE_CHANGED");
  });

  /**
   * A-4 修的那个真实缺陷：`groupBy` 服务端默认 `tenant`，回显若放在行上，
   * **空结果时整个消失**，拿到 `[]` 的调用方无从得知自己查的是哪根轴。
   */
  it("`dimension` 在信封上，且空结果照样查", () => {
    const body = thrown(() =>
      assertAtlasContract({ items: [] }, "usage-summaries"),
    );
    expect(body["code"]).toBe("ATLAS_CONTRACT_FIELD_MISSING");
    expect(body["field"]).toBe("dimension");
    expect(String(body["message"])).toContain("信封");
  });

  it("退回那批陈旧字段名同样要报", () => {
    const body = thrown(() =>
      assertAtlasContract(
        {
          dimension: "tenant",
          items: [
            {
              id: "u1",
              statType: "chat",
              totalRequests: "10",
              successRequests: "9",
              currency: "CNY",
            },
          ],
        },
        "usage-summaries",
      ),
    );
    expect(String(body["message"])).toContain("cycleMonth");
    expect(String(body["message"])).toContain("requests");
    expect(String(body["message"])).toContain("totalTokens");
  });
});
