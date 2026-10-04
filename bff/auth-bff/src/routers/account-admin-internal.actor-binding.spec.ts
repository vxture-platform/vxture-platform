/**
 * account-admin-internal.actor-binding.spec.ts — 两道门按真实顺序、走真 HTTP（PR C）。
 * @package @vxture/bff-auth
 *
 * guard 的单测各自证各自的判据；这里证的是**接起来之后**的事，单测看不见的那几件：
 *   1. 类级 `@UseGuards(InternalAuthGuard, ActorBindingGuard)` 真的两道都在跑、顺序是口令先、
 *      绑定后（没口令时回 invalid_internal_auth，而不是 actor_token_missing）；
 *   2. `ActorBindingGuard` 在 guard 阶段读得到 `req.body`（body-parser 在 guard 之前跑）——
 *      这是「sub == body.actorOperatorId」成立的前提，单测里是直接塞的；
 *   3. 三个 401 码从 HTTP 响应里原样出来（`message` 字段），handler 一次都没被调；
 *   4. 全过时 200、handler 被调。
 *
 * 起一个最小 Nest 应用（真 express、真 JwtService / OidcKeyService、真 config 域 parse），
 * 监听随机端口，用全局 fetch 打。AccountService 与 RedisService 是假的（没有库、没有 Redis）。
 */
import "reflect-metadata";
import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { AccountService } from "@vxture/service-account";
import {
  ActorBindingGuard,
  ACTOR_TOKEN_HEADER,
} from "../authn/actor-binding.guard";
import {
  InternalAuthGuard,
  INTERNAL_AUTH_HEADER,
} from "../authn/internal-auth.guard";
import { OidcKeyService } from "../oidc/oidc-key.service";
import { RedisService } from "../redis/redis.service";
import { buildAccessClaims } from "../token/access-claims";
import { AccountAdminInternalRouter } from "./account-admin-internal.router";

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const SUB = `opr_${OPERATOR_ID}`;
const SID = "sid-e2e";
const ISSUER = "https://auth.spec.local";
const IDP_SECRET = "idp-internal-secret-value-32-bytes-min";

const ENV_KEYS = [
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "IDP_INTERNAL_TOKEN",
  "OIDC_ISSUER",
  "OIDC_ALGORITHM",
  "OIDC_ACTIVE_KID",
  "OIDC_SIGNING_PRIVATE_KEY",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

let app: INestApplication;
let base: string;
let keys: OidcKeyService;
const sessions = new Map<string, { sub: string }>();
const adminDisableAccount = vi.fn(async () => ({
  user: { status: "disabled" },
  revoked: 2,
}));

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  VxConfigModule.register({ domains: ["auth"], strict: false });
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  process.env["JWT_SECRET"] = "spec-jwt-secret-value-at-least-32-chars";
  process.env["JWT_REFRESH_SECRET"] = "spec-jwt-refresh-secret-different-32-c";
  process.env["IDP_INTERNAL_TOKEN"] = IDP_SECRET;
  process.env["OIDC_ISSUER"] = ISSUER;
  process.env["OIDC_ALGORITHM"] = "RS256";
  process.env["OIDC_ACTIVE_KID"] = "kid-e2e";
  process.env["OIDC_SIGNING_PRIVATE_KEY"] = Buffer.from(
    privateKey,
    "utf8",
  ).toString("base64");

  const fakeRedis = {
    getOidcSession: async (sid: string) => {
      const s = sessions.get(sid);
      return s
        ? {
            sub: s.sub,
            realm: "workforce",
            authMethod: "password",
            amr: ["pwd"],
            createdAt: 0,
            lastActiveAt: 0,
            absExpiresAt: 0,
          }
        : null;
    },
  };

  @Module({
    imports: [VxConfigModule.register({ domains: ["auth"], strict: false })],
    controllers: [AccountAdminInternalRouter],
    providers: [
      InternalAuthGuard,
      ActorBindingGuard,
      {
        provide: OidcKeyService,
        inject: [VxConfigService],
        useFactory: (c: VxConfigService) =>
          new OidcKeyService(c, new JwtService({})),
      },
      { provide: RedisService, useValue: fakeRedis },
      { provide: AccountService, useValue: { adminDisableAccount } },
    ],
  })
  class SpecAppModule {}

  app = await NestFactory.create(SpecAppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  const addr = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
  keys = app.get(OidcKeyService);
  expect(keys.isReady()).toBe(true);
});

