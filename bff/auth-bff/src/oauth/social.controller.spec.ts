import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { SocialController } from "./social.controller";
import type { SocialAuthService } from "./social-auth.service";
import type { VxConfigService } from "@vxture/core-config";

// TD-025: social login (feishu/dingtalk/…) never captured the request's IP,
// so session.login_attempts.ip_address recorded the literal "unknown". These
// tests confirm the controller now extracts a real client IP (and UA) per
// request and forwards them into SocialAuthService, rather than omitting them.

interface Mocks {
  social: {
    handleCallback: ReturnType<typeof vi.fn>;
    completeBind: ReturnType<typeof vi.fn>;
  };
  config: { platform: Record<string, unknown> };
  controller: SocialController;
}

function build(): Mocks {
  const social = {
    handleCallback: vi.fn(),
    completeBind: vi.fn(),
  };
  const config = {
    platform: {
      LOGIN_UI_BASE_URL: "http://localhost:3040",
      COOKIE_DOMAIN_PLATFORM: null,
    },
  };
  const controller = new SocialController(
    social as unknown as SocialAuthService,
    config as unknown as VxConfigService,
  );
  return { social, config, controller };
}

function fakeReq(
  headers: Record<string, string | string[] | undefined>,
): Request {
  return { headers } as unknown as Request;
}

function fakeRes(): Response {
  return {
    redirect: vi.fn(),
    cookie: vi.fn(),
  } as unknown as Response;
}

const LOGIN_COMPLETION = {
  sid: "sid-123",
  realm: "customer",
  sessionMaxAge: 3600,
  redirectTo: "https://rp.example.com/callback?code=abc",
};

describe("SocialController.callback — TD-025 IP/UA capture", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("extracts a real client IP (X-Real-IP) and User-Agent, forwarding them to handleCallback", async () => {
    m.social.handleCallback.mockResolvedValue({
      kind: "login",
      completion: LOGIN_COMPLETION,
    });
    const req = fakeReq({
      "x-real-ip": "203.0.113.10",
      "user-agent": "Mozilla/5.0 TestAgent",
    });
    const res = fakeRes();

    await m.controller.callback(
      "feishu",
      "auth-code",
      "state-token",
      undefined,
      req,
      res,
    );

    expect(m.social.handleCallback).toHaveBeenCalledWith(
      "feishu",
      "auth-code",
      "state-token",
      "203.0.113.10",
      "Mozilla/5.0 TestAgent",
    );
    expect(res.redirect).toHaveBeenCalledWith(LOGIN_COMPLETION.redirectTo);
  });

  it("resolves the real IP even when a client pre-forges a leading X-Forwarded-For segment", () => {
    // Simulates nginx's $proxy_add_x_forwarded_for appending the trustworthy,
    // realip-corrected value LAST rather than replacing a client-supplied XFF.
    m.social.handleCallback.mockResolvedValue({
      kind: "login",
      completion: LOGIN_COMPLETION,
    });
    const req = fakeReq({
      "x-forwarded-for": "9.9.9.9, 203.0.113.5",
    });
    const res = fakeRes();

    return m.controller
      .callback("dingtalk", "auth-code", "state-token", undefined, req, res)
      .then(() => {
        expect(m.social.handleCallback).toHaveBeenCalledWith(
          "dingtalk",
          "auth-code",
          "state-token",
          "203.0.113.5",
          undefined,
        );
      });
  });

  it("redirects to bind-phone without invoking login completion when no phone was resolved", async () => {
    m.social.handleCallback.mockResolvedValue({
      kind: "bind",
      bindToken: "bind-tok-1",
    });
    const req = fakeReq({ "x-real-ip": "203.0.113.10" });
    const res = fakeRes();

    await m.controller.callback(
      "feishu",
      "auth-code",
      "state-token",
      undefined,
      req,
      res,
    );

    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining("/bind-phone?binding_token=bind-tok-1"),
    );
  });
});

describe("SocialController.bindPhone — TD-025 IP/UA capture", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("extracts a real client IP and User-Agent from its own request, forwarding them to completeBind", async () => {
    m.social.completeBind.mockResolvedValue(LOGIN_COMPLETION);
    const req = fakeReq({
      "x-real-ip": "198.51.100.20",
      "user-agent": "Mozilla/5.0 BindPhoneAgent",
    });
    const res = fakeRes();

    const result = await m.controller.bindPhone(
      { binding_token: "bind-tok-1", phone: "+8618092907523", code: "123456" },
      req,
      res,
    );

    expect(m.social.completeBind).toHaveBeenCalledWith(
      "bind-tok-1",
      "+8618092907523",
      "123456",
      "198.51.100.20",
      "Mozilla/5.0 BindPhoneAgent",
    );
    expect(result).toEqual({ redirectTo: LOGIN_COMPLETION.redirectTo });
  });
});
