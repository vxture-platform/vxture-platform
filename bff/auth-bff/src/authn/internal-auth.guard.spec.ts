import "reflect-metadata";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ForbiddenException,
  Logger,
  Module,
  UnauthorizedException,
} from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Reflector } from "@nestjs/core";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import {
  InternalAuthGuard,
  INTERNAL_AUTH_HEADER,
  INVALID_AUTH_WARN_INTERVAL_MS,
} from "./internal-auth.guard";
import {
  INTERNAL_ROUTE_POLICY,
  type InternalRoutePolicy,
} from "./internal-route-policy";

// Unit tests: legacy shared-secret guard only. This guard protects
// operator/account admin-internal routers (post-review scope correction,
// 2026-07-12) — it must NEVER accept a bearer/S2S credential; see
// platform-auth.guard.spec.ts for the dual-accept guard used by the
// platform-face C2/C3 self-service routers.
//
// 2026-10-01 起它还有第二道门：路由准入（deny-by-default）。两道门的**顺序**是
// 本文件最该守住的性质，见「凭据先判」那一组。
//
// 2026-10-04 拆钥匙：这个面只认 `IDP_INTERNAL_TOKEN`，产品面的 `AUTH_INTERNAL_TOKEN`
// 对它必须是外人。**config 不再手搓**：此前 spec 把 `{ auth: { AUTH_INTERNAL_TOKEN } }`
// `as unknown as` 塞给 guard，绕过了 zod 的域 parse——它证「guard 读了哪个字段」，不证
// 「env 里的键到得了 config」。现在每个用例都把 env 喂给真正的 `VxConfigModule.register`
// （`stripEmptyEnvValues` → `authSchema.parse`），再经 Nest DI 拿到真正的 `VxConfigService`。
// 一个 schema 里没声明的键在这条路上会被剥掉——这正是「做了没接」会藏身的那一层。

const IDP_SECRET = "idp-internal-secret-value-32-bytes-min";
const AUTH_SECRET = "auth-internal-secret-product-face-value";

const DECLARED: InternalRoutePolicy = {
  risk: "admin-action",
  actor: "declared-unbound",
  why: "测试用",
};

// ── 真 config：env → VxConfigModule.register → Nest DI → VxConfigService ─────────

const ENV_KEYS = [
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "AUTH_INTERNAL_TOKEN",
  "IDP_INTERNAL_TOKEN",
] as const;
const JWT_SECRET = "spec-jwt-secret-value-at-least-32-chars";
const JWT_REFRESH_SECRET = "spec-jwt-refresh-secret-different-32-chars";

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // `register()` 第一次调用会把仓根 `.env.local` 里**尚未设置**的键灌进 process.env
  // （本机有 AUTH_INTERNAL_TOKEN=...，CI 没有这个文件）。先空跑一次把这一步耗掉，
  // 之后每个用例自己 set / delete，结果与机器无关。
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

async function realConfig(tokens: {
  AUTH_INTERNAL_TOKEN?: string;
  IDP_INTERNAL_TOKEN?: string;
}): Promise<VxConfigService> {
  process.env["JWT_SECRET"] = JWT_SECRET;
  process.env["JWT_REFRESH_SECRET"] = JWT_REFRESH_SECRET;
  for (const k of ["AUTH_INTERNAL_TOKEN", "IDP_INTERNAL_TOKEN"] as const) {
    if (tokens[k] === undefined) delete process.env[k];
    else process.env[k] = tokens[k];
  }

  @Module({
    imports: [VxConfigModule.register({ domains: ["auth"], strict: false })],
  })
  class SpecConfigModule {}

  const app = await NestFactory.createApplicationContext(SpecConfigModule, {
    logger: false,
  });
  const config = app.get(VxConfigService);
  // strict:false 下 parse 失败会静默落成 `{}`——那样下面的断言会误把「没解析」读成「没配」。
  // 用一个必填键证明这次 parse 真的成功了。
  expect(config.auth.JWT_SECRET).toBe(JWT_SECRET);
  await app.close();
  return config;
}

/**
 * 假 Reflector：只实现 `get`，并且**只认方法级 target**——与实现一致（实现不走
 * getAllAndOverride 的类级回落，理由见 internal-route-policy.ts）。
 */
