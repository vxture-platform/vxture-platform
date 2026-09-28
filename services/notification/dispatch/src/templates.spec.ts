/**
 * templates.spec.ts — 模板表的守卫（2026-09-28 批 5 新建：此前这张表一条用例都没有，
 * 唯一间接的覆盖来自 operator-mirror.spec 借它渲染客户原文）。
 *
 * 钉三件事：
 *   1. 批 5 七条新模板的**主题落点**（逐条显式，不按前缀猜）与**文案参数集合**；
 *   2. 全表通则：两种语言的参数集合逐条一致、文案里不写 markdown、参数名不许是裸 id 形状；
 *   3. `@vxture/service-subscription` 里那份**第二副本**与本表的关系（子集 + 差集有声明）。
 *
 * ── 这条守卫看不见什么（写下来，免得它被当成比它实际更强的保证）──
 *   · 看不见**调用方实际传了什么**。参数集合是契约，但谁把一个 uuid 传进 `addonOrderNo`，
 *     渲染出来就是 uuid，本 spec 一行都照不到（那一半靠 dispatcher 的用例与人工过一眼）。
 *   · 看不见 console 那份手写主题清单的 `planned` 标与两本词条。「有模板却还标着开发中」
 *     那一半钉在 @vxture/service-account 的 notification-preferences.service.spec.ts 里
 *     ——那边能同时看到本包的 topicOf 与偏好中心的 PLANNED 集合。
 *   · 看不见短信模板：新码没进 `smsParams` 的 switch（默认回 {}），所以它们不发短信。
 */
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TEMPLATES,
  render,
  topicOf,
  type NotificationLocale,
  type NotificationTemplateCode,
  type NotificationTopic,
  type TemplateParams,
} from "./templates";
/**
 * 跨包相对导入（services → services，dep-cruiser 允许同层）。
 * 不写成 `@vxture/service-subscription`：那个别名会把整包源码拖进本包的程序
 * （连 @nestjs/common 一起，而本包没装它）。customer-notifier.ts **自身零 import**，
 * 所以按路径只拉它一个文件，类型与运行时都成立。它搬家时这条导入会当场报错——
 * 那正是希望的行为：两份副本的对账不该悄悄失效。
 */
import {
  CUSTOMER_NOTIFICATION_TEMPLATES,
  type CustomerNotificationTemplate,
} from "../../../commerce/subscription/src/service/customer-notifier";

const LOCALES: readonly NotificationLocale[] = ["zh-CN", "en-US"];

/** 任意位置的 uuid（不是整串匹配：要抓的是「混在文案里」的那种）。 */
const UUID_ANYWHERE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function placeholders(...texts: string[]): string[] {
  return [
    ...new Set(
      texts.flatMap((t) =>
        [...t.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1] as string),
      ),
    ),
  ].sort();
}

function rendered(
  code: NotificationTemplateCode,
  params: TemplateParams,
  locale: NotificationLocale,
): string {
  const r = render(code, params, null, locale);
  return `${r.title}\n${r.body}`;
}

interface NewCase {
  readonly topic: NotificationTopic;
  readonly params: TemplateParams;
  /** 必须出现在渲染结果里的值。第一项是这条消息的**可视把手**（可视码或可视名）。 */
  readonly mustContain: readonly [string, ...string[]];
  readonly placeholders: readonly string[];
}

const PACK = "AI 加油包 10 万 tokens";
const ADDON_ORDER = "ORD-202609-7a1b2c3d4e";

