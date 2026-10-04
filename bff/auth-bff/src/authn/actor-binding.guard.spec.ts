import "reflect-metadata";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Logger,
  Module,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { OidcKeyService } from "../oidc/oidc-key.service";
import type { RedisService } from "../redis/redis.service";
import { buildAccessClaims } from "../token/access-claims";
import {
  ACTOR_TOKEN_AUDIENCES,
  ACTOR_TOKEN_HEADER,
  ActorBindingGuard,
  isAllowedOperatorSessionAccessToken,
} from "./actor-binding.guard";
import { REJECTION_WARN_INTERVAL_MS } from "./rejection-warn";

// ActorBindingGuard 的单测。签发走**真的** OidcKeyService（RS256、真 PEM、真 JwtService），
// 密钥与 issuer 经 env → `VxConfigModule.register` → zod 域 parse → Nest DI 拿到真正的
// `VxConfigService`——与 internal-auth.guard.spec 同一手法，不手搓 config。
//
// 四种票的形状逐字照抄各自的签发点（spec 里标了行），而不是「随便造一张带 userType 的 JWT」：
//   (a) 会话 access token  oidc.service.ts issueAccessAndId → token.service issueAccessToken → buildAccessClaims
//   (b) OBO 管理票         token-exchange.service.ts exchangeOperator（act / mode / realm / scope mgmt:<product>）
//   (c) step-up 票         oidc.service.ts issueOperatorStepUp（stepup:true / amr）
//   (d) id_token           oidc.service.ts issueAccessAndId 尾部（sid / profile / auth_time，**无 roles**）
// 只有 (a) 且 aud ∈ {admin, arche} 且 sub == actorOperatorId 且中央会话仍在才放。
//
// RedisService 是假的：这里只需要 `getOidcSession`；真 Redis 的那一半在 redis 包的 itest。

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const SUB = `opr_${OPERATOR_ID}`;
const SID = "sid-aaaa-bbbb";
const ISSUER = "https://auth.spec.local";

const ENV_KEYS = [
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "OIDC_ISSUER",
  "OIDC_ALGORITHM",
  "OIDC_ACTIVE_KID",
  "OIDC_SIGNING_PRIVATE_KEY",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

function rsaPrivatePemBase64(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  // env 装载器是按行的，所以生产里走 base64；这里也走同一条路。
  return Buffer.from(privateKey, "utf8").toString("base64");
}

/** 两把不同的密钥：一把是「本 IdP」，另一把演「别人签的票」。 */
const KEY_A = rsaPrivatePemBase64();
const KEY_B = rsaPrivatePemBase64();

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // 第一次 register 会把仓根 .env.local 里尚未设置的键灌进 process.env；先耗掉这一步。
  VxConfigModule.register({ domains: ["auth"], strict: false });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function realKeys(privateKeyB64: string, kid: string) {
  process.env["JWT_SECRET"] = "spec-jwt-secret-value-at-least-32-chars";
  process.env["JWT_REFRESH_SECRET"] = "spec-jwt-refresh-secret-different-32-c";
  process.env["OIDC_ISSUER"] = ISSUER;
  process.env["OIDC_ALGORITHM"] = "RS256";
  process.env["OIDC_ACTIVE_KID"] = kid;
  process.env["OIDC_SIGNING_PRIVATE_KEY"] = privateKeyB64;

  @Module({
    imports: [VxConfigModule.register({ domains: ["auth"], strict: false })],
  })
  class SpecConfigModule {}

  const app = await NestFactory.createApplicationContext(SpecConfigModule, {
    logger: false,
  });
  const config = app.get(VxConfigService);
  // strict:false 下 parse 失败会静默落成 `{}`；用一个必填键证明这次 parse 真的成功了。
  expect(config.auth.OIDC_ISSUER).toBe(ISSUER);
  await app.close();
  const keys = new OidcKeyService(config, new JwtService({}));
  expect(keys.isReady()).toBe(true);
  return keys;
}

interface FakeSession {
  sub: string;
  realm: string;
}

function fakeRedis(sessions: Map<string, FakeSession>) {
  const getOidcSession = vi.fn(async (sid: string) => {
    const s = sessions.get(sid);
    return s
      ? {
          sub: s.sub,
          realm: s.realm,
          authMethod: "password",
          amr: ["pwd"],
          createdAt: 0,
          lastActiveAt: 0,
          absExpiresAt: 0,
        }
      : null;
  });
  return {
    service: { getOidcSession } as unknown as RedisService,
    getOidcSession,
  };
}

interface FakeRequest {
  headers: Record<string, string>;
  body: Record<string, unknown>;
  ip?: string;
  header(name: string): string | undefined;
}

function fakeRequest(
  headers: Record<string, string>,
  body: Record<string, unknown>,
  ip = "10.0.0.1",
): FakeRequest {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    headers: lower,
    body,
    ip,
    header(name: string) {
      return lower[name.toLowerCase()];
    },
  };
}

