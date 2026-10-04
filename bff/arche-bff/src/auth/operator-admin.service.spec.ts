/**
 * operator-admin.service.spec.ts — 委派给 IdP 的每一条路都把主体的两半送到（PR C）。
 * @package @vxture/bff-arche
 *
 * 钉三件 tsc 看不见的事：
 *   1. 十一个委派方法**每一个**都把 `actor.accessToken` 放进 `x-vxture-actor-token`、把
 *      `actor.operatorId` 放进正文 `actorOperatorId`——auth-bff 的 ActorBindingGuard 比的就是
 *      这两样；少一个方法漏送，那条运营动作上线就是 503；
 *   2. 票**只**进头，不进正文（正文会进 IdP 的审计 metadata / 日志行）；
 *   3. 半个主体（没有票 / 没有 id）到不了 fetch。
 *   `listOperatorSessions` 是 GET、没有主体，不在这张表里——它不带票是对的（`actor: "none"`）。
 *
 * config 走真的 `VxConfigModule.register`（env → zod 域 parse → Nest DI），不手搓对象。
 */
import "reflect-metadata";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Module, UnauthorizedException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import type { ActingOperator } from "./acting-operator";
import {
  ACTOR_TOKEN_HEADER,
  OperatorAdminService,
} from "./operator-admin.service";

const IDP_SECRET = "idp-internal-secret-value-32-bytes-min";
const IDP_BASE = "http://vx-platform-auth-bff:3081";
const ACTOR: ActingOperator = {
  operatorId: "11111111-1111-4111-8111-111111111111",
  accessToken: "rs256.session.access-token",
};
const TARGET = "22222222-2222-4222-8222-222222222222";

