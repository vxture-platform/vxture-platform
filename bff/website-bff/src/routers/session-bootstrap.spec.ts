/**
 * Browser bootstrap reconciles local RP identity with central session authority.
 * @package @vxture/bff-website
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-16
 */
import "reflect-metadata";
import { afterEach, expect, it, vi } from "vitest";
import type { Request } from "express";
import { OidcAuthRouter } from "./oidc-auth.router";

function fixture(centralCookie: string | undefined = "central") {
  const store = {
    get: vi.fn(async () => ({ sid: "central" })),
    destroy: vi.fn(async () => {}),
    destroyBySid: vi.fn(async () => 1),
  };
  const auth = {
    resolve: vi.fn(async () => ({
      status: "ok",
      claims: { sub: "usr_1" },
    })),
  };
  const request = vi.fn(async () =>
    Response.json({
      valid: true,
      next_check_at: Math.floor(Date.now() / 1000) + 300,
    }),
  );
  vi.stubGlobal("fetch", request);
  const router = new OidcAuthRouter(
    {} as never,
    store as never,
    auth as never,
    {} as never,
    {
      cookieSecure: true,
      defaultReturnTo: "https://vxture.com/",
      config: {
        clientId: "website",
        clientSecret: "fixture",
        issuer: "https://accounts.vxture.com",
      },
    } as never,
  );
  const req = {
    cookies: { "__Host-vx_rp_session_website": "local", vx_sid: centralCookie },
  } as unknown as Request;
  return { router, req, store, auth, request };
}
afterEach(() => vi.unstubAllGlobals());

it.each([undefined, "replacement"])(
  "rejects a missing or replaced central cookie %s immediately",
  async (cookie) => {
    const f = fixture(cookie === undefined ? "" : cookie);
    await expect(f.router.session(f.req)).rejects.toMatchObject({
      status: 401,
    });
    expect(f.store.destroy).toHaveBeenCalledWith("local");
    expect(f.auth.resolve).not.toHaveBeenCalled();
  },
);

it("queries central validity on every explicit bootstrap", async () => {
  const f = fixture();
  await expect(f.router.session(f.req)).resolves.toMatchObject({
    status: "active",
  });
  await f.router.session(f.req);
  expect(f.request).toHaveBeenCalledTimes(2);
});

it("revokes local bindings when central logout is confirmed", async () => {
  const f = fixture();
  f.request.mockResolvedValue(Response.json({ valid: false }));
  await expect(f.router.session(f.req)).rejects.toMatchObject({ status: 401 });
  expect(f.store.destroyBySid).toHaveBeenCalledWith("central");
});

it("returns an outage without revoking the local session", async () => {
  const f = fixture();
  f.request.mockRejectedValue(new Error("offline"));
  await expect(f.router.session(f.req)).rejects.toMatchObject({ status: 503 });
  expect(f.store.destroy).not.toHaveBeenCalled();
  expect(f.store.destroyBySid).not.toHaveBeenCalled();
});
