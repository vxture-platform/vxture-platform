import { describe, expect, it } from "vitest";
import { decideAuth, resolveLoginPrompt, resolvePresence } from "./decide";

describe("resolvePresence", () => {
  it("认 RP 会话 cookie 为 authenticated，不再看其余信号", () => {
    expect(
      resolvePresence({
        hasRpSession: true,
        presenceCookie: "anonymous",
        silentParam: "0",
      }),
    ).toBe("authenticated");
  });

  it("两个信号都没有 → unknown（还没问过 IdP）", () => {
    expect(resolvePresence({ hasRpSession: false })).toBe("unknown");
  });

  it("presence cookie 记着 anonymous → anonymous", () => {
    expect(
      resolvePresence({ hasRpSession: false, presenceCookie: "anonymous" }),
    ).toBe("anonymous");
  });

  /* 这条是无限重定向的回归锁。只认 cookie 的版本在 cookie 存不住时（浏览器策略、
   * 非浏览器客户端）会一直判 unknown → 一直静默探测 → 一直失败回跳，整站不可用。
   * 2026-08-04 用无 cookie jar 的 curl 实测复现过。 */
  it("cookie 丢了但 URL 上带着 vx_sso_silent=0 → 仍判 anonymous", () => {
    expect(
      resolvePresence({
        hasRpSession: false,
        presenceCookie: null,
        silentParam: "0",
      }),
    ).toBe("anonymous");
  });

  it("presence 是伪造/陈旧的杂值 → 当 unknown，最坏只是多问一次", () => {
    expect(
      resolvePresence({ hasRpSession: false, presenceCookie: "yes" }),
    ).toBe("unknown");
  });
});

describe("decideAuth", () => {
  it("authenticated 放行", () => {
    expect(decideAuth({ hasRpSession: true })).toEqual({ action: "allow" });
  });

  it("unknown 值得静默问一次", () => {
    expect(decideAuth({ hasRpSession: false })).toEqual({
      action: "login",
      prompt: "none",
    });
  });

  it("anonymous 直接交互登录，不再白跑一次静默", () => {
    expect(
      decideAuth({ hasRpSession: false, presenceCookie: "anonymous" }),
    ).toEqual({ action: "login", prompt: undefined });
  });
});

describe("resolveLoginPrompt", () => {
  it("上一轮已确认无中央会话 → 撤掉这一轮的 prompt=none", () => {
    expect(resolveLoginPrompt("none", "anonymous")).toBeUndefined();
  });

  it("presence 未知时保留 prompt=none", () => {
    expect(resolveLoginPrompt("none", null)).toBe("none");
  });

  it("非静默请求原样透传（不因 presence 改写交互登录）", () => {
    expect(resolveLoginPrompt("login", "anonymous")).toBe("login");
    expect(resolveLoginPrompt(undefined, "anonymous")).toBeUndefined();
  });
});
