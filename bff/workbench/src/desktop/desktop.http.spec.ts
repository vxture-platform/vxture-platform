/**
 * desktop.http.spec.ts - Real HTTP, RSA IdP and shared RP component contracts.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-22
 */
import type { INestApplication } from "@nestjs/common";
// ⚠️ 跨层引用: Exercise the shared RP store instead of a BFF-local substitute.
import { RpSessionStore } from "@vxture/core-oidc-rp";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createDesktopApp } from "./app";
import {
  createDesktopRuntime,
  desktopConfig,
  type DesktopRuntime,
} from "./runtime";
import { TestRedis } from "./test-redis";
import { WorkspaceReader, type OrganizationReads } from "./workspace-reader";
import { ApplicationReader } from "./application-reader";
import { ResourceReader } from "./resource-reader";
import { EntitlementReader } from "./entitlement-reader";
import { failure } from "../errors";

const SUB = "usr_11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const WORKSPACE = "33333333-3333-4333-8333-333333333333";
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...rsa.publicKey.export({ format: "jwk" }),
  kid: "synthetic",
  alg: "RS256",
  use: "sig",
};

// ============================================================================
// Disposable IdP and HTTP application
// ============================================================================

describe("minimal desktop backend", () => {
  let idp: Server,
    app: INestApplication,
    base: string,
    issuer: string,
    rt: DesktopRuntime,
    redis: TestRedis;
  let centralValid = true,
    centralOutage = false,
    lifetime = 3600,
    refreshes = 0,
    redirectToken = false;
  let codeOverrides: Record<string, unknown> = {};
  let refreshOverrides: Record<string, unknown> = {};
  const codes = new Map<string, { nonce: string; challenge: string }>();
  const refreshTokens = new Map<string, { sid: string }>();
  const seenRequests: string[] = [];

  function jwt(claims: Record<string, unknown>): string {
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "synthetic" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: issuer,
        aud: "ruyin-desktop",
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...claims,
      }),
    ).toString("base64url");
    return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), rsa.privateKey).toString("base64url")}`;
  }

  beforeAll(async () => {
    idp = createServer(async (req, res) => {
      seenRequests.push(req.url ?? "");
      const json = (body: unknown, status = 200) =>
        res
          .writeHead(status, { "content-type": "application/json" })
          .end(JSON.stringify(body));
      if (req.url === "/oidc/jwks") {
        json({ keys: [jwk] });
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString();
      if (
        req.headers.authorization !==
        `Basic ${Buffer.from("ruyin-desktop:synthetic-only").toString("base64")}`
      ) {
        json({}, 401);
        return;
      }
      if (req.url === "/oidc/session/status") {
        expect(JSON.parse(text)).toMatchObject({ active: false });
        json(
          centralValid
            ? { valid: true, next_check_at: Math.floor(Date.now() / 1000) + 60 }
            : { valid: false },
          centralOutage ? 503 : 200,
        );
        return;
      }
      if (req.url !== "/oidc/token") {
        json({}, 404);
        return;
      }
      if (redirectToken) {
        res.writeHead(307, { location: `${issuer}/redirect-leak` }).end();
        return;
      }
      const params = new URLSearchParams(text);
      let nonce: string | undefined,
        sid = "central-synthetic",
        overrides: Record<string, unknown> = {};
      if (params.get("grant_type") === "authorization_code") {
        const code = codes.get(params.get("code") ?? "");
        codes.delete(params.get("code") ?? "");
        if (
          !code ||
          createHash("sha256")
            .update(params.get("code_verifier") ?? "")
            .digest("base64url") !== code.challenge
        ) {
          json({}, 400);
          return;
        }
        nonce = code.nonce;
        overrides = codeOverrides;
        expect(params.get("redirect_uri")).toBe(`${base}/auth/callback`);
      } else {
        const old = params.get("refresh_token") ?? "";
        const record = refreshTokens.get(old);
        refreshTokens.delete(old);
        if (!record) {
          json({}, 400);
          return;
        }
        sid = record.sid;
        overrides = refreshOverrides;
        refreshes++;
      }
      const refreshToken = randomBytes(24).toString("hex");
      refreshTokens.set(refreshToken, { sid });
      json({
        id_token: jwt({
          sub: SUB,
          sid,
          ...(nonce ? { nonce } : {}),
          ...overrides,
        }),
        access_token: jwt({
          sub: SUB,
          sid,
          userType: "tenant_user",
          account_status: "active",
          name: "Synthetic User",
          active_org: ORG,
          active_org_type: "organization",
          active_org_name: "Synthetic Org",
          active_workspace: WORKSPACE,
          active_workspace_name: "Test Workspace",
          roles: ["org:member", "workspace:member"],
          ...overrides,
        }),
        refresh_token: refreshToken,
        expires_in:
          params.get("grant_type") === "authorization_code" ? lifetime : 3600,
      });
    });
    await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
    issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await app?.close();
    centralValid = true;
    centralOutage = false;
    lifetime = 3600;
    refreshes = 0;
    redirectToken = false;
    codeOverrides = {};
    refreshOverrides = {};
    codes.clear();
    refreshTokens.clear();
    seenRequests.length = 0;
    redis = new TestRedis();
    rt = createDesktopRuntime(
      desktopConfig({
        RUYIN_BFF_BASE: "http://127.0.0.1",
        OIDC_ISSUER: issuer,
        RUYIN_DESKTOP_OIDC_CLIENT_SECRET: "synthetic-only",
      }),
      redis,
    );
    app = await createDesktopApp(rt);
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    rt.config.base = base;
    rt.config.oidc.redirectUri = `${base}/auth/callback`;
    rt.workspaces = new WorkspaceReader({
      listOrgMembershipsForUser: async (userId) => [
        {
          organizationId: ORG,
          userId,
          status: "active",
          role: "member",
          organization: {
            id: ORG,
            name: "Synthetic Org",
            type: "organization",
            status: "active",
            ownerUserId: userId,
          },
        },
      ],
      listWorkspacesForSwitch: async (organizationId) => [
        {
          id: WORKSPACE,
          organizationId,
          name: "Test Workspace",
          isDefault: true,
        },
      ],
    });
  });
  afterAll(async () => {
    await app?.close();
    idp.closeAllConnections();
    await new Promise<void>((resolve) => idp.close(() => resolve()));
  });

  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${base}/desktop${path}`, { ...init, redirect: "manual" });
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  async function approval(extra = "") {
    const secret = randomBytes(32).toString("hex"),
      handle = createHash("sha256").update(secret).digest("hex");
    const login = await request(
      `/auth/login?surface=native&handle=${handle}${extra}`,
    );
    expect(login.status).toBe(302);
    expect(login.headers.get("set-cookie")).toBeNull();
    const authorize = new URL(login.headers.get("location")!);
    expect(authorize.searchParams.get("client_id")).toBe("ruyin-desktop");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.href).not.toContain(secret);
    const code = randomBytes(16).toString("hex");
    codes.set(code, {
      nonce: authorize.searchParams.get("nonce")!,
      challenge: authorize.searchParams.get("code_challenge")!,
    });
    const callback = `/auth/callback?state=${authorize.searchParams.get("state")}&code=${code}`;
    return { secret, handle, authorize, callback };
  }
  async function login() {
    const pending = await approval();
    expect((await request(pending.callback)).status).toBe(302);
    const claim = await post("/auth/native/claim", {
      deviceSecret: pending.secret,
    });
    expect(claim.status).toBe(200);
    return {
      ...pending,
      ...((await claim.json()) as { rpsid: string; expiresInSec: number }),
    };
  }

  // ========================================================================
  // Authentication, identity projection and exact boundaries
  // ========================================================================

  it("serves the self-contained completion page with only its exact stylesheet allowed", async () => {
    const response = await request(
      "/auth/native/done?code=synthetic-private-code&handle=synthetic-private-handle",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("set-cookie")).toBeNull();
    const html = await response.text();
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    expect(style).toBeTruthy();
    const digest = createHash("sha256").update(style!).digest("base64");
    expect(response.headers.get("content-security-policy")).toBe(
      `default-src 'none'; style-src 'sha256-${digest}'; img-src data:; font-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    );
    expect(html).toContain('aria-labelledby="completion-title"');
    expect(html).toContain("<title>验证完成 · Ruyin Work</title>");
    expect(html).toContain(">DESKTOP</span>");
    expect(html).toContain("现在可以关闭此页面");
    expect(
      [...html.matchAll(/\bsrc="([^"]+)"/g)].map(([, src]) => src),
    ).toEqual([expect.stringMatching(/^data:image\/png;base64,/)]);
    expect(
      [...html.matchAll(/\bhref="([^"]+)"/g)].map(([, href]) => href),
    ).toEqual([
      "https://ruyin.work/",
      "https://vxture.com/zh-CN/legal/terms",
      "https://vxture.com/zh-CN/legal/privacy",
      "https://vxture.com/zh-CN/legal/copyright",
    ]);
    const urls = [...(style ?? "").matchAll(/url\("([^"]+)"\)/g)].map(
      ([, url]) => url,
    );
    const embeddedFont = expect.stringMatching(/^data:font\/woff2;base64,/);
    expect(urls).toEqual([embeddedFont, embeddedFont]);
    expect(html).not.toMatch(
      /<script\b|<link\b|<form\b|\bstyle=|\bon\w+=|synthetic-private-/i,
    );
  });

  it("uses native approval without browser credentials and returns only an opaque session", async () => {
    const pending = await approval();
    expect(pending.authorize.searchParams.has("prompt")).toBe(false);
    expect(
      (await post("/auth/native/claim", { deviceSecret: pending.secret }))
        .status,
    ).toBe(404);
    const callback = await request(pending.callback);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${base}/auth/native/done`);
    expect(callback.headers.get("set-cookie")).toBeNull();
    const done = await request("/auth/native/done"),
      html = await done.text();
    expect(html).toContain("请返回 RUYIN");
    expect(html).not.toContain(pending.secret);
    expect(done.headers.get("cache-control")).toBe("no-store");
    expect(
      [...redis.values.values()].map((row) => row.value).join(),
    ).not.toContain(pending.secret);
    const claim = await post("/auth/native/claim", {
      deviceSecret: pending.secret,
    });
    const body = (await claim.json()) as { rpsid: string };
    expect(Object.keys(body).sort()).toEqual(["expiresInSec", "rpsid"]);
    const me = await request("/api/me", {
      headers: { "x-vxture-session": body.rpsid },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      id: SUB.slice(4),
      name: "Synthetic User",
      accountStatus: "active",
    });
    const context = await request("/api/tenant-context", {
      headers: { "x-vxture-session": body.rpsid },
    });
    expect(await context.json()).toMatchObject({
      id: ORG,
      workspace: WORKSPACE,
      tenantType: "organization",
    });
    expect(
      JSON.stringify(
        await (
          await request("/api/me", {
            headers: { "x-vxture-session": body.rpsid },
          })
        ).json(),
      ),
    ).not.toMatch(/Token|rpsid|secret/);
    expect(me.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("consumes both callback state and concurrent claims exactly once", async () => {
    const p = await approval();
    expect((await request(p.callback)).status).toBe(302);
    expect((await request(p.callback)).status).toBe(400);
    const replies = await Promise.all([
      post("/auth/native/claim", { deviceSecret: p.secret }),
      post("/auth/native/claim", { deviceSecret: p.secret }),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 404]);
    expect(
      (await request(`/auth/login?surface=native&handle=${p.handle}`)).status,
    ).toBe(409);
  });

  it("expires unclaimed approval and its RP session with the original login deadline", async () => {
    const p = await approval();
    expect((await request(p.callback)).status).toBe(302);
    expect([...redis.values.keys()].some((key) => key.includes(":sess:"))).toBe(
      false,
    );
    redis.offset = 301000;
    expect(
      (await post("/auth/native/claim", { deviceSecret: p.secret })).status,
    ).toBe(404);
    for (const key of redis.values.keys())
      if (key.includes(":sess:")) expect(await redis.get(key)).toBeNull();
  });

  it.each([
    "&prompt=login",
    "&surface=native",
    "&handle[]=x",
    "&returnTo=https://foreign.test",
    "&workspaceId=unsafe",
    "&prompt=select_account&prompt=select_account",
    "&ui_locales=bad",
  ])("rejects malformed or ambiguous login %s", async (extra) => {
    const handle = "a".repeat(64);
    expect(
      (await request(`/auth/login?surface=native&handle=${handle}${extra}`))
        .status,
    ).toBe(400);
    expect(redis.values.size).toBe(0);
  });

  it("supports explicit account selection and checks exact requested scope", async () => {
    const p = await approval(
      `&prompt=select_account&tenantId=${ORG}&workspaceId=${WORKSPACE}&ui_locales=zh-CN`,
    );
    expect(p.authorize.searchParams.get("prompt")).toBe("select_account");
    expect(p.authorize.searchParams.get("tenant_hint")).toBe(ORG);
    expect((await request(p.callback)).status).toBe(302);
    const wrong = await approval(
      `&workspaceId=44444444-4444-4444-8444-444444444444`,
    );
    expect((await request(wrong.callback)).status).toBe(401);
    expect(
      (await post("/auth/native/claim", { deviceSecret: wrong.secret })).status,
    ).toBe(404);
  });

  it.each([
    { aud: "console" },
    { iss: "https://other.test" },
    { nonce: "wrong" },
    { exp: 1 },
    { sub: "opr_operator" },
    { userType: "operator" },
    { account_status: "suspended" },
  ])("rejects invalid IdP claims %j", async (overrides) => {
    codeOverrides = overrides;
    const p = await approval();
    expect((await request(p.callback)).status).toBe(401);
    expect(
      (await post("/auth/native/claim", { deviceSecret: p.secret })).status,
    ).toBe(404);
  });

  it("does not authenticate native reads using browser cookies or ambiguous headers", async () => {
    const s = await login();
    expect(
      (
        await request("/api/me", {
          headers: { cookie: `vx_rp_session=${s.rpsid}` },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/me", {
          headers: { "x-vxture-session": `${s.rpsid},another` },
        })
      ).status,
    ).toBe(400);
    expect(
      (await request("/api/me", { headers: { "x-vxture-session": "unknown" } }))
        .status,
    ).toBe(401);
    expect(
      (await post("/auth/native/claim", { deviceSecret: 123 })).status,
    ).toBe(400);
  });

  it("refreshes using the shared RP service and never returns the rotated tokens", async () => {
    lifetime = 5;
    const s = await login();
    expect(refreshes).toBe(1);
    const response = await request("/api/me", {
      headers: { "x-vxture-session": s.rpsid },
    });
    expect(response.status).toBe(200);
    expect(refreshes).toBe(1);
    expect(await response.text()).not.toMatch(/Token|rpsid/);
  });

  it("local logout is idempotent and preserves the central identity and Console namespace", async () => {
    const s = await login();
    const consoleStore = new RpSessionStore(redis, "console", "vx:");
    await consoleStore.create(
      "separate-console",
      (await rt.store.get(s.rpsid))!,
      3600,
    );
    expect(
      (await post("/auth/native/logout", {}, { "x-vxture-session": s.rpsid }))
        .status,
    ).toBe(204);
    expect(
      (await post("/auth/native/logout", {}, { "x-vxture-session": s.rpsid }))
        .status,
    ).toBe(204);
    expect(
      (await request("/api/me", { headers: { "x-vxture-session": s.rpsid } }))
        .status,
    ).toBe(401);
    expect(await consoleStore.get("separate-console")).not.toBeNull();
    expect(centralValid).toBe(true);
    expect(seenRequests).not.toContain("/oidc/end_session");
  });

  it("validates backchannel revocation and removes this RP's sessions only", async () => {
    const a = await login(),
      b = await login();
    const consoleStore = new RpSessionStore(redis, "console", "vx:");
    await consoleStore.create(
      "console-session",
      (await rt.store.get(a.rpsid))!,
      3600,
    );
    const token = jwt({
      sid: "central-synthetic",
      events: { "http://schemas.openid.net/event/backchannel-logout": {} },
    });
    const wrong = jwt({
      sid: "central-synthetic",
      aud: "console",
      events: { "http://schemas.openid.net/event/backchannel-logout": {} },
    });
    expect(
      (await post("/auth/backchannel-logout", { logout_token: wrong })).status,
    ).toBe(400);
    expect(await rt.store.get(a.rpsid)).not.toBeNull();
    expect(
      (await post("/auth/backchannel-logout", { logout_token: token })).status,
    ).toBe(200);
    expect(await rt.store.get(a.rpsid)).toBeNull();
    expect(await rt.store.get(b.rpsid)).toBeNull();
    expect(await consoleStore.get("console-session")).not.toBeNull();
    expect(
      (await post("/auth/backchannel-logout", { logout_token: token })).status,
    ).toBe(200);
  });

  it("preserves a session on a central outage and rejects confirmed revocation", async () => {
    const s = await login();
    centralOutage = true;
    expect(
      (await request("/api/me", { headers: { "x-vxture-session": s.rpsid } }))
        .status,
    ).toBe(502);
    expect(await rt.store.get(s.rpsid)).not.toBeNull();
    centralOutage = false;
    centralValid = false;
    expect(
      (await request("/api/me", { headers: { "x-vxture-session": s.rpsid } }))
        .status,
    ).toBe(401);
    expect(await rt.store.get(s.rpsid)).toBeNull();
  });

  it("keeps missing business and device APIs explicit rather than proxying Console", async () => {
    for (const path of ["/api/desktop/devices", "/api/atlas/models"])
      expect((await request(path)).status).toBe(404);
    expect(seenRequests).toEqual([]);
  });

  // ========================================================================
  // Minimal workspace entitlements
  // ========================================================================

  const entitlementsPath = "/api/subscription/entitlements";

  it("returns minimal entitlement facts only for the session workspace", async () => {
    const session = await login();
    const assertRead = vi.fn().mockResolvedValue(undefined);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ product_code: "bundled-agent" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            product_code: "bundled-agent",
            tier_code: null,
            component_role: "bundled",
            quota: { limit: 100 },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    rt.entitlements = new EntitlementReader({ query }, { assertRead });

    const response = await request(
      `${entitlementsPath}?workspaceId=other&tenantId=other`,
      {
        headers: { "x-vxture-session": session.rpsid },
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual([
      { productCode: "bundled-agent", tier: null, status: null, bundled: true },
    ]);
    expect(query.mock.calls.map((args) => args[1])).toEqual([
      [WORKSPACE],
      [WORKSPACE, ["bundled-agent"]],
      [WORKSPACE, ["bundled-agent"]],
    ]);
    expect(assertRead.mock.calls).toEqual(
      Array.from({ length: 2 }, () => [
        expect.objectContaining({ activeWorkspace: WORKSPACE, activeOrg: ORG }),
        "tenant.quota.read",
      ]),
    );
  });

  it("distinguishes missing credentials, permission, empty coverage and source failure", async () => {
    const session = await login();
    const headers = { "x-vxture-session": session.rpsid };
    const assertRead = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const missingSource = await request(entitlementsPath, { headers });
    expect(missingSource.status).toBe(503);
    rt.entitlements = new EntitlementReader({ query }, { assertRead });
    expect(
      (
        await request(entitlementsPath, {
          headers: { cookie: "vx_rp_session=browser-only" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(entitlementsPath, {
          headers: { "x-vxture-session": "invalid-session" },
        })
      ).status,
    ).toBe(401);
    expect(assertRead).not.toHaveBeenCalled();

    assertRead.mockRejectedValueOnce(
      failure(403, "WORKBENCH_READ_FORBIDDEN", "Read forbidden"),
    );
    expect((await request(entitlementsPath, { headers })).status).toBe(403);
    expect(query).not.toHaveBeenCalled();

    const empty = await request(entitlementsPath, { headers });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);

    query.mockRejectedValueOnce(new Error("private source details"));
    const unavailable = await request(entitlementsPath, { headers });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      code: "WORKBENCH_ENTITLEMENTS_UNAVAILABLE",
      message: "Workspace entitlements are temporarily unavailable",
      retryable: true,
    });
    expect((await request("/api/me", { headers })).status).toBe(200);
  });

  it("discards entitlement results when the user logs out while reading", async () => {
    const session = await login();
    const headers = { "x-vxture-session": session.rpsid };
    const assertRead = vi.fn().mockResolvedValue(undefined);
    let finish!: () => void;
    const pending = new Promise<{ rows: [] }>((resolve) => {
      finish = () => resolve({ rows: [] });
    });
    const query = vi.fn().mockReturnValueOnce(pending);
    rt.entitlements = new EntitlementReader({ query }, { assertRead });

    const reading = request(entitlementsPath, { headers });
    try {
      await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
      expect((await post("/auth/native/logout", {}, headers)).status).toBe(204);
    } finally {
      finish();
    }
    expect((await reading).status).toBe(401);
  });

  // ========================================================================
  // Shared subscription reads and public branding
  // ========================================================================

  function applications(
    scope?: ConstructorParameters<typeof ApplicationReader>[2],
  ) {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const subscriptions = vi.fn().mockResolvedValue([]);
    const catalog = vi.fn().mockResolvedValue([]);
    const entries = vi.fn().mockResolvedValue([]);
    rt.applications = new ApplicationReader(
      { subscriptions, catalog, entries },
      { query },
      scope,
    );
    return { query, subscriptions, catalog, entries };
  }

  // ========================================================================
  // Recommendation reads require a tenant-level grant for subscription history.
  // ========================================================================

  const recommendationsPath = "/api/subscription/recommended-products";

  it("returns only ordered codes bound to the native tenant", async () => {
    const session = await login();
    const assertRead = vi.fn().mockResolvedValue(undefined);
    const { query, subscriptions, catalog } = applications({ assertRead });
    query.mockResolvedValue({
      rows: [
        { productCode: "beta-agent", minPrice: "19.00", favorite: true },
        { productCode: "stable-agent", minPrice: "0.00" },
      ],
    });

    const response = await request(
      `${recommendationsPath}?tenantId=attacker&workspaceId=other`,
      { headers: { "x-vxture-session": session.rpsid } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual([
      { productCode: "beta-agent" },
      { productCode: "stable-agent" },
    ]);
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.any(String), [ORG]);
    expect(subscriptions).not.toHaveBeenCalled();
    expect(catalog).not.toHaveBeenCalled();
    expect(assertRead.mock.calls).toEqual(
      Array.from({ length: 2 }, () => [
        expect.objectContaining({
          userId: SUB.slice(4),
          activeOrg: ORG,
          activeWorkspace: WORKSPACE,
        }),
        "tenant.billing.read",
        true,
      ]),
    );
  });

  it("rejects missing, browser-only and invalid credentials before reading", async () => {
    const assertRead = vi.fn();
    const { query } = applications({ assertRead });
    expect((await request(recommendationsPath)).status).toBe(400);
    expect(
      (
        await request(recommendationsPath, {
          headers: { cookie: "vx_rp_session=browser-only" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(recommendationsPath, {
          headers: { "x-vxture-session": "invalid-session" },
        })
      ).status,
    ).toBe(401);
    expect(assertRead).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("blocks tenant history on denied permission without ending the session", async () => {
    const session = await login();
    const assertRead = vi
      .fn()
      .mockRejectedValue(
        failure(403, "WORKBENCH_READ_FORBIDDEN", "Read forbidden"),
      );
    const { query } = applications({ assertRead });
    const headers = { "x-vxture-session": session.rpsid };
    const response = await request(recommendationsPath, { headers });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "WORKBENCH_READ_FORBIDDEN",
      retryable: false,
    });
    expect(query).not.toHaveBeenCalled();
    expect((await request("/api/me", { headers })).status).toBe(200);
  });

  it("distinguishes empty results, unavailable permission wiring and source failure", async () => {
    const session = await login();
    const headers = { "x-vxture-session": session.rpsid };
    applications();
    const missing = await request(recommendationsPath, { headers });
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({
      code: "WORKBENCH_RECOMMENDATIONS_UNAVAILABLE",
      retryable: true,
    });

    const { query } = applications({
      assertRead: vi.fn().mockResolvedValue(undefined),
    });
    const empty = await request(recommendationsPath, { headers });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);

    query.mockRejectedValueOnce(new Error("postgres://private-source"));
    const unavailable = await request(recommendationsPath, { headers });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      code: "WORKBENCH_RECOMMENDATIONS_UNAVAILABLE",
      message: "Agent recommendations are temporarily unavailable",
      retryable: true,
    });
  });

  it("discards results when the tenant permission is removed during the read", async () => {
    const session = await login();
    const assertRead = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        failure(403, "WORKBENCH_READ_FORBIDDEN", "Read forbidden"),
      );
    const { query } = applications({ assertRead });
    query.mockResolvedValue({ rows: [{ productCode: "unreturned-agent" }] });
    const response = await request(recommendationsPath, {
      headers: { "x-vxture-session": session.rpsid },
    });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("unreturned-agent");
    expect(assertRead).toHaveBeenCalledTimes(2);
  });

  it("discards results when the native session ends during the read", async () => {
    const session = await login();
    const headers = { "x-vxture-session": session.rpsid };
    const { query } = applications({
      assertRead: vi.fn().mockResolvedValue(undefined),
    });
    type CandidateResult = { rows: { productCode: string }[] };
    let finishRead!: (result: CandidateResult) => void;
    const pending = new Promise<CandidateResult>((resolve) => {
      finishRead = resolve;
    });
    query.mockReturnValueOnce(pending);
    const reading = request(recommendationsPath, { headers });
    try {
      await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
      expect((await post("/auth/native/logout", {}, headers)).status).toBe(204);
    } finally {
      finishRead({ rows: [{ productCode: "unreturned-agent" }] });
    }
    const response = await reading;
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("unreturned-agent");
  });

  // ========================================================================
  // Subscribed application and branding response contracts
  // ========================================================================

  it("uses the existing member catalog with real primary and bundled identities, without billing permission", async () => {
    const session = await login(),
      source = applications();
    source.subscriptions.mockResolvedValue([
      {
        subscriptionId: "real-id",
        productCode: "agent",
        status: "active",
        tier: "pro",
        bundled: false,
        access: "allowed",
        expiresAt: new Date("2027-01-01"),
      },
      {
        subscriptionId: "real-id",
        productCode: "bundle",
        status: "active",
        tier: null,
        bundled: true,
        access: "denied",
      },
    ]);
    source.catalog.mockResolvedValue([
      {
        productCode: "agent",
        productName: "Real agent",
        productNick: "REAL",
        description: "Stored description",
        releaseVersion: "1.2.3",
        releaseStage: "stable",
        iconUrl: "https://cdn.test/logo.png",
        iconVersion: "stored-logo-version",
      },
    ]);
    source.entries.mockResolvedValue([
      { code: "agent", homeUrl: "https://agent.test" },
    ]);
    const response = await request(
      "/api/subscription/subscribed-products?workspaceId=attacker",
      { headers: { "x-vxture-session": session.rpsid } },
    );
    expect(response.status).toBe(200);
    expect(source.subscriptions).toHaveBeenCalledWith(
      WORKSPACE,
      ORG,
      SUB.slice(4),
      true,
      true,
    );
    expect(await response.json()).toEqual([
      {
        subscriptionId: "real-id",
        productCode: "agent",
        productName: "Real agent",
        productNick: "REAL",
        description: "Stored description",
        tier: "pro",
        status: "active",
        releaseVersion: "1.2.3",
        releaseStage: "stable",
        endAt: "2027-01-01T00:00:00.000Z",
        homeUrl: "https://agent.test",
        iconUrl: "https://cdn.test/logo.png",
        iconVersion: "stored-logo-version",
        bundled: false,
        access: "allowed",
      },
      {
        subscriptionId: "real-id",
        productCode: "bundle",
        productName: null,
        productNick: null,
        description: null,
        tier: null,
        status: "active",
        releaseVersion: null,
        releaseStage: null,
        endAt: null,
        homeUrl: null,
        iconUrl: null,
        iconVersion: null,
        bundled: true,
        access: "denied",
      },
    ]);
    expect(source.query).not.toHaveBeenCalled();
  });
  it("distinguishes empty catalog from unavailable sources and never fabricates subscription identity", async () => {
    const session = await login(),
      headers = { "x-vxture-session": session.rpsid },
      path = "/api/subscription/subscribed-products";
    expect((await request(path, { headers })).status).toBe(503);
    const source = applications();
    expect(await (await request(path, { headers })).json()).toEqual([]);
    source.subscriptions.mockRejectedValueOnce(
      new Error("private database address"),
    );
    const failed = await request(path, { headers });
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private database");
    source.subscriptions.mockResolvedValueOnce([{ productCode: "agent" }]);
    expect((await request(path, { headers })).status).toBe(503);
    expect(await rt.store.get(session.rpsid)).not.toBeNull();
  });
  it("rejects missing identity and removed live membership before any catalog read", async () => {
    const source = applications(),
      path = "/api/subscription/subscribed-products";
    expect((await request(path)).status).toBe(400);
    expect(
      (await request(path, { headers: { "x-vxture-session": "invalid" } }))
        .status,
    ).toBe(401);
    const session = await login(),
      headers = { "x-vxture-session": session.rpsid };
    rt.workspaces = new WorkspaceReader({
      listOrgMembershipsForUser: async () => [],
      listWorkspacesForSwitch: async () => [],
    });
    expect((await request(path, { headers })).status).toBe(403);
    delete rt.workspaces;
    expect((await request(path, { headers })).status).toBe(503);
    expect(source.subscriptions).not.toHaveBeenCalled();
  });
  it("discards an in-flight catalog result when local session revocation wins", async () => {
    const session = await login(),
      source = applications();
    source.subscriptions.mockImplementation(async () => {
      await rt.store.destroy(session.rpsid);
      return [];
    });
    expect(
      (
        await request("/api/subscription/subscribed-products", {
          headers: { "x-vxture-session": session.rpsid },
        })
      ).status,
    ).toBe(401);
  });
  it("serves public icon bytes through the shared read with validators", async () => {
    const path = "/api/applications/agent/icon";
    expect((await request(path)).status).toBe(503);
    const source = applications(),
      bytes = Buffer.from([137, 80, 78, 71]);
    source.query.mockResolvedValue({
      rows: [{ mime_type: "image/png", bytes, checksum: "one" }],
    });
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(source.query.mock.calls[0]![1]).toEqual(["agent"]);
    expect(response.headers.get("etag")).toBe('"one"');
    expect(
      (await request(path, { headers: { "if-none-match": '"one"' } })).status,
    ).toBe(304);
    source.query.mockResolvedValueOnce({ rows: [] });
    expect((await request(path)).status).toBe(404);
    source.query.mockRejectedValueOnce(new Error("offline"));
    expect((await request(path)).status).toBe(503);
    expect(source.subscriptions).not.toHaveBeenCalled();
  });
  it.each([
    { mime_type: "image/svg+xml", bytes: Buffer.from("<svg/>") },
    { mime_type: "image/png", bytes: Buffer.alloc(262145) },
    { mime_type: "image/png", bytes: Buffer.alloc(0) },
  ])("rejects unsafe icon data", async (row) => {
    const source = applications();
    source.query.mockResolvedValue({ rows: [{ ...row, checksum: "bad" }] });
    expect((await request("/api/applications/agent/icon")).status).toBe(503);
  });

  it("keeps missing workspace sources explicit without logging out the user", async () => {
    const s = await login();
    delete rt.workspaces;
    for (const path of [
      "/api/me/workspaces",
      "/api/iam/workspaces/mine",
      "/api/me/organization",
      "/api/tenant-context",
    ]) {
      const response = await request(path, {
        headers: { "x-vxture-session": s.rpsid },
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "WORKSPACE_SOURCE_UNAVAILABLE",
      });
    }
    expect(await rt.store.get(s.rpsid)).not.toBeNull();
  });

  it("reads permitted organization/workspace pairs without inventing a default membership", async () => {
    const s = await login(),
      second = "44444444-4444-4444-8444-444444444444",
      other = "55555555-5555-4555-8555-555555555555";
    const calls: string[] = [];
    const source: OrganizationReads = {
      listOrgMembershipsForUser: async (userId) => {
        calls.push(userId);
        return [
          {
            organizationId: ORG,
            userId,
            status: "active",
            role: "member",
            organization: {
              id: ORG,
              name: "Organization full name",
              displayName: "Org",
              type: "organization",
              ownerUserId: "hidden",
              status: "active",
            },
          },
          {
            organizationId: other,
            userId,
            status: "active",
            role: "member",
            organization: {
              id: other,
              name: "Other full name",
              type: "organization",
              ownerUserId: "hidden",
              status: "active",
            },
          },
        ];
      },
      listWorkspacesForSwitch: async (organizationId, userId) => {
        expect(userId).toBe(SUB.slice(4));
        return organizationId === ORG
          ? [
              {
                id: WORKSPACE,
                organizationId,
                name: "Current workspace",
                isDefault: false,
              },
              {
                id: second,
                organizationId,
                name: "Other allowed workspace",
                isDefault: false,
              },
            ]
          : [];
      },
    };
    rt.workspaces = new WorkspaceReader(source);
    const headers = { "x-vxture-session": s.rpsid };
    const rows = await (
      await request("/api/me/workspaces", { headers })
    ).json();
    expect(rows).toEqual([
      {
        tenantId: ORG,
        tenantName: "Organization full name",
        tenantType: "organization",
        workspaceId: WORKSPACE,
        workspaceName: "Current workspace",
        workspaceIsDefault: false,
        isCurrent: true,
      },
      {
        tenantId: ORG,
        tenantName: "Organization full name",
        tenantType: "organization",
        workspaceId: second,
        workspaceName: "Other allowed workspace",
        workspaceIsDefault: false,
        isCurrent: false,
      },
    ]);
    expect(
      await (await request("/api/iam/workspaces/mine", { headers })).json(),
    ).toEqual([
      { id: WORKSPACE, name: "Current workspace", isDefault: false },
      { id: second, name: "Other allowed workspace", isDefault: false },
    ]);
    expect(
      await (await request("/api/me/organization", { headers })).json(),
    ).toEqual({
      tenantId: ORG,
      tenantName: "Organization full name",
      displayName: "Org",
    });
    expect(calls.every((user) => user === SUB.slice(4))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("ownerUserId");
  });

  it("rejects removed current membership and unavailable queries without substituting another workspace", async () => {
    const s = await login();
    rt.workspaces = new WorkspaceReader({
      listOrgMembershipsForUser: async () => [],
      listWorkspacesForSwitch: async () => [],
    });
    const headers = { "x-vxture-session": s.rpsid };
    expect(
      (await request("/api/iam/workspaces/mine", { headers })).status,
    ).toBe(403);
    expect((await request("/api/tenant-context", { headers })).status).toBe(
      403,
    );
    rt.workspaces = new WorkspaceReader({
      listOrgMembershipsForUser: async () => {
        throw new Error("synthetic outage");
      },
      listWorkspacesForSwitch: async () => [],
    });
    expect((await request("/api/me/workspaces", { headers })).status).toBe(503);
    expect((await request("/api/me", { headers })).status).toBe(200);
  });

  it.each([
    { active_org: "44444444-4444-4444-8444-444444444444" },
    { active_workspace: "44444444-4444-4444-8444-444444444444" },
  ])("rejects scope drift after shared RP refresh %j", async (overrides) => {
    const s = await login();
    const record = (await rt.store.get(s.rpsid))!;
    await rt.store.update(s.rpsid, { ...record, accessExpiresAt: 1 }, 3600);
    refreshOverrides = overrides;
    const response = await request("/api/tenant-context", {
      headers: { "x-vxture-session": s.rpsid },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "SESSION_SCOPE_CHANGED",
    });
    expect((await rt.store.get(s.rpsid))?.activeOrg).toBe(ORG);
    expect(
      (await request("/api/me", { headers: { "x-vxture-session": s.rpsid } }))
        .status,
    ).toBe(409);
  });

  it("requires reauthorization for an old RP session that has no original scope binding", async () => {
    const s = await login();
    const record = (await rt.store.get(s.rpsid)) as unknown as Record<
      string,
      unknown
    >;
    delete record.desktopScope;
    await redis.setex(
      `vx:rp:ruyin-desktop:sess:${s.rpsid}`,
      3600,
      JSON.stringify(record),
    );
    const response = await request("/api/me", {
      headers: { "x-vxture-session": s.rpsid },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "SESSION_SCOPE_CHANGED",
    });
  });

  // ========================================================================
  // Quota reads reuse the session scope and live domain permission checks.
  // ========================================================================

  it.each([0, 25])(
    "reads quota including used=%s only for the bound workspace",
    async (used) => {
      const session = await login();
      const usage = {
        storage: { used, limit: 100 },
        aiCredit: { used, limit: 200 },
      };
      const assertRead = vi.fn().mockResolvedValue(undefined);
      const resources = vi.fn().mockResolvedValue(usage);
      rt.resources = new ResourceReader({ assertRead }, { resources });
      const response = await request(
        "/api/subscription/quota-usage?workspaceId=other&tenantId=other",
        {
          headers: { "x-vxture-session": session.rpsid },
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual(usage);
      expect(resources).toHaveBeenCalledExactlyOnceWith(WORKSPACE);
      expect(assertRead).toHaveBeenCalledTimes(2);
      for (const [user, permission] of assertRead.mock.calls) {
        expect(user).toMatchObject({
          userId: SUB.slice(4),
          activeOrg: ORG,
          activeWorkspace: WORKSPACE,
        });
        expect(permission).toBe("tenant.quota.read");
      }
    },
  );

  it("requires native identity before touching the quota source", async () => {
    const assertRead = vi.fn(),
      resources = vi.fn();
    rt.resources = new ResourceReader({ assertRead }, { resources });
    const missing = await request("/api/subscription/quota-usage");
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      code: "NATIVE_REQUEST_INVALID",
      retryable: false,
    });
    expect(
      (
        await request("/api/subscription/quota-usage", {
          headers: { cookie: "vx_rp_session=browser-only" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/subscription/quota-usage", {
          headers: { "x-vxture-session": "invalid-session" },
        })
      ).status,
    ).toBe(401);
    expect(assertRead).not.toHaveBeenCalled();
    expect(resources).not.toHaveBeenCalled();
  });

  it.each(["WORKBENCH_SCOPE_FORBIDDEN", "WORKBENCH_READ_FORBIDDEN"])(
    "rejects quota on %s without ending a valid identity session",
    async (code) => {
      const session = await login();
      const resources = vi.fn();
      const assertRead = vi
        .fn()
        .mockRejectedValue(failure(403, code, "Read forbidden"));
      rt.resources = new ResourceReader({ assertRead }, { resources });
      const headers = { "x-vxture-session": session.rpsid };
      const response = await request("/api/subscription/quota-usage", {
        headers,
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code, retryable: false });
      expect(resources).not.toHaveBeenCalled();
      expect((await request("/api/me", { headers })).status).toBe(200);
    },
  );

  it("returns unavailable rather than zero quota when the source is missing or fails", async () => {
    const session = await login(),
      headers = { "x-vxture-session": session.rpsid };
    const missing = await request("/api/subscription/quota-usage", { headers });
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({
      code: "WORKBENCH_RESOURCE_UNAVAILABLE",
      retryable: true,
    });
    rt.resources = new ResourceReader(
      { assertRead: vi.fn().mockResolvedValue(undefined) },
      {
        resources: vi
          .fn()
          .mockRejectedValue(new Error("postgres://private-source")),
      },
    );
    const unavailable = await request("/api/subscription/quota-usage", {
      headers,
    });
    expect(unavailable.status).toBe(503);
    const body = await unavailable.text();
    expect(body).not.toMatch(/private-source|storage|aiCredit/);
    expect((await request("/api/me", { headers })).status).toBe(200);
  });

  it("discards quota when permission is removed while the source is reading", async () => {
    const session = await login();
    const assertRead = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        failure(403, "WORKBENCH_READ_FORBIDDEN", "Read forbidden"),
      );
    rt.resources = new ResourceReader(
      { assertRead },
      {
        resources: vi.fn().mockResolvedValue({
          storage: { used: 1, limit: 2 },
          aiCredit: { used: 3, limit: 4 },
        }),
      },
    );
    const response = await request("/api/subscription/quota-usage", {
      headers: { "x-vxture-session": session.rpsid },
    });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("storage");
  });

  it("discards an in-flight quota response after local native logout", async () => {
    const session = await login(),
      headers = { "x-vxture-session": session.rpsid };
    const usage = {
      storage: { used: 1, limit: 2 },
      aiCredit: { used: 3, limit: 4 },
    };
    let release!: (value: typeof usage) => void;
    const pending = new Promise<typeof usage>((resolve) => {
      release = resolve;
    });
    const resources = vi.fn().mockReturnValue(pending);
    rt.resources = new ResourceReader(
      { assertRead: vi.fn().mockResolvedValue(undefined) },
      { resources },
    );
    const reading = request("/api/subscription/quota-usage", { headers });
    try {
      await vi.waitFor(() => expect(resources).toHaveBeenCalledTimes(1));
      expect((await post("/auth/native/logout", {}, headers)).status).toBe(204);
    } finally {
      release(usage);
    }
    const response = await reading;
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("storage");
  });

  it("exposes standard build identity without contacting dependencies or requiring a session", async () => {
    delete rt.workspaces;
    delete rt.applications;
    centralOutage = true;
    const get = vi
      .spyOn(rt.redis, "get")
      .mockRejectedValue(new Error("Redis unavailable"));
    try {
      for (const key of [
        "APP_VERSION",
        "GIT_SHA",
        "BUILD_TIME",
        "DEPLOY_STAGE",
      ])
        vi.stubEnv(key, "");
      const response = await request("/healthz");
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = (await response.json()) as { time: string };
      expect(body).toMatchObject({
        status: "ok",
        service: "workbench-bff",
        product: "vxture",
        version: "dev",
        gitSha: "unknown",
        stage: "dev",
        buildTime: "unknown",
      });
      expect(Number.isFinite(Date.parse(body.time))).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(
        /synthetic-only|redis:|postgres:|clientSecret|rpsid/,
      );
      vi.stubEnv("APP_VERSION", "beta-test");
      vi.stubEnv("GIT_SHA", "12345678");
      vi.stubEnv("BUILD_TIME", "2026-11-22T00:00:00.000Z");
      vi.stubEnv("DEPLOY_STAGE", "beta");
      expect(await (await request("/healthz")).json()).toMatchObject({
        version: "beta-test",
        gitSha: "12345678",
        stage: "beta",
        buildTime: "2026-11-22T00:00:00.000Z",
      });
      expect(await (await request("/health")).json()).toEqual({ status: "ok" });
      expect(get).not.toHaveBeenCalled();
      expect(seenRequests).toEqual([]);
    } finally {
      get.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("keeps dependency health distinct and rejects cancelled or replayed callbacks", async () => {
    expect((await request("/health")).status).toBe(200);
    const pending = await approval();
    const state = pending.authorize.searchParams.get("state");
    const denied = await request(
      `/auth/callback?state=${state}&error=access_denied`,
    );
    expect(denied.status).toBe(400);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect((await request(pending.callback)).status).toBe(400);
    expect(
      (await post("/auth/native/claim", { deviceSecret: pending.secret }))
        .status,
    ).toBe(404);
    expect((await request("/auth/callback?state=bad&code=unused")).status).toBe(
      400,
    );
  });

  it("never returns an authenticated session if persistence fails during claim", async () => {
    const pending = await approval();
    expect((await request(pending.callback)).status).toBe(302);
    redis.failWrites = true;
    const claim = await post("/auth/native/claim", {
      deviceSecret: pending.secret,
    });
    expect(claim.status).toBe(503);
    expect(await claim.text()).not.toContain("rpsid");
    expect([...redis.values.keys()].some((key) => key.includes(":sess:"))).toBe(
      false,
    );
    expect(
      (await post("/auth/native/claim", { deviceSecret: pending.secret }))
        .status,
    ).toBe(404);
  });

  it("rejects ordinary id tokens, malformed logout and implicit cookie logout", async () => {
    const session = await login();
    expect((await post("/auth/backchannel-logout", {})).status).toBe(400);
    expect(
      (
        await post("/auth/backchannel-logout", {
          logout_token: jwt({ sid: "central-synthetic" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/auth/native/logout",
          {},
          { cookie: `vx_rp_session=${session.rpsid}` },
        )
      ).status,
    ).toBe(400);
    expect(await rt.store.get(session.rpsid)).not.toBeNull();
  });

  it("never follows an IdP redirect carrying its server credentials or code verifier", async () => {
    redirectToken = true;
    const p = await approval();
    expect((await request(p.callback)).status).toBe(401);
    expect(seenRequests).not.toContain("/redirect-leak");
    expect(
      (await post("/auth/native/claim", { deviceSecret: p.secret })).status,
    ).toBe(404);
  });
});

describe("desktop configuration", () => {
  const env = {
    RUYIN_BFF_BASE: "https://desktop.test",
    OIDC_ISSUER: "https://accounts.test",
    RUYIN_DESKTOP_OIDC_CLIENT_SECRET: "synthetic-only",
  };
  it("requires a distinct backend identity and explicit configuration", () => {
    expect(desktopConfig(env).oidc).toMatchObject({
      clientId: "ruyin-desktop",
      redirectUri: "https://desktop.test/auth/callback",
    });
    for (const key of Object.keys(env))
      expect(() => desktopConfig({ ...env, [key]: "" })).toThrow();
    expect(
      desktopConfig({ ...env, OIDC_CLIENT_ID: "workbench" }).oidc.clientId,
    ).toBe("ruyin-desktop");
    for (const value of [
      "http://remote.test",
      "https://u:p@desktop.test",
      "https://desktop.test/path",
    ])
      expect(() => desktopConfig({ ...env, RUYIN_BFF_BASE: value })).toThrow();
    for (const ttl of ["0", "-1", "86401", "NaN"])
      expect(() =>
        desktopConfig({ ...env, RUYIN_DESKTOP_SESSION_TTL: ttl }),
      ).toThrow();
  });
});
