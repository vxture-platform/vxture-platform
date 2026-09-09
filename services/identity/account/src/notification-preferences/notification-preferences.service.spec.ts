import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TOPICS,
  NotificationPreferencesService,
} from "./notification-preferences.service";

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
      const transactional = (
        [
          "subscription_expiry",
          "provision_result",
          "payment_due",
          "refund_progress",
          "order_status",
          "tenant_change",
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