function fakeReflector(policyByHandler: Map<unknown, InternalRoutePolicy>) {
  return {
    get: (key: string, target: unknown) =>
      key === INTERNAL_ROUTE_POLICY ? policyByHandler.get(target) : undefined,
  } as unknown as Reflector;
}

async function makeGuard(
  tokens: { AUTH_INTERNAL_TOKEN?: string; IDP_INTERNAL_TOKEN?: string },
  policyByHandler = new Map<unknown, InternalRoutePolicy>(),
): Promise<InternalAuthGuard> {
  return new InternalAuthGuard(
    await realConfig(tokens),
    fakeReflector(policyByHandler),
  );
}

interface FakeRequest {
  headers: Record<string, string>;
  ip?: string;
  header(name: string): string | undefined;
}

function fakeRequest(
  headers: Record<string, string> = {},
  ip = "10.0.0.1",
): FakeRequest {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    headers: lower,
    ip,
    header(name: string) {
      return lower[name.toLowerCase()];
    },
  };
}

function handlerFn(): void {}
class FakeRouter {}

function ctx(req: FakeRequest, handler: unknown = handlerFn): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => FakeRouter,
  } as unknown as ExecutionContext;
}

const DECLARED_MAP = new Map([[handlerFn, DECLARED]]);

/** 已声明的上下文（声明挂在 handlerFn 上），默认只配 IDP 那把。 */
function declaredGuard(
  tokens: { AUTH_INTERNAL_TOKEN?: string; IDP_INTERNAL_TOKEN?: string } = {
    IDP_INTERNAL_TOKEN: IDP_SECRET,
  },
) {
  return makeGuard(tokens, DECLARED_MAP);
}

function expectUnauthorized(fn: () => unknown, code: string) {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(UnauthorizedException);
  expect((caught as UnauthorizedException).message).toBe(code);
}

describe("InternalAuthGuard · 凭据（只认 IDP_INTERNAL_TOKEN）", () => {
  it("passes with the IDP value in x-vxture-internal-auth on a declared route", async () => {
    const guard = await declaredGuard();
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: IDP_SECRET });
    expect(guard.canActivate(ctx(req))).toBe(true);
  });

  it("rejects a wrong shared secret → 401 invalid_internal_auth", async () => {
    const guard = await declaredGuard();
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: "wrong" });
    expectUnauthorized(
      () => guard.canActivate(ctx(req)),
      "invalid_internal_auth",
    );
  });

  it("fails closed when IDP_INTERNAL_TOKEN is unconfigured → 401 internal_auth_unavailable", async () => {
    const guard = await declaredGuard({});
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: "anything" });
    expectUnauthorized(
      () => guard.canActivate(ctx(req)),
      "internal_auth_unavailable",
    );
  });

  it("rejects when no header is presented → 401 invalid_internal_auth", async () => {
    const guard = await declaredGuard();
    expectUnauthorized(
      () => guard.canActivate(ctx(fakeRequest())),
      "invalid_internal_auth",
    );
  });

  it("ignores an Authorization: Bearer header — this guard has no S2S path", async () => {
    // A caller presenting a bearer token (even a well-formed one) but no
    // legacy header must still be rejected here — this guard's consumers
    // (operator/account admin-internal routers) must never accept S2S
    // tokens, which is exactly the bug the platform-auth.guard.ts split fixed.
    const guard = await declaredGuard();
    const req = fakeRequest({ authorization: "Bearer some.jwt.token" });
    expectUnauthorized(
      () => guard.canActivate(ctx(req)),
      "invalid_internal_auth",
    );
  });
});

