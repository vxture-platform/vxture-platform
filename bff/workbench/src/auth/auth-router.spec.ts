/**
 * Browser-bound login, context switching and logout over real Nest HTTP routes.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cookies,
  Fixture,
  ORG,
  USER,
  WORKSPACE,
} from "./fixtures.spec-support";

let fixture: Fixture;
beforeEach(async () => {
  fixture = new Fixture();
  await fixture.start();
});
afterEach(async () => {
  await fixture.stop();
});

// ============================================================================
// Cross-portal login uses signed identity and exact context, never cookie sharing.
// ============================================================================
const portalPath = () =>
  `/auth/login?surface=portal&userId=${USER.slice(4)}&tenantId=${ORG}&workspaceId=${WORKSPACE}`;
describe("Console portal entry", () => {
  it("preserves hints and reuses central SSO without a forced login prompt", async () => {
    const start = await fixture.begin(`${portalPath()}&returnTo=%2Fapps`);
    expect(start.location.searchParams.get("tenant_hint")).toBe(ORG);
    expect(start.location.searchParams.get("workspace_hint")).toBe(WORKSPACE);
    expect(start.location.searchParams.has("prompt")).toBe(false);
    const done = await fixture.request(
      `/auth/callback?state=${start.state}&code=ok`,
      start.cookie,
    );
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe("http://127.0.0.1/apps");
    expect((await fixture.request("/api/me", cookies(done))).status).toBe(200);
    expect(
      (
        await fixture.request(
          `/auth/callback?state=${start.state}&code=ok`,
          start.cookie,
        )
      ).status,
    ).toBe(400);
  });
  it.each(["active_org", "active_workspace"])(
    "rejects fallback of %s",
    async (key) => {
      const start = await fixture.begin(portalPath());
      fixture.accessPatch = { [key]: "00000000-0000-4000-8000-000000000099" };
      expect(
        (
          await fixture.request(
            `/auth/callback?state=${start.state}&code=ok`,
            start.cookie,
          )
        ).status,
      ).toBe(403);
      expect(fixture.store.records.size).toBe(0);
    },
  );
  it("rejects a different central customer account", async () => {
    const start = await fixture.begin(portalPath());
    const other = "usr_00000000-0000-4000-8000-000000000099";
    fixture.idPatch = { sub: other };
    fixture.accessPatch = { sub: other };
    expect(
      (
        await fixture.request(
          `/auth/callback?state=${start.state}&code=ok`,
          start.cookie,
        )
      ).status,
    ).toBe(403);
    expect(fixture.store.records.size).toBe(0);
  });
  it.each(["before", "during"])(
    "preserves another target account established %s authorization",
    async (when) => {
      const old = await fixture.login();
      const oldId = [...fixture.store.records.keys()][0]!;
      const raw = fixture.store.records.get(oldId)!;
      const changeAccount = () =>
        fixture.store.records.set(
          oldId,
          JSON.stringify({
            ...JSON.parse(raw),
            sub: "usr_00000000-0000-4000-8000-000000000099",
          }),
        );
      if (when === "before") {
        changeAccount();
        expect((await fixture.request(portalPath(), old)).status).toBe(409);
      } else {
        const start = await fixture.begin(portalPath());
        changeAccount();
        expect(
          (
            await fixture.request(
              `/auth/callback?state=${start.state}&code=ok`,
              `${start.cookie}; ${old}`,
            )
          ).status,
        ).toBe(409);
      }
      expect(fixture.store.records.size).toBe(1);
    },
  );
  it("requires live workspace membership before creating a portal session", async () => {
    const start = await fixture.begin(portalPath());
    fixture.allowedScope = false;
    expect(
      (
        await fixture.request(
          `/auth/callback?state=${start.state}&code=ok`,
          start.cookie,
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(fixture.store.records.size).toBe(0);
  });
  it.each([
    "&userId=bad",
    `&workspaceId=${WORKSPACE}`,
    "&tenantId[]=x",
    "&prompt=none",
  ])("rejects invalid or ambiguous hints %s", async (extra) => {
    expect((await fixture.request(`${portalPath()}${extra}`)).status).toBe(400);
    expect(fixture.tokenCalls).toBe(0);
  });
});

// ============================================================================
// Authorization establishes only a browser-bound, one-time customer session.
// ============================================================================
describe("authorization", () => {
  it("uses PKCE and nonce, stores tokens server-side and exposes only identity", async () => {
    const start = await fixture.begin("/auth/login?returnTo=%2Fapps");
    expect(start.location.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(start.location.searchParams.get("code_challenge")).toHaveLength(43);
    expect(start.state).toHaveLength(43);
    expect(start.response.headers.get("set-cookie")).toContain("HttpOnly");
    const response = await fixture.request(
      `/auth/callback?state=${start.state}&code=ok`,
      start.cookie,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://127.0.0.1/apps");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const cookie = cookies(response);
    expect(cookie).not.toContain("private-refresh-token");
    const identity = await fixture.request("/api/me", cookie);
    expect(await identity.json()).toMatchObject({
      id: USER.slice(4),
      name: "验收用户",
    });
    expect(fixture.statusBody).toEqual({
      sid: "central-session",
      active: false,
    });
    expect(fixture.statusAuthorization).toBe(
      `Basic ${Buffer.from("workbench:fixture-only").toString("base64")}`,
    );
  });
  it("rejects a stolen state without consuming the originating browser's request", async () => {
    const start = await fixture.begin();
    const path = `/auth/callback?state=${start.state}&code=ok`;
    expect((await fixture.request(path)).status).toBe(400);
    expect(
      (
        await fixture.request(
          path,
          start.cookie.replace(/=.*/, "=wrong-browser"),
        )
      ).status,
    ).toBe(400);
    expect(fixture.tokenCalls).toBe(0);
    expect((await fixture.request(path, start.cookie)).status).toBe(302);
    expect((await fixture.request(path, start.cookie)).status).toBe(400);
    expect(fixture.tokenCalls).toBe(1);
  });
  it("isolates simultaneous login attempts by state cookie", async () => {
    const first = await fixture.begin();
    const second = await fixture.begin();
    expect(first.cookie.split("=")[0]).not.toBe(second.cookie.split("=")[0]);
    expect(
      (
        await fixture.request(
          `/auth/callback?state=${first.state}&code=x`,
          second.cookie,
        )
      ).status,
    ).toBe(400);
  });
  it.each([
    ["nonce", { nonce: "different-browser-nonce" }],
    ["audience", { aud: "console" }],
    ["issuer", { iss: "https://other.invalid" }],
    ["subject", { sub: "usr_00000000-0000-4000-8000-000000000099" }],
    ["session", { sid: "" }],
    ["expiry type", { exp: "9999999999" }],
    ["future activation", { nbf: 9999999999 }],
  ])("rejects invalid ID token %s", async (_label, patch) => {
    fixture.idPatch = patch;
    const start = await fixture.begin();
    const response = await fixture.request(
      `/auth/callback?state=${start.state}&code=x`,
      start.cookie,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fixture.store.records.size).toBe(0);
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      `${fixture.config.cookieName}=`,
    );
  });
  it.each([
    { userType: "operator" },
    { account_status: "suspended" },
    { active_org: "invalid" },
    { active_workspace: "invalid" },
    { roles: ["org:owner"] },
    { sid: "wrong-session" },
  ])("rejects an invalid customer context %j", async (patch) => {
    fixture.accessPatch = patch;
    const start = await fixture.begin();
    const response = await fixture.request(
      `/auth/callback?state=${start.state}&code=x`,
      start.cookie,
    );
    expect(response.status).toBe(401);
    expect(fixture.store.records.size).toBe(0);
  });
  it.each(["login_required", "interaction_required"])(
    "returns a silent %s to the portal once",
    async (error) => {
      const start = await fixture.begin(
        "/auth/login?prompt=none&returnTo=%2Fapps%3Ffilter%3Dall",
      );
      const response = await fixture.request(
        `/auth/callback?state=${start.state}&error=${error}`,
        start.cookie,
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "http://127.0.0.1/apps?filter=all&vx_sso_silent=0",
      );
      expect(fixture.tokenCalls).toBe(0);
      expect(fixture.store.records.size).toBe(0);
      expect(
        (
          await fixture.request(
            `/auth/callback?state=${start.state}&error=${error}`,
            start.cookie,
          )
        ).status,
      ).toBe(400);
    },
  );
  it("does not mask a denied silent authorization as an anonymous visit", async () => {
    const start = await fixture.begin("/auth/login?prompt=none");
    expect(
      (
        await fixture.request(
          `/auth/callback?state=${start.state}&error=access_denied`,
          start.cookie,
        )
      ).status,
    ).toBe(401);
  });
  it("consumes failed authorization and rejects duplicate query values", async () => {
    const start = await fixture.begin();
    const response = await fixture.request(
      `/auth/callback?state=${start.state}&error=access_denied`,
      start.cookie,
    );
    expect(response.status).toBe(401);
    expect(
      (
        await fixture.request(
          `/auth/callback?state=${start.state}&code=ok`,
          start.cookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (await fixture.request("/auth/login?prompt=none&prompt=login")).status,
    ).toBe(400);
    expect(fixture.tokenCalls).toBe(0);
  });
  it("does not allow an external post-login return target", async () => {
    const start = await fixture.begin(
      "/auth/login?returnTo=https%3A%2F%2Fother.invalid%2Fapps",
    );
    const response = await fixture.request(
      `/auth/callback?state=${start.state}&code=ok`,
      start.cookie,
    );
    expect(response.headers.get("location")).toBe("http://127.0.0.1/");
  });
});

