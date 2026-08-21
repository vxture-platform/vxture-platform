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
      // 默认开外发通道等于替用户同意打扰。
      expect(prefs[topic].email).toBe(false);
      expect(prefs[topic].sms).toBe(false);
    }
    expect(prefs.account.inbox).toBe(true);
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
      account: { inbox: true, telepathy: true },
      marketing_blast: { email: true },
    });

    expect(saved).not.toHaveProperty("marketing_blast");
    expect(saved.account).not.toHaveProperty("telepathy");
  });

  it("非布尔值不覆盖默认(字符串 'true' 不算开)", async () => {
    const { service } = build(null);
    const saved = await service.replace("u-1", {
      billing: { email: "true", sms: 1, inbox: null },
    });

    expect(saved.billing.email).toBe(false);
    expect(saved.billing.sms).toBe(false);
    expect(saved.billing.inbox).toBe(true);
  });

  it("已保存的合法开关照常保留", async () => {
    const { service } = build({ billing: { email: true, sms: true } });
    const prefs = await service.get("u-1");
    expect(prefs.billing.email).toBe(true);
    expect(prefs.billing.sms).toBe(true);
    // 未提及的主题回落默认,而不是变成 undefined。
    expect(prefs.usage.inbox).toBe(true);
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
    const { service } = build({ billing: { email: true } });
    await expect(service.allows("u-1", "billing", "email")).resolves.toBe(true);
    await expect(service.allows("u-1", "billing", "sms")).resolves.toBe(false);
  });
});
