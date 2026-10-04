/**
 * operator-admin-internal.actor-binding.spec.ts — 8 条运营账号路由的两道门按真实顺序、走真 HTTP。
 * @package @vxture/bff-auth
 *
 * `account-admin-internal.actor-binding.spec.ts` 对 3 条客户账号路由走过一遍；这个 router 有 8 条
 * （含建号 / 重置密码），此前没有任何可执行的东西钉住它的门序——`check-internal-route-policy.mjs`
 * 第 ⑧ 条现在静态钉着（反写 / 分写即红），这里是运行时那一半：
 *   1. 没口令（带着合法会话票）→ 401 invalid_internal_auth，而且 **Redis 一次都没被查**：口令那道门
 *      先判、绑定门没跑——否则没口令的人能从 actor_token_invalid / mismatch 的差别里探会话、并让
 *      IdP 在认证之前查 Redis；
 *   2. 口令对、没会话票 → 401 actor_token_missing：**这正是旧发送方在部署窗口里的请求形状**
 *      （runbook `15-idp-internal-token-cutover.md` §8 末条）——发送方把它压成 503
 *      operator_admin_unavailable，不是攻击、不是故障；
 *   3. 两道门都过 → handler 真的在跑：用 `id === actorOperatorId` 让 handler 自己抛 400
 *      cannot_disable_self，不需要仓储有任何行为。
 *
 * 起一个最小 Nest 应用（真 express、真 JwtService / OidcKeyService、真 config 域 parse），
 * 监听随机端口，用全局 fetch 打。仓储 / 邮件 / OidcService 都是空壳：三条用例没有一条走到它们。
 */
import "reflect-metadata";
import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { PgOperatorRepository } from "@vxture/service-iam";
import { MailService } from "@vxture/service-mail";
import {
  ActorBindingGuard,
  ACTOR_TOKEN_HEADER,
} from "../authn/actor-binding.guard";
import {
  InternalAuthGuard,
  INTERNAL_AUTH_HEADER,
} from "../authn/internal-auth.guard";
import { OidcKeyService } from "../oidc/oidc-key.service";
import { OidcService } from "../oidc/oidc.service";
import { RedisService } from "../redis/redis.service";
import { buildAccessClaims } from "../token/access-claims";
import { OperatorRefreshTokenRepository } from "../token/operator-refresh-token.repository";
import { OperatorAdminInternalRouter } from "./operator-admin-internal.router";

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const SUB = `opr_${OPERATOR_ID}`;
const SID = "sid-e2e-operator";
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
const getOidcSession = vi.fn(async (sid: string) => {
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
});

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
  process.env["OIDC_ACTIVE_KID"] = "kid-e2e-operator";
  process.env["OIDC_SIGNING_PRIVATE_KEY"] = Buffer.from(
    privateKey,
    "utf8",
  ).toString("base64");

  @Module({
    imports: [VxConfigModule.register({ domains: ["auth"], strict: false })],
    controllers: [OperatorAdminInternalRouter],
    providers: [
      InternalAuthGuard,
      ActorBindingGuard,
      {
        provide: OidcKeyService,
        inject: [VxConfigService],
        useFactory: (c: VxConfigService) =>
          new OidcKeyService(c, new JwtService({})),
      },
      { provide: RedisService, useValue: { getOidcSession } },
      // 空壳：三条用例没有一条走到仓储 / 邮件 / OidcService（guard 拒绝，或 handler 在第一行自抛）。
      { provide: PgOperatorRepository, useValue: {} },
      { provide: OperatorRefreshTokenRepository, useValue: {} },
      { provide: MailService, useValue: {} },
      { provide: OidcService, useValue: {} },
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

function sessionToken(): string {
  return keys.sign(
    buildAccessClaims({ sessionId: SID, roles: [], userType: "operator" }),
    { audience: "arche", subject: SUB, expiresInSec: 900 },
  );
}

/** 让 handler 一进门就自抛：目标 id 就是 actor 自己 → 400 cannot_disable_self。 */
async function disableSelf(
  headers: Record<string, string>,
): Promise<{ status: number; message: string | undefined }> {
  const res = await fetch(
    `${base}/internal/operator/accounts/${OPERATOR_ID}/disable`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ actorOperatorId: OPERATOR_ID, reason: "测试" }),
    },
  );
  const json = (await res.json()) as Record<string, unknown>;
  return {
    status: res.status,
    message: typeof json["message"] === "string" ? json["message"] : undefined,
  };
}

describe("运营账号 router：两道门接起来（真 HTTP）", () => {
  it("没口令（带着合法会话票）→ 401 invalid_internal_auth，且 Redis 一次没被查：口令门先判、绑定门没跑", async () => {
    sessions.set(SID, { sub: SUB });
    getOidcSession.mockClear();
    const r = await disableSelf({ [ACTOR_TOKEN_HEADER]: sessionToken() });
    expect(r.status).toBe(401);
    expect(r.message).toBe("invalid_internal_auth");
    expect(getOidcSession).not.toHaveBeenCalled();
  });

  it("口令对、没有会话票 → 401 actor_token_missing（旧发送方在部署窗口里的请求形状）", async () => {
    getOidcSession.mockClear();
    const r = await disableSelf({ [INTERNAL_AUTH_HEADER]: IDP_SECRET });
    expect(r.status).toBe(401);
    expect(r.message).toBe("actor_token_missing");
    expect(getOidcSession).not.toHaveBeenCalled();
  });

  it("口令对 + 该运营者的会话票 + 会话在 → 两道门都过，handler 在跑（自抛 400 cannot_disable_self）", async () => {
    sessions.set(SID, { sub: SUB });
    getOidcSession.mockClear();
    const r = await disableSelf({
      [INTERNAL_AUTH_HEADER]: IDP_SECRET,
      [ACTOR_TOKEN_HEADER]: sessionToken(),
    });
    expect(r.status).toBe(400);
    expect(r.message).toBe("cannot_disable_self");
    expect(getOidcSession).toHaveBeenCalledTimes(1);
    expect(getOidcSession).toHaveBeenCalledWith(SID);
  });
});