// ============================================================================
// Context facts are scoped to the verified member, including non-admin users.
// ============================================================================
describe("workspace access", () => {
  it("returns live scope display metadata behind authentication", async () => {
    expect((await fixture.request("/api/tenant-context")).status).toBe(401);
    const cookie = await fixture.login();
    const response = await fixture.request("/api/tenant-context", cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: ORG,
      name: "Updated organization",
      workspace: WORKSPACE,
      workspaceName: "Updated workspace",
    });
  });
  it("allows an ordinary workspace member to read only the current workspace's subscriptions", async () => {
    const cookie = await fixture.login();
    const response = await fixture.request(
      "/api/subscription/subscribed-products",
      cookie,
    );
    expect(response.status).toBe(200);
    expect(fixture.subscriptionScopes).toEqual([[WORKSPACE, ORG]]);
    fixture.allowedScope = false;
    expect(
      (await fixture.request("/api/subscription/subscribed-products", cookie))
        .status,
    ).toBeGreaterThanOrEqual(400);
    expect(fixture.subscriptionScopes).toHaveLength(1);
  });
  it("authorizes overview reads before calling any resource or billing service", async () => {
    const cookie = await fixture.login();
    const paths = ["quota-usage", "credits", "monthly-bill"];
    for (const path of paths) {
      expect(
        (await fixture.request(`/api/subscription/${path}`, cookie)).status,
      ).toBe(403);
    }
    expect(fixture.resourceScopes).toEqual([]);
    fixture.allowedResourceRead = true;
    for (const path of paths) {
      expect(
        (await fixture.request(`/api/subscription/${path}`, cookie)).status,
      ).toBe(200);
    }
    expect(fixture.resourceScopes).toEqual([WORKSPACE, ORG, ORG]);
    fixture.allowedScope = false;
    expect(
      (await fixture.request("/api/subscription/credits", cookie)).status,
    ).toBe(403);
    expect(fixture.resourceScopes).toHaveLength(3);
  });
  it("prechecks switch membership and verifies the applied IdP context", async () => {
    const cookie = await fixture.login();
    expect(
      (
        await fixture.request(
          "/auth/switch-workspace?workspaceId=00000000-0000-4000-8000-000000000099",
          cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await fixture.request(`/auth/switch-workspace?workspaceId=${WORKSPACE}`))
        .status,
    ).toBe(401);
    const response = await fixture.request(
      `/auth/switch-workspace?workspaceId=${WORKSPACE}`,
      cookie,
    );
    const url = new URL(response.headers.get("location")!);
    expect(url.searchParams.get("workspace_hint")).toBe(WORKSPACE);
    expect(url.searchParams.get("tenant_hint")).toBe(ORG);
    expect(url.searchParams.get("prompt")).toBe("none");
    fixture.nonce = url.searchParams.get("nonce")!;
    fixture.accessPatch = {
      active_workspace: "00000000-0000-4000-8000-000000000099",
    };
    expect(
      (
        await fixture.request(
          `/auth/callback?state=${url.searchParams.get("state")}&code=x`,
          cookies(response),
        )
      ).status,
    ).toBe(403);
  });
  it("preserves an explicitly selected workspace during an organization transition", async () => {
    const cookie = await fixture.login();
    for (const workspace of [
      "invalid",
      "00000000-0000-4000-8000-000000000099",
    ]) {
      expect(
        (
          await fixture.request(
            `/auth/switch-tenant?tenantId=${ORG}&workspaceId=${workspace}`,
            cookie,
          )
        ).status,
      ).toBe(403);
    }
    const response = await fixture.request(
      `/auth/switch-tenant?tenantId=${ORG}&workspaceId=${WORKSPACE}`,
      cookie,
    );
    expect(response.status).toBe(302);
    const url = new URL(response.headers.get("location")!);
    expect(url.searchParams.get("tenant_hint")).toBe(ORG);
    expect(url.searchParams.get("workspace_hint")).toBe(WORKSPACE);
    expect(url.searchParams.get("prompt")).toBe("none");
  });
  it("denies unauthorized billing reads and hides internal routes", async () => {
    const cookie = await fixture.login();
    const response = await fixture.request("/api/subscription/credits", cookie);
    expect(response.status).toBe(403);
    expect((await fixture.request("/api/subscription/credits")).status).toBe(
      401,
    );
    expect((await fixture.request("/api/admin/users", cookie)).status).toBe(
      404,
    );
    expect(
      (
        await fixture.request("/auth/logout", cookie, {
          headers: { "sec-fetch-site": "cross-site" },
        })
      ).status,
    ).toBe(403);
  });
});

