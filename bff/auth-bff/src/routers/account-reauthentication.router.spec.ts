/**
 * Real HTTP origin, realm, body and cache boundaries for ownership confirmation.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Module, UnauthorizedException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { VxConfigService } from "@vxture/core-config";
import {
  AccountReauthenticationRouter,
  OperatorAccountReauthenticationRouter,
} from "./account-reauthentication.router";
import { AccountReauthenticationService } from "../authn/account-reauthentication.service";
import { CustomerSelfGuard } from "../authn/customer-self.guard";
import { OperatorSelfGuard } from "../authn/operator-self.guard";
import { RealmSessionService } from "../oidc/realm-session.service";
import { AccountsOriginGuard } from "../accounts/accounts-origin.guard";

// ============================================================================
// HTTP boundary with real guards; factor persistence is tested separately.
// ============================================================================
describe("account ownership HTTP endpoints", () => {
  let app: import("@nestjs/common").INestApplication;
  let base: string;
  const service = {
    options: vi.fn(async () => ({ methods: ["totp"] })),
    start: vi.fn(async () => ({ verificationId: "ticket" })),
    verify: vi.fn(async () => ({ proofToken: "proof" })),
  };
  const realms = {
    requireCustomer: vi.fn(async (sid: string) => {
      if (sid !== "customer")
        throw new UnauthorizedException("customer_session_required");
      return { sid, userId: "user", user: { status: "active" } };
    }),
    requireOperator: vi.fn(async (sid: string) => {
      if (sid !== "operator")
        throw new UnauthorizedException("operator_session_required");
      return "operator-id";
    }),
  };
  beforeAll(async () => {
    @Module({
      controllers: [
        AccountReauthenticationRouter,
        OperatorAccountReauthenticationRouter,
      ],
      providers: [
        CustomerSelfGuard,
        OperatorSelfGuard,
        AccountsOriginGuard,
        { provide: AccountReauthenticationService, useValue: service },
        { provide: RealmSessionService, useValue: realms },
        {
          provide: VxConfigService,
          useValue: {
            auth: { OIDC_ISSUER: "https://accounts.vxture.com" },
            platform: { LOGIN_UI_BASE_URL: "https://accounts.vxture.com" },
          },
        },
      ],
    })
    class HttpModule {}
    app = await NestFactory.create(HttpModule, { logger: false });
    app.use(cookieParser());
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });
  function post(
    realm: "customer" | "operator",
    suffix: string,
    body: unknown = {},
    cookie = "vx_sid=customer; vx_sid_op=operator",
    origin = "https://accounts.vxture.com",
  ) {
    return fetch(`${base}/oidc/${realm}/self/reauthentication${suffix}`, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  it.each(["customer", "operator"] as const)(
    "uses only the %s cookie and returns no-store",
    async (realm) => {
      const response = await post(realm, "/options", {
        operation: "password",
        target: "",
        userId: "attacker",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(service.options).toHaveBeenLastCalledWith(
        realm === "operator" ? "workforce" : "customer",
        realm === "operator" ? "operator" : "customer",
        "password",
        "",
      );
      expect(
        (
          await post(realm, "", {
            operation: "password",
            target: "",
            method: "totp",
          })
        ).status,
      ).toBe(200);
      expect(
        (await post(realm, "/ticket/verify", { code: "123456" })).status,
      ).toBe(200);
      expect(service.verify).toHaveBeenLastCalledWith(
        realm === "operator" ? "workforce" : "customer",
        realm === "operator" ? "operator" : "customer",
        "ticket",
        { code: "123456" },
      );
    },
  );
  it.each(["customer", "operator"] as const)(
    "rejects foreign or absent cookies for %s",
    async (realm) => {
      const foreign =
        realm === "customer" ? "vx_sid_op=operator" : "vx_sid=customer";
      for (const suffix of ["/options", "", "/ticket/verify"])
        expect((await post(realm, suffix, {}, foreign)).status).toBe(401);
    },
  );
  it.each(["customer", "operator"] as const)(
    "rejects cross-origin and malformed %s requests",
    async (realm) => {
      expect(
        (await post(realm, "", {}, undefined, "https://console.vxture.com"))
          .status,
      ).toBe(403);
      for (const body of [null, [], "password"])
        expect((await post(realm, "", body)).status).toBe(400);
    },
  );
});
