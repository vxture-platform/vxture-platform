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
 * 判据**不是**「有模板就不许 planned」：那条会当场红在一条 owner 明文裁定上——
 * `member_invitation` 故意留在 PLANNED 里，尽管 `tenant.invitation` 已经在发，理由是那条
 * 消息是 `mandatory` 的（站内这条**就是**邀请本身）。而 `mandatory` 是 dispatcher 每次调用
 * 传的参数、不是模板属性，静态看不见。所以判据换成能真正判定的那一半：
 *
 *   **凡是 PLANNED 里还有模板落上去的主题，必须在下面这张带理由的例外表里出现。**
 *
 * 抓的是沉默，不是抓某个方向：下一轮谁接了模板忘了动开关，这里要求他写下理由。
 *
 * 看不见什么：console 那份 `planned` 标与两本词条（在门户包里，另一个测试运行器）。
 * 这条守卫绿了只说明**后端**这一半是真的。
 */
const PLANNED_WITH_TEMPLATE_EXCEPTIONS: Record<string, string> = {
  member_invitation:
    "owner 2026-09-09：tenant.invitation 是 mandatory 的——站内这条消息就是邀请本身，" +
    "关掉它邀请人会收到「已送达」而对方那边什么也没有。等 accepted / declined / revoked " +
    "三条可选周知接上，再把它挪出 PLANNED。",
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

  it("仍标「开发中」且确实没有模板的三个：security / invoice_progress / ticket_activity", () => {
    for (const topic of ["security", "invoice_progress", "ticket_activity"]) {
      expect([...NOTIFICATION_TOPICS_PLANNED] as string[]).toContain(topic);
      expect(topicsWithTemplates.has(topic)).toBe(false);
    }
  });
});
