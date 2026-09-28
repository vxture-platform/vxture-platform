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
 *   · 文案表本身看不见 `mandatory`（那是 dispatcher 每次调用传的参数）。所以「成员邀请
 *     主题从开发中放开之后，客户关掉它仍然关不掉邀请本身」那一条在本文件末尾**跑分发器**
 *     来证，不写成断言。
 *   · 看不见短信模板：新码没进 `smsParams` 的 switch（默认回 {}），所以它们不发短信。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  NOTIFICATION_TEMPLATES,
  ROLE_PARAM,
  render,
  roleNameOf,
  topicOf,
  type NotificationLocale,
  type NotificationTemplateCode,
  type NotificationTopic,
  type TemplateParams,
} from "./templates";
/* 「关掉主题关不掉邀请本身」那一组要真的跑一遍分发器：mandatory 是**调用参数**不是模板
   属性，静态断言证不了它。 */
import { NotificationDispatcher } from "./dispatcher";
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

/**
 * 成员邀请四态（2026-09-29）。
 *
 * `tenancy.invitations` 的五态里，pending 之外那四个此前一句话都不发。这一组钉三件事：
 *   1. 四条都落在 `member_invitation`（与已在发的 `tenant.invitation` 同一个主题）；
 *   2. 四条各自的**收件人视角**——accepted / declined / expired 写给邀请人，revoked 写给
 *      被邀请人。写错视角不会报错，只会让人收到一句在说别人的话；
 *   3. 文案里一个 uuid 都没有：邀请由租户名 + 角色名 + 邀请人当初填的那个账号认领。
 */
