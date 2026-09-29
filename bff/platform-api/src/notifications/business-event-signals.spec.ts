/**
 * business-event-signals.spec.ts —— 业务事件巡检的纯映射：一行 → 一条通告的形状。
 *
 * 这里钉的不是「代码跑得通」，是四类**只会在屏幕上现形**的错：
 *   · 标题 / 正文 / 链接里漏出 UUID（全站铁律，静态守卫看不见运行时拼出来的串）；
 *   · 主体码没带 U- / T- 前缀（裸 10 位数字分不出是用户还是租户，owner 2026-09-21）；
 *   · 去重键写错 → 同一件事每轮重播一条，通告板被同一行刷满；
 *   · 去重键超过 reference_id 的 varchar(128) → 22001，那一条通告静默消失（加油包的
 *     order_no 本身就能到 128 位，所以这不是理论情形）；
 *   · severity 写错 → 在等人处理的事 30 天后自己消失（info 会过期，warning 不会）。
 * 真库上的谓词与授权面由 operator-signal-sweep.itest.spec.ts 钉，两边各管一半。
 */
import { describe, expect, it } from "vitest";
import { TICKET_EVENT_COMMENT } from "@vxture-platform/shared";
import {
  BUSINESS_EVENT_CODES,
  BUSINESS_EVENT_INFO_TTL_MS,
  BUSINESS_EVENT_PASSES,
  BUSINESS_EVENT_REFERENCE_TYPE,
  businessEventDedupeKey,
  composeBusinessNotice,
  type BusinessEventCode,
  type SignalRow,
} from "./business-event-signals";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const UUID = "0198c4de-1f2b-4d3e-8a91-77b0c5e6d412";

const passOf = (code: BusinessEventCode) => {
  const pass = BUSINESS_EVENT_PASSES.find((p) => p.code === code);
  if (!pass) throw new Error(`没有 ${code} 这一段`);
  return pass;
};

const shape = (code: BusinessEventCode, row: SignalRow) =>
  passOf(code).shape(row);

describe("业务事件巡检 —— 表结构不变式", () => {
  it("每个事件码恰好一段，且与 BUSINESS_EVENT_CODES 一致", () => {
    const codes = BUSINESS_EVENT_PASSES.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual([...BUSINESS_EVENT_CODES].sort());
  });

  it("每条 SQL 都用绑定参数收回看窗口与上限，且不拼串", () => {
    for (const pass of BUSINESS_EVENT_PASSES) {
      // 拼串进 SQL 就是注入面，也让 check-ops-todo-alerts 那种文本判据瞎掉。
      expect(pass.sql.includes("${"), pass.code).toBe(false);
      expect(pass.sql, pass.code).toContain("make_interval(mins => $1::int)");
      expect(pass.sql, pass.code).toContain("limit $2::int");
      // 每段都要有稳定的顺序：无序 + limit 等于每轮随机取一批。
      expect(pass.sql, pass.code).toContain("order by");
    }
  });

  it("每条 SQL 都把行键 alias 成 dedupe_key —— 少了它去重就没有锚", () => {
    for (const pass of BUSINESS_EVENT_PASSES) {
      expect(pass.sql, pass.code).toContain("as dedupe_key");
    }
  });

  /**
   * 参数位与 extraParams 必须**数目相等**。两个方向都错得不响：
   *   · SQL 里多一个 $4 而没给参数 ⇒ pg 抛「bind message supplies 3 parameters」，
   *     那一类整轮失败（巡检把它 catch 成一段失败，运营端的表现是这一类一条不发）；
   *   · 给了参数而 SQL 里没有那个位 ⇒ 参数被默默忽略，谓词按别的规则放行，
   *     **一个字都不会报**。后者正是这一批要防的那种漏法。
   */
  it("SQL 里的最大参数位 = 2 + extraParams 的个数", () => {
    for (const pass of BUSINESS_EVENT_PASSES) {
      const positions = [...pass.sql.matchAll(/\$(\d+)/g)].map((m) =>
        Number(m[1]),
      );
      const highest = Math.max(...positions);
      expect(highest, pass.code).toBe(2 + (pass.extraParams?.length ?? 0));
      // 位号不跳号：$2 与 $4 之间少了 $3，上面那条仍然能过。
      const distinct = [...new Set(positions)].sort((a, b) => a - b);
      expect(distinct, pass.code).toEqual(
        Array.from({ length: highest }, (_, i) => i + 1),
      );
    }
  });

  /**
   * 读 support.ticket_comments 的那一类：事件词必须**绑参**，不许写进 SQL 字面量。
   *
   * 守卫（check-ticket-comment-visibility）查的是「客户面读这张表要带白名单过滤」；
   * 这一条查的是另一半：运营通告这一侧的判据也得来自值域那一份，不是手抄。
   * 三处字面量（console 展示层 / console-bff 写入方 / 这条 SQL）里有一处写错，
   * 后果是该发的通告一条不发，而且不报错。
   */
  it("客户回复那一类：事件词绑参取自值域，SQL 里没有手抄的词", () => {
    const pass = passOf("ticket.customer_replied");
    expect(pass.sql).toContain("c.event_type = any($3::text[])");
    expect(pass.sql).not.toContain("'comment'");
    expect(pass.extraParams).toEqual([[TICKET_EVENT_COMMENT]]);
    // 第二道门：词对上了还要身份对上（运营也能写出 comment 这个词，见 demo seed 的旧行）。
    expect(pass.sql).toContain("c.actor_type = 'customer'");
    // 正文不引评论文本 ⇒ SQL 不取 payload。
    expect(pass.sql).not.toContain("payload");
  });
});

