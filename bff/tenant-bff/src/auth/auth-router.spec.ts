/**
 * HTTP regressions for login issuance, replay protection and live member revocation.
 * @package @vxture/bff-tenant
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-15
 */
import "reflect-metadata";
import {
  ForbiddenException,
  Module,
  NotFoundException,
  type INestApplication,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CustomerPortalService,
  DEFAULT_CONFIGURATION,
  PortalAccessService,
  type PublishedPortal,
} from "@vxture/service-customer-portal"; // ⚠️ 跨层引用: exercise the actual domain authorization boundary.
import type { Pool } from "pg";
import { configureHttp } from "../bootstrap";
import { PortalGateway } from "../gateway";
import { PortalRouter } from "../portal-router";
import { AuthRouter } from "./auth-router";
import { PortalOidcClient } from "./oidc-client";
import { SessionStore, type Session } from "./session-store";

const USER = "00000000-0000-4000-8000-000000000001";
const ORG = "00000000-0000-4000-8000-000000000002";
const SPACE = "00000000-0000-4000-8000-000000000003";
const CLIENT = "customer-portal";
const PROXY = "z".repeat(48);
const SID = "central-session";
const binding: PublishedPortal = {
  id: "portal-a",
  hostname: "a.ruyin.work",
  tenantId: ORG,
  workspaceId: SPACE,
  versionId: "published",
  configuration: DEFAULT_CONFIGURATION,
};
let app: INestApplication, member: boolean, org: string, dbError: boolean;
const states = new Map<string, string>();
const sessions = new Map<string, Session>();
const cookie = (res: Response) =>
  res.headers
    .getSetCookie()
    .filter((x) => !/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(x))
    .map((x) => x.split(";", 1)[0])
    .join("; ");
const expiry = () => Math.floor(Date.now() / 1000) + 3600;

beforeEach(async () => {
  states.clear();
  sessions.clear();
  member = true;
  org = ORG;
  dbError = false;
  const redis = {
    setex: async (key: string, _ttl: number, value: string) => {
      states.set(key, value);
    },
    get: async (key: string) => states.get(key) ?? null,
    getdel: async (key: string) => {
      const value = states.get(key);
      states.delete(key);
      return value ?? null;
    },
  } as unknown as Redis;
  const pool = { query: vi.fn() } as unknown as Pool;
  const portals = new CustomerPortalService(pool);
  const access = new PortalAccessService(pool);
  vi.spyOn(portals, "published").mockImplementation(async (hostname) => {
    if (hostname === binding.hostname) return binding;
    if (hostname === "robot01.ruyin.work")
      return { ...binding, id: "portal-b", hostname };
    throw new NotFoundException();
  });
  vi.spyOn(portals, "applications").mockResolvedValue([]);
  const assertMember = access.assertMember.bind(access);
  vi.spyOn(access, "assertMember").mockImplementation(async (portal, user) => {
    if (dbError) throw new Error("Database unavailable");
    if (!member) throw new ForbiddenException();
    if (
      user.activeOrg !== portal.tenantId ||
      user.activeWorkspace !== portal.workspaceId
    )
      return assertMember(portal, user);
    return { name: "Researcher", workspaceName: "Default" };
  });
  vi.spyOn(PortalOidcClient.prototype, "exchangeCode").mockResolvedValue({
    idToken: "id",
    accessToken: "access",
    refreshToken: "refresh",
    accessExpiresAt: expiry(),
  });
  vi.spyOn(PortalOidcClient.prototype, "verifyIdToken").mockResolvedValue({
    sub: `usr_${USER}`,
    sid: SID,
    aud: CLIENT,
    iss: "https://auth.example",
    exp: expiry(),
  });
  vi.spyOn(PortalOidcClient.prototype, "verifyAccessToken").mockImplementation(
    async () => ({
      sub: `usr_${USER}`,
      sid: SID,
      exp: expiry(),
      userType: "tenant_user",
      account_status: "active",
      active_org: org,
      active_workspace: SPACE,
      roles: ["workspace:member"],
    }),
  );
  vi.spyOn(PortalOidcClient.prototype, "centralStatus").mockResolvedValue({
    valid: true,
    nextCheckAt: expiry(),
  });
  vi.spyOn(SessionStore.prototype, "create").mockImplementation(async function (
    this: SessionStore,
    id,
    session,
  ) {
    sessions.set(this.key(id), session);
  });
  vi.spyOn(SessionStore.prototype, "read").mockImplementation(async function (
    this: SessionStore,
    id,
  ) {
    const session = sessions.get(this.key(id));
    return session ? { raw: JSON.stringify(session), session } : null;
  });
  vi.spyOn(SessionStore.prototype, "destroy").mockImplementation(
    async function (this: SessionStore, id) {
      sessions.delete(this.key(id));
    },
  );
  @Module({
    controllers: [AuthRouter, PortalRouter],
    providers: [
      {
        provide: PortalGateway,
        useValue: new PortalGateway(
          {
            port: 0,
            databaseUrl: "",
            redisUrl: "",
            proxyToken: PROXY,
            oidc: {
              issuer: "https://auth.example",
              clientId: CLIENT,
              clientSecret: "fixture",
              scopes: ["openid"],
              sessionTtlSec: 3600,
            },
          },
          redis,
          portals,
          access,
        ),
      },
    ],
  })
  class AppModule {}
  app = await NestFactory.create(AppModule, {
    logger: false,
    bodyParser: false,
  });
  configureHttp(app);
  await app.listen(0, "127.0.0.1");
});
afterEach(async () => {
  await app?.close();
  vi.restoreAllMocks();
});

