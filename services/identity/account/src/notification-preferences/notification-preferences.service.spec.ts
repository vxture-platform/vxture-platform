import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TOPICS,
  NOTIFICATION_TOPICS_PLANNED,
  NotificationPreferencesService,
} from "./notification-preferences.service";
/**
 * 跨包相对导入（services → services，dep-cruiser 允许同层）。
 * 不用 `@vxture/service-notification`：**没有**这个路径别名，而 templates.ts 自身零
 * import，按路径只拉它一个文件，类型与运行时都成立。这是唯一能同时看到「派发侧哪些
 * 主题真有模板」与「偏好中心还把哪些标成开发中」的地方——这两半此前全仓无人对账。
 */
import {
  NOTIFICATION_TEMPLATES,
  topicOf,
  type NotificationTemplateCode,
} from "../../../../notification/dispatch/src/templates";

/**
 * 规整逻辑(normalize)的守卫。它是这条链路上唯一有安全内容的地方:
 *
 *  · **安全类站内信强制开启** —— 账号被接管时用户必须有一个到达路径。这不是
 *    产品偏好,所以由服务端强制而不是靠前端把开关画成 disabled;前端画不画,
 *    是可以被绕过的。
 *  · **未知键丢弃** —— 库里存下未知主题会让「这个开关是什么」永远没人答得上来。
 *  · **缺省补齐** —— 返回的永远是完整矩阵,前端因此不必自带第二份默认值。
 *
 * 用假 Pool:这里要验的是规整规则,不是 SQL。
 */
function build(storedNotifications: unknown) {
  const query = vi
    .fn()
    .mockResolvedValue({ rows: [{ notifications: storedNotifications }] });
  const service = new NotificationPreferencesService({
    query,
  } as unknown as Pool);
  return { service, query };
}