describe("业务事件巡检 —— 逐类文案", () => {
  it("新用户注册：带 U- 前缀，链接走 user_no", () => {
    expect(
      shape("user.signed_up", {
        dedupe_key: "1799729056",
        code: "1799729056",
        display_name: "郭彦昊",
        kind: "web",
      }),
    ).toEqual({
      severity: "info",
      title: "新用户注册：郭彦昊（U-1799729056）",
      body: "郭彦昊（U-1799729056） · 官网注册",
      link: "/accounts/1799729056",
    });
  });

  it("新建组织租户：带 T- 前缀与所有者", () => {
    expect(
      shape("tenant.created", {
        dedupe_key: "2143889307",
        code: "2143889307",
        tenant_name: "示例科技",
        display_name: "郭彦昊",
      }),
    ).toEqual({
      severity: "info",
      title: "新建组织租户 示例科技（T-2143889307）",
      body: "示例科技（T-2143889307） · 所有者 郭彦昊",
      link: "/tenants/2143889307",
    });
  });

  it("提交企业认证：warning（在等运营审核），方式与主体各自成文", () => {
    const shaped = shape("tenant.verification_submitted", {
      dedupe_key: UUID,
      kind: "enterprise",
      method: "documents",
      subject_text: "示例科技有限公司",
      tenant_no: "2143889307",
      tenant_name: "示例科技",
    });
    expect(shaped.severity).toBe("warning");
    expect(shaped.title).toBe("示例科技 提交企业认证（提交资料）");
    expect(shaped.body).toBe(
      "租户 示例科技（T-2143889307） · 申报名称 示例科技有限公司 · 认证方式 提交资料 · 等待运营审核。",
    );
    expect(shaped.link).toBe("/verifications");
  });

  it("客户下单待付款：金额带币符，链接走 order_no", () => {
    const shaped = shape("order.created", {
      dedupe_key: "ORD-202609-1A2B3C4D5E",
      code: "ORD-202609-1A2B3C4D5E",
      amount: "99.00",
      currency: "CNY",
      kind: "new",
      product_name: "Karda",
      plan_name: "专业版",
      tenant_no: "2143889307",
      tenant_name: "示例科技",
    });
    expect(shaped.title).toBe(
      "客户下单待付款 ¥99.00 · ORD-202609-1A2B3C4D5E（Karda 专业版）",
    );
    expect(shaped.severity).toBe("info");
    expect(shaped.link).toBe("/orders/ORD-202609-1A2B3C4D5E");
  });

  it("加油包：price 是钱、amount 是配额量，两者不混", () => {
    const shaped = shape("addon.created", {
      dedupe_key: "ORD-202609-ADDON01",
      code: "ORD-202609-ADDON01",
      amount: "50.00",
      currency: "CNY",
      product_name: "调用量包 10 万",
      kind: "llm.tokens",
      note: "100000",
      tenant_name: "示例科技",
    });
    expect(shaped.title).toBe(
      "客户下单加油包 ¥50.00 · ORD-202609-ADDON01（调用量包 10 万）",
    );
    expect(shaped.body).toContain("配额 llm.tokens 100000");
    expect(shaped.link).toBe("/addon-orders");
  });

  it("申请开票：warning，票种与抬头进正文", () => {
    const shaped = shape("invoice.applied", {
      dedupe_key: "INV-202609-0001",
      code: "INV-202609-0001",
      amount: "1200.50",
      currency: "CNY",
      kind: "electronic_special",
      subject_text: "示例科技有限公司",
      tenant_name: "示例科技",
    });
    expect(shaped.severity).toBe("warning");
    expect(shaped.title).toBe("客户申请开票 ¥1200.50 · INV-202609-0001");
    expect(shaped.body).toContain("电子专票");
    expect(shaped.link).toBe("/invoices");
  });

  it("客户评价：任一分 ≤2 升 warning，缺分画「—」", () => {
    const low = shape("review.submitted", {
      dedupe_key: UUID,
      product_score: 5,
      price_score: 2,
      service_score: null,
      product_name: "Karda",
      note: "价格偏高",
      tenant_name: "示例科技",
    });
    expect(low.severity).toBe("warning");
    expect(low.title).toBe("客户评价 Karda：产品 5/价格 2/服务 —");
    expect(low.body).toContain("评语「价格偏高」");

    const fine = shape("review.submitted", {
      dedupe_key: UUID,
      product_score: 5,
      price_score: 4,
      service_score: 3,
      product_name: "Karda",
    });
    expect(fine.severity).toBe("info");
    expect(fine.body).toContain("未留评语");
  });

  it("优惠核销：邀请档单独一句，其余按券种", () => {
    expect(
      shape("voucher.redeemed", {
        dedupe_key: "RDM-202609-0001",
        code: "RDM-202609-0001",
        kind: "invite",
        tenant_name: "示例科技",
        display_name: "郭彦昊",
      }).title,
    ).toBe("邀请订阅已核销：RDM-202609-0001");

    expect(
      shape("voucher.redeemed", {
        dedupe_key: "RDM-202609-0002",
        code: "RDM-202609-0002",
        kind: "recharge_card",
        tenant_name: "示例科技",
      }).title,
    ).toBe("优惠已核销：充值卡 · RDM-202609-0002");
  });

  it("申请注销：warning，正文写清保留期内可撤销", () => {
    const shaped = shape("account.deletion_requested", {
      dedupe_key: "1799729056",
      code: "1799729056",
      display_name: "郭彦昊",
    });
    expect(shaped.severity).toBe("warning");
    expect(shaped.title).toBe(
      "用户申请注销账号：郭彦昊（U-1799729056），30 天后清除",
    );
    expect(shaped.link).toBe("/accounts/1799729056");
  });

  it("关自动续费：按 actor_type 分主语，链接走订阅的订单号", () => {
    const base: SignalRow = {
      dedupe_key: UUID,
      order_no: "ORD-202609-1A2B3C4D5E",
      product_name: "Karda",
      plan_name: "专业版",
      tenant_name: "示例科技",
    };
    expect(shape("subscription.autorenew_off", base).title).toBe(
      "客户关闭自动续费 Karda 专业版 · 示例科技",
    );
    expect(
      shape("subscription.autorenew_off", { ...base, actor_type: "operator" })
        .title,
    ).toBe("运营代客户关闭自动续费 Karda 专业版 · 示例科技");
    expect(
      shape("subscription.autorenew_off", { ...base, actor_type: "system" })
        .title,
    ).toBe("系统关闭自动续费 Karda 专业版 · 示例科技");
    expect(shape("subscription.autorenew_off", base).link).toBe(
      "/subscriptions/ORD-202609-1A2B3C4D5E",
    );
    // 没履约过的订阅查不到订单号：宁可不给链接，也不给一个点开 404 的。
    expect(
      shape("subscription.autorenew_off", { ...base, order_no: null }).link,
    ).toBeNull();
  });

  it("新工单：p0 升 critical，其余 warning", () => {
    const p0 = shape("ticket.created", {
      dedupe_key: "TCK-202609-0001",
      code: "TCK-202609-0001",
      subject_text: "登录不了",
      priority: "p0",
      kind: "account",
      note: "console",
      tenant_name: "示例科技",
    });
    expect(p0.severity).toBe("critical");
    expect(p0.title).toBe("新工单 TCK-202609-0001：登录不了（P0 最高）");
    expect(p0.body).toContain("来源 客户控制台");
    expect(p0.link).toBe("/tickets/TCK-202609-0001");

    expect(
      shape("ticket.created", {
        dedupe_key: "TCK-202609-0002",
        code: "TCK-202609-0002",
        subject_text: "发票问题",
        priority: "p2",
      }).severity,
    ).toBe("warning");
  });

  it("客户回复工单：p0 升 critical，正文说清当前状态与回复人", () => {
    const shaped = shape("ticket.customer_replied", {
      dedupe_key: "TCK-202609-0001:2026-09-29T11:28:28.341Z",
      code: "TCK-202609-0001",
      subject_text: "登录不了",
      priority: "p1",
      note: "resolved",
      display_name: "张三",
      tenant_no: "2636605046",
      tenant_name: "示例科技",
    });
    expect(shaped.severity).toBe("warning");
    expect(shaped.title).toBe("客户回复工单 TCK-202609-0001：登录不了");
    expect(shaped.body).toContain("回复人 张三");
    // 「已解决」上的回复会把单自动重开,通告必须说得出它当时是什么状态。
    expect(shaped.body).toContain("当前状态 已解决");
    expect(shaped.body).toContain("优先级 P1 高");
    expect(shaped.body).toContain("示例科技");
    expect(shaped.link).toBe("/tickets/TCK-202609-0001");

    expect(
      shape("ticket.customer_replied", {
        dedupe_key: "TCK-2:t",
        code: "TCK-2",
        subject_text: "急",
        priority: "p0",
      }).severity,
    ).toBe("critical");
  });

  it("客户回复：去重键带回复时刻 ⇒ 同一张单回三句是三条通告", () => {
    const first = businessEventDedupeKey(
      "ticket.customer_replied",
      "TCK-202609-0001:2026-09-29T11:28:28.341Z",
    );
    const second = businessEventDedupeKey(
      "ticket.customer_replied",
      "TCK-202609-0001:2026-09-29T11:29:02.007Z",
    );
    expect(first).not.toBe(second);
    // 而同一句回话被重扫十几次(回看窗口 30 分钟 / 节奏 2 分钟)只会落成一条。
    expect(first).toBe(
      businessEventDedupeKey(
        "ticket.customer_replied",
        "TCK-202609-0001:2026-09-29T11:28:28.341Z",
      ),
    );
  });

  it("值域外的码原样回显，不吞掉也不猜", () => {
    // 工单分类没有 CHECK（开放分类法），来源与优先级有；三者都可能出现没登记的值。
    const shaped = shape("ticket.created", {
      dedupe_key: "TCK-9",
      code: "TCK-9",
      subject_text: "标题",
      priority: "p9",
      note: "wechat",
    });
    expect(shaped.title).toContain("（p9）");
    expect(shaped.body).toContain("来源 wechat");
  });

  it("金额缺失写「金额未记录」，不写 ¥0.00", () => {
    expect(
      shape("order.created", { dedupe_key: "ORD-1", code: "ORD-1" }).title,
    ).toBe("客户下单待付款 金额未记录 · ORD-1");
  });
});