function disableHandler(): void {}
class OperatorAdminInternalRouter {}

function ctx(req: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => disableHandler,
    getClass: () => OperatorAdminInternalRouter,
  } as unknown as ExecutionContext;
}

// ── 四种票，照各自签发点的形状 ────────────────────────────────────────────────

/** (a) 运营者会话 access token（issueAccessAndId 的 workforce 分支 → buildAccessClaims）。 */
function sessionAccessToken(
  keys: OidcKeyService,
  opts: { aud?: string; sub?: string; sid?: string; ttl?: number } = {},
): string {
  return keys.sign(
    buildAccessClaims({
      sessionId: opts.sid ?? SID,
      roles: [],
      userType: "operator",
      extra: {
        account_status: "active",
        operator_role: "super_admin",
        name: "op",
        dataScope: "global",
        scope: "openid profile admin",
      },
    }),
    {
      audience: opts.aud ?? "admin",
      subject: opts.sub ?? SUB,
      expiresInSec: opts.ttl ?? 900,
    },
  );
}

/** (b) OBO 管理票（token-exchange.service.ts exchangeOperator）。 */
function oboToken(keys: OidcKeyService, aud = "karda"): string {
  return keys.sign(
    {
      act: { sub: "arda" },
      mode: "operator",
      userType: "operator",
      realm: "workforce",
      scope: "mgmt:karda",
    },
    { audience: aud, subject: SUB, expiresInSec: 300 },
  );
}

/** (c) step-up 票（issueOperatorStepUp）。aud 来自请求体，默认 admin。 */
function stepUpToken(keys: OidcKeyService, aud = "admin"): string {
  return keys.sign(
    { stepup: true, userType: "operator", amr: ["otp"] },
    { audience: aud, subject: SUB, expiresInSec: 300 },
  );
}

/** (d) id_token（issueAccessAndId 尾部）：sid + profile + auth_time + userType，**没有 roles**。 */
function idToken(keys: OidcKeyService, aud = "admin"): string {
  return keys.sign(
    {
      sid: SID,
      name: "op",
      email: "op@example.test",
      email_verified: true,
      auth_time: Math.floor(Date.now() / 1000),
      userType: "operator",
    },
    { audience: aud, subject: SUB, expiresInSec: 300 },
  );
}

async function harness(opts: { sessions?: Map<string, FakeSession> } = {}) {
  const keys = await realKeys(KEY_A, "kid-a");
  const sessions =
    opts.sessions ??
    new Map<string, FakeSession>([[SID, { sub: SUB, realm: "workforce" }]]);
  const redis = fakeRedis(sessions);
  const guard = new ActorBindingGuard(keys, redis.service);
  return { keys, guard, sessions, redis };
}

async function expectUnauthorized(
  run: () => Promise<unknown>,
  code: string,
): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(UnauthorizedException);
  expect((caught as UnauthorizedException).message).toBe(code);
}