describe("通知偏好规整", () => {
  it("从未设置过 → 返回全默认(站内开、外发通道关)", async () => {
    const { service } = build(null);
    const prefs = await service.get("u-1");

    expect(Object.keys(prefs).sort()).toEqual([...NOTIFICATION_TOPICS].sort());
    for (const topic of NOTIFICATION_TOPICS) {
      expect(Object.keys(prefs[topic]).sort()).toEqual(
        [...NOTIFICATION_CHANNELS].sort(),
      );
      // 默认开外发通道等于替用户同意打扰——事务性的那几个除外（错过了会有实际损失）。
      // 2026-09-09 从四个变六个：订单最后怎么样了、租户升组织，错过同样会误判自己
      // 的订单或权限状态。这张名单**手写、不引服务端的表**：引过来就成了「拿被测的
      // 那份去证明它自己」，改错了两边一起错，测不出来。
      // 2026-09-28 批 5 再加两个：认证结果（驳回了不知道，企业认证一直卡着，订阅与开票
      // 跟着卡）、额度用尽（花钱买的加油包用完了不知道，业务在没有余量的情况下空跑）。
      // 2026-09-29 owner 把邀请拆成两个主题之后，**这两行都不在名单里**（邮件默认关），
      // 各有各的理由：member_invitation 只剩 tenant.invitation 一条而那条是 inboxOnly 的
      // （默认打开一个永远不会发出邮件的开关 = 页面在说假话）；invitation_activity 是
      // **周知**不是事务性（owner 的分类），所以照 announcement 走，默认只进站内。
      const transactional = (
        [
          "subscription_expiry",
          "provision_result",
          "payment_due",
          "refund_progress",
          "order_status",
          "tenant_change",
          "verification_result",
          "quota_alert",
        ] as readonly string[]
      ).includes(topic);
      expect(prefs[topic].email).toBe(transactional);
      expect(prefs[topic].sms).toBe(false);
    }
    expect(prefs.announcement.inbox).toBe(true);
  });

  it("安全类站内信即使库里存着 false 也强制为 true", async () => {
    const { service } = build({
      security: { inbox: false, email: false, sms: false },
    });
    const prefs = await service.get("u-1");
    expect(prefs.security.inbox).toBe(true);
  });

  it("写入时同样强制:提交 security.inbox=false 落库仍是 true", async () => {
    const { service, query } = build(null);
    const saved = await service.replace("u-1", {
      security: { inbox: false },
    });

    expect(saved.security.inbox).toBe(true);
    // 落库的那份也必须是强制后的值,不能只在返回值上装样子。
    const persisted = JSON.parse(query.mock.calls[0]![1]![1] as string);
    expect(persisted.security.inbox).toBe(true);
  });

  /**
   * 成员邀请的站内档也锁（2026-09-29）。
   *
   * 拆分之后这个主题下**只剩一条**模板：`tenant.invitation`——站内那条消息**就是**邀请。
   * 站内可关的话，界面会出现「未订阅」而邀请照样进收件箱的假象。真正兜住「关不掉邀请本身」
   * 的是 dispatcher 的 mandatory 短路（那一条在 @vxture/service-notification 的
   * templates.spec.ts 里**跑分发器**证过）；这里钉的是界面看到的那一半：服务端强制，不靠
   * 前端把开关画成 disabled。
   */
  it("成员邀请的站内档锁定为开，邮件那一档照常可关", async () => {
    const { service, query } = build({
      member_invitation: { inbox: false, email: false, sms: false },
    });
    const prefs = await service.get("u-1");
    expect(prefs.member_invitation.inbox).toBe(true);
    // 邮件 / 短信不锁（owner 2026-09-29：站内恒锁、邮件短信可开关）；默认关，因为这一行
    // 唯一那条模板是 inboxOnly 的。
    expect(prefs.member_invitation.email).toBe(false);
    expect(prefs.member_invitation.sms).toBe(false);

    const saved = await service.replace("u-1", {
      member_invitation: { inbox: false, email: true },
    });
    expect(saved.member_invitation.inbox).toBe(true);
    expect(saved.member_invitation.email).toBe(true);
    // 落库的那份也必须是强制后的值,不能只在返回值上装样子。
    const persisted = JSON.parse(query.mock.calls[1]![1]![1] as string);
    expect(persisted.member_invitation.inbox).toBe(true);
  });

  /**
   * 邀请动态**三档全关得掉**（2026-09-29 拆主题的验收）。
   *
   * 与上一条用例成对：同样提交「三档全关」，`member_invitation` 的站内被强制回 true，
   * 而这一行三档都留在关的状态。少了这一条，「新主题被顺手加进 LOCKED」不会有任何东西
   * 报错——症状是客户按下去、保存、回来又是开着的，而那正是拆行要解决的毛病。
   */
  it("邀请动态不在锁定集合里：三个渠道都关得掉，落库也是关的", async () => {
    const { service, query } = build(null);
    const saved = await service.replace("u-1", {
      invitation_activity: { inbox: false, email: false, sms: false },
    });
    expect(saved.invitation_activity).toEqual({
      inbox: false,
      email: false,
      sms: false,
    });
    // 落库的那份也得是关的，不能只在返回值上装样子。
    const persisted = JSON.parse(query.mock.calls[0]![1]![1] as string);
    expect(persisted.invitation_activity.inbox).toBe(false);
    // 对照：同一次提交里那条「就是邀请本身」的主题，站内仍然被强制为开。
    const locked = await service.replace("u-1", {
      member_invitation: { inbox: false },
    });
    expect(locked.member_invitation.inbox).toBe(true);
  });

  it("未知主题与未知渠道一律丢弃", async () => {
    const { service } = build(null);
    const saved = await service.replace("u-1", {
      announcement: { inbox: true, telepathy: true },
      marketing_blast: { email: true },
    });

    expect(saved).not.toHaveProperty("marketing_blast");
    expect(saved.announcement).not.toHaveProperty("telepathy");
  });

  it("非布尔值不覆盖默认(字符串 'true' 不算开)", async () => {
    const { service } = build(null);
    const saved = await service.replace("u-1", {
      payment_due: { email: "true", sms: 1, inbox: null },
    });

    // 非布尔一律回落默认：payment_due.email 默认开（事务性）、sms 默认关、inbox 默认开。
    expect(saved.payment_due.email).toBe(true);
    expect(saved.payment_due.sms).toBe(false);
    expect(saved.payment_due.inbox).toBe(true);
  });

  it("已保存的合法开关照常保留", async () => {
    const { service } = build({ payment_due: { email: true, sms: true } });
    const prefs = await service.get("u-1");
    expect(prefs.payment_due.email).toBe(true);
    expect(prefs.payment_due.sms).toBe(true);
    // 未提及的主题回落默认,而不是变成 undefined。
    expect(prefs.quota_alert.inbox).toBe(true);
  });

  it("写入 SQL 只替换 notifications 键,不整列覆写", async () => {
    const { service, query } = build(null);
    await service.replace("u-1", {});
    const sql = query.mock.calls[0]![0] as string;
    // `||` 顶层合并:preferences 是共享的压力阀,整列覆写会静默清掉别人的数据。
    expect(sql).toContain("||");
    expect(sql).toContain("jsonb_build_object('notifications'");
  });

  it("allows() 是发信侧的判据", async () => {
    const { service } = build({ payment_due: { email: true } });
    await expect(service.allows("u-1", "payment_due", "email")).resolves.toBe(
      true,
    );
    await expect(service.allows("u-1", "payment_due", "sms")).resolves.toBe(
      false,
    );
  });
});

