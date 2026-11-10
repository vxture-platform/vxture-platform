/**
 * Website login carries the platform locale into central authentication.
 * @package @vxture/bff-website
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-11
 */
import "reflect-metadata";
import { expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { OidcAuthRouter } from "./oidc-auth.router";

it.each([
  [{}, { NEXT_LOCALE: "en-US" }, "en-US"],
  [{ ui_locales: "en-US" }, { NEXT_LOCALE: "zh-CN" }, "en-US"],
  [{ ui_locales: "unsupported" }, {}, "zh-CN"],
])(
  "forwards a supported interface preference to Accounts",
  async (query, cookies, expected) => {
    const buildAuthorizeUrl = vi.fn(
      () => "https://accounts.example/oidc/authorize",
    );
    const router = new OidcAuthRouter(
      { buildAuthorizeUrl } as never,
      {} as never,
      {} as never,
      { setex: vi.fn() } as never,
      {
        config: { clientId: "website" },
        keyPrefix: "test:",
        defaultReturnTo: "https://vxture.com/",
        allowedReturnOrigins: ["https://vxture.com"],
      } as never,
    );
    const redirect = vi.fn();
    await router.login(
      undefined,
      undefined,
      { query, cookies } as unknown as Request,
      { redirect } as unknown as Response,
    );
    expect(buildAuthorizeUrl).toHaveBeenCalledWith(
      expect.objectContaining({ uiLocales: expected }),
    );
    expect(redirect).toHaveBeenCalledWith(
      "https://accounts.example/oidc/authorize",
    );
  },
);
