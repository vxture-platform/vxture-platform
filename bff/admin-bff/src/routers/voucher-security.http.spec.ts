/**
 * voucher-security.http.spec.ts - Voucher write gates over real Nest HTTP.
 * @package @vxture/bff-admin
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import "reflect-metadata";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import type {
  NextFunction,
  Request,
  Response as ExpressResponse,
} from "express";
import type { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
// ⚠️ 跨层引用: Exercise the public RP verifier with ephemeral signed credentials.
import { HttpOidcRpClient, type OidcRpConfig } from "@vxture/core-oidc-rp";
// ⚠️ 跨层引用: Supply isolated claim-key configuration without loading environments.
import { VxConfigService } from "@vxture/core-config";
import { OperatorStepUpGuard } from "../auth/step-up.guard";
import { OperatorStepUpService } from "../auth/operator-stepup.service";
import { voucherStepUpIntent } from "../auth/voucher-step-up";
import {
  stepUpActionCookieName,
  stepUpCookieName,
} from "../auth/step-up.decorator";
import { RP_OIDC_CLIENT, RP_RUNTIME } from "../oidc/oidc-rp.tokens";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import type { ConsoleUser, RequestContext } from "../types/console.types";
import { CommercialRouter } from "./commercial.router";

// ===========================================================================
// No database or IdP is contacted; only the local HTTP server listens.
// ===========================================================================
const OPERATOR = "11111111-1111-4111-8111-111111111111";
const OTHER_OPERATOR = "22222222-2222-4222-8222-222222222222";
const RESOURCE = "33333333-3333-4333-8333-333333333333";
const ISSUER = "https://voucher-security.invalid";
const COOKIE = stepUpActionCookieName(true);
const SESSION_HASH = "a".repeat(64);
const command = { reason: "", idempotencyKey: "s03-security" };
let currentRequestHash = "";
const consumeAction = vi.fn(async () => ({ mode: "execute" as const }));
const MANAGE = "promotion:campaign.manage";
const config: OidcRpConfig = {
  issuer: ISSUER,
  clientId: "admin",
  clientSecret: "isolated-test-only",
  redirectUri: "https://admin.invalid/auth/callback",
  scopes: ["openid"],
  sessionTtlSec: 3600,
};
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const foreignKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
}).privateKey;
const jwksFetch = vi.fn<typeof fetch>(async (url) => {
  if (String(url) !== `${ISSUER}/oidc/jwks`)
    throw new Error(
      "External requests are forbidden in voucher security tests",
    );
  return new Response(
    JSON.stringify({
      keys: [
        { ...publicKey.export({ format: "jwk" }), kid: "s01", alg: "RS256" },
      ],
    }),
  );
});
const verifier = new HttpOidcRpClient(config, { fetchImpl: jwksFetch });

/** Generate a genuine signature; overrides model invalid but signed claims. */
function credential(
  overrides: Record<string, unknown> = {},
  signingKey: KeyObject = privateKey,
): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "RS256", kid: "s01" })}.${encode({
    iss: ISSUER,
    aud: "admin",
    sub: `opr_${OPERATOR}`,
    iat: now,
    exp: now + 300,
    stepup: true,
    userType: "operator",
    stepup_action: {
      sessionHash: SESSION_HASH,
      requestHash: currentRequestHash,
    },
    ...overrides,
  })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(signingKey).toString("base64url")}`;
}

/** Any database access is a failure, including reads before authorization. */
function blockedPool() {
  const query = vi.fn(() => {
    throw new Error("Denied requests must not query the database");
  });
  const connect = vi.fn(() => {
    throw new Error("Denied requests must not acquire a database connection");
  });
  return { pool: { query, connect } as unknown as Pool, query, connect };
}
const ro = blockedPool(),
  rw = blockedPool();
const routes = [
  { name: "create", path: "/voucher-batches" },
  { name: "batch action", path: `/voucher-batches/${RESOURCE}/actions` },
  { name: "assign", path: "/vouchers/assign" },
  { name: "issue", path: `/voucher-batches/${RESOURCE}/issue` },
  { name: "revoke", path: `/vouchers/${RESOURCE}/revoke` },
];
let app: INestApplication | undefined, base: string;

// ===========================================================================
// Use the production controller, global guard, cookie parser and RP verifier.
// ===========================================================================
beforeAll(async () => {
  @Module({
    controllers: [CommercialRouter],
    providers: [
      { provide: OperatorStepUpService, useValue: { consumeAction } },
      { provide: ADMIN_BFF_RO_POOL, useValue: ro.pool },
      { provide: ADMIN_BFF_RW_POOL, useValue: rw.pool },
      { provide: RP_OIDC_CLIENT, useValue: verifier },
      { provide: RP_RUNTIME, useValue: { config, cookieSecure: true } },
      {
        provide: VxConfigService,
        useValue: {
          auth: {
            VOUCHER_CLAIM_ACTIVE_KEY: "s01",
            VOUCHER_CLAIM_KEYS: JSON.stringify({ s01: "01".repeat(32) }),
          },
        },
      },
      { provide: APP_GUARD, useClass: OperatorStepUpGuard },
    ],
  })
  class TestModule {}
  app = await NestFactory.create(TestModule, { logger: false });
  app.use(cookieParser());
  // This fixture supplies an already verified session; it does not test login/TOTP.
  app.use(
    (
      req: Request & RequestContext,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      const session = req.header("x-s01-session");
      if (session === "operator" || session === "other") {
        const user: ConsoleUser = {
          id: session === "operator" ? OPERATOR : OTHER_OPERATOR,
          name: "S01 operator",
          email: "",
          roleLabel: "",
          roleCode: "",
          roleI18nKey: "",
          roleNameEn: "",
        };
        req.operatorSessionHash = SESSION_HASH;
        req.user = user;
        req.capabilities = (req.header("x-s01-capabilities") ?? "")
          .split(",")
          .filter(Boolean);
      }
      next();
    },
  );
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app?.close();
});
beforeEach(() => {
  vi.clearAllMocks();
});

/** Submit only to this test's local server with explicit session/proof inputs. */
async function submit(
  path: string,
  token?: string,
  opts: { session?: string; capabilities?: string; cookieName?: string } = {},
) {
  return fetch(`${base}/api/commercial${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-s01-session": opts.session ?? "operator",
      "x-s01-capabilities": opts.capabilities ?? MANAGE,
      ...(token ? { Cookie: `${opts.cookieName ?? COOKIE}=${token}` } : {}),
    },
    // Invalid commands keep successful authorization paths free of database work.
    body: JSON.stringify(command),
  });
}
function expectNoDatabaseAccess() {
  expect(ro.query).not.toHaveBeenCalled();
  expect(ro.connect).not.toHaveBeenCalled();
  expect(rw.query).not.toHaveBeenCalled();
  expect(rw.connect).not.toHaveBeenCalled();
}
async function expectStepUpRequired(response: Response) {
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ message: "step_up_required" });
  expectNoDatabaseAccess();
}

