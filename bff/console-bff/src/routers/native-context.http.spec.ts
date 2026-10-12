/**
 * native-context.http.spec.ts - Native scope handshake over real Nest HTTP.
 * @package @vxture/bff-console
 * @layer Application
 * @category Test
 * @author AI-Generated
 * @date 2026-10-12
 */
import "reflect-metadata";
import {
  Controller,
  Get,
  Module,
  Req,
  type INestApplication,
} from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
// ⚠️ 跨层引用: Use the real RP store and per-request verification pipeline.
import {
  RpAuthService,
  RpSessionStore,
  rpSessionCookieName,
  type OidcRpClient,
  type RpRedis,
  type RpSession,
} from "@vxture/core-oidc-rp";
import cookieParser from "cookie-parser";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Request } from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { CapabilityGuard, SelfScope } from "../auth/capability";
import { ConsoleAuthService } from "../auth/auth.service";
import { SessionAggregator } from "../aggregators/session.aggregator";
import { AuthMiddleware } from "../middleware/auth.middleware";
import { TenantMiddleware } from "../middleware/tenant.middleware";
import { PermissionMiddleware } from "../middleware/permission.middleware";
import {
  RP_AUTH_SERVICE,
  RP_OIDC_CLIENT,
  RP_REDIS,
  RP_RUNTIME,
  RP_SESSION_STORE,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/console.types";
import { NativeAuthRouter, nativePendingKey } from "./native-auth.router";
import { OidcAuthRouter, consoleAuthReqKey } from "./oidc-auth.router";

// ============================================================================
// Real RP store, verified claims adapter, and HTTP middleware chain
// ============================================================================

const TENANT = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const SECRET = "d".repeat(64);
const HANDLE = createHash("sha256").update(SECRET).digest("hex");
const PREFIX = "context-spec:";
const COOKIE = rpSessionCookieName(true, "console");
const values = new Map<string, string>();
const members = new Map<string, Set<string>>();
const redis = {
  get: vi.fn(async (key: string) => values.get(key) ?? null),
  setex: vi.fn(async (key: string, _ttl: number, value: string) => {
    values.set(key, value);
    return "OK";
  }),
  getdel: vi.fn(async (key: string) => {
    const value = values.get(key) ?? null;
    values.delete(key);
    return value;
  }),
  del: vi.fn(async (...keys: string[]) => {
    keys.forEach((key) => {
      values.delete(key);
      members.delete(key);
    });
    return keys.length;
  }),
  sadd: vi.fn(async (key: string, ...ids: string[]) => {
    const set = members.get(key) ?? new Set<string>();
    ids.forEach((id) => set.add(id));
    members.set(key, set);
    return ids.length;
  }),
  srem: vi.fn(async (key: string, ...ids: string[]) => {
    ids.forEach((id) => members.get(key)?.delete(id));
    return ids.length;
  }),
  smembers: vi.fn(async (key: string) => [...(members.get(key) ?? [])]),
  expire: vi.fn(async () => 1),
} satisfies RpRedis & { getdel(key: string): Promise<string | null> };
const store = new RpSessionStore(redis, "console", PREFIX);
const rt: RpRuntime = {
  config: {
    clientId: "console",
    clientSecret: "",
    issuer: "https://accounts.spec.local",
    redirectUri: "https://console.spec.local/auth/callback",
    scopes: ["openid"],
    sessionTtlSec: 3600,
  },
  enabled: true,
  cookieSecure: true,
  keyPrefix: PREFIX,
  allowedReturnOrigins: ["https://console.spec.local"],
  defaultReturnTo: "https://console.spec.local/",
  postLogoutRedirectUri: "https://accounts.spec.local/logout",
};
const claims = (workspace = WORKSPACE): Record<string, unknown> => ({
  sub: "user",
  active_org: TENANT,
  active_workspace: workspace,
  roles: ["org:member", "workspace:member"],
});
let issued: Record<string, unknown>;
const tokens = {
  idToken: "id-token",
  accessToken: "new-access",
  refreshToken: "refresh-token",
  accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
};
const client = {
  buildAuthorizeUrl: vi.fn(
    (input: Parameters<OidcRpClient["buildAuthorizeUrl"]>[0]) => {
      const url = new URL("https://accounts.spec.local/oidc/authorize");
      url.searchParams.set("state", input.state);
      url.searchParams.set("nonce", input.nonce);
      url.searchParams.set("code_challenge", input.codeChallenge);
      if (input.prompt) url.searchParams.set("prompt", input.prompt);
      if (input.tenantHint)
        url.searchParams.set("tenant_hint", input.tenantHint);
      if (input.workspaceHint)
        url.searchParams.set("workspace_hint", input.workspaceHint);
      return url.toString();
    },
  ),
  exchangeCode: vi.fn(async () => tokens),
  verifyIdToken: vi.fn(async () => ({
    sub: "user",
    sid: "central",
    aud: "console",
    iss: rt.config.issuer,
    exp: tokens.accessExpiresAt,
  })),
  verifyAccessToken: vi.fn(async (token: string) =>
    token === "old-access" ? claims(OTHER) : issued,
  ),
  refresh: vi.fn(async () => tokens),
  verifyLogoutToken: vi.fn(async () => ({ sid: "central" })),
  buildEndSessionUrl: vi.fn(() => "https://accounts.spec.local/logout"),
} satisfies OidcRpClient;
const auth = new RpAuthService(store, client, 3600);
let accessible: boolean;
const getTenantContext = vi.fn(
  async (_user: string, tenantId: string, workspaceId?: string) =>
    accessible
      ? {
          id: tenantId,
          name: "Team",
          mode: "tenant",
          workspace: workspaceId ?? OTHER,
        }
      : {
          id: "platform:user",
          name: "Platform",
          mode: "platform",
          workspace: "PLATFORM",
        },
);
const capabilitiesFor = vi.fn(async () => ["tenant.quota.read"]);

@SelfScope()
@Controller("api/context")
class ContextEndpoint {
  @Get()
  read(@Req() req: Request & RequestContext) {
    return { tenant: req.tenant, capabilities: req.capabilities };
  }
}

@Module({
  controllers: [OidcAuthRouter, NativeAuthRouter, ContextEndpoint],
  providers: [
    { provide: RP_SESSION_STORE, useValue: store },
    { provide: RP_REDIS, useValue: redis },
    { provide: RP_RUNTIME, useValue: rt },
    { provide: RP_AUTH_SERVICE, useValue: auth },
    { provide: RP_OIDC_CLIENT, useValue: client },
    {
      provide: ConsoleAuthService,
      useValue: {
        getCurrentUser: async () => ({ id: "user", timezone: null }),
      },
    },
    {
      provide: SessionAggregator,
      useValue: { getTenantContext, capabilitiesFor },
    },
    AuthMiddleware,
    TenantMiddleware,
    PermissionMiddleware,
    { provide: APP_GUARD, useClass: CapabilityGuard },
  ],
})
class ContextSpecModule {}

let app: INestApplication;
let base: string;
const oldSession: RpSession = {
  sid: "central",
  sub: "user",
  idToken: "old-id",
  accessToken: "old-access",
  refreshToken: "old-refresh",
  accessExpiresAt: tokens.accessExpiresAt,
};
beforeAll(async () => {
  app = await NestFactory.create(ContextSpecModule, { logger: false });
  app.use(cookieParser());
  for (const type of [AuthMiddleware, TenantMiddleware, PermissionMiddleware]) {
    const middleware = app.get(type);
    app.use("/api", middleware.use.bind(middleware));
  }
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app?.close();
});
beforeEach(async () => {
  values.clear();
  members.clear();
  vi.clearAllMocks();
  issued = claims();
  accessible = true;
  await store.create("browser", oldSession, 3600);
  await store.create("old-native", oldSession, 3600);
});

async function begin(extra = `&tenantId=${TENANT}&workspaceId=${WORKSPACE}`) {
  const response = await fetch(
    `${base}/auth/login?surface=native&handle=${HANDLE}${extra}`,
    { redirect: "manual" },
  );
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location")!);
}
async function callback(url: URL) {
  return fetch(
    `${base}/auth/callback?code=code&state=${url.searchParams.get("state")}`,
    { redirect: "manual", headers: { Cookie: `${COOKIE}=browser` } },
  );
}
async function claim() {
  return fetch(`${base}/auth/native/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceSecret: SECRET }),
  });
}

// ============================================================================
// Successful switching, strict targets, and compatibility
// ============================================================================

describe("native active context handshake", () => {
  it("binds the requested scope once and propagates it through header-authenticated APIs", async () => {
    const url = await begin();
    expect(url.searchParams.get("tenant_hint")).toBe(TENANT);
    expect(url.searchParams.get("workspace_hint")).toBe(WORKSPACE);
    expect(url.toString()).not.toContain(SECRET);
    const raw = JSON.parse(
      values.get(consoleAuthReqKey(PREFIX, url.searchParams.get("state")!))!,
    );
    expect(raw).toMatchObject({ tenantId: TENANT, workspaceId: WORKSPACE });
    const done = await callback(url);
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe(
      "https://console.spec.local/native-done",
    );
    expect(done.headers.get("set-cookie")).toBeNull();
    expect(client.verifyIdToken).toHaveBeenCalledWith(
      tokens.idToken,
      raw.nonce,
    );
    const claimed = await claim();
    expect(claimed.status).toBe(200);
    const body = (await claimed.json()) as {
      rpsid: string;
      expiresInSec: number;
    };
    expect(Object.keys(body).sort()).toEqual(["expiresInSec", "rpsid"]);
    expect(body.rpsid).not.toBe("old-native");
    expect(await store.get(body.rpsid)).toMatchObject({
      activeOrg: TENANT,
      accessToken: tokens.accessToken,
    });
    const response = await fetch(`${base}/api/context?workspaceId=${OTHER}`, {
      headers: { "X-Vxture-Session": body.rpsid },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tenant: { id: TENANT, workspace: WORKSPACE },
    });
    expect(getTenantContext).toHaveBeenCalledWith("user", TENANT, WORKSPACE);
    expect(capabilitiesFor).toHaveBeenCalledWith("user", TENANT, WORKSPACE);
    expect((await claim()).status).toBe(404);
    expect((await callback(url)).status).toBe(400);
    expect(await store.get("browser")).toEqual(oldSession);
    expect(await store.get("old-native")).toEqual(oldSession);
    await fetch(`${base}/auth/native/logout`, {
      method: "POST",
      headers: { "X-Vxture-Session": "old-native" },
    });
    expect(await store.get("old-native")).toBeNull();
    expect(await store.get(body.rpsid)).not.toBeNull();
    expect(await store.get("browser")).toEqual(oldSession);
    expect(client.buildEndSessionUrl).not.toHaveBeenCalled();
  });

  it.each(["tenant", "workspace", "absent"])(
    "does not bind a session when the issued %s scope differs",
    async (axis) => {
      const url = await begin();
      issued = {
        ...claims(),
        ...(axis === "tenant"
          ? { active_org: OTHER }
          : { active_workspace: axis === "absent" ? null : OTHER }),
      };
      const done = await callback(url);
      expect(done.status).toBe(403);
      expect(done.headers.get("cache-control")).toBe("no-store");
      expect(await done.json()).toMatchObject({
        code: "NATIVE_CONTEXT_NOT_APPLIED",
      });
      expect(values.has(nativePendingKey(PREFIX, HANDLE))).toBe(false);
      expect((await claim()).status).toBe(404);
      expect(
        await redis.smembers(`${PREFIX}rp:console:sididx:central`),
      ).toEqual(["browser", "old-native"]);
      expect(await store.get("browser")).toEqual(oldSession);
    },
  );

  it.each([`&tenantId=${TENANT}`, `&workspaceId=${WORKSPACE}`, ""])(
    "supports a single hint or ordinary native login: %s",
    async (extra) => {
      expect((await callback(await begin(extra))).status).toBe(302);
      expect((await claim()).status).toBe(200);
    },
  );

  it("rejects a default-workspace hint whose issued claims carry no workspace membership", async () => {
    const url = await begin();
    issued = { ...claims(), roles: ["org:member"] };
    const done = await callback(url);
    expect(done.status).toBe(403);
    expect(await done.json()).toMatchObject({
      code: "NATIVE_CONTEXT_NOT_APPLIED",
    });
    expect((await claim()).status).toBe(404);
  });

  it("rejects revoked scope in the API middleware before permission lookup", async () => {
    await callback(await begin());
    const { rpsid } = (await (await claim()).json()) as { rpsid: string };
    accessible = false;
    const response = await fetch(`${base}/api/context`, {
      headers: { "X-Vxture-Session": rpsid },
    });
    expect(response.status).toBe(403);
    expect(capabilitiesFor).not.toHaveBeenCalled();
  });

  it("preserves browser cookie priority when both session transports are present", async () => {
    await callback(await begin());
    const { rpsid } = (await (await claim()).json()) as { rpsid: string };
    const response = await fetch(`${base}/api/context`, {
      headers: { Cookie: `${COOKIE}=browser`, "X-Vxture-Session": rpsid },
    });
    expect(await response.json()).toMatchObject({
      tenant: { workspace: OTHER },
    });
  });

  it("returns an explicit native OIDC failure without setting browser presence cookies", async () => {
    const url = await begin("&prompt=none");
    const response = await fetch(
      `${base}/auth/callback?error=login_required&state=${url.searchParams.get("state")}`,
      { redirect: "manual" },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "OIDC_ERROR" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await claim()).status).toBe(404);
  });

  it("removes the new session when pending binding storage fails", async () => {
    const url = await begin();
    const original = redis.setex.getMockImplementation()!;
    redis.setex.mockImplementationOnce(async (key, ttl, value) =>
      original(key, ttl, value),
    );
    redis.setex.mockRejectedValueOnce(new Error("Pending store unavailable"));
    expect((await callback(url)).status).toBe(500);
    expect(await redis.smembers(`${PREFIX}rp:console:sididx:central`)).toEqual([
      "browser",
      "old-native",
    ]);
    expect((await claim()).status).toBe(404);
  });

  it("keeps browser callback cookie replacement and old-session cleanup", async () => {
    const login = await fetch(`${base}/auth/login`, { redirect: "manual" });
    const url = new URL(login.headers.get("location")!);
    const done = await callback(url);
    expect(done.status).toBe(302);
    expect(done.headers.get("set-cookie")).toContain(COOKIE);
    expect(await store.get("browser")).toBeNull();
    expect(await store.get("old-native")).toEqual(oldSession);
  });

  it.each([
    `surface=native`,
    `surface=native&handle=bad`,
    `handle=${HANDLE}`,
    `tenantId=${TENANT}`,
    `surface=native&handle=${HANDLE}&tenantId=`,
    `surface=native&handle=${HANDLE}&workspaceId=bad`,
    `surface=native&handle=${HANDLE}&workspaceId[]=${WORKSPACE}`,
    `surface=native&handle=${HANDLE}&tenantId=${TENANT}&tenantId=${TENANT}`,
    `surface=native&surface=native&handle=${HANDLE}`,
    `surface=native&handle=${HANDLE}&handle=${HANDLE}`,
  ])("rejects malformed or ambiguous native input: %s", async (query) => {
    const response = await fetch(`${base}/auth/login?${query}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "NATIVE_LOGIN_REQUEST_INVALID",
    });
    expect(client.buildAuthorizeUrl).not.toHaveBeenCalled();
  });
});