/** 批 5 的七条。主题是**定稿**，改这里等于改产品决策，不是改测试。 */
const NEW_CASES: Record<string, NewCase> = {
  "tenant.verification_approved": {
    topic: "verification_result",
    params: { tenantName: "Acme 科技", reviewedAt: "2026-09-28" },
    mustContain: ["Acme 科技", "2026-09-28"],
    placeholders: ["reviewedAt", "tenantName"],
  },
  "tenant.verification_rejected": {
    topic: "verification_result",
    params: { tenantName: "Acme 科技", reason: "营业执照号与企业名称不一致" },
    // 驳回必须带上原因与下一步：只说「未通过」的话客户无从下手。
    mustContain: ["Acme 科技", "营业执照号与企业名称不一致"],
    placeholders: ["reason", "tenantName"],
  },
  "subscription.trial_expired": {
    topic: "subscription_expiry",
    params: { productName: "Arda", planName: "体验版", endAt: "2026-09-28" },
    // 订阅没有面向客户的可视码（既有 subscription.expired 同样如此），把手是产品 + 套餐。
    mustContain: ["Arda", "体验版", "2026-09-28"],
    placeholders: ["endAt", "planName", "productName"],
  },
  /* 加油包四条的参数名沿用全仓词汇：orderNo / endAt / amount（不另起
     addonOrderNo / expiresAt / price）。发侧（addon-lifecycle 的 addonNotice）按直觉
     传的就是这三个——两套词汇的代价是文案渲染成空串。 */
  "addon.activated": {
    topic: "provision_result",
    params: {
      packName: PACK,
      orderNo: ADDON_ORDER,
      endAt: "2026-12-27",
      amount: "¥99.00",
    },
    mustContain: [ADDON_ORDER, PACK, "2026-12-27", "¥99.00"],
    placeholders: ["amount", "endAt", "orderNo", "packName"],
  },
  "addon.expiring_soon": {
    topic: "subscription_expiry",
    params: {
      packName: PACK,
      orderNo: ADDON_ORDER,
      endAt: "2026-12-27",
      days: 7,
    },
    mustContain: [ADDON_ORDER, PACK, "2026-12-27", "7"],
    placeholders: ["days", "endAt", "orderNo", "packName"],
  },
  "addon.exhausted": {
    topic: "quota_alert",
    params: { packName: PACK, orderNo: ADDON_ORDER, endAt: "2026-12-27" },
    mustContain: [ADDON_ORDER, PACK, "2026-12-27"],
    placeholders: ["endAt", "orderNo", "packName"],
  },
  "addon.expired": {
    topic: "subscription_expiry",
    params: { packName: PACK, orderNo: ADDON_ORDER, endAt: "2026-12-27" },
    mustContain: [ADDON_ORDER, PACK, "2026-12-27"],
    placeholders: ["endAt", "orderNo", "packName"],
  },
};