describe("成员邀请四态", () => {
  const INVITATION_CODES = [
    "tenant.invitation_accepted",
    "tenant.invitation_declined",
    "tenant.invitation_revoked",
    "tenant.invitation_expired",
  ] as const;

  const TENANT = "Acme 科技";
  /* 角色参数传的是**码**（`access.roles.role_code`），成词是渲染层的事——只有那一层知道
     收件人读哪种语言。所以这一组按语言取词断言，不写死一个中文名。 */
  const ROLE_CODE = "member";
  const ROLE_LABEL: Record<NotificationLocale, string> = {
    "zh-CN": "成员",
    "en-US": "Member",
  };
  const INVITEE = "ann@acme.example";
  const params: TemplateParams = {
    tenantName: TENANT,
    roleKey: ROLE_CODE,
    inviteeName: INVITEE,
    expiresAt: "2026-10-06",
  };

  it("四条，都在模板表里，且都归 invitation_activity（**与邀请本身不同主题**）", () => {
    expect(INVITATION_CODES).toHaveLength(4);
    for (const code of INVITATION_CODES) {
      expect(Object.keys(NOTIFICATION_TEMPLATES)).toContain(code);
      expect(topicOf(code)).toBe("invitation_activity");
      /* owner 2026-09-29 看过页面后拆的那一刀就在这一句上：四条周知与「邀请本身」**不是**
         同一个主题，客户才能只静音周知而不影响邀请送达（本批最初两者同主题，于是站内那一档
         为了保住邀请本身必须锁死，四条跟着关不掉）。 */
      expect(topicOf(code)).not.toBe(topicOf("tenant.invitation"));
    }
    // 邀请本身留在原主题里：那一行只剩它一条，站内恒锁。
    expect(topicOf("tenant.invitation")).toBe("member_invitation");
  });

  it("文案参数集合就是约定的那几个（撤回那条不需要被邀请人自己的账号）", () => {
    const set = (code: NotificationTemplateCode) => {
      const def = NOTIFICATION_TEMPLATES[code];
      return placeholders(def.title, def.body);
    };
    expect(set("tenant.invitation_accepted")).toEqual([
      "inviteeName",
      "roleKey",
      "tenantName",
    ]);
    expect(set("tenant.invitation_declined")).toEqual([
      "inviteeName",
      "roleKey",
      "tenantName",
    ]);
    /* 撤回是写给**被邀请人**的：把他自己的账号念给他听没有意义，认领靠租户名 + 角色。 */
    expect(set("tenant.invitation_revoked")).toEqual(["roleKey", "tenantName"]);
    expect(set("tenant.invitation_expired")).toEqual([
      "expiresAt",
      "inviteeName",
      "roleKey",
      "tenantName",
    ]);
  });

  for (const code of INVITATION_CODES) {
    for (const locale of LOCALES) {
      it(`${code}（${locale}）带可视把手、不含 uuid、参数无残留`, () => {
        const text = rendered(code, params, locale);
        expect(text).toContain(TENANT);
        expect(text).toContain(ROLE_LABEL[locale]);
        // 上线过的那个缺陷：中文正文里印出英文角色码。
        expect(text).not.toContain(ROLE_CODE);
        expect(text).not.toMatch(UUID_ANYWHERE);
        expect(text).not.toMatch(/\{\{/);
        expect(text).not.toContain("**");
      });
    }
  }

  it("写给邀请人的三条都点名被邀请人：谁、哪个租户、什么角色", () => {
    for (const code of [
      "tenant.invitation_accepted",
      "tenant.invitation_declined",
      "tenant.invitation_expired",
    ] as const) {
      for (const locale of LOCALES) {
        const text = rendered(code, params, locale);
        // 三样缺一样，邀请人就得回邀请记录里自己对——那正是这几条通知要省掉的事。
        expect(text).toContain(INVITEE);
        expect(text).toContain(TENANT);
        expect(text).toContain(ROLE_LABEL[locale]);
      }
    }
  });

  it("拒绝那条明说「没有加入」并给出下一步，不揣测原因", () => {
    const zh = rendered("tenant.invitation_declined", params, "zh-CN");
    // 只写「拒绝了邀请」会让邀请人去成员列表里自己数人。
    expect(zh).toContain("没有加入");
    expect(zh).toContain("重新邀请");
    // 库里只有一个 declined 状态，为什么拒绝没有任何数据支持。
    for (const guess of ["原因", "可能", "也许", "为什么"]) {
      expect(zh).not.toContain(guess);
    }
    const en = rendered("tenant.invitation_declined", params, "en-US");
    expect(en.toLowerCase()).toContain("did not join");
    expect(en.toLowerCase()).toContain("new invitation");
    for (const guess of ["reason", "maybe", "perhaps", "probably"]) {
      expect(en.toLowerCase()).not.toContain(guess);
    }
  });

  it("撤回那条写给被邀请人：只说撤回 + 不再有效，不指责不揣测", () => {
    const zh = rendered("tenant.invitation_revoked", params, "zh-CN");
    expect(zh).toContain("撤回");
    expect(zh).toContain("不再有效");
    /* 对着被邀请人写「你没有及时接受」是把撤回说成他的问题；写「对方可能…」是替邀请人
       编话。两种都不许出现。 */
    for (const blame of [
      "未及时",
      "没有及时",
      "拒绝",
      "原因",
      "可能",
      "违规",
    ]) {
      expect(zh).not.toContain(blame);
    }
    const en = rendered("tenant.invitation_revoked", params, "en-US");
    expect(en.toLowerCase()).toContain("withdrawn");
    expect(en.toLowerCase()).toContain("no longer");
    for (const blame of ["reason", "failed to", "too late", "declined"]) {
      expect(en.toLowerCase()).not.toContain(blame);
    }
  });

  it("过期那条说清「截止前没被接受」+ 可以重新邀请，不写成「对方拒绝了」", () => {
    const zh = rendered("tenant.invitation_expired", params, "zh-CN");
    expect(zh).toContain("2026-10-06");
    expect(zh).toContain("已过期");
    expect(zh).toContain("重新邀请");
    // 没人接受与明确拒绝是两件事，库里也是两个状态。
    expect(zh).not.toContain("拒绝");
    const en = rendered("tenant.invitation_expired", params, "en-US");
    expect(en).toContain("2026-10-06");
    expect(en.toLowerCase()).toContain("expired");
    expect(en.toLowerCase()).toContain("new invitation");
    expect(en.toLowerCase()).not.toContain("declined");
  });

  it("四条正文互不相同（拒绝与过期没有合成一句「或者…或者」）", () => {
    const bodies = INVITATION_CODES.map(
      (code) => NOTIFICATION_TEMPLATES[code].body,
    );
    expect(new Set(bodies).size).toBe(4);
    for (const body of bodies) expect(body).not.toContain("或者");
  });

  /* 邀请本身那条只改了**一件事**：角色参数从 roleName 换成 roleKey（它有同一个缺陷——
     中文正文里印出英文码，见「角色码在渲染时成词」那一组）。有效期与邀请人一个没少。 */
  it("邀请本身那条只换了角色参数名：有效期与邀请人仍在", () => {
    expect(
      placeholders(
        NOTIFICATION_TEMPLATES["tenant.invitation"].title,
        NOTIFICATION_TEMPLATES["tenant.invitation"].body,
      ),
    ).toEqual(["expiresAt", "inviterName", "roleKey", "tenantName"]);
  });
});

/**
 * 角色名（2026-09-29）。修的是一处**已经上线**的缺陷：发侧把 `access.roles.role_code`
 * 原样塞进文案，于是中文正文读作「以「member」身份加入」。
 *
 * 契约：参数名 `roleKey`，值是**码**；翻成词在渲染时做，因为只有那一层知道收件人读哪种
 * 语言（`localeOf(account.users.language)`）。所以这一组的判据是**同一个码、两种语言、两个
 * 不同的词**——少了后半句，发侧先翻好再传进来也能全绿，而那恰恰是要防的做法。
 */
describe("角色码在渲染时成词", () => {
  /** 五个码 = `access.roles.role_code` 的全集；词与 console 的 `role.*` 词条逐字相同。 */
  const ROLE_WORDS: Record<string, Record<NotificationLocale, string>> = {
    owner: { "zh-CN": "所有者", "en-US": "Owner" },
    manager: { "zh-CN": "管理员", "en-US": "Manager" },
    member: { "zh-CN": "成员", "en-US": "Member" },
    readonly: { "zh-CN": "只读成员", "en-US": "Read-only" },
    guest: { "zh-CN": "访客", "en-US": "Guest" },
  };

  /** 带角色的五条：邀请本身（已上线）+ 四个终态。 */
  const ROLE_TEMPLATES = [
    "tenant.invitation",
    "tenant.invitation_accepted",
    "tenant.invitation_declined",
    "tenant.invitation_revoked",
    "tenant.invitation_expired",
  ] as const;

  /** 角色之外的参数给全，免得「少一个参数」把断言带向别的原因。 */
  const base: TemplateParams = {
    tenantName: "Acme 科技",
    inviterName: "Ann",
    inviteeName: "ann@acme.example",
    expiresAt: "2026-10-06",
  };

  it("五个码两种语言各有词，且查表就是那张表（不落回落档）", () => {
    for (const [code, words] of Object.entries(ROLE_WORDS)) {
      for (const locale of LOCALES) {
        expect(roleNameOf(code, locale)).toBe(words[locale]);
      }
    }
    expect(Object.keys(ROLE_WORDS)).toHaveLength(5);
  });

  it("五条模板都用 roleKey 这一个参数名，全表不留旧名 roleName", () => {
    for (const code of ROLE_TEMPLATES) {
      const def = NOTIFICATION_TEMPLATES[code];
      expect(placeholders(def.title, def.body)).toContain(ROLE_PARAM);
    }
    /* 两个名字并存的话，只改了一处的人不会收到任何提醒——而症状是正文里一个空洞。 */
    for (const code of Object.keys(
      NOTIFICATION_TEMPLATES,
    ) as NotificationTemplateCode[]) {
      const def = NOTIFICATION_TEMPLATES[code];
      expect(placeholders(def.title, def.body)).not.toContain("roleName");
    }
  });

  it("同一个码、两种语言、两个词；中文正文里一个英文码都不剩", () => {
    for (const code of ROLE_TEMPLATES) {
      for (const [roleKey, words] of Object.entries(ROLE_WORDS)) {
        const zh = rendered(code, { ...base, roleKey }, "zh-CN");
        expect(zh).toContain(words["zh-CN"]);
        // 这一句就是那个缺陷本身：中文里印出 `member` / `guest` 这种内部值。
        expect(zh).not.toContain(roleKey);
        expect(rendered(code, { ...base, roleKey }, "en-US")).toContain(
          words["en-US"],
        );
      }
    }
  });

  it("码不认识、或者压根没给：两种语言各回落成一句实话，不印码也不留空洞", () => {
    for (const code of ROLE_TEMPLATES) {
      for (const params of [
        // 目录外的码：将来加了角色而这张表没跟。
        { ...base, roleKey: "sysadmin" },
        // 发侧整个忘了传这个参数（`interpolate` 对缺参本来是替换成空串）。
        { ...base },
      ]) {
        const zh = rendered(code, params, "zh-CN");
        expect(zh).toContain("未指定角色");
        expect(zh).not.toContain("sysadmin");
        /* 空洞长这样：「以「」身份加入」。回落必须把它填上——一句带洞的话比一个陌生的码
           更难读，而两者都是把「我不知道」说成了别的东西。 */
        expect(zh).not.toContain("「」");
        expect(rendered(code, params, "en-US")).toContain(
          "an unspecified role",
        );
      }
    }
  });
});

/**
 * 「关掉主题关不掉邀请本身」「关掉邀请本身关不掉那四条周知」——**跑一遍分发器**来证。
 *
 * 为什么必须是运行证明而不是断言：这里要证的两件事都**不在模板表里**——
 *   · `mandatory` 是 dispatcher 每次调用传的参数（`tenant.invitation`：站内那条消息**就是**
 *     邀请，关掉它邀请人会收到「已送达对方账号」而对方那边什么也没有，owner 2026-09-09）；
 *   · 「关掉哪个主题会静音哪几条」是 `topicOf` 与偏好门**跑起来之后**的行为。
 *
 * 2026-09-29 owner 把邀请拆成两个主题（`member_invitation` 只剩邀请本身，四条周知归
 * `invitation_activity`），所以这一组现在钉**两个方向**：
 *   关掉「邀请动态」 ⇒ 四条周知不落，而邀请本身照样落（验收就是这一条）；
 *   关掉「成员邀请」 ⇒ 邀请本身照样落（mandatory 短路），而四条周知**不再被连带静音**
 *                     ——拆开之前那四条跟着一起哑掉，那正是拆行要解决的事。
 * 只验一个方向证不了拆开生效：两个主题其实还是同一个，也能让「关掉 A 之后 B 不发」全绿。
 *
 * 判据先验它会不会动：第一条用例证明这个假开关**只关指定的那一个主题**——否则「关了照样
 * 送到」可能只是因为开关根本没生效，那是个恒真的判据。
 */
describe("拆开之后两个主题各自管得住自己", () => {
  /** 只装分发器在这条路径上会碰的几张表；未知 SQL 一律抛（多一条查询不该静默变成查不到）。 */
  function invitePool() {
    const inbox = new Set<string>();
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("select owner_user_id from tenancy.tenants")) {
        return { rows: [{ owner_user_id: "inviter-1" }], rowCount: 1 };
      }
      if (sql.includes("from account.users")) {
        return {
          rows: [{ email: null, phone: null, language: "zh-CN" }],
          rowCount: 1,
        };
      }
      if (sql.includes("insert into support.inbox_messages")) {
        const key = [params[1], params[2], params[6], params[7]].join("|");
        if (inbox.has(key)) return { rows: [], rowCount: 0 };
        inbox.add(key);
        return { rows: [{ id: `msg-${inbox.size}` }], rowCount: 1 };
      }
      if (sql.includes("insert into support.notification_logs")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });
    return { pool: { query } as unknown as Pool, inbox };
  }

  /**
   * 探针：对**指定的那一个**主题的任何渠道都回 false，其余主题照常放行。
   *
   * 这是探针而不是一个真实的库内状态——偏好服务把 `member_invitation` 的**站内**档锁成了开
   * （@vxture/service-account 的 `LOCKED.member_invitation`，那边有用例），所以现实里站内
   * 这一档永远是 true，客户真能关的是邮件 / 短信。这里故意把站内也关掉，为的是让用例落在
   * dispatcher 那一个短路的两侧：mandatory 绕过、不带 mandatory 不绕过。
   *
   * 带参数而不是写死一个主题：拆开之后要两个主题各关一次，才看得出那一刀真的切在中间。
   * 而 `invitation_activity` 三个渠道都**没有**锁（那正是拆开的目的），所以关掉它是客户
   * 真做得到的事，不只是探针。
   */
  const topicOff = (denied: NotificationTopic) => ({
    allows: async (_userId: string, topic: NotificationTopic) =>
      topic !== denied,
  });

  function dispatcher(pool: Pool, denied: NotificationTopic) {
    return new NotificationDispatcher(pool, {
      prefs: topicOff(denied),
      // 运营镜像另有自己的用例；这里关掉，免得假 pool 还要装它那三条查询。
      operatorMirror: null,
      logger: { warn: () => {} },
    });
  }

  const invitation = {
    tenantId: "t-1",
    reference: {
      type: "invitation" as const,
      id: "8800000012:7a1b2c3d4e5f:sent",
    },
    params: {
      tenantName: "Acme 科技",
      inviterName: "Ann",
      roleName: "成员",
      expiresAt: "2026-10-06",
    },
  };

  it("这个假开关只关指定的那一个主题：别的主题照样送到（否则下面几条是恒真的）", async () => {
    const f = invitePool();
    const res = await dispatcher(f.pool, "invitation_activity").notify({
      tenantId: "t-1",
      templateCode: "subscription.expiring_soon",
      reference: { type: "subscription", id: "sub-1:2026-10-06" },
      params: {
        productName: "Arda",
        planName: "Pro",
        endAt: "2026-10-06",
        days: 7,
      },
    });
    expect(res.inboxCreated).toBe(1);
  });

  it("mandatory 的邀请本身：自己那个主题关着也照样落进被邀请人的收件箱", async () => {
    const f = invitePool();
    const res = await dispatcher(f.pool, "member_invitation").notify({
      ...invitation,
      templateCode: "tenant.invitation",
      exactRecipients: ["invitee-1"],
      mandatory: true,
      inboxOnly: true,
      link: "/inbox",
    });
    expect(res.inboxCreated).toBe(1);
    expect(res.skipped).toBe(0);
  });

  /** 四条周知的公共调用形状（收件人是邀请人；四条各自的引用锚不同）。 */
  function activity(code: NotificationTemplateCode) {
    return {
      tenantId: "t-1",
      templateCode: code,
      reference: {
        type: "invitation" as const,
        id: `8800000012:7a1b2c3d4e5f:${code}`,
      },
      params: {
        tenantName: "Acme 科技",
        roleKey: "member",
        inviteeName: "ann@acme.example",
        expiresAt: "2026-10-06",
      },
      exactRecipients: ["inviter-1"],
    };
  }

  const ACTIVITY_CODES = [
    "tenant.invitation_accepted",
    "tenant.invitation_declined",
    "tenant.invitation_revoked",
    "tenant.invitation_expired",
  ] as NotificationTemplateCode[];

  it("关掉「邀请动态」：四条周知停在门口（不带 mandatory 就不绕过偏好门）", async () => {
    /* 这一条同时是「上一条不是因为门没生效」的对照：四条周知**没有** mandatory，所以它们
       真的被拦住了。拆主题之后关掉的是 `invitation_activity`——客户在偏好页上把这一行的三
       档全关掉就是这个状态（那一行没有 LOCKED，见偏好服务）。 */
    for (const code of ACTIVITY_CODES) {
      const f = invitePool();
      const res = await dispatcher(f.pool, "invitation_activity").notify(
        activity(code),
      );
      expect(res.inboxCreated).toBe(0);
      expect(res.skipped).toBe(1);
      expect(f.inbox.size).toBe(0);
    }
  });

  it("关掉「邀请动态」的同时，mandatory 的邀请本身仍然送达（owner 要的验收）", async () => {
    const f = invitePool();
    const res = await dispatcher(f.pool, "invitation_activity").notify({
      ...invitation,
      templateCode: "tenant.invitation",
      exactRecipients: ["invitee-1"],
      mandatory: true,
      inboxOnly: true,
      link: "/inbox",
    });
    expect(res.inboxCreated).toBe(1);
    expect(res.skipped).toBe(0);
    expect(f.inbox.size).toBe(1);
  });

  it("反过来：关掉「成员邀请」不再连带静音那四条周知（拆行的全部意义）", async () => {
    /* 拆开之前四条与邀请本身同住一行，站内那一档为了保住邀请本身必须锁死，于是客户要么
       忍着四条、要么把整行关掉（而关掉的那一档根本关不动）。这条用例就是那个连带效应
       现在不存在了——同一个探针关着 member_invitation，四条照样落。 */
    for (const code of ACTIVITY_CODES) {
      const f = invitePool();
      const res = await dispatcher(f.pool, "member_invitation").notify(
        activity(code),
      );
      expect(res.inboxCreated).toBe(1);
      expect(res.skipped).toBe(0);
    }
  });
});

