/**
 * HTTP authentication, validation and fault semantics for central-session status.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-10-21
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { VxConfigService } from "@vxture/core-config";
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
import { OidcService } from "../oidc/oidc.service";
import { AllExceptionsFilter } from "../filters/all-exceptions.filter";
import { OidcRouter } from "./oidc.router";

// ── Real routing and orchestration; repository/store boundaries are doubles ──

const clients = {
  findEnabledByClientId: vi.fn(async (clientId: string) => {
    if (clientId === "disabled" || clientId === "unknown") return null;
    return {
      clientId,
      realm: clientId === "admin" ? "workforce" : "customer",
      tokenEndpointAuthMethod:
        clientId === "public" ? "none" : "client_secret_basic",
    };
  }),
  authenticateClient: vi.fn(async (clientId: string, secret: string) =>
    secret === "test-secret" ||
    (clientId === "special client" && secret === "s:+% value")
      ? {
          clientId,
          realm: clientId === "admin" ? "workforce" : "customer",
          tokenEndpointAuthMethod: "client_secret_basic",
        }
      : null,
  ),
};
const redis = { checkOidcSessionStatus: vi.fn() };
const service = Object.assign(
  Object.create(OidcService.prototype) as OidcService,
  {
    clients,
    redis,
  },
);
@Module({
  controllers: [OidcRouter],
  providers: [
    { provide: OidcService, useValue: service },
    { provide: VxConfigService, useValue: {} },
  ],
})
class StatusTestModule {}

let app: INestApplication;
let base: string;
const basic = (id = "yucer", secret = "test-secret") =>
  `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64")}`;
const post = (
  body: unknown = { sid: "session-test", active: false },
  authorization: string | null = basic(),
  suffix = "",
) =>
  fetch(`${base}/oidc/session/status${suffix}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization === null ? {} : { Authorization: authorization }),
    },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  app = await NestFactory.create(StatusTestModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  redis.checkOidcSessionStatus
    .mockReset()
    .mockResolvedValue({ valid: true, next_check_at: 1800000300 });
});

// ── Credential and request gates ──

describe("central session status HTTP", () => {
  it.each([
    null,
    "Bearer token",
    "Basic !!!",
    "Basic YTo=",
    "Basic YTo",
    `Basic ${Buffer.from("no-colon").toString("base64")}`,
    `Basic ${Buffer.from("%ZZ:secret").toString("base64")}`,
  ])(
    "rejects unsupported/malformed authentication %s",
    async (authorization) => {
      const res = await post(undefined, authorization);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe(
        'Basic realm="accounts"',
      );
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(await res.json()).toEqual({
        code: "INVALID_CLIENT",
        message: expect.any(String),
        retryable: false,
      });
      expect(redis.checkOidcSessionStatus).not.toHaveBeenCalled();
    },
  );

  it.each([
    basic("unknown"),
    basic("disabled"),
    basic("yucer", "wrong"),
    basic("public"),
    basic("public", ""),
  ])(
    "rejects unknown, disabled, public and wrong-secret clients",
    async (authorization) => {
      const res = await post(undefined, authorization);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "INVALID_CLIENT" });
      expect(redis.checkOidcSessionStatus).not.toHaveBeenCalled();
    },
  );

  it("does not accept Cookie or body credentials as authentication", async () => {
    const res = await fetch(`${base}/oidc/session/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "vx_sid=session-test; rpsid=local",
        "x-vxture-internal-auth": "shared-secret",
      },
      body: JSON.stringify({
        sid: "session-test",
        active: false,
        client_id: "yucer",
        client_secret: "test-secret",
      }),
    });
    expect(res.status).toBe(401);
    expect(clients.findEnabledByClientId).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    {},
    { sid: "x" },
    { sid: "x", active: "false" },
    { sid: 1, active: false },
    { sid: "", active: false },
    { sid: "x".repeat(129), active: false },
    { sid: "../x", active: false },
    { sid: "x", active: false, workspace_id: "other" },
    { sid: "x", active: false, client_id: "other" },
  ])("rejects malformed/selector request %j", async (body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    // Express rejects a JSON scalar before the controller is entered.
    if (body !== null)
      expect(await res.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(redis.checkOidcSessionStatus).not.toHaveBeenCalled();
  });

  it("rejects URL selectors and form bodies", async () => {
    expect((await post(undefined, basic(), "?sid=other")).status).toBe(400);
    const res = await fetch(`${base}/oidc/session/status`, {
      method: "POST",
      headers: {
        Authorization: basic(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "sid=session-test&active=false",
    });
    expect(res.status).toBe(400);
    expect(redis.checkOidcSessionStatus).not.toHaveBeenCalled();
  });

  // ── Status projection and unavailable authority ──

  it.each([
    ["yucer", "customer", false],
    ["admin", "workforce", true],
  ] as const)(
    "derives identity and realm for %s",
    async (id, realm, active) => {
      const res = await post({ sid: "session-test", active }, basic(id));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        valid: true,
        next_check_at: 1800000300,
      });
      expect(redis.checkOidcSessionStatus).toHaveBeenCalledWith(
        "session-test",
        id,
        realm,
        active,
      );
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("pragma")).toBe("no-cache");
      expect(res.headers.get("set-cookie")).toBeNull();
    },
  );

  it("decodes OAuth Basic form-encoded values safely", async () => {
    expect(
      (await post(undefined, basic("special client", "s:+% value"))).status,
    ).toBe(200);
    expect(clients.authenticateClient).toHaveBeenCalledWith(
      "special client",
      "s:+% value",
    );
  });

  it("returns only valid:false for an ended or unbound session", async () => {
    redis.checkOidcSessionStatus.mockResolvedValueOnce({ valid: false });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false });
  });

  it.each(["repository", "redis"])(
    "preserves identity uncertainty on %s failure",
    async (boundary) => {
      if (boundary === "repository")
        clients.findEnabledByClientId.mockRejectedValueOnce(
          new Error("database down"),
        );
      else
        redis.checkOidcSessionStatus.mockRejectedValueOnce(
          new Error("store down"),
        );
      const res = await post();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        code: "SESSION_STATUS_UNAVAILABLE",
        message: expect.any(String),
        retryable: true,
      });
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    },
  );
});
