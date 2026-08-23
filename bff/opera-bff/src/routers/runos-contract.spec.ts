/**
 * runos-contract.spec.ts — Runos **词表**的反向验证。
 *
 * 机制在 `upstream-contract.spec.ts`；这一份只钉：**把 runos 侧实测到的两条真实漂移退回去，
 * 确认这张表真的会红。** 那两条当初都是手工逐字段对源码才发现的，两条都不报错。
 */

import { describe, expect, it } from "vitest";

import { RUNOS_CONTRACT, assertRunosContract } from "./runos-contract";

type RunosResource = keyof typeof RUNOS_CONTRACT;

function payloadFor(resource: RunosResource, drop: string[] = []): unknown {
  const contract = RUNOS_CONTRACT[resource];
  const row: Record<string, unknown> = Object.fromEntries(
    contract.fields.filter((f) => !drop.includes(f)).map((f) => [f, "x"]),
  );
  const shape = contract.shape;
  if (shape.kind === "list") return [row];
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
});

describe("反向验证：runos 侧实测到的两条漂移", () => {
  /**
   * 门户曾经读 `latencyMs`——**上游从来没有过这个字段**（真值拆成了
   * `latencyTotalMs`/`GatewayMs`/`CapabilityMs`）。于是调用流水的延迟列一直是「—」，
   * 不报错，谁也没发现。
   */
  it("调用流水缺 `latencyTotalMs`；给了那个不存在的旧名也不算数", () => {
    const payload = payloadFor("audit-calls", ["latencyTotalMs"]) as {
      items: Record<string, unknown>[];
    };
    payload.items[0]!["latencyMs"] = "123";
    const body = thrown(() => assertRunosContract(payload, "audit-calls"));
    expect(body["code"]).toBe("RUNOS_CONTRACT_FIELD_MISSING");
    expect(body["field"]).toBe("latencyTotalMs");
    expect(String(body["message"])).toContain("audit-calls");
    expect(body["retryable"]).toBe(false);
  });

  /**
   * `quota/reset` 只回 `{grantId, used, updatedAt}`。把它当消费量存进缓存，
   * `enforced` 就成了 undefined，于是一条**有上限**的授权被渲染成「未强制」——
   * 重置一次配额，界面就开始说这条授权不限量。
   */
  it("配额消费量缺 enforced/quotaLimit/remaining（reset 的形状混进来就是这样）", () => {
    const body = thrown(() =>
      assertRunosContract(
        { grantId: "g1", used: 0, updatedAt: null },
        "grant-quota",
      ),
    );
    expect(String(body["message"])).toContain("quotaLimit");
    expect(String(body["message"])).toContain("enforced");
    expect(String(body["message"])).toContain("remaining");
  });

  /**
   * 计量与配额维度（2026-08-24 接出）。这一组不是「以防万一」——它钉的是两条会
   * **静默出错**的边界：
   *
   * - `costUnit` 缺了，计量列会只剩一个数字，而 `costUnit` 是开放词表：同一列里
   *   `rerank` 按 candidate、`parse` 按 page。没有单位的一列数字，等于邀请人把
   *   token 和页数加起来（product_251 X-3 举的正是这个 `SUM()` 例子）。
   * - `quotaLimit` 缺了会被读成 0，而 0 在这里的含义是「未强制」；页面据此显示
   *   「未强制」——于是一条**有上限**的授权被渲染成不限量。
   */
  it.each([
    ["costAmount", "计量列整列消失"],
    ["costUnit", "只剩数字，不同能力的单位被混在一列里"],
    ["quotaLimit", "读成 0 → 有上限的授权被渲染成「未强制」"],
    ["quotaCounterBefore", "配额位置只剩分母"],
    ["degradedMode", "降级裁决与正常裁决长得一样"],
    ["matchedPolicyIds", "裁决旁的策略提示变成空串"],
  ] as const)("调用流水缺 `%s`（%s）", (field, _why) => {
    const body = thrown(() =>
      assertRunosContract(payloadFor("audit-calls", [field]), "audit-calls"),
    );
    expect(body["code"]).toBe("RUNOS_CONTRACT_FIELD_MISSING");
    expect(body["field"]).toBe(field);
  });

  /**
   * `costAmount` 上线是**字符串**（`Decimal(18,6)`，上游只把四个 BigInt 窄化成
   * Number，Decimal 原样交给 `JSON.stringify`）。实测确认过，不是推断——读侧这个
   * 形状上游一条单测都没钉，而那正是 `latencyMs` 那条缺陷的温床。
   *
   * 这里不断言类型（契约层只查有无），钉的是**别把它当数字用**这条约定：
   * 一旦有人在门户里 `Number(costAmount)`，Decimal 存在的理由就没了。
   */
  it("`costAmount` 与 `costUnit` 是成对的必有字段，不是可选装饰", () => {
    const fields = RUNOS_CONTRACT["audit-calls"].fields;
    expect(fields).toContain("costAmount");
    expect(fields).toContain("costUnit");
  });

  it("一次点名所有缺的字段，不是只报第一个", () => {
    const body = thrown(() =>
      assertRunosContract([{ capabilityId: "a.b" }], "capabilities"),
    );
    expect(String(body["message"])).toContain("primitiveType");
    expect(String(body["message"])).toContain("admissionTier");
    expect(String(body["message"])).toContain("category");
  });
});

describe("形状声明本身对不对（照 runos 真实响应）", () => {
  /**
   * 这一组以前钉的是「runos 用 `rows`」——那是把一处分歧钉成了资产。
   * product_251 A-4 之后两边同形，所以它反过来钉相同，并且钉住**退回去会红**。
   */
  it.each([
    "audit-calls",
    "audit-mgmt-events",
    "audit-outcomes",
    "usage-summaries",
  ] as const)("%s 是分页信封，行键是 `items`", (resource) => {
    const shape = RUNOS_CONTRACT[resource].shape;
    expect(shape.kind).toBe("page");
    expect(shape.kind === "page" && shape.rowsKey).toBe("items");
  });

  it("退回旧的 `rows` 行键会被判形状变更", () => {
    const body = thrown(() =>
      assertRunosContract(
        { rows: [{ eventId: "1" }], nextCursor: null },
        "audit-calls",
      ),
    );
    expect(body["code"]).toBe("RUNOS_CONTRACT_SHAPE_CHANGED");
    expect(String(body["message"])).toContain("items");
  });

  it("三条游标流水都把 `nextCursor` 钉在信封上", () => {
    for (const resource of [
      "audit-calls",
      "audit-mgmt-events",
      "audit-outcomes",
    ] as const) {
      const shape = RUNOS_CONTRACT[resource].shape;
      expect(shape.kind === "page" && shape.envelopeFields, resource).toContain(
        "nextCursor",
      );
    }
  });

  /**
   * `usage-summaries` 有信封却**没有游标**——因为 `groupBy` 默认 `workspace`、
   * 窗口默认当月，两者都是服务端解析出来的。这条同时钉住此前表里的一处抄错：
   * `dimension` 曾被列成行字段，那条读一旦真有数据就会误报。
   */
  it("usage-summaries 的 `dimension`/`from`/`to` 在信封上，空结果照样查", () => {
    const shape = RUNOS_CONTRACT["usage-summaries"].shape;
    expect(shape.kind === "page" && shape.envelopeFields).toEqual([
      "dimension",
      "from",
      "to",
    ]);
    expect(RUNOS_CONTRACT["usage-summaries"].fields).not.toContain("dimension");

    const body = thrown(() =>
      assertRunosContract({ items: [] }, "usage-summaries"),
    );
    expect(body["field"]).toBe("dimension");
  });
});
