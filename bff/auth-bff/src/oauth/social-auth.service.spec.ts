import { describe, expect, it, vi, beforeEach } from "vitest";
import { SocialAuthService } from "./social-auth.service";
import type { OAuthProviderRegistry } from "./provider-registry";
import type { AccountService } from "@vxture/service-account";
import type { PhoneCodeService } from "@vxture/service-sms";
import type { RedisService } from "../redis/redis.service";
import type { OidcService } from "../oidc/oidc.service";

// TD-025: social login previously called OidcService.completeLoginWithUser with
// no ip/user-agent at all, so session.login_attempts.ip_address fell through to
// the "unknown" default. These tests confirm SocialAuthService now threads the
// caller-supplied ipAddress/userAgent all the way down into that call.

interface Mocks {
  registry: { resolve: ReturnType<typeof vi.fn> };
  account: {
    findUserByProviderSubject: ReturnType<typeof vi.fn>;
    findUserByIdentifier: ReturnType<typeof vi.fn>;
    createUser: ReturnType<typeof vi.fn>;
    backfillProfile: ReturnType<typeof vi.fn>;
    bindIdentity: ReturnType<typeof vi.fn>;
  };
  phoneCode: { verifyCode: ReturnType<typeof vi.fn> };
  redis: {
    consumeOauthState: ReturnType<typeof vi.fn>;
    consumeOauthBind: ReturnType<typeof vi.fn>;
  };
  oidc: { completeLoginWithUser: ReturnType<typeof vi.fn> };
  service: SocialAuthService;
}

function build(): Mocks {
  const registry = { resolve: vi.fn() };
  const account = {
    findUserByProviderSubject: vi.fn(),
    findUserByIdentifier: vi.fn(),
    createUser: vi.fn(),
    backfillProfile: vi.fn().mockResolvedValue(undefined),
    bindIdentity: vi.fn().mockResolvedValue(undefined),
  };
  const phoneCode = { verifyCode: vi.fn() };
  const redis = {
    consumeOauthState: vi.fn(),
    consumeOauthBind: vi.fn(),
  };
  const oidc = {
    completeLoginWithUser: vi.fn().mockResolvedValue({
      sid: "sid-1",
      realm: "customer",
      sessionMaxAge: 3600,
      redirectTo: "https://rp.example.com/callback?code=abc",
    }),
  };
  const service = new SocialAuthService(
    registry as unknown as OAuthProviderRegistry,
    account as unknown as AccountService,
    phoneCode as unknown as PhoneCodeService,
    redis as unknown as RedisService,
    oidc as unknown as OidcService,
  );
  return { registry, account, phoneCode, redis, oidc, service };
}

describe("SocialAuthService.handleCallback — TD-025 IP/UA threading", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("forwards the caller-supplied ipAddress/userAgent into OidcService.completeLoginWithUser for a known identity", async () => {
    m.redis.consumeOauthState.mockResolvedValue({
      providerCode: "feishu",
      redirectUri: "https://auth.example.com/auth/oauth/feishu/callback",
      loginChallenge: "chal-1",
    });
    m.registry.resolve.mockResolvedValue({
      provider: {
        exchangeCode: vi.fn().mockResolvedValue({
          accessToken: "at-1",
          expiresIn: 3600,
        }),
        getUserInfo: vi.fn().mockResolvedValue({
          providerId: "provider-subj-1",
          name: "Test User",
          raw: {},
        }),
      },
      config: {
        redirectUri: "https://auth.example.com/auth/oauth/feishu/callback",
      },
    });
    m.account.findUserByProviderSubject.mockResolvedValue({ id: "user-1" });

    const result = await m.service.handleCallback(
      "feishu",
      "auth-code",
      "state-1",
      "203.0.113.10",
      "Mozilla/5.0 TestAgent",
    );

    expect(m.oidc.completeLoginWithUser).toHaveBeenCalledWith(
      "chal-1",
      "user-1",
      "social:feishu",
      { ipAddress: "203.0.113.10", userAgent: "Mozilla/5.0 TestAgent" },
    );
    expect(result.kind).toBe("login");
  });

  it("still forwards ipAddress/userAgent when resolving a new user by provider-verified phone", async () => {
    m.redis.consumeOauthState.mockResolvedValue({
      providerCode: "dingtalk",
      redirectUri: "https://auth.example.com/auth/oauth/dingtalk/callback",
      loginChallenge: "chal-2",
    });
    m.registry.resolve.mockResolvedValue({
      provider: {
        exchangeCode: vi.fn().mockResolvedValue({
          accessToken: "at-2",
          expiresIn: 3600,
        }),
        getUserInfo: vi.fn().mockResolvedValue({
          providerId: "provider-subj-2",
          phone: "+8618092907523",
          name: "New User",
          raw: {},
        }),
      },
      config: {
        redirectUri: "https://auth.example.com/auth/oauth/dingtalk/callback",
      },
    });
    m.account.findUserByProviderSubject.mockResolvedValue(null);
    m.account.findUserByIdentifier.mockResolvedValue({ id: "user-2" });

    await m.service.handleCallback(
      "dingtalk",
      "auth-code",
      "state-2",
      "198.51.100.20",
      undefined,
    );

    expect(m.oidc.completeLoginWithUser).toHaveBeenCalledWith(
      "chal-2",
      "user-2",
      "social:dingtalk",
      { ipAddress: "198.51.100.20", userAgent: undefined },
    );
  });
});

describe("SocialAuthService.completeBind — TD-025 IP/UA threading", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("forwards its own request's ipAddress/userAgent into OidcService.completeLoginWithUser", async () => {
    m.phoneCode.verifyCode.mockResolvedValue(true);
    m.redis.consumeOauthBind.mockResolvedValue({
      providerCode: "feishu",
      providerSubject: "provider-subj-3",
      name: "Bind User",
      loginChallenge: "chal-3",
    });
    m.account.findUserByIdentifier.mockResolvedValue({ id: "user-3" });

    await m.service.completeBind(
      "bind-tok-1",
      "+8618092907523",
      "123456",
      "203.0.113.99",
      "Mozilla/5.0 BindAgent",
    );

    expect(m.oidc.completeLoginWithUser).toHaveBeenCalledWith(
      "chal-3",
      "user-3",
      "social:feishu",
      { ipAddress: "203.0.113.99", userAgent: "Mozilla/5.0 BindAgent" },
    );
  });
});
