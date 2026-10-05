/**
 * launch-checks.spec.ts —— 「全部通过」到底数哪几条。
 *
 * 只钉 `allPassed()` 这一个纯函数，因为它是整份上线检查里**唯一能让按钮点不动**的
 * 判据：`LaunchDrawer` 的 `confirmLaunch()` 拿它决定要不要逼人写跳过理由。
 *
 * ── 为什么这份文件是 2026-09-17 才出现的 ──
 * 那天往检查里加「开通回执」时才发现，`allPassed()` 数的是 `runLaunchChecks()` 的
 * **全部**返回值，而抽屉里显示哪几条由另一张表（`MEASURE_ONLY`）决定。两者不是同一个
 * 集合，于是可以有一条**界面上不存在、却一票否决上线**的检查——`acceptance-chain`
 * 当时正落在这个缝里。加一条谁都还没实现的新约定进来，会把每个产品的上线都推进
 * 「带理由跳过」那条路，而按钮上看不出是被哪一条挡的。
 *
 * 所以这里钉的不是「advisory 这个字段存在」，是**它真的被排除在判定之外**。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import {
  allPassed,
  legacyAuthThisMonth,
  runLaunchChecks,
  signalFacts,
  type CheckResult,
} from "./launch-checks";

/* `runLaunchChecks` 从模块级的 `api` 发五个读；这里把它换成按 URL 分流的桩，别的读都给
   「没有」，只有 integration-signals 这一路由测试各自塞。`OperaApiError` 要是个 class：
   `reason()` 用 instanceof 判。 */
vi.mock("@/lib/api", () => {
  class OperaApiError extends Error {}
  return { api: { get: vi.fn() }, OperaApiError };
});

function check(over: Partial<CheckResult>): CheckResult {
  return {
    id: "x",
    label: "x",
    what: "",
    side: "ours",
    status: "pass",
    detail: "",
    remedy: null,
    ...over,
  };
}

describe("allPassed —— 只数参与判定的那些", () => {
  it("全通过：true", () => {
    expect(allPassed([check({ id: "a" }), check({ id: "b" })])).toBe(true);
  });

  it("有一条未通过：false", () => {
    expect(
      allPassed([check({ id: "a" }), check({ id: "b", status: "fail" })]),
    ).toBe(false);
  });

  it("**advisory 未通过不算数**——这一条错了，每个产品的上线都会被逼着写理由", () => {
    expect(
      allPassed([
        check({ id: "a" }),
        check({ id: "ack", status: "fail", advisory: true }),
      ]),
    ).toBe(true);
  });

  it("advisory 通过了也不改变结论——它不是加分项", () => {
    expect(
      allPassed([
        check({ id: "a", status: "fail" }),
        check({ id: "ack", advisory: true }),
      ]),
    ).toBe(false);
  });

  it("只有 advisory 条目：false，不能因为没有硬条件就宣布全通过", () => {
    expect(allPassed([check({ id: "ack", advisory: true })])).toBe(false);
  });

  it("空数组：false（读不到不等于通过，与全文件的失败方向一致）", () => {
    expect(allPassed([])).toBe(false);
  });
});

describe("legacyAuthThisMonth —— E6 那句话里的 n", () => {
  it("按路由的计数合成一个总数", () => {
    expect(
      legacyAuthThisMonth({
        byRoute: { entitlements: 12, "usage.consume": 3 },
      }),
    ).toBe(15);
  });

  it("空 byRoute 是 0——0 要上屏（E3a 那天看的就是 0），不是「没有」", () => {
    expect(legacyAuthThisMonth({ byRoute: {} })).toBe(0);
  });

  it("BFF 没给这一段：undefined，那句话不上屏；不把「读不到」画成 0", () => {
    expect(legacyAuthThisMonth(undefined)).toBeUndefined();
  });
});

describe("signalFacts —— 抽屉的行从实测结果整段抄的那几句事实", () => {
  it("代上报的 reporter 与 E6 的 n 一起到行上（接入检查抽屉此前只抄了 n）", () => {
    expect(
      signalFacts(
        check({ legacyAuthThisMonth: 3, delegatedReporter: "atlas" }),
      ),
    ).toEqual({ legacyAuthThisMonth: 3, delegatedReporter: "atlas" });
  });

  it("只有 reporter 也到——atlas 代发、本月零次旧凭据是 E3a 之后的常态", () => {
    expect(signalFacts(check({ delegatedReporter: "atlas" }))).toEqual({
      delegatedReporter: "atlas",
    });
  });

  it("没有的键不给（exactOptionalPropertyTypes）；读不到实测结果时是空对象", () => {
    expect(signalFacts(check({}))).toEqual({});
    expect("delegatedReporter" in signalFacts(check({}))).toBe(false);
    expect(signalFacts(undefined)).toEqual({});
  });
});

describe("runLaunchChecks —— C2 那条上的 reporter 从 BFF 信号到实测结果", () => {
  const PRODUCT = {
    id: "p-1",
    productCode: "tenderforge",
    origin: "first_party",
    originProvider: null,
  };

  function stubSignals(
    entitlement: {
      lastSeenAt: string;
      via: string;
      workspaceId: string | null;
      reporter?: string | null;
    } | null,
  ): void {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes("/integration-signals")) {
        return {
          login: null,
          entitlement,
          consume: null,
          s2s: null,
          provision: null,
          provisionAck: null,
          delivery: null,
          plan: null,
          subscription: null,
        };
      }
      if (url.includes("/webhook")) return null;
      return [];
    });
  }

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("atlas 持代上报票替它读过：c2-entitlement 带 delegatedReporter=atlas，且仍是「经 S2S 令牌」", async () => {
    stubSignals({
      lastSeenAt: "2026-10-05T01:02:03.000Z",
      via: "s2s",
      workspaceId: "ws-1",
      reporter: "atlas",
    });
    const results = await runLaunchChecks(PRODUCT);
    const c2 = results.find((r) => r.id === "c2-entitlement");
    expect(c2).toMatchObject({
      status: "pass",
      delegatedReporter: "atlas",
    });
    expect(c2?.detail).toContain("S2S 令牌");
    /* 两个抽屉的行都从这里抄——这一步就是「信号到了行上」。 */
    expect(signalFacts(c2)).toEqual({ delegatedReporter: "atlas" });
  });

  it("产品自己换票读的：没有 delegatedReporter 这个键，不是 null", async () => {
    stubSignals({
      lastSeenAt: "2026-10-05T01:02:03.000Z",
      via: "s2s",
      workspaceId: "ws-1",
      reporter: null,
    });
    const results = await runLaunchChecks(PRODUCT);
    const c2 = results.find((r) => r.id === "c2-entitlement");
    expect(c2?.status).toBe("pass");
    expect(c2 && "delegatedReporter" in c2).toBe(false);
    expect(signalFacts(c2)).toEqual({});
  });

  it("30 天内没人读过：c2 fail，也没有 reporter", async () => {
    stubSignals(null);
    const results = await runLaunchChecks(PRODUCT);
    const c2 = results.find((r) => r.id === "c2-entitlement");
    expect(c2?.status).toBe("fail");
    expect(signalFacts(c2)).toEqual({});
  });
});
