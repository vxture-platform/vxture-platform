/**
 * Portal SSO entry over Nest HTTP with an injected verified-claims adapter.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { RpSession } from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: test the RP boundary without exposing tokens.
import { OidcAuthRouter } from "./oidc-auth.router";
import {
  RP_AUTH_SERVICE,
  RP_OIDC_CLIENT,
  RP_REDIS,
  RP_RUNTIME,
  RP_SESSION_STORE,
} from "../oidc/oidc-rp.tokens";

// ============================================================================
// HTTP composition; JWT cryptography is delegated to the shared OIDC client.
// ============================================================================
const USER = "00000000-0000-4000-8000-000000000001";
const ORG = "00000000-0000-4000-8000-000000000002";
const WORKSPACE = "00000000-0000-4000-8000-000000000003";
const OTHER = "00000000-0000-4000-8000-000000000099";
const COOKIE = "__Host-vx_rp_session_console";
const pending = new Map<string, string>();
const sessions = new Map<string, RpSession>();
let access: Record<string, unknown>;
let subject: string;
const tokens = {
  idToken: "private-id",
  accessToken: "private-access",
  refreshToken: "private-refresh",
  accessExpiresAt: 9999999999,
};
const client = {
  buildAuthorizeUrl: vi.fn(
    (input: {
      state: string;
      nonce: string;
      prompt?: string;
      tenantHint?: string;
      workspaceHint?: string;
    }) => {
      const url = new URL("https://accounts.spec.local/oidc/authorize");
      url.searchParams.set("state", input.state);
      url.searchParams.set("nonce", input.nonce);
      if (input.tenantHint)
        url.searchParams.set("tenant_hint", input.tenantHint);
      if (input.workspaceHint)
        url.searchParams.set("workspace_hint", input.workspaceHint);
      if (input.prompt) url.searchParams.set("prompt", input.prompt);
      return url.href;
    },
  ),
  exchangeCode: vi.fn(async () => tokens),
  verifyIdToken: vi.fn(async () => ({
    sub: subject,
    sid: "central",
    exp: 9999999999,
  })),
  verifyAccessToken: vi.fn(async () => access),
};
@Module({
  controllers: [OidcAuthRouter],
  providers: [
    { provide: RP_OIDC_CLIENT, useValue: client },
    { provide: RP_AUTH_SERVICE, useValue: {} },
    {
      provide: RP_SESSION_STORE,
      useValue: {
        get: async (id: string) => sessions.get(id) ?? null,
        create: async (id: string, value: RpSession) => {
          sessions.set(id, value);
        },
        destroy: async (id: string) => {
          sessions.delete(id);
        },
      },
    },
    {
      provide: RP_REDIS,
      useValue: {
        get: async (key: string) => pending.get(key) ?? null,
        setex: async (key: string, _ttl: number, value: string) => {
          pending.set(key, value);
        },
        getdel: async (key: string) => {
          const value = pending.get(key);
          pending.delete(key);
          return value ?? null;
        },
      },
    },
    {
      provide: RP_RUNTIME,
      useValue: {
        config: { clientId: "console", sessionTtlSec: 3600 },
        cookieSecure: true,
        keyPrefix: "portal-spec:",
        allowedReturnOrigins: ["https://console.spec.local"],
        defaultReturnTo: "https://console.spec.local/",
      },
    },
  ],
})
class PortalSpecModule {}
let app: INestApplication;
let base: string;
beforeAll(async () => {
  app = await NestFactory.create(PortalSpecModule, { logger: false });
  app.use(cookieParser());
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
});
beforeEach(() => {
  pending.clear();
  sessions.clear();
  vi.clearAllMocks();
  subject = `usr_${USER}`;
  access = {
    sub: subject,
    sid: "central",
    userType: "tenant_user",
    account_status: "active",
    active_org: ORG,
    active_workspace: WORKSPACE,
    roles: ["workspace:member"],
  };
});
function request(path: string, cookie = "") {
  return fetch(`${base}${path}`, { redirect: "manual", headers: { cookie } });
}
function startPath(extra = "") {
  return `/auth/login?surface=portal&userId=${USER}&tenantId=${ORG}&workspaceId=${WORKSPACE}${extra}`;
}
async function begin(extra = "", cookie = "") {
  const response = await request(startPath(extra), cookie);
  expect(response.status).toBe(302);
  const url = new URL(response.headers.get("location")!);
  return {
    response,
    url,
    callback: `/auth/callback?code=code&state=${url.searchParams.get("state")}`,
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  };
}

// ============================================================================
// Successful continuation, account mismatch, fallback rejection, and replay
// ============================================================================
describe("portal entry", () => {
  it("reuses central SSO without a forced prompt and preserves exact scope and destination", async () => {
    const start = await begin(
      "&returnTo=https%3A%2F%2Fconsole.spec.local%2Fzh-CN%2Fbilling",
    );
    expect(start.url.searchParams.get("tenant_hint")).toBe(ORG);
    expect(start.url.searchParams.get("workspace_hint")).toBe(WORKSPACE);
    expect(start.url.searchParams.has("prompt")).toBe(false);
    expect(start.response.headers.get("set-cookie")).toMatch(
      /HttpOnly.*Secure.*SameSite=Lax/,
    );
    const response = await request(start.callback, start.cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://console.spec.local/zh-CN/billing",
    );
    expect(sessions.size).toBe(1);
    expect([...sessions.values()][0]).toMatchObject({
      sub: `usr_${USER}`,
      activeOrg: ORG,
    });
    expect(response.headers.get("set-cookie")).not.toContain("private-");
    expect((await request(start.callback, start.cookie)).status).toBe(400);
  });
  it("requires the initiating browser without consuming a stolen request", async () => {
    const start = await begin();
    expect((await request(start.callback)).status).toBe(400);
    expect(client.exchangeCode).not.toHaveBeenCalled();
    expect((await request(start.callback, start.cookie)).status).toBe(302);
  });
  it("keeps concurrent tabs' bindings separate", async () => {
    const first = await begin();
    const second = await begin();
    expect((await request(first.callback, second.cookie)).status).toBe(400);
    expect((await request(first.callback, first.cookie)).status).toBe(302);
  });
  it.each([
    { active_org: OTHER },
    { active_workspace: OTHER },
    { roles: ["org:owner"] },
    { sub: `usr_${OTHER}` },
    { userType: "operator" },
    { account_status: "suspended" },
    { sid: "other-central" },
  ])("rejects a fallback or mismatched verified context %j", async (patch) => {
    const start = await begin();
    access = { ...access, ...patch };
    expect((await request(start.callback, start.cookie)).status).toBe(403);
    expect(sessions.size).toBe(0);
  });
  it("rejects a different central account", async () => {
    const start = await begin();
    subject = `usr_${OTHER}`;
    expect((await request(start.callback, start.cookie)).status).toBe(403);
    expect(sessions.size).toBe(0);
  });
  it.each(["before", "during"])(
    "preserves another target account established %s authorization",
    async (when) => {
      const old = { ...tokens, sid: "old-central", sub: `usr_${OTHER}` };
      if (when === "before") {
        sessions.set("old", old);
        expect((await request(startPath(), `${COOKIE}=old`)).status).toBe(409);
        expect(pending.size).toBe(0);
      } else {
        const start = await begin();
        sessions.set("old", old);
        expect(
          (await request(start.callback, `${start.cookie}; ${COOKIE}=old`))
            .status,
        ).toBe(409);
      }
      expect(sessions.get("old")).toEqual(old);
    },
  );
  it("does not redirect off origin", async () => {
    const start = await begin("&returnTo=https%3A%2F%2Fevil.invalid");
    expect(
      (await request(start.callback, start.cookie)).headers.get("location"),
    ).toBe("https://console.spec.local/");
  });
  it.each([
    `&userId=${OTHER}`,
    `&tenantId=${OTHER}`,
    `&workspaceId=${OTHER}`,
    "&userId[]=x",
    "&prompt=none",
    "&handle=bad",
  ])("rejects ambiguous or mixed input %s", async (extra) => {
    expect((await request(startPath(extra))).status).toBe(400);
    expect(pending.size).toBe(0);
  });
});
