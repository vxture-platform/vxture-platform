import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { OidcRouter } from "./oidc.router";

/**
 * 登出只结束发起方所在 realm 的会话（owner 2026-09-15 报「串台」）。
 *
 * 此前 end_session 一律把两个 realm 都结束、两份 cookie 都清：从 console 退出会把
 * 同一浏览器里的 opera 踢下线，反过来也一样。
 *
 * 每条同时钉两件事——结束了哪个会话、清了哪个 cookie——两者必须是同一份，
 * 否则留下拿不到 cookie 的孤儿会话（这是更早那次 `tenant ?? operator` 的教训）。
 */
function build(realmOfClient: "customer" | "workforce" | null) {
  const oidc = {
    logoutRealmOf: vi.fn(async (_clientId?: string) => realmOfClient),
    endSession: vi.fn(
      async (
        _sids: ReadonlyArray<string | undefined>,
      ): Promise<string | null> => null,
    ),
  };
  const config = {
    platform: {
      COOKIE_DOMAIN_PLATFORM: ".vxture.com",
      LOGIN_UI_BASE_URL: "https://accounts.vxture.com",
    },
  };
  const router = new OidcRouter(oidc as never, config as never);
  const res = {
    clearCookie: vi.fn((_name: string, _options?: unknown) => undefined),
    redirect: vi.fn((_url: string) => undefined),
  };
  const req = { cookies: { vx_sid: "sid-tenant", vx_sid_op: "sid-operator" } };
  return { router, oidc, res, req };
}

async function logout(
  realmOfClient: "customer" | "workforce" | null,
  clientId?: string,
) {
  const ctx = build(realmOfClient);
  await ctx.router.endSession(
    { ...(clientId ? { client_id: clientId } : {}) },
    ctx.req as unknown as Request,
    ctx.res as unknown as Response,
  );
  const ended = ctx.oidc.endSession.mock.calls[0]?.[0];
  const cleared = ctx.res.clearCookie.mock.calls.map((c) => c[0]);
  return { ended, cleared };
}

describe("end_session 按发起方 realm 收口", () => {
  it("从 console（租户）退出：只结束租户会话，只清 vx_sid 与 hint，运营者会话不动", async () => {
    const { ended, cleared } = await logout("customer", "console");
    expect(ended).toEqual(["sid-tenant"]);
    expect(cleared).toContain("vx_sid");
    expect(cleared).toContain("vx_hint");
    expect(cleared).not.toContain("vx_sid_op");
  });

  it("从 opera（运营）退出：只结束运营者会话，只清 vx_sid_op，租户会话不动", async () => {
    const { ended, cleared } = await logout("workforce", "opera");
    expect(ended).toEqual(["sid-operator"]);
    expect(cleared).toEqual(["vx_sid_op"]);
  });

  /* 反向对照：认不出发起方时仍然两个都结束——没有这条，「永远只清一份」的实现
     也能过上面两条，而那会留下退不出去的会话。 */
  it("认不出 realm（没带 client_id）：两个都结束、两份都清", async () => {
    const { ended, cleared } = await logout(null);
    expect(ended).toEqual(["sid-operator", "sid-tenant"]);
    expect(cleared).toEqual(
      expect.arrayContaining(["vx_sid", "vx_sid_op", "vx_hint"]),
    );
  });
});
