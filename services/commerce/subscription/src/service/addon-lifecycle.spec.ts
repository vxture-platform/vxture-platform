/**
 * addon-lifecycle.spec.ts —— 加油包三档的**判据**（2026-09-28 批 5）。
 *
 * 这一组是本批唯一真正需要被钉住的判断。三条红线各自钉在这里：
 *   ① 不重置的池上才允许比水位（铁律五禁裸读 quota_used）——会重置的池判不出「买的量没了」；
 *   ② gauge（存储类）从不进 consume，`quota_used` 恒为 0：它**不进「已用尽」**，
 *      但两条时间轴的通知照发（少发比误发好，不发就是把这一类彻底藏起来）；
 *   ③ 存量闸门：首趟不许把历史上所有已过期 / 已用尽的包一次性播出去。
 *
 * 判据只住一处（classifyAddonPool），SQL 那侧只按时间窗 / 水位把范围收窄到有界。
 */
import { describe, expect, it } from "vitest";
import {
  addonActivatedNotice,
  addonLifecycleNotice,
  classifyAddonPool,
  type AddonLifecycleWindow,
} from "./addon-lifecycle";
import type { AddonPoolCandidate } from "../types/addon.types";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

const WINDOW: AddonLifecycleWindow = { leadDays: 7, backlogDays: 3 };

const UUID_SHAPE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const candidate = (
  over: Partial<AddonPoolCandidate> = {},
): AddonPoolCandidate => ({
  orderNo: "ORD-202609-1A2B3C4D5E",
  tenantId: "org-1",
  packName: "AI 加油包 100 Credits",
  metricKind: "counter",
  resetPeriod: "none",
  quotaLimit: "100",
  quotaUsed: "10",
  price: "29.90",
  currency: "CNY",
  expiresAt: at(30),
  poolUpdatedAt: NOW,
  createdByType: "customer",
  createdById: "22222222-2222-4222-8222-222222222222",
  ...over,
});

describe("classifyAddonPool —— 三档", () => {
  it("到期日落在提醒窗口里 → 即将到期", () => {
    expect(
      classifyAddonPool(candidate({ expiresAt: at(3) }), WINDOW, NOW),
    ).toBe("expiring_soon");
  });

  it("窗口之外（还早）→ 什么都不发", () => {
    expect(
      classifyAddonPool(candidate({ expiresAt: at(30) }), WINDOW, NOW),
    ).toBeNull();
  });

  it("水位到顶 → 已用尽", () => {
    expect(
      classifyAddonPool(
        candidate({ quotaUsed: "100", quotaLimit: "100" }),
        WINDOW,
        NOW,
      ),
    ).toBe("exhausted");
  });

  it("到期日已过且在回看窗口内 → 已过期", () => {
    expect(
      classifyAddonPool(candidate({ expiresAt: at(-1) }), WINDOW, NOW),
    ).toBe("expired");
  });

  it("已过期盖过已用尽：余量作废这件事更靠前", () => {
    expect(
      classifyAddonPool(
        candidate({ expiresAt: at(-1), quotaUsed: "100" }),
        WINDOW,
        NOW,
      ),
    ).toBe("expired");
  });

  it("已用尽盖过即将到期：量已经是 0 的包，「还剩三天」答的不是客户的问题", () => {
    expect(
      classifyAddonPool(
        candidate({ expiresAt: at(3), quotaUsed: "100" }),
        WINDOW,
        NOW,
      ),
    ).toBe("exhausted");
  });
});

describe("classifyAddonPool —— 三条红线", () => {
  /**
   * gauge：存储类指标从不进 consume，`quota_used` 永远是 0。这里故意把它的水位**写到顶**
   * ——真实库里不会这样，但正是这个用例在证明：判据不是「用了多少」，而是「这个指标的
   * 水位这一列说不说得上话」。说不上话就不发「已用尽」，而两条时间轴照发。
   */
  it("gauge 池水位到顶也不发「已用尽」", () => {
    expect(
      classifyAddonPool(
        candidate({
          metricKind: "gauge",
          quotaUsed: "1073741824",
          quotaLimit: "1073741824",
        }),
        WINDOW,
        NOW,
      ),
    ).toBeNull();
  });

  it("gauge 池照收两条时间轴的通知", () => {
    const gauge = (expiresAt: Date) =>
      candidate({
        metricKind: "gauge",
        quotaUsed: "1073741824",
        quotaLimit: "1073741824",
        expiresAt,
      });
    expect(classifyAddonPool(gauge(at(3)), WINDOW, NOW)).toBe("expiring_soon");
    expect(classifyAddonPool(gauge(at(-1)), WINDOW, NOW)).toBe("expired");
  });

  it("未分类的指标（kind 为 null）不被排除：它的水位只可能被 consume 推上去", () => {
    expect(
      classifyAddonPool(
        candidate({ metricKind: null, quotaUsed: "100" }),
        WINDOW,
        NOW,
      ),
    ).toBe("exhausted");
  });

  it("会重置的池不发「已用尽」：那是本周期烧完了，不是买的量没了", () => {
    for (const resetPeriod of ["month", "day"]) {
      expect(
        classifyAddonPool(
          candidate({ resetPeriod, quotaUsed: "100" }),
          WINDOW,
          NOW,
        ),
      ).toBeNull();
    }
  });

  it("水位按 BigInt 比，不转 number（bytes 能超 2^53）", () => {
    expect(
      classifyAddonPool(
        candidate({
          quotaLimit: "9007199254740993",
          quotaUsed: "9007199254740992",
        }),
        WINDOW,
        NOW,
      ),
    ).toBeNull();
  });

  it("存量闸门：过期太久的包一条都不发", () => {
    expect(
      classifyAddonPool(candidate({ expiresAt: at(-30) }), WINDOW, NOW),
    ).toBeNull();
  });

  it("存量闸门：很久以前就烧光的包一条都不发", () => {
    expect(
      classifyAddonPool(
        candidate({ quotaUsed: "100", poolUpdatedAt: at(-30) }),
        WINDOW,
        NOW,
      ),
    ).toBeNull();
  });

  it("闸门边界内的仍然发（闸门不是把终态整类关掉）", () => {
    expect(
      classifyAddonPool(candidate({ expiresAt: at(-2) }), WINDOW, NOW),
    ).toBe("expired");
  });
});

