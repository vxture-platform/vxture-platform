/**
 * product-health.spec.ts — 就绪探测里两条**翻译**的单测。
 *
 * 这两条都不是逻辑复杂，是**词表对不齐**，而对不齐的表现是「页面绿着 / 栏目空着」，
 * 不是报错。所以钉在测试里，不靠读代码时记得。
 *
 * 两条都由 2026-08-23 的 atlas / runos 联调实测反推：
 *   - atlas `/readyz` 恒回 HTTP 200，坏了也只体现在 body 的 `status: "blocked"`
 *   - atlas 的 `checks` 值是对象（`{status,latencyMs}`），不是字符串
 */

import { describe, expect, it } from "vitest";

import { readChecks, readinessFromBody } from "./product-health.router";

describe("readinessFromBody —— 产品自报的就绪词 → 本页三档", () => {
  it("认 025 标准的三个词", () => {
    expect(readinessFromBody("ready", 200)).toBe("ready");
    expect(readinessFromBody("degraded", 200)).toBe("degraded");
    expect(readinessFromBody("blocked", 200)).toBe("fail");
  });

  /**
   * 这条是整个函数存在的理由。atlas 的 `/readyz` handler 不改状态码，所以数据库挂了
   * 也是 **HTTP 200 + `status:"blocked"`**；旧实现不认 `blocked`，落到状态码兜底，
   * 把它判成 `ready`——服务状态页对着一个坏掉的 atlas 显示「就绪」。
   */
  it("blocked 但 HTTP 200（atlas 的形状）判成 fail，不是 ready", () => {
    expect(readinessFromBody("blocked", 200)).toBe("fail");
  });

  it("runos 的形状（blocked + 503）也是 fail", () => {
    expect(readinessFromBody("blocked", 503)).toBe("fail");
  });

  it("`fail` 继续认——它是本页对外的档位名", () => {
    expect(readinessFromBody("fail", 200)).toBe("fail");
  });

  it("没有可辨认的自报状态时才回落到 HTTP 状态码", () => {
    expect(readinessFromBody(null, 200)).toBe("ready");
    expect(readinessFromBody(null, 503)).toBe("fail");
    expect(readinessFromBody("something-else", 500)).toBe("fail");
  });
});

describe("readChecks —— 逐依赖明细", () => {
  /** atlas 的真实形状：值是对象。旧实现只收字符串，于是整栏恒为空。 */
  it("对象形状的 check 取 status，并带上延迟", () => {
    expect(
      readChecks({
        checks: {
          database: { status: "pass", latencyMs: 2 },
          modelRegistry: { status: "pass", latencyMs: 109, activeModels: 87 },
        },
      }),
    ).toEqual({ database: "pass 2ms", modelRegistry: "pass 109ms" });
  });

  it("字符串形状原样收（另一种合法写法）", () => {
    expect(readChecks({ checks: { redis: "pass" } })).toEqual({
      redis: "pass",
    });
  });

  it("没有 status 的对象跳过，不编一个出来", () => {
    expect(readChecks({ checks: { weird: { latencyMs: 3 } } })).toBeNull();
  });

  it("没有 checks / 形状不对时回 null，不是空对象", () => {
    expect(readChecks(null)).toBeNull();
    expect(readChecks({})).toBeNull();
    expect(readChecks({ checks: ["a"] })).toBeNull();
  });
});