describe("批 5 的七条新客户模板", () => {
  it("七条，不多不少，且都在模板表里", () => {
    expect(Object.keys(NEW_CASES)).toHaveLength(7);
    for (const code of Object.keys(NEW_CASES)) {
      expect(Object.keys(NOTIFICATION_TEMPLATES)).toContain(code);
    }
  });

  for (const [code, c] of Object.entries(NEW_CASES)) {
    const key = code as NotificationTemplateCode;

    it(`${code} → 主题 ${c.topic}`, () => {
      expect(topicOf(key)).toBe(c.topic);
      expect(NOTIFICATION_TEMPLATES[key].topic).toBe(c.topic);
    });

    it(`${code} 的文案参数集合就是约定的那几个`, () => {
      const def = NOTIFICATION_TEMPLATES[key];
      expect(placeholders(def.title, def.body)).toEqual([...c.placeholders]);
    });

    for (const locale of LOCALES) {
      it(`${code}（${locale}）渲染后带可视把手、不含 uuid`, () => {
        const text = rendered(key, c.params, locale);
        // 第一项是可视把手：客户凭它能在界面上找到这件事。
        expect(text).toContain(c.mustContain[0]);
        for (const v of c.mustContain) expect(text).toContain(v);
        expect(text).not.toMatch(UUID_ANYWHERE);
        // 参数没留空：`{{x}}` 原样漏出去说明参数名拼错了。
        expect(text).not.toMatch(/\{\{/);
      });
    }
  }

  it("四条加油包**不共用一个主题**：到期归权益、用尽归额度", () => {
    // 合成一个主题的代价不对称：关掉「额度用完了」的人会连带关掉「你买的包下周到期」，
    // 而漏掉后者要花钱。
    expect(topicOf("addon.exhausted")).toBe("quota_alert");
    expect(topicOf("addon.expiring_soon")).toBe("subscription_expiry");
    expect(topicOf("addon.expired")).toBe("subscription_expiry");
    expect(topicOf("addon.exhausted")).not.toBe(topicOf("addon.expiring_soon"));
    // 开通与 order.fulfilled 同一类「买的东西到账了吗」，主题也要同一个。
    expect(topicOf("addon.activated")).toBe(topicOf("order.fulfilled"));
  });

  it("用尽与过期是两条各自完整的话，不是一条里写「或者…或者」", () => {
    const exhausted = NOTIFICATION_TEMPLATES["addon.exhausted"].body;
    const expired = NOTIFICATION_TEMPLATES["addon.expired"].body;
    expect(exhausted).not.toBe(expired);
    // 用尽：量没了、时间还在 ⇒ 下一步是再买一份。
    expect(exhausted).toContain("已无可用余量");
    // 过期：时间到了、没用完的量作废 ⇒ 下一步不同。
    expect(expired).toContain("作废");
    for (const body of [exhausted, expired]) expect(body).not.toContain("或者");
  });

  it("试用到期不承诺任何数据保留（平台今天没有这条成文承诺）", () => {
    for (const locale of LOCALES) {
      const text = rendered(
        "subscription.trial_expired",
        NEW_CASES["subscription.trial_expired"]!.params,
        locale,
      );
      for (const promise of [
        "保留",
        "retain",
        "retention",
        "永久",
        "forever",
      ]) {
        expect(text.toLowerCase()).not.toContain(promise.toLowerCase());
      }
    }
  });
});

/**
 * 维护暂停与人工暂停（2026-09-28 收尾）。
 *
 * 这一组钉的是**文案的事实性**，不是渲染机制：`subscription.suspended` 的「如需恢复请联系
 * 客服」对人工暂停是对的（只有运营放得开），对产品维护是假话——维护结束后
 * `sweepProductMaintenance` 的第 2 段自己把订阅放回 active、结算顺延、发恢复通知。
 * 「顺延」不是新加的承诺：维护那条腿开的 episode 原因是 `platform_ops`，而
 * `SUSPENSION_REASON_EXTENDS_TERM.platform_ops === true`。
 */
describe("维护暂停与人工暂停是两条各自完整的话", () => {
  const MAINTENANCE = "subscription.suspended_maintenance";
  const params = {
    productName: "Arda",
    planName: "Pro",
    resumeAt: "2026-09-30",
  };

  it("主题与人工暂停同一个（回答的是同一个问题：我的服务在不在）", () => {
    expect(topicOf(MAINTENANCE)).toBe(topicOf("subscription.suspended"));
  });

  it("两条正文不是同一句（没有写成一条里「或者…或者」）", () => {
    expect(NOTIFICATION_TEMPLATES[MAINTENANCE].body).not.toBe(
      NOTIFICATION_TEMPLATES["subscription.suspended"].body,
    );
  });

  it("维护那条**不写「联系客服」**：系统自己会恢复，这句话只会白造工单", () => {
    for (const locale of LOCALES) {
      const text = rendered(MAINTENANCE, params, locale).toLowerCase();
      for (const wrong of ["联系客服", "联系支持", "contact support"]) {
        expect(text).not.toContain(wrong.toLowerCase());
      }
    }
  });

  it("维护那条说齐三件事：为什么停 / 预计恢复时间 / 自动恢复且天数顺延", () => {
    const zh = rendered(MAINTENANCE, params, "zh-CN");
    expect(zh).toContain("升级维护");
    expect(zh).toContain("2026-09-30");
    expect(zh).toContain("自动恢复");
    expect(zh).toContain("顺延");
    const en = rendered(MAINTENANCE, params, "en-US");
    expect(en).toContain("maintenance");
    expect(en).toContain("2026-09-30");
    expect(en.toLowerCase()).toContain("resumes by itself");
    expect(en.toLowerCase()).toContain("term");
  });

  it("不越界承诺：只说窗口写的那个「预计」，不保证到点一定恢复", () => {
    // 窗口到时未结束不会自动结束（运营要回 opera 点「结束维护」）——自动的是**恢复这件
    // 事**，不是那个时刻。所以正文里不许出现把时间说死的话。
    const zh = rendered(MAINTENANCE, params, "zh-CN");
    expect(zh).toContain("预计");
    for (const overstated of ["一定", "保证", "准时", "不会超过"]) {
      expect(zh).not.toContain(overstated);
    }
    const en = rendered(MAINTENANCE, params, "en-US").toLowerCase();
    expect(en).toContain("expected");
    for (const overstated of [
      "guarantee",
      "no later than",
      "will be back at",
    ]) {
      expect(en).not.toContain(overstated);
    }
  });

  it("人工暂停那条**没被改**：「联系客服」仍在（对人工暂停它是对的）", () => {
    expect(NOTIFICATION_TEMPLATES["subscription.suspended"].body).toContain(
      "如需恢复请联系客服",
    );
    expect(
      rendered(
        "subscription.suspended",
        { productName: "Arda", planName: "Pro" },
        "en-US",
      ).toLowerCase(),
    ).toContain("contact support");
  });
});

/**
 * 代客续期与自助续费（2026-09-28 收尾）。
 *
 * 这一组钉的是**为什么必须是两条模板**：`subscription.renewed` 的正文要说「实付
 * {{amount}}」，而运营在订阅侧直接续期没有订单、没有付款——那个字段没有诚实的值。
 * 写 ¥0 与 owner 的「收入 = 真实实付」冲突，留空则是半截话。所以代客那条**一个字不提
 * 金额**，只说新周期到哪天 + 这次是平台代为办的。
 */
describe("代客续期与自助续费是两条，判据是那笔钱在不在", () => {
  const BY_OPERATOR = "subscription.renewed_by_operator";
  const params = { productName: "Arda", planName: "Pro", endAt: "2027-09-10" };

  it("主题与自助续费同一个（回答的是同一个问题：我的订阅到什么时候）", () => {
    expect(topicOf(BY_OPERATOR)).toBe(topicOf("subscription.renewed"));
  });

  it("文案参数里**没有** amount —— 自助那条有，这条按设计没有", () => {
    const def = NOTIFICATION_TEMPLATES[BY_OPERATOR];
    expect(placeholders(def.title, def.body)).toEqual([
      "endAt",
      "planName",
      "productName",
    ]);
    expect(
      placeholders(
        NOTIFICATION_TEMPLATES["subscription.renewed"].title,
        NOTIFICATION_TEMPLATES["subscription.renewed"].body,
      ),
    ).toContain("amount");
  });

  it("对钱**完全沉默**：既不说金额，也不说「未产生费用」", () => {
    /* 两个方向都会说错话：填 ¥0 与「收入 = 真实实付」冲突；而写「未产生费用」在运营
       按线下合同收过款之后同样是假话（那笔钱只是不在系统里）。所以这条文案一个字都不
       提钱——这也正是它与 subscription.renewed 分成两条的原因。 */
    const forbidden = [
      "¥",
      "实付",
      "金额",
      "费用",
      "付款",
      "订单",
      "0.00",
      "paid",
      "amount",
      "charge",
      "order",
      "free",
    ];
    for (const locale of LOCALES) {
      const text = rendered(BY_OPERATOR, params, locale);
      for (const money of forbidden) {
        expect(text.toLowerCase()).not.toContain(money.toLowerCase());
      }
      // 参数没留空：`{{x}}` 原样漏出去说明参数名拼错了。
      expect(text).not.toMatch(/\{\{/);
    }
  });

  it("说齐两件事：新周期到哪天 + 这一次是平台代为办的", () => {
    const zh = rendered(BY_OPERATOR, params, "zh-CN");
    expect(zh).toContain("2027-09-10");
    expect(zh).toContain("平台已为你续期");
    const en = rendered(BY_OPERATOR, params, "en-US");
    expect(en).toContain("2027-09-10");
    expect(en.toLowerCase()).toContain("we renewed");
  });

  it("两条正文不是同一句（没有写成一条里「或者…或者」）", () => {
    expect(NOTIFICATION_TEMPLATES[BY_OPERATOR].body).not.toBe(
      NOTIFICATION_TEMPLATES["subscription.renewed"].body,
    );
    for (const locale of LOCALES) {
      expect(rendered(BY_OPERATOR, params, locale)).not.toContain("或者");
    }
  });

  it("不越界承诺：不写「永久 / 免费 / 一直」这类替产品许诺的话", () => {
    const zh = rendered(BY_OPERATOR, params, "zh-CN");
    for (const forever of ["永久", "免费", "一直", "不再收费", "自动续"]) {
      expect(zh).not.toContain(forever);
    }
    const en = rendered(BY_OPERATOR, params, "en-US").toLowerCase();
    for (const forever of ["forever", "auto-renew", "every period"]) {
      expect(en).not.toContain(forever);
    }
  });

  it("自助续费那条**没被改**：实付金额仍在（它那一路真的收了钱）", () => {
    expect(NOTIFICATION_TEMPLATES["subscription.renewed"].body).toContain(
      "实付 {{amount}}",
    );
  });
});

describe("全表通则", () => {
  const codes = Object.keys(
    NOTIFICATION_TEMPLATES,
  ) as NotificationTemplateCode[];

  /** 该模板两种语言都该用到的参数 → 标记值。标记既当填充也当探针。 */
  function markers(code: NotificationTemplateCode): {
    names: string[];
    params: TemplateParams;
  } {
    const def = NOTIFICATION_TEMPLATES[code];
    const names = placeholders(def.title, def.body);
    return {
      names,
      params: Object.fromEntries(names.map((p) => [p, `<${p}>`])),
    };
  }

  it("每条模板两种语言的标题与正文都非空", () => {
    /* = 模板码总数。加一条码就在这里 +1 —— 这个数字当探针的全部意义就是「加了码却没有
       任何一条用例覆盖到它」当场红。2026-09-28 收尾加两条（运营代客续期 / 升级维护暂停）：
       32 → 34。 */
    expect(codes).toHaveLength(34);
    for (const code of codes) {
      const { params } = markers(code);
      for (const locale of LOCALES) {
        const r = render(code, params, null, locale);
        expect(r.title.length).toBeGreaterThan(0);
        expect(r.body.length).toBeGreaterThan(0);
        expect(r.subject.startsWith("[Vxture] ")).toBe(true);
      }
    }
  });

  /**
   * 两种语言的参数集合必须逐条相同。en 那两张表没有导出，所以不能直接比集合——
   * 用同一组标记值渲染，双向各一个判据：
   *   · 渲染结果里**没有** `{{` 残留 ⇒ 该语言用到的参数都在这组里（⊆）；
   *   · 每个标记都出现 ⇒ 这组参数该语言也都用到了（⊇）。
   * 一种语言少一个参数，就是它比另一种少说了一件事（少一个日期、少一个单号）。
   */
  it("两种语言的参数集合逐条一致", () => {
    for (const code of codes) {
      const { names, params } = markers(code);
      for (const locale of LOCALES) {
        const text = rendered(code, params, locale);
        expect(text).not.toMatch(/\{\{/);
        for (const name of names) expect(text).toContain(`<${name}>`);
      }
    }
  });

  it("文案里不写 markdown 的 ** 强调（字符串不是 markdown，客户看到的就是星号）", () => {
    for (const code of codes) {
      const { params } = markers(code);
      for (const locale of LOCALES) {
        const r = render(code, params, null, locale);
        expect(r.title).not.toContain("**");
        expect(r.body).not.toContain("**");
      }
    }
  });

  it("参数名不许是裸 id 形状（可视码 / 可视名 / 金额 / 日期才准进文案）", () => {
    for (const code of codes) {
      for (const name of markers(code).names) {
        expect(name).not.toBe("id");
        expect(name).not.toMatch(/[a-z0-9]Id$/);
      }
    }
  });

  it("渲染结果不含 uuid（参数全是可视值时）", () => {
    for (const code of codes) {
      const { params } = markers(code);
      for (const locale of LOCALES) {
        expect(rendered(code, params, locale)).not.toMatch(UUID_ANYWHERE);
      }
    }
  });
});

/**
 * 第二份副本（@vxture/service-subscription 的 CustomerNotificationTemplate）。
 *
 * 它是本表的**子集**而不是复制品：只列写入方住在那个包里的模板码。所以判据不是「相等」，
 * 是「子集 + 差集必须逐条有声明」——后者才抓得住「加了模板码，两处都忘了动」。
 */
const EXPECTED_MISSING_IN_SECOND_COPY: Record<string, string> = {
  "announcement.published":
    "公告由 @vxture/service-notification 的公告流自己发",
  "tenant.invitation": "入组邀请的写入方在 admin-bff / console-bff 的成员流",
  "tenant.converted": "个人转组织的写入方在 tenants.router",
  "tenant.verification_approved":
    "企业认证审核的写入方是 admin-bff 的 reviewVerification（批 5）",
  "tenant.verification_rejected":
    "企业认证审核的写入方是 admin-bff 的 reviewVerification（批 5）",
};

describe("第二份模板码副本", () => {
  it("类型层：第二副本的每个成员都是权威联合的成员", () => {
    // A extends B 不成立就编译不过——这一句的价值在编译期，运行时只是让它被用到。
    type AssertSubset<A extends B, B> = [A, B];
    const proof: AssertSubset<
      CustomerNotificationTemplate,
      NotificationTemplateCode
    > = ["addon.activated", "addon.activated"];
    expect(proof).toHaveLength(2);
  });

  it("运行时：副本无重复、每一项都在权威表里", () => {
    const copy = [...CUSTOMER_NOTIFICATION_TEMPLATES];
    expect(new Set(copy).size).toBe(copy.length);
    // 读不到就该红，不许当成「通过」。
    expect(copy.length).toBeGreaterThan(20);
    for (const code of copy) {
      expect(Object.keys(NOTIFICATION_TEMPLATES)).toContain(code);
    }
  });

  it("差集逐条有声明：新加模板码而两处都没动的，这里当场红", () => {
    const copy = new Set<string>(CUSTOMER_NOTIFICATION_TEMPLATES);
    const missing = Object.keys(NOTIFICATION_TEMPLATES)
      .filter((code) => !copy.has(code))
      .sort();
    expect(missing).toEqual(
      Object.keys(EXPECTED_MISSING_IN_SECOND_COPY).sort(),
    );
  });

  it("声明表里不许有「已经不缺」的条目（逃生口不给不存在的债发许可）", () => {
    const copy = new Set<string>(CUSTOMER_NOTIFICATION_TEMPLATES);
    for (const code of Object.keys(EXPECTED_MISSING_IN_SECOND_COPY)) {
      expect(Object.keys(NOTIFICATION_TEMPLATES)).toContain(code);
      expect(copy.has(code)).toBe(false);
      expect(EXPECTED_MISSING_IN_SECOND_COPY[code]!.length).toBeGreaterThan(8);
    }
  });

  it("批 5 的五条「本包发得出的」确实进了副本", () => {
    for (const code of [
      "subscription.trial_expired",
      "addon.activated",
      "addon.expiring_soon",
      "addon.exhausted",
      "addon.expired",
    ]) {
      expect([...CUSTOMER_NOTIFICATION_TEMPLATES]).toContain(code);
    }
  });
});