// ===========================================================================
// Every write path must reject unauthorized requests before domain/DB work.
// ===========================================================================
describe.each(routes)("voucher HTTP security: $name", ({ path }) => {
  beforeEach(() => {
    currentRequestHash = voucherStepUpIntent({
      method: "POST",
      path: `/api/commercial${path}`,
      body: command,
      operatorSessionHash: SESSION_HASH,
    } as never).requestHash;
  });
  it("requires the secure step-up cookie", async () => {
    await expectStepUpRequired(await submit(path));
    await expectStepUpRequired(
      await submit(path, credential(), {
        cookieName: stepUpActionCookieName(false),
      }),
    );
  });

  it("requires an active operator session independently of a valid proof", async () => {
    await expectStepUpRequired(
      await submit(path, credential(), { session: "absent" }),
    );
  });

  it("rejects a proof belonging to another operator", async () => {
    await expectStepUpRequired(
      await submit(path, credential(), { session: "other" }),
    );
  });

  it.each(["", "promotion:campaign.read", "commerce:billing.manage"])(
    "requires promotion write capability even with a valid proof: %s",
    async (capabilities) => {
      const response = await submit(path, credential(), { capabilities });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        message: expect.stringContaining("Missing capability"),
      });
      expectNoDatabaseAccess();
    },
  );

  it.each([
    { name: "missing expiry", claims: { exp: undefined } },
    { name: "null expiry", claims: { exp: null } },
    { name: "string expiry", claims: { exp: "9999999999" } },
    { name: "fractional expiry", claims: { exp: 9_999_999_999.5 } },
    {
      name: "unsafe integer expiry",
      claims: { exp: Number.MAX_SAFE_INTEGER + 1 },
    },
    { name: "wrong issuer", claims: { iss: "https://other.invalid" } },
    { name: "wrong audience", claims: { aud: "console" } },
    { name: "missing step-up flag", claims: { stepup: undefined } },
    { name: "false step-up flag", claims: { stepup: false } },
    { name: "string step-up flag", claims: { stepup: "true" } },
  ])("rejects signed claims with $name", async ({ claims }) => {
    await expectStepUpRequired(await submit(path, credential(claims)));
  });

  it.each([0, 1, 3600])(
    "rejects expiry %i seconds ago, including the RP clock-skew window",
    async (secondsAgo) => {
      await expectStepUpRequired(
        await submit(
          path,
          credential({ exp: Math.floor(Date.now() / 1000) - secondsAgo }),
        ),
      );
    },
  );

  it("rejects malformed and forged tokens through real signature verification", async () => {
    await expectStepUpRequired(await submit(path, "malformed.jwt.token"));
    await expectStepUpRequired(await submit(path, credential({}, foreignKey)));
  });

  it("accepts a valid action-bound proof and reaches business input validation", async () => {
    const response = await submit(path, credential());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ statusCode: 400 });
    expectNoDatabaseAccess();
  });
});

it("does not accept the reusable five-minute cookie on voucher writes", async () => {
  await expectStepUpRequired(
    await submit("/voucher-batches", credential(), {
      cookieName: stepUpCookieName(true),
    }),
  );
  expect(consumeAction).not.toHaveBeenCalled();
});
