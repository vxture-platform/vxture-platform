/**
 * atlas-compat.spec.ts —— 两代形状归一。
 *
 * 这一层的价值全在「**两代都成立**」上，而那正是肉眼最难验的东西：本地只连得到其中
 * 一代。测试是唯一能同时按住两边的地方。
 */
import { describe, expect, it } from "vitest";
import { normalizeAtlasState } from "./atlas-compat";

describe("state ⇄ isActive 双向补齐", () => {
  it("只有 state 时补出 isActive", () => {
    const rows = [{ state: "active" }, { state: "inactive" }];
    normalizeAtlasState(rows);
    expect(rows[0]).toMatchObject({ isActive: true });
    expect(rows[1]).toMatchObject({ isActive: false });
  });

  /**
   * 这条是整个文件存在的理由。`deprecated` 的 `is_active` 是 **true**——把它反向映射成
   * `false`，界面上一个仍在服务的模型会显示成「停用」，而且不报任何错。
   */
  it("deprecated 仍算「运营意图开着」——不是停用", () => {
    const row = { state: "deprecated" };
    normalizeAtlasState(row);
    expect(row).toMatchObject({ isActive: true });
  });

  it("两个都有时一个都不改（上游是权威，这一层只补不覆盖）", () => {
    const row = { state: "deprecated", isActive: true };
    normalizeAtlasState(row);
    expect(row).toEqual({ state: "deprecated", isActive: true });
  });

  it("不给没有这个概念的对象凭空加字段", () => {
    const row = { id: "x", providerCode: "openai" };
    normalizeAtlasState(row);
    expect(row).toEqual({ id: "x", providerCode: "openai" });
  });

  it("下探嵌套：{items:[…]} 与 endpoint.models[]", () => {
    const page = {
      items: [{ state: "active", models: [{ state: "inactive" }] }],
      nextCursor: null,
    };
    normalizeAtlasState(page);
    expect(page.items[0]).toMatchObject({ isActive: true });
    expect(page.items[0]!.models[0]).toMatchObject({ isActive: false });
  });

  it("null / 标量原样返回，不炸", () => {
    expect(normalizeAtlasState(null)).toBeNull();
    expect(normalizeAtlasState("x")).toBe("x");
    expect(normalizeAtlasState(3)).toBe(3);
  });
});