/**
 * 「有模板却还标着开发中」这道守卫（2026-09-28 批 5 补）。
 *
 * 三处是**手工同步**的：本服务的 PLANNED 集合、console NotificationsPage 那份手写清单的
 * `planned` 标、两本词条。漏掉后两处的症状是界面说假话；漏掉这一处（把一个已有模板的主题
 * 留在 PLANNED 里）的症状更糟——页面据此**禁用三个渠道开关**，于是客户收得到一封关不掉
 * 的信。本文件自己的表头写着「给一个按下去不起作用的开关比不给更糟」，这条守卫就是那句话
 * 的机器版。
 *
 * 判据**不是**「有模板就不许 planned」。那条判据建这道守卫时会当场红在一条 owner 明文裁定
 * 上：`member_invitation` 当时故意留在 PLANNED 里，尽管 `tenant.invitation` 已经在发，理由是
 * 那条消息是 `mandatory` 的（站内这条**就是**邀请本身）。而 `mandatory` 是 dispatcher 每次
 * 调用传的参数、不是模板属性，静态看不见。所以判据换成能真正判定的那一半：
 *
 *   **凡是 PLANNED 里还有模板落上去的主题，必须在下面这张带理由的例外表里出现。**
 *
 * 抓的是沉默，不是抓某个方向：下一轮谁接了模板忘了动开关，这里要求他写下理由。
 *
 * 2026-09-29：那条裁定要求的四条可选周知接上了，`member_invitation` 已移出 PLANNED，例外表
 * 因此空了（清空的理由与它现在活在哪里，见表上的注释）。判据本身一个字没改——它防的不是
 * 那一条，是「下一个人接了模板忘了动开关」这件事。
 *
 * 看不见什么：console 那份 `planned` 标与两本词条（在门户包里，另一个测试运行器）。
 * 这条守卫绿了只说明**后端**这一半是真的。
 */
const PLANNED_WITH_TEMPLATE_EXCEPTIONS: Record<string, string> = {
  /* 2026-09-29：**这张表现在是空的**。里面唯一那条（member_invitation，owner 2026-09-09
     的裁定）随着主题移出 PLANNED 一起删掉了——留着就是「为不存在的债发许可」。
     表本身留下：下一个人接了模板忘了放开关，上面那条用例会当场要求他在这里写理由。
     那条裁定的实质没有丢，它现在活在两个能跑的地方——服务端 `LOCKED.member_invitation`
     的站内锁（本文件上面有用例），与 dispatcher 的 mandatory 短路（@vxture/service-
     notification 的 templates.spec.ts 里跑分发器证的那一组）。 */
};

