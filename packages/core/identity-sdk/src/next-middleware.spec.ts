import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { createAuthMiddleware } from "./next-middleware";

function req(url: string, cookies: Record<string, string> = {}): NextRequest {
  const r = new NextRequest(new URL(url, "http://portal.test"));
  for (const [k, v] of Object.entries(cookies)) r.cookies.set(k, v);
  return r;
}

/** 从 302/307 的 Location 里取出跳转目标，断言更好读。 */
function location(res: NextResponse): URL {
  return new URL(res.headers.get("location") ?? "", "http://portal.test");
}

describe("createAuthMiddleware", () => {
  const mw = createAuthMiddleware({ app: "demo" });

  it("Unknown → 去 /auth/login 并静默探测一次", () => {
    const url = location(mw(req("/tenants")));
    expect(url.pathname).toBe("/auth/login");
    expect(url.searchParams.get("prompt")).toBe("none");
    expect(url.searchParams.get("returnTo")).toBe("http://portal.test/tenants");
  });

  it("Anonymous → 直接交互登录，不带 prompt", () => {
    const res = mw(req("/tenants", { vx_demo_sso_presence: "anonymous" }));
    expect(location(res).searchParams.get("prompt")).toBeNull();
  });

  it("Authenticated → 放行", () => {
    const res = mw(req("/tenants", { vx_rp_session_demo: "sid" }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("别的门户的会话 cookie 不算数（本地同 localhost，cookie 无视端口）", () => {
    const res = mw(req("/tenants", { vx_rp_session_other: "sid" }));
    expect(location(res).pathname).toBe("/auth/login");
  });

  /* 2026-09-04 实测：容器里 Next 自己拼的 origin 是绑定地址 https://0.0.0.0:3020，
   * 用它拼的 returnTo 被 BFF 白名单挡掉、回落首页，首访深链（邀请邮件链接）登录后
   * 丢路径。returnTo 必须按 nginx 转发的 Host / X-Forwarded-Proto 拼。 */
  it("returnTo 用转发头里的公开 origin，不用容器绑定地址", () => {
    const r = new NextRequest(
      new URL("/zh-CN/accept-invitation?token=abc", "http://0.0.0.0:3020"),
      {
        headers: {
          host: "console.example.com",
          "x-forwarded-proto": "https",
        },
      },
    );
    expect(location(mw(r)).searchParams.get("returnTo")).toBe(
      "https://console.example.com/zh-CN/accept-invitation?token=abc",
    );
  });

  it("X-Forwarded-Host 优先于 Host（多级代理取第一个）", () => {
    const r = new NextRequest(new URL("/tenants", "http://0.0.0.0:3020"), {
      headers: {
        host: "vx-platform-console:3020",
        "x-forwarded-host": "console.example.com, internal",
        "x-forwarded-proto": "https, http",
      },
    });
    expect(location(mw(r)).searchParams.get("returnTo")).toBe(
      "https://console.example.com/tenants",
    );
  });

  it("returnTo 里剥掉 vx_sso_silent，避免参数一层层套下去", () => {
    const res = mw(req("/tenants?vx_sso_silent=0&keep=1"));
    expect(location(res).searchParams.get("returnTo")).toBe(
      "http://portal.test/tenants?keep=1",
    );
  });

  /* 2026-08-05 实测踩到：豁免路径当时直接 `NextResponse.next()`，绕过了 onAllow，
   * 于是 website 的 `/` 不再经 next-intl 补 locale 前缀，静静地 404——没有任何
   * 一处报错指向 middleware。豁免的含义是"不参与认证决策"，不是"不参与后续处理"。 */
  it("豁免路径仍然走 onAllow（不是绕过整条链）", () => {
    const onAllow = vi.fn(() => NextResponse.next());
    const guarded = createAuthMiddleware({
      app: "demo",
      isExempt: (p) => p === "/signin",
      onAllow,
    });
    guarded(req("/signin"));
    expect(onAllow).toHaveBeenCalledOnce();
  });

  it("认证通过也走同一个 onAllow", () => {
    const onAllow = vi.fn(() => NextResponse.next());
    const guarded = createAuthMiddleware({ app: "demo", onAllow });
    guarded(req("/tenants", { vx_rp_session_demo: "sid" }));
    expect(onAllow).toHaveBeenCalledOnce();
  });

  it("静态资源连 onAllow 都不进（没有 locale 语义，白改写一次）", () => {
    const onAllow = vi.fn(() => NextResponse.next());
    const guarded = createAuthMiddleware({ app: "demo", onAllow });
    guarded(req("/logo.svg"));
    guarded(req("/_next/static/chunk.js"));
    guarded(req("/auth/login"));
    expect(onAllow).not.toHaveBeenCalled();
  });

  it("isExempt 可以表达'只保护一条路径'（website 的反转用法）", () => {
    const publicSite = createAuthMiddleware({
      app: "demo",
      isExempt: (p) => !p.startsWith("/dashboard"),
    });
    expect(publicSite(req("/products")).headers.get("location")).toBeNull();
    expect(location(publicSite(req("/dashboard"))).pathname).toBe(
      "/auth/login",
    );
  });
});
