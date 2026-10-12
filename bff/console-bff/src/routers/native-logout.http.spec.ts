/**
 * native-logout.http.spec.ts - Native RP logout contracts over real HTTP.
 * @package @vxture/bff-console
 * @layer Application
 * @category Test
 * @description
 *   Exercises Nest routing, the global capability guard, and the real RP store
 *   against an in-memory Redis adapter. No IdP or external Redis is contacted.
 * @author AI-Generated
 * @date 2026-10-12
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
// ⚠️ 跨层引用: Exercise the infrastructure session store used by the BFF.
import {
  randomToken,
  rpSessionCookieName,
  RpSessionStore,
  type RpRedis,
  type RpSession,
} from "@vxture/core-oidc-rp";
import cookieParser from "cookie-parser";
import { request } from "node:http";
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
import { CapabilityGuard } from "../auth/capability";
import {
  RP_AUTH_SERVICE,
  RP_OIDC_CLIENT,
  RP_REDIS,
  RP_RUNTIME,
  RP_SESSION_STORE,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import { NativeAuthRouter } from "./native-auth.router";
import { OidcAuthRouter } from "./oidc-auth.router";

// ============================================================================
// Session storage and HTTP application
// ============================================================================

const PREFIX = "logout-spec:";
const SID = "central-session";
const NATIVE = randomToken();
const BROWSER = randomToken();
const OTHER_NATIVE = randomToken();
const COOKIE = rpSessionCookieName(true, "console");
const PATHS = ["/auth/native/logout", "/auth/logout"] as const;
const values = new Map<string, string>();
const members = new Map<string, Set<string>>();

const redis = {
  get: vi.fn(async (key: string) => values.get(key) ?? null),
  setex: vi.fn(async (key: string, _ttl: number, value: string) => {
    values.set(key, value);
    return "OK";
  }),
  del: vi.fn(async (...keys: string[]) => {
    for (const key of keys) {
      values.delete(key);
      members.delete(key);
    }
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
  getdel: vi.fn(async (key: string) => {
    const value = values.get(key) ?? null;
    values.delete(key);
    return value;
  }),
} satisfies RpRedis & { getdel(key: string): Promise<string | null> };

const store = new RpSessionStore(redis, "console", PREFIX);
const websiteStore = new RpSessionStore(redis, "website", PREFIX);
const session: RpSession = {
  sid: SID,
  sub: "usr_logout-spec",
  idToken: "test-id-token",
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  // An expired access token must not prevent local logout or trigger refresh.
  accessExpiresAt: 1,
};
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
const resolve = vi.fn(async () => {
  throw new Error("Logout must not resolve or refresh session tokens");
});
const buildEndSessionUrl = vi.fn(
  (_input: { postLogoutRedirectUri: string; state: string }) =>
    "https://accounts.spec.local/end-session",
);

@Module({
  controllers: [OidcAuthRouter, NativeAuthRouter],
  providers: [
    { provide: RP_SESSION_STORE, useValue: store },
    { provide: RP_REDIS, useValue: redis },
    { provide: RP_RUNTIME, useValue: rt },
    { provide: RP_AUTH_SERVICE, useValue: { resolve } },
    { provide: RP_OIDC_CLIENT, useValue: { buildEndSessionUrl } },
    { provide: APP_GUARD, useClass: CapabilityGuard },
  ],
})
class LogoutSpecModule {}

let app: INestApplication;
let base: string;

beforeAll(async () => {
  app = await NestFactory.create(LogoutSpecModule, { logger: false });
  app.use(cookieParser());
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  values.clear();
  members.clear();
  vi.clearAllMocks();
  await store.create(NATIVE, session, 3600);
  await store.create(BROWSER, session, 3600);
  await store.create(OTHER_NATIVE, session, 3600);
  await websiteStore.create(NATIVE, session, 3600);
});

// ============================================================================
// Native logout and legacy POST compatibility
// ============================================================================

describe.each(PATHS)("POST %s", (path) => {
  it("destroys the header session and its tokens while preserving other sessions", async () => {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "X-Vxture-Session": NATIVE,
        Cookie: `${COOKIE}=${BROWSER}`,
      },
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await store.get(NATIVE)).toBeNull();
    expect(await store.get(BROWSER)).toEqual(session);
    expect(await store.get(OTHER_NATIVE)).toEqual(session);
    expect(await websiteStore.get(NATIVE)).toEqual(session);
    expect(await redis.smembers(`${PREFIX}rp:console:sididx:${SID}`)).toEqual([
      BROWSER,
      OTHER_NATIVE,
    ]);
    expect(resolve).not.toHaveBeenCalled();
    expect(buildEndSessionUrl).not.toHaveBeenCalled();
  });

  it("is idempotent for repeated, unknown, or already expired RP sessions", async () => {
    for (const id of [NATIVE, NATIVE, randomToken()]) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "X-Vxture-Session": id },
      });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(buildEndSessionUrl).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "   ", `${NATIVE},${BROWSER}`, `${NATIVE} extra`])(
    "rejects missing, empty, or ambiguous header %s without touching storage",
    async (header) => {
      const response = await fetch(`${base}${path}?rpsid=${NATIVE}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${COOKIE}=${BROWSER}`,
          ...(header === undefined ? {} : { "X-Vxture-Session": header }),
        },
        body: JSON.stringify({ rpsid: NATIVE }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "NATIVE_SESSION_HEADER_INVALID",
        retryable: false,
      });
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
      expect(await store.get(NATIVE)).toEqual(session);
      expect(await store.get(BROWSER)).toEqual(session);
      expect(resolve).not.toHaveBeenCalled();
      expect(buildEndSessionUrl).not.toHaveBeenCalled();
    },
  );

  it("rejects duplicate physical headers even when both identify the same session", async () => {
    const status = await new Promise<number>((accept, reject) => {
      const outgoing = request(
        `${base}${path}`,
        { method: "POST", headers: { "X-Vxture-Session": [NATIVE, NATIVE] } },
        (response) => {
          response.resume();
          response.on("end", () => accept(response.statusCode ?? 0));
          response.on("error", reject);
        },
      );
      outgoing.on("error", reject);
      outgoing.end();
    });
    expect(status).toBe(400);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it.each(["get", "del", "srem"] as const)(
    "returns a retryable failure when storage %s fails, then permits retry",
    async (operation) => {
      redis[operation].mockRejectedValueOnce(new Error("Storage unavailable"));
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "X-Vxture-Session": NATIVE },
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "NATIVE_LOGOUT_UNAVAILABLE",
        retryable: true,
      });
      expect(buildEndSessionUrl).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
      const retry = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "X-Vxture-Session": NATIVE },
      });
      expect(retry.status).toBe(204);
      expect(await store.get(NATIVE)).toBeNull();
      expect(await store.get(BROWSER)).toEqual(session);
    },
  );
});

// ============================================================================
// Browser logout and existing native claim boundaries
// ============================================================================

describe("Browser and native route boundaries", () => {
  it.each(["logout", "switch"])(
    "keeps GET /auth/%s on the cookie-based central logout flow",
    async (path) => {
      const response = await fetch(`${base}/auth/${path}`, {
        redirect: "manual",
        headers: { Cookie: `${COOKIE}=${BROWSER}`, "X-Vxture-Session": NATIVE },
      });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "https://accounts.spec.local/end-session",
      );
      expect(response.headers.get("set-cookie")).toContain(`${COOKIE}=;`);
      expect(await store.get(BROWSER)).toBeNull();
      expect(await store.get(NATIVE)).toEqual(session);
      expect(buildEndSessionUrl).toHaveBeenCalledTimes(1);
      const target = new URL(
        buildEndSessionUrl.mock.calls[0]?.[0]?.postLogoutRedirectUri ?? "",
      );
      expect(target.searchParams.get("mode")).toBe(
        path === "logout" ? "signout" : "switch",
      );
    },
  );

  it("does not expose a GET native logout or an unprefixed native claim", async () => {
    expect((await fetch(`${base}/auth/native/logout`)).status).toBe(404);
    expect((await fetch(`${base}/auth/claim`, { method: "POST" })).status).toBe(
      404,
    );
    expect(await store.get(NATIVE)).toEqual(session);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("keeps native claim reachable through the global capability guard", async () => {
    const response = await fetch(`${base}/auth/native/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSecret: "a".repeat(64) }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NATIVE_NOT_READY" });
    expect(redis.getdel).toHaveBeenCalledTimes(1);
  });
});