describe("全表通则", () => {
  const codes = Object.keys(
    NOTIFICATION_TEMPLATES,
  ) as NotificationTemplateCode[];

  /**
   * 该模板两种语言都该用到的参数 → 标记值。标记既当填充也当探针。
   *
   * `roleKey` 例外：它是**码不是展示值**，渲染时被换成该语言的角色名，所以标记穿不过它
   * （硬塞一个 `<roleKey>` 只会落进「码不认识」的回落档）。给它一个真码，另在 `echo` 里
   * 摘出去——它那一半的判据在「角色码在渲染时成词」那一组，以及下面参数集合那条用例里。
   */
  function markers(code: NotificationTemplateCode): {
    names: string[];
    params: TemplateParams;
    echo: string[];
  } {
    const def = NOTIFICATION_TEMPLATES[code];
    const names = placeholders(def.title, def.body);
    return {
      names,
      params: Object.fromEntries(
        names.map((p) => [p, p === ROLE_PARAM ? "member" : `<${p}>`]),
      ),
      echo: names.filter((p) => p !== ROLE_PARAM),
    };
  }

  it("每条模板两种语言的标题与正文都非空", () => {
    /* = 模板码总数。加一条码就在这里 +1 —— 这个数字当探针的全部意义就是「加了码却没有
       任何一条用例覆盖到它」当场红。2026-09-28 收尾加两条（运营代客续期 / 升级维护暂停）：
       32 → 34。2026-09-29 成员邀请四态：34 → 38。 */
    expect(codes).toHaveLength(38);
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
      const { names, echo, params } = markers(code);
      for (const locale of LOCALES) {
        const text = rendered(code, params, locale);
        expect(text).not.toMatch(/\{\{/);
        for (const name of echo) expect(text).toContain(`<${name}>`);
        /* roleKey 那一半：标记换不过去，改成按语言断言它成了那个语言的角色名——⊇ 那个
           方向（「这个参数该语言也用到了」）的判据没有丢。 */
        if (names.includes(ROLE_PARAM)) {
          expect(text).toContain(roleNameOf("member", locale));
        }
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
  /* 2026-09-29 成员邀请四态：写入方在 @vxture/service-organization 的成员仓储
     （accepted / declined / revoked 三个活方法）与邀请过期巡检，都不在订阅包里。
     **不往第二副本里加**——那份副本只列写入方住在那个包里的模板码，加进去就是声明一件
     不存在的事，而这张差集表正是为这种情况准备的逃生口。 */
  "tenant.invitation_accepted":
    "邀请接受的写入方在 identity/organization 的成员仓储，不在订阅包",
  "tenant.invitation_declined":
    "邀请拒绝的写入方在 identity/organization 的成员仓储，不在订阅包",
  "tenant.invitation_revoked":
    "邀请撤回的写入方在 identity/organization 的成员仓储，不在订阅包",
  "tenant.invitation_expired":
    "邀请过期没有写入方，靠巡检补齐（与加油包池巡检同一形状），不在订阅包",
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
