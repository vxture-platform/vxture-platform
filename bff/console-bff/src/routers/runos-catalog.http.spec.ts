/**
 * Session middleware and upstream HTTP behavior for desktop catalog reads.
 * @package @vxture/bff-console
 * @layer Application
 * @category Test
 * @author AI-Generated
 * @date 2026-10-19
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { VxConfigService } from "@vxture/core-config";
// ⚠️ 跨层引用: Exercise the shared RP verification and session store over HTTP.
import {
  RpAuthService,
  RpSessionStore,
  rpSessionCookieName,
  type OidcRpClient,
  type RpRedis,
} from "@vxture/core-oidc-rp";
import cookieParser from "cookie-parser";
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
import { ConsoleAuthService } from "../auth/auth.service";
import { CapabilityGuard } from "../auth/capability";
import { S2sExchangeService } from "../auth/s2s-exchange.service";
import { SessionAggregator } from "../aggregators/session.aggregator";
import { AuthMiddleware } from "../middleware/auth.middleware";
import { TenantMiddleware } from "../middleware/tenant.middleware";
import { PermissionMiddleware } from "../middleware/permission.middleware";
import {
  RP_AUTH_SERVICE,
  RP_RUNTIME,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import { RunosRouter } from "./runos.router";

// --- Real RP sessions and HTTP transport -----------------------------------

const TENANT = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const values = new Map<string, string>();
const redis = {
  get: async (key: string) => values.get(key) ?? null,
  setex: async (key: string, _ttl: number, value: string) => {
    values.set(key, value);
    return "OK";
  },
  del: async (...keys: string[]) => {
    keys.forEach((key) => values.delete(key));
    return keys.length;
  },
  sadd: async () => 1,
  srem: async () => 1,
  smembers: async () => [],
  expire: async () => 1,
} satisfies RpRedis;
const store = new RpSessionStore(redis, "console", "runos-spec:");
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
  keyPrefix: "runos-spec:",
  allowedReturnOrigins: ["https://console.spec.local"],
  defaultReturnTo: "https://console.spec.local/",
  postLogoutRedirectUri: "https://accounts.spec.local/logout",
};
const client = {
  verifyAccessToken: vi.fn(async (token: string) => ({
    sub: "user",
    active_org: TENANT,
    active_workspace:
      token === "other" ? OTHER : token === "missing" ? undefined : WORKSPACE,
    roles: ["org:member"],
  })),
  refresh: vi.fn(async () => {
    throw new Error("expired");
  }),
} as unknown as OidcRpClient;
const auth = new RpAuthService(store, client, 3600);
let accessible = true;
const getTenantContext = vi.fn(
  async (_user: string, tenant: string, workspace?: string) => ({
    id: tenant,
    name: "Team",
    mode: accessible ? "tenant" : "platform",
    workspace: workspace ?? "default",
  }),
);
const exchange = {
  getToken: vi.fn(
    async (workspace: string) => `service-${workspace}` as string | null,
  ),
};
let upstreamBase: string;
let upstreamStatus = 200;
let upstreamBody: unknown;
let rawBody: string | undefined;
let received: { url: string; headers: Record<string, unknown> }[];
let upstream: Server;
let app: INestApplication;
let base: string;
const metadata = {
  capability_id: "writing.summary",
  title: "Summary",
  display_name: { en: "Summary" },
  primitive_type: "skill",
  category: "writing",
  tags: ["text"],
};
const version = "a".repeat(64);

@Module({
  controllers: [RunosRouter],
  providers: [
    {
      provide: VxConfigService,
      useFactory: () => ({ platform: { RUNOS_API_URL: upstreamBase } }),
    },
    { provide: S2sExchangeService, useValue: exchange },
    { provide: RP_AUTH_SERVICE, useValue: auth },
    { provide: RP_RUNTIME, useValue: rt },
    {
      provide: ConsoleAuthService,
      useValue: {
        getCurrentUser: async () => ({ id: "user", timezone: null }),
      },
    },
    {
      provide: SessionAggregator,
      useValue: { getTenantContext, capabilitiesFor: async () => [] },
    },
    AuthMiddleware,
    TenantMiddleware,
    PermissionMiddleware,
    { provide: APP_GUARD, useClass: CapabilityGuard },
  ],
})
class CatalogSpecModule {}
beforeAll(async () => {
  upstream = createServer((req, res) => {
    received.push({ url: req.url!, headers: req.headers });
    res.writeHead(upstreamStatus, {
      "Content-Type": "application/json",
      ...(upstreamStatus === 302
        ? { Location: "https://example.com/secret" }
        : {}),
    });
    res.end(rawBody ?? JSON.stringify(upstreamBody));
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  upstreamBase = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  app = await NestFactory.create(CatalogSpecModule, { logger: false });
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
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});
beforeEach(async () => {
  vi.clearAllMocks();
  values.clear();
  received = [];
  accessible = true;
  exchange.getToken.mockImplementation(
    async (workspace) => `service-${workspace}`,
  );
  upstreamStatus = 200;
  rawBody = undefined;
  upstreamBody = { items: [metadata], total: 1, nextCursor: null, version };
  for (const [id, accessToken] of [
    ["native", "current"],
    ["browser", "other"],
    ["missing", "missing"],
    ["expired", "expired"],
  ]) {
    await store.create(
      id!,
      {
        sid: "central",
        sub: "user",
        idToken: "id",
        accessToken: accessToken!,
        refreshToken: "refresh",
        accessExpiresAt:
          accessToken === "expired" ? 0 : Math.floor(Date.now() / 1000) + 3600,
      },
      3600,
    );
  }
});
async function read(
  query = "",
  headers: Record<string, string> = { "X-Vxture-Session": "native" },
) {
  return fetch(`${base}/api/runos/capabilities${query}`, { headers });
}

// --- Member visibility, verified scope, and sanitized proxy behavior --------

describe("Runos session catalog HTTP", () => {
  it("accepts the contract's asset primitive metadata", async () => {
    upstreamBody = {
      items: [{ ...metadata, primitive_type: "asset" }],
      total: 1,
      nextCursor: null,
      version,
    };
    expect((await read()).status).toBe(200);
  });
  it("allows an ordinary member with no governance permissions and exchanges only server-side", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(upstreamBody);
    expect(exchange.getToken).toHaveBeenCalledWith(WORKSPACE, "runos", TENANT);
    expect(received[0]).toMatchObject({
      url: "/tenancy/capabilities",
      headers: { authorization: `Bearer service-${WORKSPACE}` },
    });
    expect(received[0]!.headers).not.toHaveProperty("cookie");
    expect(received[0]!.headers).not.toHaveProperty("x-vxture-session");
  });
  it("uses the browser session when cookie and native header coexist", async () => {
    const response = await read("", {
      "X-Vxture-Session": "native",
      Cookie: `${rpSessionCookieName(true, "console")}=browser`,
    });
    expect(response.status).toBe(200);
    expect(exchange.getToken).toHaveBeenCalledWith(OTHER, "runos", TENANT);
  });
  it.each(["none", "expired"])(
    "rejects %s session before contacting Runos",
    async (id) => {
      expect((await read("", { "X-Vxture-Session": id })).status).toBe(401);
      expect(received).toEqual([]);
    },
  );
  it("rejects absent session", async () => {
    expect((await read("", {})).status).toBe(401);
  });
  it("rejects an inaccessible explicit workspace without falling back", async () => {
    accessible = false;
    expect((await read()).status).toBe(403);
    expect(exchange.getToken).not.toHaveBeenCalled();
  });
  it("rejects a missing active workspace", async () => {
    expect((await read("", { "X-Vxture-Session": "missing" })).status).toBe(
      403,
    );
    expect(received).toEqual([]);
  });
  it.each([
    "workspaceId=other",
    "tenantId=other",
    "task_id=fake",
    "limit=0",
    "limit=1001",
    "limit=1&limit=2",
    "cursor=",
    "cursor=bad%2B",
  ])("rejects query %s", async (query) => {
    expect((await read(`?${query}`)).status).toBe(400);
    expect(exchange.getToken).not.toHaveBeenCalled();
  });
  it("passes paging unchanged and strips unapproved upstream fields", async () => {
    upstreamBody = {
      items: [
        {
          ...metadata,
          contract: "secret",
          endpoint: "private",
          token: "secret",
        },
      ],
      total: 2,
      nextCursor: "next-page",
      version,
      secret: "private",
    };
    const response = await read("?limit=1&cursor=page-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [metadata],
      total: 2,
      nextCursor: "next-page",
      version,
    });
    expect(received[0]!.url).toBe(
      "/tenancy/capabilities?limit=1&cursor=page-1",
    );
  });
  it.each([
    [409, "CAPABILITY_CATALOG_CHANGED", 409],
    [400, "CAPABILITY_CATALOG_CURSOR_INVALID", 400],
    [401, "S2S_TOKEN_INVALID", 502],
    [403, "CALLER_CATALOG_FORBIDDEN", 502],
    [503, "CAPABILITY_CATALOG_UNAVAILABLE", 502],
  ])(
    "maps upstream %s %s to %s without exposing its message",
    async (status, code, expected) => {
      upstreamStatus = status as number;
      upstreamBody = { code, message: "SECRET", token: "SECRET" };
      const response = await read();
      expect(response.status).toBe(expected);
      expect(await response.text()).not.toContain("SECRET");
    },
  );
  it.each([
    null,
    [],
    { items: [], total: -1, nextCursor: null, version },
    { items: [metadata, metadata], total: 2, nextCursor: null, version },
    { items: [metadata], total: 1, nextCursor: null },
    { items: [], total: 2, nextCursor: "cursor", version },
  ])("rejects malformed success body %#", async (body) => {
    upstreamBody = body;
    expect((await read()).status).toBe(502);
  });
  it("rejects invalid JSON and redirects", async () => {
    rawBody = "not json";
    expect((await read()).status).toBe(502);
    upstreamStatus = 302;
    expect((await read()).status).toBe(503);
  });
  it("fails closed without a service token", async () => {
    exchange.getToken.mockResolvedValue(null);
    expect((await read()).status).toBe(503);
    expect(received).toEqual([]);
  });
  it("sanitizes token exchange failures", async () => {
    exchange.getToken.mockRejectedValue(new Error("SECRET"));
    const response = await read();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SECRET");
    expect(received).toEqual([]);
  });
});