describe("通知的形状", () => {
  it("开通：引用键是订单号，参数名与模板表逐字对齐", () => {
    const notice = addonActivatedNotice({
      orderNo: "ORD-202609-1A2B3C4D5E",
      tenantId: "org-1",
      packName: "AI 加油包 100 Credits",
      price: "29.90",
      currency: "CNY",
      expiresAt: new Date("2027-09-28T00:00:00.000Z"),
      createdByType: "customer",
      createdById: "22222222-2222-4222-8222-222222222222",
    });
    expect(notice).toMatchObject({
      tenantId: "org-1",
      templateCode: "addon.activated",
      reference: { type: "addon", id: "ORD-202609-1A2B3C4D5E" },
      link: "/billing#quota-addons",
    });
    /* 模板读的就是这四个键，名字走仓里的通用词汇（orderNo / endAt / amount）。
       少一个不报错，只会让客户收到一句带洞的话——插值遇未知键静默换空串。
       区分单号住哪张表靠 reference.type，不靠参数名。 */
    expect(notice.params).toEqual({
      packName: "AI 加油包 100 Credits",
      orderNo: "ORD-202609-1A2B3C4D5E",
      endAt: "2027-09-28",
      amount: "¥29.90",
    });
    // 买的人也收（加油包是 workspace 级的，掏钱的常常不是 owner）。
    expect(notice.recipients).toEqual(["22222222-2222-4222-8222-222222222222"]);
  });

  it("即将到期：引用键带到期日（窗口内每趟重扫，靠它收成一条），带剩余天数", () => {
    const notice = addonLifecycleNotice(
      "expiring_soon",
      candidate({ expiresAt: at(3) }),
      NOW,
    );
    expect(notice.templateCode).toBe("addon.expiring_soon");
    expect(notice.reference).toEqual({
      type: "addon",
      id: "ORD-202609-1A2B3C4D5E:2026-10-01",
    });
    expect(notice.params).toEqual({
      packName: "AI 加油包 100 Credits",
      orderNo: "ORD-202609-1A2B3C4D5E",
      endAt: "2026-10-01",
      days: 3,
    });
  });

  it("两个终态：引用键就是订单号（一辈子各发一次），模板码各一条", () => {
    const exhausted = addonLifecycleNotice("exhausted", candidate(), NOW);
    const expired = addonLifecycleNotice("expired", candidate(), NOW);
    expect(exhausted.templateCode).toBe("addon.exhausted");
    expect(expired.templateCode).toBe("addon.expired");
    // 两条终态模板读三个键（没有 days、没有 amount）。
    for (const notice of [exhausted, expired]) {
      expect(notice.params).toEqual({
        packName: "AI 加油包 100 Credits",
        orderNo: "ORD-202609-1A2B3C4D5E",
        endAt: "2026-10-28",
      });
    }
    for (const notice of [exhausted, expired]) {
      expect(notice.reference).toEqual({
        type: "addon",
        id: "ORD-202609-1A2B3C4D5E",
      });
    }
  });

  it("客户看得见的每一处都不出现 uuid（引用键也只有可视码）", () => {
    for (const notice of [
      addonLifecycleNotice("expiring_soon", candidate({ expiresAt: at(3) })),
      addonLifecycleNotice("exhausted", candidate()),
      addonLifecycleNotice("expired", candidate({ expiresAt: at(-1) })),
      addonActivatedNotice(candidate()),
    ]) {
      expect(JSON.stringify(notice.params)).not.toMatch(UUID_SHAPE);
      expect(notice.reference.id).not.toMatch(UUID_SHAPE);
      expect(String(notice.link)).not.toMatch(UUID_SHAPE);
      /* recipients 是收件人的 account id，派发器按它查邮箱——结构字段，不上屏，
         与「文案里不许有 uuid」不是同一件事。 */
    }
  });

  it("下单人不是客户（运营代下单）时不额外指定收件人，只发租户 owner", () => {
    const notice = addonActivatedNotice(
      candidate({ createdByType: "operator" }),
    );
    expect(notice.recipients).toBeUndefined();
  });
});
