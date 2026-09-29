/**
 * customer-notifications.wiring.spec.ts —— 认证面上的通知开关（2026-09-29）。
 *
 * 为什么值得一条用例：这个 provider 是「auth-bff 触发的写路径会不会发通知」的**唯一
 * 开关**，而十四条安全通知里有七条只在这个进程上发生（邮件重置令牌改密、运营锁定 /
 * 解锁 / 下线全部会话、没见过的设备登录）。漏掉这一行的后果是那七条一句话都不发——
 * 编译过、类型过、守卫全绿、boot-smoke 绿，只有客户那边什么都没有。
 * **一个不挂任何东西的 provider 正是这个纲要要消灭的那种缺陷**，所以这里逐个点名。
 *
 * `inject` 与 `useFactory` 的形参是**位置对应**的两份清单，所以顺序也要钉：改了一边
 * 忘了另一边，注进去的就是另一个服务，而那是运行时才炸的错。
 */
import { describe, expect, it, vi } from "vitest";
import type { FactoryProvider } from "@nestjs/common";
import {
  AccountService,
  NotificationPreferencesService,
} from "@vxture/service-account";
import { MailService } from "@vxture/service-mail";
import { SmsService } from "@vxture/service-sms";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import {
  CUSTOMER_NOTIFIER,
  customerNotificationsProvider,
} from "./customer-notifications.wiring";

const provider = customerNotificationsProvider as FactoryProvider;

describe("auth-bff 的 customerNotificationsProvider", () => {
  it("inject 清单逐项对上（顺序即形参顺序）", () => {
    expect(provider.provide).toBe(CUSTOMER_NOTIFIER);
    expect(provider.inject).toEqual([
      COMMERCE_PG_POOL,
      MailService,
      SmsService,
      NotificationPreferencesService,
      AccountService,
    ]);
  });

  it("账号服务拿到通知器（漏挂 = 七条安全通知一句话都不发）", () => {
    const wired = build();
    expect(wired.accounts.setCustomerNotifier).toHaveBeenCalledTimes(1);
    expect(wired.accounts.setCustomerNotifier).toHaveBeenCalledWith(
      wired.dispatcher,
    );
  });

  it("安全事件**不进**运营通告流（owner 裁定 5：显式关掉镜像）", () => {
    const wired = build();
    expect(mirrorOf(wired.dispatcher)).toBeNull();
  });

  /*
   * 「挂上了但挂的是个空壳」是同一个缺陷的另一张脸：分发器拿不到邮件 / 短信 / 偏好，
   * 站内那一半照落、另两个渠道静默不发，而上面三条用例都会是绿的。所以这里点名三样
   * 被注入方确实到了构造选项里（读私有字段是刻意的，公开面上看不出来）。
   */
  it("注入的邮件 / 短信 / 偏好三样都到了分发器手上", () => {
    const wired = build();
    expect(fieldOf(wired.dispatcher, "mail")).toBe(wired.mail);
    expect(fieldOf(wired.dispatcher, "sms")).toBe(wired.sms);
    expect(fieldOf(wired.dispatcher, "prefs")).toBe(wired.prefs);
  });
});

/**
 * 一次装配，把五个被注入方都换成桩。`inject` 与 `useFactory` 的形参是**位置对应**的两份
 * 清单，所以这里的实参顺序也钉着上面那条用例里的顺序。
 */
function build() {
  const pool = {};
  const mail = {};
  const sms = {};
  const prefs = {};
  const accounts = { setCustomerNotifier: vi.fn() };
  const dispatcher = provider.useFactory(pool, mail, sms, prefs, accounts);
  return { dispatcher, pool, mail, sms, prefs, accounts };
}

/**
 * 分发器有没有装运营镜像。读的是私有字段——刻意的：**这条用例要证的就是构造选项里那一个
 * `operatorMirror: null` 还在**，而那件事在公开面上看不出来（`notify` 要一个真 pool 才跑）。
 * 用私有字段当判据的代价是它随实现改名会红；那正是希望的：改名的人必须看到这条裁定。
 */
function mirrorOf(dispatcher: unknown): unknown {
  return (dispatcher as { operatorMirror?: unknown }).operatorMirror ?? null;
}

function fieldOf(dispatcher: unknown, key: string): unknown {
  return (dispatcher as Record<string, unknown>)[key];
}
