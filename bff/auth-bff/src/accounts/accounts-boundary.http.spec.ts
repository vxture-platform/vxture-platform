/**
 * Account-center boundary regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Module, UnauthorizedException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import express from "express";
import { VxConfigService } from "@vxture/core-config";
import { AccountService } from "@vxture/service-account";
import { AccountsBoundaryModule } from "./accounts-boundary.module";
import { RealmSessionService } from "../oidc/realm-session.service";
import { AccountsOriginGuard } from "./accounts-origin.guard";
import { CustomerSelfGuard } from "../authn/customer-self.guard";
import { OperatorSelfGuard } from "../authn/operator-self.guard";
import { OperatorSelfService } from "../oidc/operator-self.service";
import { OperatorWebauthnService } from "../oidc/operator-webauthn.service";
import { OperatorSelfRouter } from "../routers/operator-self.router";
import { OperatorWebauthnRouter } from "../routers/operator-webauthn.router";
import { AvatarUploadController } from "../avatar/avatar-upload.controller";

// ============================================================================
// Real HTTP boundary with domain authorities stubbed at their public contract
// ============================================================================

describe("account-center legacy routes share the browser and realm boundary", () => {
  let app: import("@nestjs/common").INestApplication;
  let base: string;
  const self = {
    getSelf: vi.fn(async () => ({ id: "operator" })),
    startEmailChange: vi.fn(async () => ({ ok: true })),
    changePassword: vi.fn(async () => ({ ok: true })),
  };
  const passkeys = {
    listCredentials: vi.fn(async () => []),
    createRegistrationOptions: vi.fn(async () => ({ challenge: "challenge" })),
  };
  const account = { setAvatar: vi.fn(async () => {}) };
  const realms = {
    requireOperator: vi.fn(async (sid?: string) => {
      if (sid !== "operator")
        throw new UnauthorizedException("operator_session_required");
      return "operator-id";
    }),
    requireCustomer: vi.fn(async (sid?: string) => {
      if (sid !== "customer" && sid !== "deleting")
        throw new UnauthorizedException("customer_session_required");
      return {
        sid,
        userId: "customer-id",
        user: { status: sid === "deleting" ? "deleting" : "active" },
      };
    }),
  };
  beforeAll(async () => {
    @Module({
      controllers: [
        OperatorSelfRouter,
        OperatorWebauthnRouter,
        AvatarUploadController,
      ],
      providers: [
        AccountsOriginGuard,
        CustomerSelfGuard,
        OperatorSelfGuard,
        { provide: RealmSessionService, useValue: realms },
        {
          provide: VxConfigService,
          useValue: {
            auth: { OIDC_ISSUER: "https://accounts.vxture.com" },
            platform: { LOGIN_UI_BASE_URL: "http://localhost:3080" },
          },
        },
        { provide: OperatorSelfService, useValue: self },
        { provide: OperatorWebauthnService, useValue: passkeys },
        { provide: AccountService, useValue: account },
      ],
    })
    class HttpModule {}
    app = await NestFactory.create(HttpModule, { logger: false });
    app.use(cookieParser());
    app.use("/api/me/avatar", express.raw({ type: () => true, limit: "1mb" }));
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });
  it("exports the shared authorities from a separate module", () => {
    const exports = Reflect.getMetadata("exports", AccountsBoundaryModule);
    expect(exports).toEqual(
      expect.arrayContaining([
        CustomerSelfGuard,
        OperatorSelfGuard,
        RealmSessionService,
        AccountsOriginGuard,
      ]),
    );
  });
  it.each(["/oidc/operator/self", "/oidc/operator/webauthn/credentials"])(
    "rejects customer cookies at %s",
    async (path) => {
      expect(
        (await fetch(base + path, { headers: { cookie: "vx_sid=customer" } }))
          .status,
      ).toBe(401);
    },
  );
  it.each(["/oidc/operator/self", "/oidc/operator/webauthn/credentials"])(
    "accepts workforce when both cookies coexist at %s",
    async (path) => {
      const res = await fetch(base + path, {
        headers: { cookie: "vx_sid=customer; vx_sid_op=operator" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    },
  );
  it.each(["https://evil.test", "https://console.vxture.com", "null"])(
    "blocks workforce mutations from %s",
    async (origin) => {
      const res = await fetch(base + "/oidc/operator/self/email/start", {
        method: "POST",
        headers: {
          origin,
          cookie: "vx_sid_op=operator",
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(res.status).toBe(403);
    },
  );
  it("accepts the independently configured login UI", async () => {
    const res = await fetch(base + "/oidc/operator/webauthn/register/options", {
      method: "POST",
      headers: {
        origin: "http://localhost:3080",
        cookie: "vx_sid_op=operator",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });
  it("clears only the workforce cookie on workforce password change", async () => {
    const res = await fetch(base + "/oidc/operator/self/password", {
      method: "POST",
      headers: {
        origin: "https://accounts.vxture.com",
        cookie: "vx_sid=customer; vx_sid_op=operator",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("vx_sid_op=;");
    expect(res.headers.get("set-cookie")).not.toContain("vx_sid=;");
  });
  it.each(["operator", "revoked", "deleting"])(
    "rejects invalid avatar session %s",
    async (sid) => {
      const before = account.setAvatar.mock.calls.length;
      const res = await fetch(base + "/api/me/avatar", {
        method: "PUT",
        headers: {
          origin: "https://accounts.vxture.com",
          cookie: `vx_sid=${sid}; vx_sid_op=operator`,
          "content-type": "image/png",
        },
        body: Buffer.from("89504e470d0a1a0a00000000", "hex"),
      });
      expect(res.status).toBe(sid === "deleting" ? 403 : 401);
      expect(account.setAvatar.mock.calls.length).toBe(before);
    },
  );
  it("accepts binary avatar data after customer validation", async () => {
    const res = await fetch(base + "/api/me/avatar", {
      method: "PUT",
      headers: {
        origin: "https://accounts.vxture.com",
        cookie: "vx_sid=customer; vx_sid_op=operator",
        "content-type": "image/png",
      },
      body: Buffer.from("89504e470d0a1a0a00000000", "hex"),
    });
    expect(res.status).toBe(200);
    expect(account.setAvatar).toHaveBeenCalledWith(
      "customer-id",
      expect.objectContaining({ contentType: "image/png" }),
    );
  });
  it("blocks avatar uploads lacking Origin", async () => {
    const res = await fetch(base + "/api/me/avatar", {
      method: "PUT",
      headers: { cookie: "vx_sid=customer", "content-type": "image/png" },
      body: "bytes",
    });
    expect(res.status).toBe(403);
  });
});