const body = (actorOperatorId: string = OPERATOR_ID) => ({
  actorOperatorId,
  reason: "r",
});
/** 没有 actorOperatorId 的请求体（传 undefined 会撞上默认参数，所以单独一个工厂）。 */
const bodyWithoutActor = () => ({ reason: "r" });

describe("ActorBindingGuard · 放行的只有「允许的 RP 发给该运营者的会话 access token」", () => {
  it("admin 会话票、sub == actorOperatorId、会话在 → 过", async () => {
    const { keys, guard, redis } = await harness();
    const req = fakeRequest(
      { [ACTOR_TOKEN_HEADER]: sessionAccessToken(keys, { aud: "admin" }) },
      body(),
    );
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    // 第 6 条真的查了会话，而且查的是票里的 sid
    expect(redis.getOidcSession).toHaveBeenCalledWith(SID);
  });

  it("arche 会话票 → 过（第二个合法 RP）", async () => {
    const { keys, guard } = await harness();
    const req = fakeRequest(
      { [ACTOR_TOKEN_HEADER]: sessionAccessToken(keys, { aud: "arche" }) },
      body(),
    );
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it("白名单就是这两个，与两个发送方 oidc-rp.module 的 CLIENT_ID 逐字相同", () => {
    expect([...ACTOR_TOKEN_AUDIENCES].sort()).toEqual(["admin", "arche"]);
  });
});

describe("ActorBindingGuard · 401 actor_token_missing", () => {
  it("没有 x-vxture-actor-token 头 → missing，不碰 Redis", async () => {
    const { guard, redis } = await harness();
    await expectUnauthorized(
      () => guard.canActivate(ctx(fakeRequest({}, body()))),
      "actor_token_missing",
    );
    expect(redis.getOidcSession).not.toHaveBeenCalled();
  });

  it("头在但是空串 → missing", async () => {
    const { guard } = await harness();
    await expectUnauthorized(
      () =>
        guard.canActivate(
          ctx(fakeRequest({ [ACTOR_TOKEN_HEADER]: "" }, body())),
        ),
      "actor_token_missing",
    );
  });
});

describe("ActorBindingGuard · 401 actor_token_invalid（第 1–5 条：这不是一张合法的会话票）", () => {
  it("opera 的会话票 → invalid（opera-bff 持内部口令，却不是账号路由的合法调用方）", async () => {
    const { keys, guard } = await harness();
    const req = fakeRequest(
      { [ACTOR_TOKEN_HEADER]: sessionAccessToken(keys, { aud: "opera" }) },
      body(),
    );
    await expectUnauthorized(
      () => guard.canActivate(ctx(req)),
      "actor_token_invalid",
    );
  });

  it("OBO 管理票（aud = 产品码、act、scope mgmt:*）→ invalid", async () => {
    const { keys, guard } = await harness();
    const req = fakeRequest({ [ACTOR_TOKEN_HEADER]: oboToken(keys) }, body());
    await expectUnauthorized(
      () => guard.canActivate(ctx(req)),
      "actor_token_invalid",
    );
  });

  it("step-up 票（stepup:true，aud admin）→ invalid", async () => {
    const { keys, guard } = await harness();
    const req = fakeRequest(
      { [ACTOR_TOKEN_HEADER]: stepUpToken(keys, "admin") },
      body(),
    );
    await expectUnauthorized(
      () => guard.canActivate(ctx(req)),
      "actor_token_invalid",
    );
  });

  it("id_token 形状（sid + auth_time + profile，无 roles）→ invalid", async () => {
    const { keys, guard } = await harness();
    const req = fakeRequest(
      { [ACTOR_TOKEN_HEADER]: idToken(keys, "admin") },
      body(),
    );
    await expectUnauthorized(
      () => guard.canActivate(ctx(req)),
      "actor_token_invalid",
    );
  });

  it("过期的会话票 → invalid（verify 自己拒）", async () => {
    const { keys, guard } = await harness();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
    const token = sessionAccessToken(keys, { ttl: 60 });
    vi.setSystemTime(new Date("2026-10-04T00:02:00Z"));
    await expectUnauthorized(
      () =>
        guard.canActivate(
          ctx(fakeRequest({ [ACTOR_TOKEN_HEADER]: token }, body())),
        ),
      "actor_token_invalid",
    );
  });

  it("别的密钥签的会话票 → invalid；同一张票在它自己的 IdP 上是能过的（证明差别只在密钥）", async () => {
    const { guard } = await harness();
    const foreign = await realKeys(KEY_B, "kid-b");
    const token = sessionAccessToken(foreign, { aud: "admin" });
    await expectUnauthorized(
      () =>
        guard.canActivate(
          ctx(fakeRequest({ [ACTOR_TOKEN_HEADER]: token }, body())),
        ),
      "actor_token_invalid",
    );
    expect(foreign.verify(token)["sub"]).toBe(SUB);
  });

  it("不是 JWT 的串 → invalid", async () => {
    const { guard } = await harness();
    await expectUnauthorized(
      () =>
        guard.canActivate(
          ctx(fakeRequest({ [ACTOR_TOKEN_HEADER]: "not-a-jwt" }, body())),
        ),
      "actor_token_invalid",
    );
  });

  it("userType 不是 operator（租户会话票，aud 硬改成 admin）→ invalid", async () => {
    const { keys, guard } = await harness();
    const token = keys.sign(
      buildAccessClaims({ sessionId: SID, roles: [], userType: "tenant_user" }),
      { audience: "admin", subject: `usr_${OPERATOR_ID}`, expiresInSec: 300 },
    );
    await expectUnauthorized(
      () =>
        guard.canActivate(
          ctx(fakeRequest({ [ACTOR_TOKEN_HEADER]: token }, body())),
        ),
      "actor_token_invalid",
    );
  });

  it("纵深：aud 在白名单里但带 act / 带 mgmt: scope / 没有 sid 的票都不过", () => {
    const base: Record<string, unknown> = {
      ...buildAccessClaims({ sessionId: SID, roles: [], userType: "operator" }),
      aud: "admin",
      sub: SUB,
    };
    expect(isAllowedOperatorSessionAccessToken(base)).toBe(true);
    expect(
      isAllowedOperatorSessionAccessToken({ ...base, act: { sub: "arda" } }),
    ).toBe(false);
    expect(
      isAllowedOperatorSessionAccessToken({ ...base, scope: "mgmt:karda" }),
    ).toBe(false);
    expect(isAllowedOperatorSessionAccessToken({ ...base, stepup: true })).toBe(
      false,
    );
    const noSid: Record<string, unknown> = { ...base };
    delete noSid["sid"];
    expect(isAllowedOperatorSessionAccessToken(noSid)).toBe(false);
    expect(
      isAllowedOperatorSessionAccessToken({
        ...base,
        sub: `usr_${OPERATOR_ID}`,
      }),
    ).toBe(false);
    expect(
      isAllowedOperatorSessionAccessToken({ ...base, aud: ["admin"] }),
    ).toBe(false);
  });
});

describe("ActorBindingGuard · access token 与 id_token 的判别式（钉住 access-claims.ts 的性质）", () => {
  it("buildAccessClaims 对每一张 access token 都写 roles（缺省 []）——这就是第 5 条依赖的那条性质", () => {
    expect(Array.isArray(buildAccessClaims({}).roles)).toBe(true);
    expect(
      Array.isArray(
        buildAccessClaims({ userType: "operator", sessionId: SID }).roles,
      ),
    ).toBe(true);
    // id_token 的形状（照 issueAccessAndId 尾部）没有 roles
    const idShape = {
      sid: SID,
      name: "op",
      auth_time: 1,
      userType: "operator",
      aud: "admin",
      sub: SUB,
    };
    expect("roles" in idShape).toBe(false);
    expect(isAllowedOperatorSessionAccessToken(idShape)).toBe(false);
    expect(isAllowedOperatorSessionAccessToken({ ...idShape, roles: [] })).toBe(
      true,
    );
  });
});

describe("ActorBindingGuard · 401 actor_token_mismatch（票可信，但绑不到请求体点名的人）", () => {
  it("sub 与 actorOperatorId 不符 → mismatch，且没去查会话", async () => {
    const { keys, guard, redis } = await harness();
    const req = fakeRequest(
      { [ACTOR_TOKEN_HEADER]: sessionAccessToken(keys) },
      body(OTHER_ID),
    );
    await expectUnauthorized(
      () => guard.canActivate(ctx(req)),
      "actor_token_mismatch",
    );
    expect(redis.getOidcSession).not.toHaveBeenCalled();
  });

  it("请求体没有 actorOperatorId → mismatch（没有可绑的对象）", async () => {
    const { keys, guard } = await harness();
    const req = fakeRequest(
      { [ACTOR_TOKEN_HEADER]: sessionAccessToken(keys) },
      bodyWithoutActor(),
    );
    await expectUnauthorized(
      () => guard.canActivate(ctx(req)),
      "actor_token_mismatch",
    );
  });

  it("中央会话已被 endOperatorSessions 删掉 → mismatch：票还在 15 分钟寿命内也立刻失效", async () => {
    const { keys, guard, sessions } = await harness();
    const token = sessionAccessToken(keys);
    const req = () => fakeRequest({ [ACTOR_TOKEN_HEADER]: token }, body());
    await expect(guard.canActivate(ctx(req()))).resolves.toBe(true);
    sessions.delete(SID);
    await expectUnauthorized(
      () => guard.canActivate(ctx(req())),
      "actor_token_mismatch",
    );
  });

  it("sid 对应的会话属于另一个 sub → mismatch", async () => {
    const { keys, guard, sessions } = await harness();
    sessions.set(SID, { sub: `opr_${OTHER_ID}`, realm: "workforce" });
    const req = fakeRequest(
      { [ACTOR_TOKEN_HEADER]: sessionAccessToken(keys) },
      body(),
    );
    await expectUnauthorized(
      () => guard.canActivate(ctx(req)),
      "actor_token_mismatch",
    );
  });

  it("Redis 不可用（getOidcSession 抛 503）→ 原样放出去，不压成 401", async () => {
    const { keys, guard, redis } = await harness();
    redis.getOidcSession.mockRejectedValueOnce(
      new ServiceUnavailableException("OIDC session lookup failed"),
    );
    const req = fakeRequest(
      { [ACTOR_TOKEN_HEADER]: sessionAccessToken(keys) },
      body(),
    );
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe("ActorBindingGuard · 拒绝时的限速 warn（1/ip/min，不带票）", () => {
  it("打一条 warn：带码、路由名、remote，不带呈交的票", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const { keys, guard } = await harness();
    const token = sessionAccessToken(keys, { aud: "opera" });
    const req = fakeRequest(
      { [ACTOR_TOKEN_HEADER]: token },
      body(),
      "10.9.8.7",
    );
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("actor_token_invalid");
    expect(line).toContain("route=OperatorAdminInternalRouter.disableHandler");
    expect(line).toContain("remote=10.9.8.7");
    expect(line).not.toContain(token);
  });

  it("同一 IP 一分钟内只一条；过了一分钟再打；另一个 IP 单独计", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const { guard } = await harness();
    const hit = async (ip: string) => {
      await expect(
        guard.canActivate(ctx(fakeRequest({}, body(), ip))),
      ).rejects.toThrow(UnauthorizedException);
    };
    await hit("10.0.0.1");
    await hit("10.0.0.1");
    expect(warn).toHaveBeenCalledTimes(1);
    await hit("10.0.0.2");
    expect(warn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(REJECTION_WARN_INTERVAL_MS - 1);
    await hit("10.0.0.1");
    expect(warn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    await hit("10.0.0.1");
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("放行不打 warn", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const { keys, guard } = await harness();
    const req = fakeRequest(
      { [ACTOR_TOKEN_HEADER]: sessionAccessToken(keys) },
      body(),
    );
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
