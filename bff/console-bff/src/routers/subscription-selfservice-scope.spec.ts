/**
 * subscription-selfservice-scope.spec.ts —— 客户自助能做什么、不能做什么（2026-09-25）。
 *
 * owner 定：**暂停是平台动作，客户不能控制暂停。**
 *
 * 这份 spec 钉住的重点是 `resume`，不是 `pause`。删 pause 只是少了一个客户能伤自己的
 * 口子；而旧的 `resume` 把 status 直接写回 `active`、**对「是谁暂停的」一个字都不判**
 * ——平台因违规暂停之后，客户自己调一次就把服务拿回去了，而这条端点带的权限是
 * `tenant.billing.manage`，任何租户管理员都能调。
 *
 * 两个动作现在都不在值域里。留这份 spec 是因为「从值域里删掉」在编译期拦得住我们自己，
 * 拦不住**运行时打进来的请求**——它必须在 400 那一层也拒掉，而且要给一句人话。
 */
import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import type { Pool } from "pg";
import type { Request } from "express";

import { SubscriptionRouter } from "./subscription.router";
import type { RequestContext } from "../types/console.types";

/** 任何一次查库都视为失败：这些用例都该在入参校验就被拒，走不到库。 */
function noDbRouter(): SubscriptionRouter {
  const pool = {
    query: vi.fn(() => {
      throw new Error("DB must not be touched");
    }),
  } as unknown as Pool;
  const none = undefined as never;
  const service = {
    getSubscription: vi.fn(() => {
      throw new Error("service must not be touched");
    }),
  } as unknown as never;
  return new SubscriptionRouter(
    service,
    none,
    none,
    none,
    none,
    pool,
    none,
    none,
  );
}

function req(): Request & RequestContext {
  return {
    user: { id: "11111111-1111-4111-8111-111111111111" },
    tenant: { id: "22222222-2222-4222-8222-222222222222" },
    headers: {},
  } as unknown as Request & RequestContext;
}

const SUB_ID = "33333333-3333-4333-8333-333333333333";

describe("客户自助不能控制暂停", () => {
  it.each(["pause", "resume"])(
    "%s 被拒，且**在碰库之前**就拒（不是走到一半再回滚）",
    async (action) => {
      const router = noDbRouter();
      await expect(
        router.executeAction(req(), {
          subscriptionId: SUB_ID,
          action: action as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it("给的是人话，不是「无效操作类型」——它们不是拼错，是不再开放", async () => {
    const router = noDbRouter();
    await expect(
      router.executeAction(req(), {
        subscriptionId: SUB_ID,
        action: "resume" as never,
      }),
    ).rejects.toThrow(/平台操作|联系客服/);
  });

  it("真的拼错了仍然回「无效操作类型」——两种错因不能混成一句", async () => {
    const router = noDbRouter();
    await expect(
      router.executeAction(req(), {
        subscriptionId: SUB_ID,
        action: "paused" as never, // 多了个 d
      }),
    ).rejects.toThrow(/无效操作类型/);
  });

  it("退订仍然开放（别把门修成墙：这一条是客户唯一的自助出口）", async () => {
    const router = noDbRouter();
    /*
     * 判据是**错误信息**，不是异常类型：走过入参校验之后那一步（查订阅）抛的同样是
     * BadRequestException（「订阅不存在」），按类型判分不出「被拦在门口」与「进了门之后
     * 失败」。第一版用类型判，测出来是红的——判据选错，不是行为错。
     */
    await expect(
      router.executeAction(req(), { subscriptionId: SUB_ID, action: "cancel" }),
    ).rejects.toThrow(/订阅不存在/);
  });
});