describe("业务事件巡检 —— 通告外壳", () => {
  it("planes 只投 admin，去重锚是 {事件码}:{行键}", () => {
    const pass = passOf("order.created");
    const notice = composeBusinessNotice(
      pass,
      { dedupe_key: "ORD-1", code: "ORD-1", amount: "1.00", currency: "CNY" },
      NOW,
    );
    expect(notice.targetPlanes).toEqual(["admin"]);
    expect(notice.referenceType).toBe(BUSINESS_EVENT_REFERENCE_TYPE);
    expect(notice.referenceId).toBe("order.created:ORD-1");
    expect(businessEventDedupeKey("order.created", "ORD-1")).toBe(
      "order.created:ORD-1",
    );
  });

  it("info 30 天后过期，warning / critical 不过期", () => {
    const info = composeBusinessNotice(
      passOf("user.signed_up"),
      { dedupe_key: "1", code: "1799729056" },
      NOW,
    );
    expect(info.expiresAt).toEqual(
      new Date(NOW.getTime() + BUSINESS_EVENT_INFO_TTL_MS),
    );

    const warning = composeBusinessNotice(
      passOf("invoice.applied"),
      { dedupe_key: "INV-1", code: "INV-1" },
      NOW,
    );
    expect(warning.expiresAt).toBeNull();

    const critical = composeBusinessNotice(
      passOf("ticket.created"),
      { dedupe_key: "TCK-1", code: "TCK-1", priority: "p0" },
      NOW,
    );
    expect(critical.expiresAt).toBeNull();
  });

  it("reference_id 不超过列宽 varchar(128)", () => {
    for (const pass of BUSINESS_EVENT_PASSES) {
      const notice = composeBusinessNotice(pass, { dedupe_key: UUID }, NOW);
      expect(notice.referenceId.length, pass.code).toBeLessThanOrEqual(128);
    }
  });

  it("可视码本身就能到 128 位：截断 + 内容哈希，不让 22001 静默吃掉通告", () => {
    // metering.addon_purchases.order_no 是 varchar(128)（50_metering.sql:453），
    // 加上 `addon.created:` 这 14 个字符必然越界。越界 = 写失败 = 那条通告没了。
    const long = `ORD-${"A".repeat(124)}`;
    expect(long.length).toBe(128);
    const id = businessEventDedupeKey("addon.created", long);
    expect(id.length).toBeLessThanOrEqual(128);
    // 前缀留着（查库的人还能认出这是哪一类、哪个单），尾巴是全键的 8 位 sha256。
    expect(id.startsWith("addon.created:ORD-")).toBe(true);
    expect(id).toMatch(/:[0-9a-f]{8}$/);

    // 两个前缀相同、只在末尾不同的长单号不许撞成一条：撞了就是「一条挡住另一条」。
    const other = businessEventDedupeKey("addon.created", `${long}-2`);
    expect(other).not.toBe(id);
    expect(other.length).toBeLessThanOrEqual(128);

    // 整条通告也按这个键去重（composeBusinessNotice 不另算一份）。
    const notice = composeBusinessNotice(
      passOf("addon.created"),
      { dedupe_key: long, code: long },
      NOW,
    );
    expect(notice.referenceId).toBe(id);
  });

  it("没超长就原样 —— 绝大多数键要能一眼看出是哪件事", () => {
    const key = businessEventDedupeKey(
      "order.created",
      "ORD-202609-1A2B3C4D5E",
    );
    expect(key).toBe("order.created:ORD-202609-1A2B3C4D5E");
  });

  it("每一类都不把行 id 漏进标题 / 正文 / 链接", () => {
    // 有四类的行键就是行 id（kyc.tenant_verifications / support.product_reviews /
    // metering.subscription_histories 都没有可视码）。reference_id 不上屏，放 uuid
    // 是允许的；标题、正文、链接三处一个字符都不许有——这是全站铁律里最容易在
    // 「顺手把 dedupe_key 也写进标题」时破掉的一处。
    for (const pass of BUSINESS_EVENT_PASSES) {
      const notice = composeBusinessNotice(pass, { dedupe_key: UUID }, NOW);
      expect(notice.referenceId, pass.code).toContain(UUID);
      expect(notice.title, pass.code).not.toContain(UUID);
      expect(notice.body, pass.code).not.toContain(UUID);
      expect(notice.link ?? "", pass.code).not.toContain(UUID);
    }
  });

  it("行里什么都没有时也能出一条通告（缺字段不抛）", () => {
    for (const pass of BUSINESS_EVENT_PASSES) {
      const notice = composeBusinessNotice(pass, { dedupe_key: "k" }, NOW);
      expect(notice.title.length, pass.code).toBeGreaterThan(0);
      expect(notice.title.length, pass.code).toBeLessThanOrEqual(256);
      expect(notice.body.length, pass.code).toBeGreaterThan(0);
    }
  });
});