afterAll(async () => {
  await app?.close();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function sessionToken(sub = SUB, aud = "admin"): string {
  return keys.sign(
    buildAccessClaims({ sessionId: SID, roles: [], userType: "operator" }),
    { audience: aud, subject: sub, expiresInSec: 900 },
  );
}

function stepUpToken(): string {
  return keys.sign(
    { stepup: true, userType: "operator", amr: ["otp"] },
    { audience: "admin", subject: SUB, expiresInSec: 300 },
  );
}

async function disable(
  headers: Record<string, string>,
  body: Record<string, unknown> = {
    actorOperatorId: OPERATOR_ID,
    reason: "测试",
  },
): Promise<{
  status: number;
  message: string | undefined;
  body: Record<string, unknown>;
}> {
  const res = await fetch(`${base}/internal/account/users/${USER_ID}/disable`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return {
    status: res.status,
    message: typeof json["message"] === "string" ? json["message"] : undefined,
    body: json,
  };
}

describe("两道门接起来（真 HTTP）", () => {
  it("口令对 + 该运营者的会话票 + 会话在 → 200，handler 被调", async () => {
    sessions.set(SID, { sub: SUB });
    adminDisableAccount.mockClear();
    const r = await disable({
      [INTERNAL_AUTH_HEADER]: IDP_SECRET,
      [ACTOR_TOKEN_HEADER]: sessionToken(),
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, status: "disabled", revoked: 2 });
    expect(adminDisableAccount).toHaveBeenCalledTimes(1);
  });

  it("没口令（带着合法会话票）→ 401 invalid_internal_auth：口令那道门先判", async () => {
    sessions.set(SID, { sub: SUB });
    adminDisableAccount.mockClear();
    const r = await disable({ [ACTOR_TOKEN_HEADER]: sessionToken() });
    expect(r.status).toBe(401);
    expect(r.message).toBe("invalid_internal_auth");
    expect(adminDisableAccount).not.toHaveBeenCalled();
  });

  it("口令对、没有会话票 → 401 actor_token_missing：只有口令再也开不了这扇门", async () => {
    adminDisableAccount.mockClear();
    const r = await disable({ [INTERNAL_AUTH_HEADER]: IDP_SECRET });
    expect(r.status).toBe(401);
    expect(r.message).toBe("actor_token_missing");
    expect(adminDisableAccount).not.toHaveBeenCalled();
  });

  it("口令对、票是另一个运营者的 → 401 actor_token_mismatch（guard 读到了 body.actorOperatorId）", async () => {
    sessions.set(SID, { sub: `opr_${OTHER_ID}` });
    adminDisableAccount.mockClear();
    const r = await disable({
      [INTERNAL_AUTH_HEADER]: IDP_SECRET,
      [ACTOR_TOKEN_HEADER]: sessionToken(`opr_${OTHER_ID}`),
    });
    expect(r.status).toBe(401);
    expect(r.message).toBe("actor_token_mismatch");
    expect(adminDisableAccount).not.toHaveBeenCalled();
  });

  it("口令对、票是他的、但中央会话已删 → 401 actor_token_mismatch（下线后立刻失效）", async () => {
    sessions.delete(SID);
    adminDisableAccount.mockClear();
    const r = await disable({
      [INTERNAL_AUTH_HEADER]: IDP_SECRET,
      [ACTOR_TOKEN_HEADER]: sessionToken(),
    });
    expect(r.status).toBe(401);
    expect(r.message).toBe("actor_token_mismatch");
    expect(adminDisableAccount).not.toHaveBeenCalled();
  });

  it("口令对、拿 step-up 票冒充 → 401 actor_token_invalid", async () => {
    sessions.set(SID, { sub: SUB });
    adminDisableAccount.mockClear();
    const r = await disable({
      [INTERNAL_AUTH_HEADER]: IDP_SECRET,
      [ACTOR_TOKEN_HEADER]: stepUpToken(),
    });
    expect(r.status).toBe(401);
    expect(r.message).toBe("actor_token_invalid");
    expect(adminDisableAccount).not.toHaveBeenCalled();
  });

  it("口令对、票对、但 body 里点名的是别人 → 401 actor_token_mismatch，响应不说是哪个 claim", async () => {
    sessions.set(SID, { sub: SUB });
    adminDisableAccount.mockClear();
    const r = await disable(
      {
        [INTERNAL_AUTH_HEADER]: IDP_SECRET,
        [ACTOR_TOKEN_HEADER]: sessionToken(),
      },
      { actorOperatorId: OTHER_ID, reason: "测试" },
    );
    expect(r.status).toBe(401);
    expect(r.message).toBe("actor_token_mismatch");
    expect(JSON.stringify(r.body)).not.toMatch(/sub|sid|aud/);
    expect(adminDisableAccount).not.toHaveBeenCalled();
  });
});