// ============================================================================
// Exercise the real HTTP controller, retaining only infrastructure test doubles
// ============================================================================
const request = async (
  path: string,
  session = "",
  host = binding.hostname,
  proxy = PROXY,
) =>
  fetch(`${await app.getUrl()}${path}`, {
    redirect: "manual",
    headers: {
      "x-customer-portal-host": host,
      "x-customer-portal-token": proxy,
      cookie: session,
    },
  });
async function begin() {
  const response = await request("/auth/login");
  expect(response.status).toBe(302);
  const auth = new URL(response.headers.get("location")!);
  expect(auth.searchParams.get("tenant_hint")).toBe(ORG);
  expect(auth.searchParams.get("workspace_hint")).toBe(SPACE);
  expect(auth.searchParams.get("redirect_uri")).toBe(
    "https://a.ruyin.work/auth/callback",
  );
  return {
    path: `/auth/callback?state=${auth.searchParams.get("state")}&code=ok`,
    cookie: cookie(response),
  };
}

describe("customer portal private access", () => {
  it("issues a secure host-only session for a member and blocks cross-host replay", async () => {
    const start = await begin();
    expect(
      (await request(start.path, start.cookie, "robot01.ruyin.work")).status,
    ).toBe(400);
    const response = await request(start.path, start.cookie);
    expect(response.status).toBe(302);
    const session = cookie(response);
    expect(session).toMatch(/^__Host-vx_customer_portal_session=/);
    const set = response.headers
      .getSetCookie()
      .find((x) => x.startsWith(session));
    expect(set).toMatch(/Secure/i);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).not.toMatch(/Domain=/i);
    expect((await request("/api/portal/workspace", session)).status).toBe(200);
    expect(
      (await request("/api/portal/workspace", session, "robot01.ruyin.work"))
        .status,
    ).toBe(401);
    expect((await request(start.path, start.cookie)).status).toBe(400);
  });
  it("blocks an IdP fallback context and a nonmember before setting a session", async () => {
    org = "00000000-0000-4000-8000-000000000099";
    let start = await begin();
    expect((await request(start.path, start.cookie)).status).toBe(403);
    org = ORG;
    member = false;
    start = await begin();
    expect((await request(start.path, start.cookie)).status).toBe(403);
    expect(sessions.size).toBe(0);
  });
  it("revokes an issued session when membership is removed", async () => {
    const start = await begin();
    const session = cookie(await request(start.path, start.cookie));
    member = false;
    expect((await request("/api/portal/workspace", session)).status).toBe(403);
    expect(sessions.size).toBe(0);
    member = true;
    expect((await request("/auth/session", session)).status).toBe(401);
  });
  it("fails closed for missing authentication, unknown hosts and database outages", async () => {
    expect((await request("/api/portal/workspace")).status).toBe(401);
    expect(
      (await request("/auth/login", "", "unbound.ruyin.work")).status,
    ).toBe(404);
    expect(
      (await request("/auth/login", "", binding.hostname, "invalid")).status,
    ).toBe(403);
    const start = await begin();
    dbError = true;
    expect((await request(start.path, start.cookie)).status).toBe(503);
    expect(sessions.size).toBe(0);
  });
});
