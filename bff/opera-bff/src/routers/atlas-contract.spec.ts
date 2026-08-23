/**
 * atlas-contract.spec.ts — Atlas **词表**的反向验证。
 *
 * 机制本身（形状声明、形状变更检出、空集合、未知资源）在
 * `upstream-contract.spec.ts`；这一份只钉一件事：**把本轮实测到的每一条真实漂移退回去，
 * 确认这张表真的会红。** 没红过的清单等于没有清单。
 */

import { describe, expect, it } from "vitest";

import { ATLAS_CONTRACT, assertAtlasContract } from "./atlas-contract";

type AtlasResource = keyof typeof ATLAS_CONTRACT;

/**
 * 按清单造一份「什么都不缺」的响应：行照 `fields`，信封照 `shape.envelopeFields`。
 * 两者都要造——A-4 之后信封上的服务端解析结果同样是必查项。
 */
function payloadFor(resource: AtlasResource, drop: string[] = []): unknown {
  const contract = ATLAS_CONTRACT[resource];
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
  it.each(Object.keys(ATLAS_CONTRACT) as AtlasResource[])("%s", (resource) => {
    expect(() =>
      assertAtlasContract(payloadFor(resource), resource),
    ).not.toThrow();
  });
});

describe("反向验证：把 2026-08-23 实测到的漂移退回去", () => {
  /**
   * 每一条都对应一个真实缺陷。它们当初**全都不报错**——旧代码对着 undefined 继续渲染，
   * 把「生效中」画成「停用」、把计数画成 0。守卫存在的理由就是让下一次不必靠人眼。
   */
  it.each([
    ["providers", "modelCount", "删除文案曾靠它猜这台 Atlas 会不会级联删除"],
    ["model-routes", "resolution", "状态列曾退回显示意图，假装推导过"],
    ["models", "modelType", "少了它就分不出 chat 与 embedding"],
    ["api-keys", "effectiveState", "少了它页面就得自己拿 expiresAt 再算一遍"],
    ["api-keys", "state", "字段整个改了名，旧名读回来是 undefined，表格直接抛"],
  ] as const)("%s 缺 %s（%s）", (resource, field, _why) => {
    const body = thrown(() =>
      assertAtlasContract(payloadFor(resource, [field]), resource),
    );
    expect(body["code"]).toBe("ATLAS_CONTRACT_FIELD_MISSING");
    expect(body["field"]).toBe(field);
    /* 消息里必须同时有资源名和字段名——这条消息的全部价值就是让人不用翻网络面板。 */
    expect(String(body["message"])).toContain(resource);
    expect(String(body["message"])).toContain(field);
  });

  /**
   * X-3 一次改了五个字段名，而 `audit-logs` **此前是唯一没有守卫的面**——因为第一版的
   * 实现只认裸数组，信封读被整批跳过了，跳过还没被记下来。漂移最狠的面没有守卫，
   * 是这次把形状改成声明式的直接动因。
   */
  it.each(["eventId", "objectType", "objectId", "actorId", "actorConsole"])(
    "audit-logs 缺 %s（X-3 改名，回退到旧名同样要报）",
    (field) => {
      const body = thrown(() =>
        assertAtlasContract(payloadFor("audit-logs", [field]), "audit-logs"),
      );
      expect(body["field"]).toBe(field);
    },
  );

  it("一次点名所有缺的字段，不是只报第一个", () => {
    const body = thrown(() => assertAtlasContract([{ id: "m1" }], "models"));
    expect(String(body["message"])).toContain("modelCode");
    expect(String(body["message"])).toContain("state");
    expect(String(body["message"])).toContain("grantCount");
  });
});

describe("形状声明本身对不对（照 atlas 真实响应）", () => {
  /**
   * 收敛前这里钉的是「atlas 用 `items`、runos 用 `rows`」这个差异。product_251 A-4
   * 把差异消掉了，所以这一组反过来钉**相同**——一张钉着分歧的测试会把分歧变成资产。
   */
  it("每一个分页信封的行键都是 `items`，无一例外", () => {
    for (const [resource, contract] of Object.entries(ATLAS_CONTRACT)) {
      if (contract.shape.kind !== "page") continue;
      expect(contract.shape.rowsKey, resource).toBe("items");
    }
  });

  it("游标面把 `nextCursor` 钉在信封上——空结果时行检查是失明的", () => {
    for (const resource of ["audit-logs", "logs"] as const) {
      const shape = ATLAS_CONTRACT[resource].shape;
      expect(shape.kind === "page" && shape.envelopeFields).toContain(
        "nextCursor",
      );
    }
    const body = thrown(() => assertAtlasContract({ items: [] }, "audit-logs"));
    expect(body["field"]).toBe("nextCursor");
  });

  /**
   * A-4 修的那个真实缺陷：`groupBy` 服务端默认 `tenant`，回显若放在行上，空结果时
   * 整个消失，调用方拿到 `[]` 之后无从得知自己查的是哪根轴。
   */
  it("usage-summaries 的 `dimension` 在信封上，且空结果照样查", () => {
    const body = thrown(() =>
      assertAtlasContract({ items: [] }, "usage-summaries"),
    );
    expect(body["code"]).toBe("ATLAS_CONTRACT_FIELD_MISSING");
    expect(body["field"]).toBe("dimension");
    expect(String(body["message"])).toContain("信封");
  });

  it("`logs-summary` 的窗口回显同样在信封上（`window` 有服务端默认值）", () => {
    const body = thrown(() =>
      assertAtlasContract({ items: [], from: "a" }, "logs-summary"),
    );
    expect(String(body["message"])).toContain("to");
    expect(String(body["message"])).toContain("overall");
  });
});