// ============================================================================
// Logout return paths remain browser-bound and signed back-channel events fence sessions.
// ============================================================================
describe("logout", () => {
  it.each(["same-site", "cross-site"])(
    "rejects %s session-changing navigation",
    async (site) => {
      const cookie = await fixture.login();
      for (const path of [
        "/auth/logout",
        "/auth/switch",
        `/auth/switch-workspace?workspaceId=${WORKSPACE}`,
      ]) {
        expect(
          (
            await fixture.request(path, cookie, {
              headers: { "sec-fetch-site": site },
            })
          ).status,
        ).toBe(403);
      }
      expect((await fixture.request("/auth/session", cookie)).status).toBe(200);
    },
  );
  it("switches user through central logout and then a fresh login prompt", async () => {
    const cookie = await fixture.login();
    const response = await fixture.request("/auth/switch", cookie);
    const logout = new URL(response.headers.get("location")!);
    expect(logout.pathname).toBe("/oidc/end_session");
    expect(logout.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://127.0.0.1/auth/signed-out",
    );
    expect(fixture.store.records.size).toBe(0);
    const path = `/auth/signed-out?state=${logout.searchParams.get("state")}`;
    expect((await fixture.request(path)).status).toBe(400);
    const returned = await fixture.request(path, cookies(response));
    expect(
      new URL(returned.headers.get("location")!).searchParams.get("prompt"),
    ).toBe("login");
    expect((await fixture.request(path, cookies(response))).status).toBe(400);
  });
  it("accepts only signed, valid, client-bound back-channel logout", async () => {
    const cookie = await fixture.login();
    const event = {
      events: { "http://schemas.openid.net/event/backchannel-logout": {} },
      jti: "event-1",
    };
    const send = (token: string) =>
      fixture.request("/auth/backchannel-logout", undefined, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ logout_token: token }),
      });
    expect(
      (await send(fixture.sign({ ...event, aud: "console" }))).status,
    ).toBe(400);
    expect(
      (await send(fixture.sign({ ...event, nonce: "forbidden" }))).status,
    ).toBe(400);
    expect((await fixture.request("/auth/session", cookie)).status).toBe(200);
    expect((await send(fixture.sign(event))).status).toBe(200);
    expect((await fixture.request("/auth/session", cookie)).status).toBe(401);
    expect((await send(fixture.sign(event))).status).toBe(200);
  });
});
