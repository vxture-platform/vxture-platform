import { describe, it, expect } from "vitest";
import type { UserView } from "@vxture/service-account";
import { buildTenantIdentityClaims } from "./oidc.service";

const user: UserView = {
  id: "u1",
  account: "alice",
  email: "alice@example.com",
  phone: "+8613800000000",
  name: "Alice",
  status: "active",
  avatarHash: null,
};

describe("buildTenantIdentityClaims", () => {
  it("returns no claims when the user is missing", () => {
    expect(
      buildTenantIdentityClaims(null, "openid profile email phone"),
    ).toEqual({});
  });

  it("always releases account_status, and email/phone when present", () => {
    const c = buildTenantIdentityClaims(user, "openid umbra");
    expect(c).toMatchObject({
      account_status: "active",
      email: "alice@example.com",
      email_verified: false,
      phone: "+8613800000000",
      phone_verified: true,
    });
    // display fields stay gated behind the profile scope
    expect(c.name).toBeUndefined();
    expect(c.preferred_username).toBeUndefined();
  });

  it("releases name + preferred_username only with the profile scope", () => {
    const c = buildTenantIdentityClaims(user, "openid profile umbra");
    expect(c.name).toBe("Alice");
    expect(c.preferred_username).toBe("alice");
  });

  it("omits picture when there is no custom avatar", () => {
    const c = buildTenantIdentityClaims(
      user,
      "openid profile",
      "https://accounts.vxture.com",
    );
    expect("picture" in c).toBe(false);
  });

  it("emits a versioned picture URL when a custom avatar exists (profile scope)", () => {
    const c = buildTenantIdentityClaims(
      { ...user, avatarHash: "abc123" },
      "openid profile",
      "https://accounts.vxture.com",
    );
    expect(c.picture).toBe(
      "https://accounts.vxture.com/avatar/usr_u1?v=abc123",
    );
  });

  it("withholds picture without the profile scope even if avatar exists", () => {
    const c = buildTenantIdentityClaims(
      { ...user, avatarHash: "abc123" },
      "openid email",
      "https://accounts.vxture.com",
    );
    expect("picture" in c).toBe(false);
  });

  it("falls back to the account handle when name is null", () => {
    const c = buildTenantIdentityClaims({ ...user, name: null }, "profile");
    expect(c.name).toBe("alice");
  });

  it("omits email/phone claims when the user has none", () => {
    const c = buildTenantIdentityClaims(
      { ...user, email: null, phone: "" },
      "openid profile",
    );
    expect("email" in c).toBe(false);
    expect("email_verified" in c).toBe(false);
    expect("phone" in c).toBe(false);
    expect("phone_verified" in c).toBe(false);
  });
  it("releases durable email verification evidence and defaults missing evidence to false", () => {
    expect(
      buildTenantIdentityClaims({ ...user, emailVerified: true }, "openid")
        .email_verified,
    ).toBe(true);
    expect(
      buildTenantIdentityClaims({ ...user, emailVerified: false }, "openid")
        .email_verified,
    ).toBe(false);
  });
});
