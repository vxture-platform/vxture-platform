/**
 * Social identity linking session and ownership regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-08
 */
import { describe, expect, it, vi } from "vitest";
import { SocialAuthService } from "./social-auth.service";

function fixture() {
  const state = {
    providerCode: "feishu",
    redirectUri: "https://accounts.example/callback",
    loginChallenge: "",
    link: { userId: "customer", sid: "sid" },
  };
  const sessions = {
    requireCustomer: vi.fn(async () => ({
      userId: "customer",
      user: { status: "active" },
    })),
  };
  const account = { findUserByProviderSubject: vi.fn(), bindIdentity: vi.fn() };
  const provider = {
    exchangeCode: vi.fn(async () => ({ accessToken: "token" })),
    getUserInfo: vi.fn(async () => ({ providerId: "subject", name: "Name" })),
  };
  const service = new SocialAuthService(
    {
      resolve: async () => ({
        provider,
        config: { redirectUri: state.redirectUri },
      }),
    } as never,
    account as never,
    {} as never,
    { consumeOauthState: async () => state } as never,
    {} as never,
    sessions as never,
    {} as never,
  );
  return { service, account, sessions, provider };
}

describe("social identity linking", () => {
  it("rejects a changed browser session before contacting the provider", async () => {
    const f = fixture();
    await expect(
      f.service.handleCallback(
        "feishu",
        "code",
        "state",
        undefined,
        undefined,
        "other",
      ),
    ).rejects.toThrow("link_session_required");
    expect(f.provider.exchangeCode).not.toHaveBeenCalled();
    expect(f.account.bindIdentity).not.toHaveBeenCalled();
  });
  it("rechecks session validity after provider network calls", async () => {
    const f = fixture();
    f.sessions.requireCustomer.mockRejectedValueOnce(
      new Error("session_expired"),
    );
    await expect(
      f.service.handleCallback(
        "feishu",
        "code",
        "state",
        undefined,
        undefined,
        "sid",
      ),
    ).rejects.toThrow("session_expired");
    expect(f.account.bindIdentity).not.toHaveBeenCalled();
    const g = fixture();
    g.sessions.requireCustomer
      .mockResolvedValueOnce({ userId: "customer", user: { status: "active" } })
      .mockRejectedValueOnce(new Error("session_revoked"));
    await expect(
      g.service.handleCallback(
        "feishu",
        "code",
        "state",
        undefined,
        undefined,
        "sid",
      ),
    ).rejects.toThrow("session_revoked");
    expect(g.provider.getUserInfo).toHaveBeenCalledOnce();
    expect(g.account.bindIdentity).not.toHaveBeenCalled();
  });
  it("never transfers another customer's identity", async () => {
    const f = fixture();
    f.account.findUserByProviderSubject.mockResolvedValue({ id: "other" });
    await expect(
      f.service.handleCallback(
        "feishu",
        "code",
        "state",
        undefined,
        undefined,
        "sid",
      ),
    ).rejects.toThrow("identity_already_bound");
    expect(f.account.bindIdentity).not.toHaveBeenCalled();
  });
  it("checks the persisted owner after linking", async () => {
    const f = fixture();
    f.account.findUserByProviderSubject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "customer" });
    await expect(
      f.service.handleCallback(
        "feishu",
        "code",
        "state",
        undefined,
        undefined,
        "sid",
      ),
    ).resolves.toEqual({ kind: "linked" });
    expect(f.account.bindIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "customer",
        provider: "feishu",
        providerSubject: "subject",
      }),
    );
  });
});