describe("InternalAuthGuard · 产品面的钥匙是外人（无回落）", () => {
  it("① 只设 AUTH_INTERNAL_TOKEN、头带的就是 AUTH 的值 → 401 internal_auth_unavailable", async () => {
    // 头写 "anything" 分不出「读旧键」「IDP ?? AUTH 回落」「真无回落」三种实现——
    // 只有头带旧值才是回落探测器：回落实现会在这里放行。
    const guard = await declaredGuard({ AUTH_INTERNAL_TOKEN: AUTH_SECRET });
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: AUTH_SECRET });
    expectUnauthorized(
      () => guard.canActivate(ctx(req)),
      "internal_auth_unavailable",
    );
  });

  it("② 两把都设、头带 AUTH 值 → 401 invalid_internal_auth", async () => {
    const guard = await declaredGuard({
      AUTH_INTERNAL_TOKEN: AUTH_SECRET,
      IDP_INTERNAL_TOKEN: IDP_SECRET,
    });
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: AUTH_SECRET });
    expectUnauthorized(
      () => guard.canActivate(ctx(req)),
      "invalid_internal_auth",
    );
  });

  it("③ 两把都设、头带 IDP 值 → 过", async () => {
    const guard = await declaredGuard({
      AUTH_INTERNAL_TOKEN: AUTH_SECRET,
      IDP_INTERNAL_TOKEN: IDP_SECRET,
    });
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: IDP_SECRET });
    expect(guard.canActivate(ctx(req))).toBe(true);
  });

  it("env 里的 IDP_INTERNAL_TOKEN 真的穿过了域 parse（不是手搓对象在撑场）", async () => {
    const config = await realConfig({ IDP_INTERNAL_TOKEN: IDP_SECRET });
    expect(config.auth.IDP_INTERNAL_TOKEN).toBe(IDP_SECRET);
    expect(config.auth.AUTH_INTERNAL_TOKEN).toBeUndefined();
  });
});

describe("InternalAuthGuard · invalid_internal_auth 的 warn（限速 1/ip/min）", () => {
  it("错钥匙打一条 warn，带 remote 与路由名，不带呈交的值", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const guard = await declaredGuard();
    const req = fakeRequest(
      { [INTERNAL_AUTH_HEADER]: AUTH_SECRET },
      "10.9.8.7",
    );
    expect(() => guard.canActivate(ctx(req))).toThrow(UnauthorizedException);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("invalid_internal_auth");
    expect(line).toContain("remote=10.9.8.7");
    expect(line).toContain("route=FakeRouter.handlerFn");
    expect(line).not.toContain(AUTH_SECRET);
  });

  it("同一 IP 一分钟内第二次不再打；过了一分钟再打；另一个 IP 单独计", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const guard = await declaredGuard();
    const hit = (ip: string) => {
      const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: "wrong" }, ip);
      expect(() => guard.canActivate(ctx(req))).toThrow(UnauthorizedException);
    };
    hit("10.0.0.1");
    hit("10.0.0.1");
    expect(warn).toHaveBeenCalledTimes(1);
    hit("10.0.0.2");
    expect(warn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(INVALID_AUTH_WARN_INTERVAL_MS - 1);
    hit("10.0.0.1");
    expect(warn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    hit("10.0.0.1");
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("未配置（internal_auth_unavailable）不打这条 warn —— 那是启动 warn 的事", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const guard = await declaredGuard({});
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: IDP_SECRET });
    expect(() => guard.canActivate(ctx(req))).toThrow(UnauthorizedException);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("InternalAuthGuard · 路由准入（deny-by-default）", () => {
  it("凭据对但路由没声明 → 403，不是放行", async () => {
    const guard = await makeGuard({ IDP_INTERNAL_TOKEN: IDP_SECRET }); // 空声明表
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: IDP_SECRET });
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });

  it("类级声明不生效：声明挂在 class 上时仍然 403", async () => {
    // 实现只读方法级。这条测试锁住那个选择——否则有人把声明挪到 @Controller 上，
    // 整个 controller 会「看起来声明了」而实际全是 deny（或更糟，全是放行）。
    const guard = await makeGuard(
      { IDP_INTERNAL_TOKEN: IDP_SECRET },
      new Map([[FakeRouter, DECLARED]]),
    );
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: IDP_SECRET });
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });

  it("两道门的顺序：没凭据 + 没声明 → 401 而不是 403", async () => {
    // 顺序反了的话，没有凭据的调用方能从 403 与 401 的差别里读出「这条路由
    // 存不存在」。这是本文件最该守住的性质。
    const guard = await makeGuard({ IDP_INTERNAL_TOKEN: IDP_SECRET });
    expectUnauthorized(
      () => guard.canActivate(ctx(fakeRequest())),
      "invalid_internal_auth",
    );
  });
});
