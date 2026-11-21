/**
 * operator-stepup.service.spec.ts - IdP status propagation and safe cookie issuance.
 * @package @vxture/bff-admin
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import "reflect-metadata";
import { HttpException, Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import type {
  NextFunction,
  Request,
  Response as ExpressResponse,
} from "express";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
// ⚠️ 跨层引用: The test supplies only the public configuration type.
import type { VxConfigService } from "@vxture/core-config";
import { RP_RUNTIME } from "../oidc/oidc-rp.tokens";
import { OperatorStepUpRouter } from "../routers/operator-stepup.router";
import type { RequestContext } from "../types/console.types";
import { OperatorStepUpService } from "./operator-stepup.service";

// ===========================================================================
// All IdP traffic is replaced; native fetch reaches only this test's local HTTP.
// ===========================================================================
const OPERATOR = "11111111-1111-4111-8111-111111111111";
const nativeFetch = globalThis.fetch;
const upstream = vi.fn<typeof fetch>();
const config = { auth: { IDP_INTERNAL_TOKEN: "isolated-internal-token" } };
const service = new OperatorStepUpService(config as unknown as VxConfigService);
let app: INestApplication | undefined, base: string;

beforeEach(() => {
  vi.stubEnv("OIDC_BACKCHANNEL_ISSUER", "https://idp.invalid/");
  vi.stubGlobal("fetch", upstream);
  upstream.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeAll(async () => {
  @Module({
    controllers: [OperatorStepUpRouter],
    providers: [
      { provide: OperatorStepUpService, useValue: service },
      { provide: RP_RUNTIME, useValue: { cookieSecure: true } },
    ],
  })
  class TestModule {}
  app = await NestFactory.create(TestModule, { logger: false });
  app.use(
    (
      req: Request & RequestContext,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      req.operatorSessionHash = "a".repeat(64);
      req.capabilities = ["promotion:campaign.manage"];
      req.user = {
        id: OPERATOR,
        name: "test",
        email: "",
        roleLabel: "",
        roleCode: "",
        roleI18nKey: "",
        roleNameEn: "",
      };
      next();
    },
  );
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app?.close();
});

// ===========================================================================
// Preserve authorization failures and bounded waiting information.
// ===========================================================================
describe("operator step-up client", () => {
  it("delegates with the dedicated internal secret and the authenticated operator", async () => {
    upstream.mockResolvedValue(
      Response.json({ stepUpToken: "signed", expiresIn: 300 }),
    );
    expect(await service.requestTotpStepUp(OPERATOR, "123456")).toEqual({
      stepUpToken: "signed",
      expiresIn: 300,
    });
    expect(upstream).toHaveBeenCalledWith(
      "https://idp.invalid/internal/operator/stepup/totp",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vxture-internal-auth": "isolated-internal-token",
        },
        body: JSON.stringify({ operatorId: OPERATOR, code: "123456" }),
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("preserves 429 and its bounded retry time", async () => {
    upstream.mockResolvedValue(
      Response.json(
        { retryAfter: 42, message: "untrusted upstream details" },
        { status: 429 },
      ),
    );
    const error = await service
      .requestTotpStepUp(OPERATOR, "123456")
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toEqual({
      message: "too_many_attempts; retry after 42s",
      retryAfter: 42,
    });
  });

  it.each([
    undefined,
    null,
    "42",
    -1,
    0,
    0.5,
    901,
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    "retains 429 with a conservative wait for invalid retryAfter %j",
    async (retryAfter) => {
      upstream.mockResolvedValue(
        Response.json({ retryAfter }, { status: 429 }),
      );
      const error = await service
        .requestTotpStepUp(OPERATOR, "123456")
        .catch((value: unknown) => value);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toEqual({
        message: "too_many_attempts; retry after 900s",
        retryAfter: 900,
      });
    },
  );

  it("does not expose a non-JSON upstream error body", async () => {
    upstream.mockResolvedValue(
      new Response("sensitive upstream text", { status: 429 }),
    );
    await expect(service.requestTotpStepUp(OPERATOR, "123456")).rejects.toThrow(
      "too_many_attempts; retry after 900s",
    );
  });

  it("preserves invalid-MFA 401", async () => {
    upstream.mockResolvedValue(new Response(null, { status: 401 }));
    const error = await service
      .requestTotpStepUp(OPERATOR, "123456")
      .catch((value: unknown) => value);
    expect((error as HttpException).getStatus()).toBe(401);
  });

  it.each([500, 503])("fails closed for upstream %i", async (status) => {
    upstream.mockResolvedValue(new Response(null, { status }));
    await expect(service.requestTotpStepUp(OPERATOR, "123456")).rejects.toThrow(
      "operator_stepup_failed",
    );
  });

  it("fails closed when the IdP cannot be reached", async () => {
    upstream.mockRejectedValue(new Error("offline"));
    await expect(service.requestTotpStepUp(OPERATOR, "123456")).rejects.toThrow(
      "operator_stepup_unavailable",
    );
  });

  it("returns 429 without setting a cookie over real HTTP", async () => {
    upstream.mockResolvedValue(
      Response.json({ retryAfter: 17 }, { status: 429 }),
    );
    const response = await nativeFetch(`${base}/api/operator/step-up/totp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      message: "too_many_attempts; retry after 17s",
      retryAfter: 17,
    });
  });

  it("retains the secure five-minute cookie on a successful exchange", async () => {
    upstream.mockResolvedValue(
      Response.json({ stepUpToken: "signed", expiresIn: 300 }),
    );
    const response = await nativeFetch(`${base}/api/operator/step-up/totp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, expiresIn: 300 });
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-vx_op_stepup=signed",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=300");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it.each([
    null,
    {},
    { stepUpToken: 42, expiresIn: 300 },
    ...[undefined, null, "300", 0, -1, 0.5, 301].map((expiresIn) => ({
      stepUpToken: "signed",
      expiresIn,
    })),
  ])(
    "rejects invalid credential response %j without setting a cookie",
    async (body) => {
      upstream.mockResolvedValue(Response.json(body));
      const response = await nativeFetch(`${base}/api/operator/step-up/totp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456" }),
      });
      expect(response.status).toBe(503);
      expect(response.headers.get("set-cookie")).toBeNull();
      await response.json();
    },
  );
});

// ===========================================================================
// Per-action credentials use a separate cookie and trusted session binding.
// ===========================================================================
describe("action step-up client", () => {
  const action = { requestHash: "b".repeat(64), sessionHash: "a".repeat(64) };
  it("forwards the bound action to the IdP", async () => {
    upstream.mockResolvedValue(
      Response.json({ stepUpToken: "signed", expiresIn: 300 }),
    );
    await service.requestTotpStepUp(OPERATOR, "123456", action);
    expect(JSON.parse(String(upstream.mock.calls[0]![1]!.body))).toEqual({
      operatorId: OPERATOR,
      code: "123456",
      action,
    });
  });
  it("sets only the action cookie, deriving the session from authenticated context", async () => {
    upstream.mockResolvedValue(
      Response.json({ stepUpToken: "bound", expiresIn: 300 }),
    );
    const response = await nativeFetch(`${base}/api/operator/step-up/totp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "123456",
        action: {
          requestHash: action.requestHash,
          sessionHash: "untrusted",
          action: "创建批次",
          target: "新批次",
        },
      }),
    });
    expect(response.status).toBe(200);
    await response.json();
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-vx_op_action=bound",
    );
    expect(response.headers.get("set-cookie")).not.toContain(
      "__Host-vx_op_stepup=",
    );
    expect(JSON.parse(String(upstream.mock.calls[0]![1]!.body)).action).toEqual(
      action,
    );
  });
  it("preserves the mandatory passkey rejection", async () => {
    upstream.mockResolvedValue(
      Response.json({ message: "webauthn_required" }, { status: 403 }),
    );
    await expect(
      service.requestTotpStepUp(OPERATOR, "123456", action),
    ).rejects.toThrow("webauthn_required");
  });
  it.each(["execute", "replay"] as const)(
    "preserves the confirmed %s mode",
    async (mode) => {
      upstream.mockResolvedValue(Response.json({ mode }));
      expect(await service.consumeAction(OPERATOR, "signed", action)).toEqual({
        mode,
      });
      expect(JSON.parse(String(upstream.mock.calls[0]![1]!.body))).toEqual({
        operatorId: OPERATOR,
        stepUpToken: "signed",
        audience: "admin",
        action,
      });
    },
  );
  it.each([{}, { mode: true }, { mode: "allow" }, null])(
    "rejects a malformed consumption result %j",
    async (result) => {
      upstream.mockResolvedValue(Response.json(result));
      await expect(
        service.consumeAction(OPERATOR, "signed", action),
      ).rejects.toThrow("operator_stepup_unavailable");
    },
  );
  it("preserves a missing grant rejection", async () => {
    upstream.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      service.consumeAction(OPERATOR, "signed", action),
    ).rejects.toThrow("step_up_required");
  });
  it("does not accept a lost IdP response as permission to execute", async () => {
    upstream.mockRejectedValue(new Error("response lost"));
    await expect(
      service.consumeAction(OPERATOR, "signed", action),
    ).rejects.toThrow("operator_stepup_unavailable");
  });
});
