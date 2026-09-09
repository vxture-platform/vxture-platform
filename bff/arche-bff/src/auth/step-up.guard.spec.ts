/**
 * step-up.guard.spec.ts — 高危路由的二次验证闸门。
 *
 * ── 这一格为什么值得测 ──
 * 这是治理平面上**唯一**挡在高危写操作前面的东西。它坏掉的三种方式，屏幕上都看不
 * 出来：路由照常返回 200，只是没验第二次。
 *
 * 被测件自己的文件头写了三条不变量，下面逐条钉：
 *
 *   1. **只 gate 写路由** —— 没标注 `@RequireStepUp()` 的路由直接放行。
 *      这条反过来也重要：如果 guard 对所有路由都 gate，读路由会全线 403，
 *      那是个吵闹的坏法，会被立刻发现；真正危险的是下面两条。
 *   2. **绑会话** —— 凭证签给 A、在 A 的浏览器里，只对 A 的会话有效。
 *      少了这一条，拿到任何一枚有效 step-up 凭证的人都能过任何人的闸门。
 *   3. **fail-closed** —— 验不出来就是没过。少了这一条，JWKS 抖一下所有高危操作
 *      就敞开了，而且抖动是间歇的、事后查不到。
 *
 * 另外钉住 cookie **不与 admin / opera 同名**：三个门户在同一父域下，同名 cookie
 * 会互相覆盖，表现为「在 admin 验过之后 arche 也放行」——那等于把三个门户的高危
 * 闸门连成一个。这一条只看常量，但它值一行测试：改名字的人未必知道为什么。
 */

import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { OperatorStepUpGuard } from "./step-up.guard";
import { stepUpCookieName } from "./step-up.decorator";
import { RP_OIDC_CLIENT, RP_RUNTIME } from "../oidc/oidc-rp.tokens";

const OPERATOR_ID = "42";
/** 会话 operator 对应的 sub。凭证里的 sub 必须正好是它。 */
const OWN_SUB = `opr_${OPERATOR_ID}`;
const COOKIE = stepUpCookieName(false);

type Claims = Record<string, unknown>;

/** 验签结果由每个用例给定：resolve 一组 claims，或 reject（验不出来）。 */
function makeGuard(verify: () => Promise<Claims>, required = true) {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(required),
  };
  const oidcClient = { verifyAccessToken: vi.fn(verify) };
  const moduleRef = {
    get: vi.fn((token: unknown) => {
      if (token === RP_OIDC_CLIENT) return oidcClient;
      if (token === RP_RUNTIME) return { cookieSecure: false };
      throw new Error("unexpected token");
    }),
  };
  const guard = new OperatorStepUpGuard(reflector as never, moduleRef as never);
  return { guard, reflector, oidcClient, moduleRef };
}

