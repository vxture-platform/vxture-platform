import { describe, expect, it } from "vitest";
import { formatPrincipalNo, formatPrincipalNoOr } from "./principal-no";

/**
 * 主体码 v4 的展示形状:三种主体各自的字母前缀,空值不画前缀(交给调用方占位)。
 * 前缀在此收口——此前三处三套写法,这里一旦漂移,账号页 / 租户页 / 转换回放全跟着错。
 */
describe("formatPrincipalNo", () => {
  it("按主体种类加前缀,号码原样不分组", () => {
    expect(formatPrincipalNo("1799729056", "user")).toBe("U-1799729056");
    expect(formatPrincipalNo("2765001234", "tenant")).toBe("T-2765001234");
    expect(formatPrincipalNo("3120009876", "workspace")).toBe("W-3120009876");
  });

  it("接受数字输入", () => {
    expect(formatPrincipalNo(1799729056, "user")).toBe("U-1799729056");
  });

  it("空值返回 null,而不是画一个孤零零的前缀", () => {
    expect(formatPrincipalNo(null, "user")).toBeNull();
    expect(formatPrincipalNo(undefined, "tenant")).toBeNull();
    expect(formatPrincipalNo("", "workspace")).toBeNull();
  });
});

describe("formatPrincipalNoOr", () => {
  it("有值时与 formatPrincipalNo 一致", () => {
    expect(formatPrincipalNoOr("2765001234", "tenant", "—")).toBe(
      "T-2765001234",
    );
  });

  it("空值回退到调用方给的占位符", () => {
    expect(formatPrincipalNoOr(null, "tenant", "—")).toBe("—");
    expect(formatPrincipalNoOr("", "user", "n/a")).toBe("n/a");
  });
});