const ENV_KEYS = [
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "IDP_INTERNAL_TOKEN",
  "OIDC_BACKCHANNEL_ISSUER",
  "AUTH_BFF_URL",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  VxConfigModule.register({ domains: ["auth"], strict: false });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function realService(): Promise<OperatorAdminService> {
  process.env["JWT_SECRET"] = "spec-jwt-secret-value-at-least-32-chars";
  process.env["JWT_REFRESH_SECRET"] = "spec-jwt-refresh-secret-different-32-c";
  process.env["IDP_INTERNAL_TOKEN"] = IDP_SECRET;
  process.env["OIDC_BACKCHANNEL_ISSUER"] = IDP_BASE;

  @Module({
    imports: [VxConfigModule.register({ domains: ["auth"], strict: false })],
  })
  class SpecConfigModule {}

  const app = await NestFactory.createApplicationContext(SpecConfigModule, {
    logger: false,
  });
  const config = app.get(VxConfigService);
  expect(config.auth.IDP_INTERNAL_TOKEN).toBe(IDP_SECRET);
  await app.close();
  return new OperatorAdminService(config);
}

interface Captured {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

function stubFetch(): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : null,
      });
      return new Response(
        JSON.stringify({ ok: true, status: "x", revoked: 0, sessions: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
  return calls;
}

/** 十一条委派路，每条怎么调、打到哪。少一条这里就对不上 service 的公开方法数。 */
const DELEGATIONS: ReadonlyArray<
  [string, (s: OperatorAdminService) => Promise<unknown>, string]
> = [
  [
    "createOperator",
    (s) =>
      s.createOperator(ACTOR, {
        username: "u",
        displayName: "d",
        email: "u@example.test",
        phone: null,
        roleId: TARGET,
      }),
    "/internal/operator/accounts",
  ],
  [
    "disableOperator",
    (s) => s.disableOperator(TARGET, ACTOR, "r"),
    `/internal/operator/accounts/${TARGET}/disable`,
  ],
  [
    "enableOperator",
    (s) => s.enableOperator(TARGET, ACTOR, "r"),
    `/internal/operator/accounts/${TARGET}/enable`,
  ],
  [
    "forceLogoutOperator",
    (s) => s.forceLogoutOperator(TARGET, ACTOR, "r"),
    `/internal/operator/accounts/${TARGET}/sessions/revoke`,
  ],
  [
    "resetOperatorMfa",
    (s) => s.resetOperatorMfa(TARGET, ACTOR, "r"),
    `/internal/operator/accounts/${TARGET}/mfa/reset`,
  ],
  [
    "resetOperatorPassword",
    (s) => s.resetOperatorPassword(TARGET, ACTOR, "r"),
    `/internal/operator/accounts/${TARGET}/reset-password`,
  ],
  [
    "startEmailChange",
    (s) => s.startEmailChange(ACTOR, "new@example.test"),
    `/internal/operator/accounts/${ACTOR.operatorId}/contact/email/start`,
  ],
  [
    "verifyEmailChange",
    (s) => s.verifyEmailChange(ACTOR, "123456"),
    `/internal/operator/accounts/${ACTOR.operatorId}/contact/email/verify`,
  ],
  [
    "disableAccount",
    (s) => s.disableAccount(TARGET, ACTOR, "r"),
    `/internal/account/users/${TARGET}/disable`,
  ],
  [
    "enableAccount",
    (s) => s.enableAccount(TARGET, ACTOR, "r"),
    `/internal/account/users/${TARGET}/enable`,
  ],
  [
    "forceLogoutAccount",
    (s) => s.forceLogoutAccount(TARGET, ACTOR, "r"),
    `/internal/account/users/${TARGET}/sessions/revoke`,
  ],
];

describe("OperatorAdminService · 每条委派都带着主体的两半", () => {
  it("清单覆盖了 service 上所有发 POST 的公开方法（多一个少一个都对不上）", async () => {
    const svc = await realService();
    const publicMethods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(svc) as object,
    ).filter(
      (n) =>
        n !== "constructor" &&
        n !== "idpBaseUrl" &&
        n !== "internalToken" &&
        n !== "delegate" &&
        n !== "listOperatorSessions",
    );
    expect(publicMethods.sort()).toEqual(
      DELEGATIONS.map(([name]) => name).sort(),
    );
  });

  for (const [name, call, path] of DELEGATIONS) {
    it(`${name} → ${path}：x-vxture-actor-token = 票、actorOperatorId = id、票不进正文`, async () => {
      const calls = stubFetch();
      const svc = await realService();
      await call(svc);
      expect(calls).toHaveLength(1);
      const c = calls[0]!;
      expect(c.method).toBe("POST");
      expect(c.url).toBe(`${IDP_BASE}${path}`);
      expect(c.headers[ACTOR_TOKEN_HEADER]).toBe(ACTOR.accessToken);
      expect(c.headers["x-vxture-internal-auth"]).toBe(IDP_SECRET);
      expect(c.body?.["actorOperatorId"]).toBe(ACTOR.operatorId);
      expect(JSON.stringify(c.body)).not.toContain(ACTOR.accessToken);
    });
  }

  it("listOperatorSessions（GET、无主体）不带 actor 头——它的声明是 actor: none", async () => {
    const calls = stubFetch();
    const svc = await realService();
    await svc.listOperatorSessions();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers[ACTOR_TOKEN_HEADER]).toBeUndefined();
    expect(calls[0]!.headers["x-vxture-internal-auth"]).toBe(IDP_SECRET);
  });

  it("头名与 auth-bff 的 ActorBindingGuard 读的那个逐字相同", () => {
    expect(ACTOR_TOKEN_HEADER).toBe("x-vxture-actor-token");
  });
});

describe("OperatorAdminService · 半个主体到不了 IdP", () => {
  it("没有票 → 401 operator_actor_incomplete，fetch 一次都没发", async () => {
    const calls = stubFetch();
    const svc = await realService();
    await expect(
      svc.disableOperator(
        TARGET,
        { operatorId: ACTOR.operatorId, accessToken: "" },
        "r",
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(calls).toHaveLength(0);
  });

  it("没有 id → 同样 401、不发", async () => {
    const calls = stubFetch();
    const svc = await realService();
    await expect(
      svc.disableAccount(
        TARGET,
        { operatorId: "", accessToken: ACTOR.accessToken },
        "r",
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(calls).toHaveLength(0);
  });
});