function ctx(req: unknown): ExecutionContext {
  return {
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/** 一个「什么都对」的请求：有会话、有 cookie。claims 由 makeGuard 决定。 */
const goodReq = {
  operator: { id: OPERATOR_ID },
  cookies: { [COOKIE]: "a.jwt.token" },
};

const ok = async (): Promise<Claims> => ({ sub: OWN_SUB, stepup: true });

/**
 * 断言「被闸门拦下」。
 *
 * `ApiError extends HttpException`，错误码在**响应信封**里（`getResponse()`），
 * 不是顶层的 `.code`——初稿断言 `.code` 全都不匹配，而门本身是对的。
 *
 * 顺带钉住 403：门户的 StepUpProvider 就是靠这个状态码决定要不要发起仪式，
 * 换成 401 会让它去走重新登录，而不是二次验证。
 */
async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow();
  const err = await p.catch((e) => e);
  expect(err.getStatus()).toBe(403);
  expect(err.getResponse()).toMatchObject({
    code: "AUTH_STEP_UP_REQUIRED",
    message: "step_up_required",
  });
}

describe("① 只 gate 写路由", () => {
  it("没标注 @RequireStepUp 的路由直接放行，连凭证都不看", async () => {
    const { guard, oidcClient } = makeGuard(ok, false);
    // 请求里连 operator 和 cookie 都没有——照样过，因为这条路由根本没被标注。
    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
    // 而且不该白白去验一枚不存在的凭证。
    expect(oidcClient.verifyAccessToken).not.toHaveBeenCalled();
  });
});

describe("② 绑会话 —— 拿别人的凭证无效", () => {
  it("凭证有效、stepup=true，但 sub 是别的 operator → 拒", async () => {
    // 这是最危险的一种坏法：凭证本身完全合法（签名对、没过期、stepup=true），
    // 只是不属于当前会话。少了这一条，一枚泄露的凭证能开所有人的门。
    const { guard } = makeGuard(async () => ({
      sub: "opr_999",
      stepup: true,
    }));
    await expectDenied(guard.canActivate(ctx(goodReq)));
  });

  it("sub 正好等于会话 operator → 放行", async () => {
    const { guard } = makeGuard(ok);
    await expect(guard.canActivate(ctx(goodReq))).resolves.toBe(true);
  });

  it("sub 少了 `opr_` 前缀不算数 —— 裸 id 不等于主体标识", async () => {
    const { guard } = makeGuard(async () => ({
      sub: OPERATOR_ID,
      stepup: true,
    }));
    await expectDenied(guard.canActivate(ctx(goodReq)));
  });

  it("**请求体永不被信任** —— body 里报一个 operatorId 不能顶替会话", async () => {
    const { guard } = makeGuard(async () => ({
      sub: "opr_999",
      stepup: true,
    }));
    const spoofed = {
      ...goodReq,
      body: { operatorId: "999" },
    };
    await expectDenied(guard.canActivate(ctx(spoofed)));
  });
});

describe("③ fail-closed", () => {
  it("验签抛错 → 拒，不因 JWKS 抖动而放行", async () => {
    // 放行才是危险的坏法：抖动是间歇的，事后查不到，而这段时间所有高危操作敞开。
    const { guard } = makeGuard(async () => {
      throw new Error("JWKS unreachable");
    });
    await expectDenied(guard.canActivate(ctx(goodReq)));
  });

  it("claims 里没有 stepup=true → 拒（一枚普通 access token 不算 step-up）", async () => {
    const { guard } = makeGuard(async () => ({ sub: OWN_SUB }));
    await expectDenied(guard.canActivate(ctx(goodReq)));
  });

  it('stepup 是字符串 "true" 也不算 —— 只认布尔真', async () => {
    const { guard } = makeGuard(async () => ({
      sub: OWN_SUB,
      stepup: "true",
    }));
    await expectDenied(guard.canActivate(ctx(goodReq)));
  });
});

describe("前置条件缺失", () => {
  it("没有会话 operator → 拒（中间件本该填好，缺失即无会话）", async () => {
    const { guard, oidcClient } = makeGuard(ok);
    await expectDenied(
      guard.canActivate(ctx({ cookies: { [COOKIE]: "a.jwt.token" } })),
    );
    expect(oidcClient.verifyAccessToken).not.toHaveBeenCalled();
  });

  it("没有 cookie → 拒", async () => {
    const { guard } = makeGuard(ok);
    await expectDenied(
      guard.canActivate(ctx({ operator: { id: OPERATOR_ID } })),
    );
  });

  it("cookie 存在但不是字符串 → 拒", async () => {
    const { guard } = makeGuard(ok);
    const weird = {
      operator: { id: OPERATOR_ID },
      cookies: { [COOKIE]: { not: "a string" } },
    };
    await expectDenied(guard.canActivate(ctx(weird)));
  });

  it("凭证放在**别的门户**的 cookie 名下不算数", async () => {
    // 同一父域下三个门户各有各的 cookie；认错名字等于认了别家的闸门。
    const { guard } = makeGuard(ok);
    const wrongName = {
      operator: { id: OPERATOR_ID },
      cookies: { vx_op_stepup: "a.jwt.token" },
    };
    await expectDenied(guard.canActivate(ctx(wrongName)));
  });
});

describe("cookie 名", () => {
  it("secure 下走 __Host- 前缀", () => {
    // __Host- 前缀强制 Secure + Path=/ + 无 Domain：子域写不进来。
    expect(stepUpCookieName(true)).toBe("__Host-vx_arche_stepup");
  });

  it("非 secure(本地开发)下是裸名", () => {
    expect(stepUpCookieName(false)).toBe("vx_arche_stepup");
  });

  it("**不与 admin / opera 同名** —— 同名会把三个门户的闸门连成一个", () => {
    // admin 是 vx_op_stepup、opera 是 vx_opera_stepup。三者在同一父域下，
    // 同名 cookie 互相覆盖，表现为「在 admin 验过之后 arche 也放行」。
    for (const secure of [true, false]) {
      const name = stepUpCookieName(secure);
      expect(name).toContain("arche");
      expect(name).not.toContain("vx_op_stepup");
      expect(name).not.toContain("opera");
    }
  });
});
