import { describe, expect, it } from "vitest";
import { isExternalLink, mergeById } from "./inbox-list";

/**
 * 批 6 两条修复的回归:外链不能进 next-intl 路由器(会被加语言前缀成 /zh-CN/https://…);
 * 「加载更多」与重试交错时不能出现重复行。
 */
describe("isExternalLink", () => {
  it("http / https 绝对地址是站外链接", () => {
    expect(isExternalLink("https://vxture.com/status")).toBe(true);
    expect(isExternalLink("HTTP://example.com")).toBe(true);
  });

  it("站内路径与其它协议不是", () => {
    expect(isExternalLink("/billing")).toBe(false);
    expect(isExternalLink("/inbox?filter=todo")).toBe(false);
    expect(isExternalLink("mailto:ops@example.com")).toBe(false);
    expect(isExternalLink("")).toBe(false);
  });
});

describe("mergeById", () => {
  const a = { id: "a", n: 1 };
  const b = { id: "b", n: 2 };
  const c = { id: "c", n: 3 };

  it("追加新行,保持原有顺序", () => {
    expect(mergeById([a, b], [c])).toEqual([a, b, c]);
  });

  it("已有 id 不重复、不被后到的覆盖", () => {
    const bLate = { id: "b", n: 99 };
    expect(mergeById([a, b], [bLate, c])).toEqual([a, b, c]);
  });

  it("两边为空都安全", () => {
    expect(mergeById([], [a])).toEqual([a]);
    expect(mergeById([a], [])).toEqual([a]);
    expect(mergeById([], [])).toEqual([]);
  });
});
