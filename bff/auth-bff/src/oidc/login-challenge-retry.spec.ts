import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { OidcService } from "./oidc.service";

/**
 * 登录挑战要到凭据验过才消耗（owner 2026-09-15 报「串台」）。
 *
 * ── 断在哪 ──
 * 交互登录一进门就 GETDEL 挑战。人机验证没过或密码输错之后，第二次提交必然 400
 * invalid_login_challenge；登录页把 400 当「会话失效」送人回「上一个应用」——对一个
 * 在 opera 登录页输错一次密码、浏览器里还挂着 console 会话的运营者，那就是 console。
 *
 * 这一组三条：失败不消耗（租户 / 运营两条路）、成功才消耗；以及并发下只有一个赢。
 */
const CHALLENGE = {
  clientId: "opera",
  realm: "workforce",
  redirectUri: "https://x.vxture.com/api/auth/callback",
  scope: "openid",
  codeChallenge: "c",
};

function build(
  realm: "workforce" | "customer",
  opts: { consumeReturns?: unknown } = {},
) {
  const store = new Map<string, unknown>([["lc-1", { ...CHALLENGE, realm }]]);
  const redis = {
    readOidcLoginChallenge: vi.fn(async (k: string) => store.get(k) ?? null),
    consumeOidcLoginChallenge: vi.fn(async (k: string) => {
      if ("consumeReturns" in opts) return opts.consumeReturns;
      const v = store.get(k) ?? null;
      store.delete(k);
      return v;
    }),
  };
  const service = Object.create(OidcService.prototype) as OidcService;
  Object.assign(service, {
    redis,
    clients: {
      findEnabledByClientId: vi.fn(async () => ({ clientId: "opera", realm })),
    },
    operatorGuard: {
      assertWithinRateLimit: vi.fn(),
      verifyTurnstile: vi.fn(async () => undefined),
      recordFailure: vi.fn(),
      recordSuccess: vi.fn(),
    },
    operators: { authenticateOperator: vi.fn(async () => null) },
    tenantGuard: { verifyTurnstile: vi.fn(async () => undefined) },
    authn: { loginWithPassword: vi.fn(async () => null) },
    recordOperatorAttempt: vi.fn(async () => undefined),
    recordTenantAttempt: vi.fn(async () => undefined),
  });
  return { service, redis, store };
}

const input = {
  loginChallenge: "lc-1",
  identifier: "someone",
  password: "wrong",
};

describe("交互登录：失败不消耗登录挑战", () => {
  it("运营者密码错 → 401，挑战还在，可以原地再试", async () => {
    const { service, redis, store } = build("workforce");
    await expect(
      service.completeLoginWithPassword(input),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(redis.consumeOidcLoginChallenge).not.toHaveBeenCalled();
    expect(store.has("lc-1")).toBe(true);
  });

  it("运营者人机验证没过 → 抛出，挑战还在", async () => {
    const { service, store } = build("workforce");
    (
      service as unknown as {
        operatorGuard: { verifyTurnstile: ReturnType<typeof vi.fn> };
      }
    ).operatorGuard.verifyTurnstile.mockRejectedValueOnce(
      new UnauthorizedException("human_verification_failed"),
    );
    await expect(
      service.completeLoginWithPassword(input),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.has("lc-1")).toBe(true);
  });

  it("租户密码错 → 401，挑战还在", async () => {
    const { service, store } = build("customer");
    await expect(
      service.completeLoginWithPassword(input),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.has("lc-1")).toBe(true);
  });

  /* 反向对照：凭据对了才消耗，而且消耗失败（另一个标签页先赢了）照旧 400——
     没有这一条，「永远不消耗」的实现同样能过上面三条。 */
  it("运营者凭据正确 → 消耗；被别处抢先消耗 → 400 invalid_login_challenge", async () => {
    const { service, redis } = build("workforce", { consumeReturns: null });
    (
      service as unknown as {
        operators: { authenticateOperator: ReturnType<typeof vi.fn> };
      }
    ).operators.authenticateOperator.mockResolvedValueOnce({ id: "op-1" });
    await expect(
      service.completeLoginWithPassword(input),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(redis.consumeOidcLoginChallenge).toHaveBeenCalledWith("lc-1");
  });

  it("挑战本来就不在 → 400，不碰凭据", async () => {
    const { service } = build("workforce");
    await expect(
      service.completeLoginWithPassword({ ...input, loginChallenge: "gone" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (
        service as unknown as {
          operators: { authenticateOperator: ReturnType<typeof vi.fn> };
        }
      ).operators.authenticateOperator,
    ).not.toHaveBeenCalled();
  });
});