describe("主题清单与派发侧模板对账", () => {
  const codes = Object.keys(
    NOTIFICATION_TEMPLATES,
  ) as NotificationTemplateCode[];
  const topicsWithTemplates = new Set<string>(
    codes.map((code) => topicOf(code)),
  );

  it("读到了派发侧的模板表（读不到要红，不许当成通过）", () => {
    expect(codes.length).toBeGreaterThan(20);
    expect(topicsWithTemplates.size).toBeGreaterThan(5);
  });

  it("派发侧每个主题都在偏好清单里（否则那类通知客户根本没有开关）", () => {
    for (const topic of topicsWithTemplates) {
      expect([...NOTIFICATION_TOPICS] as string[]).toContain(topic);
    }
  });

  it("PLANNED 里还有模板的主题，必须在例外表里写下理由", () => {
    const plannedWithTemplate = ([...NOTIFICATION_TOPICS_PLANNED] as string[])
      .filter((topic) => topicsWithTemplates.has(topic))
      .sort();
    expect(plannedWithTemplate).toEqual(
      Object.keys(PLANNED_WITH_TEMPLATE_EXCEPTIONS).sort(),
    );
  });

  it("例外表不给不存在的债发许可：每一条都必须仍然是「planned 且有模板」", () => {
    /* 这张表今天是空的，所以本用例此刻**一条断言都不做** —— 写下来，免得它被当成一条
       还在看着什么的守卫。它看的是将来：谁往表里加一条，这里就查那条是否真的还「planned
       且有模板」。表为空这件事本身由上一条用例把着（空表 ⇒ PLANNED 里不许有带模板的主题）。 */
    for (const [topic, reason] of Object.entries(
      PLANNED_WITH_TEMPLATE_EXCEPTIONS,
    )) {
      expect([...NOTIFICATION_TOPICS] as string[]).toContain(topic);
      expect([...NOTIFICATION_TOPICS_PLANNED] as string[]).toContain(topic);
      expect(topicsWithTemplates.has(topic)).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("批 5 接上模板的两个主题已经不在「开发中」里", () => {
    for (const topic of ["verification_result", "quota_alert"]) {
      expect(topicsWithTemplates.has(topic)).toBe(true);
      expect([...NOTIFICATION_TOPICS_PLANNED] as string[]).not.toContain(topic);
    }
  });

  it("邀请拆成两个主题：成员邀请只剩邀请本身，四个终态归邀请动态", () => {
    for (const topic of ["member_invitation", "invitation_activity"]) {
      expect([...NOTIFICATION_TOPICS] as string[]).toContain(topic);
      expect([...NOTIFICATION_TOPICS_PLANNED] as string[]).not.toContain(topic);
    }
    /* owner 2026-09-29 看过页面后裁定拆开。判据是**性质不同**：`tenant.invitation` 就是
       邀请本身（mandatory + inboxOnly，站内恒锁，关掉它邀请派不出去），四个终态是周知
       （嫌吵就该能关）。合成一行时那条站内锁会把四条周知一起锁住，客户只能二选一。
       这两句数的就是那一刀切在了哪里——落错一条不会报错，只会让某一条跟着锁死或跟着哑掉。 */
    expect(
      codes.filter((code) => topicOf(code) === "member_invitation"),
    ).toEqual(["tenant.invitation"]);
    expect(
      codes.filter((code) => topicOf(code) === "invitation_activity").sort(),
    ).toEqual([
      "tenant.invitation_accepted",
      "tenant.invitation_declined",
      "tenant.invitation_expired",
      "tenant.invitation_revoked",
    ]);
  });

  it("仍标「开发中」且确实没有模板的三个：security / invoice_progress / ticket_activity", () => {
    for (const topic of ["security", "invoice_progress", "ticket_activity"]) {
      expect([...NOTIFICATION_TOPICS_PLANNED] as string[]).toContain(topic);
      expect(topicsWithTemplates.has(topic)).toBe(false);
    }
  });
});
