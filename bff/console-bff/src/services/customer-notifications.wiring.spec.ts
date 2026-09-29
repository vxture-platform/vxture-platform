/**
 * customer-notifications.wiring.spec.ts —— console 这条路上的通知开关（2026-09-29）。
 *
 * 为什么值得一条用例：这个 provider 是「console 触发的写路径会不会发通知」的**唯一
 * 开关**。邀请的接受 / 拒绝 / 撤销三条转移都由这条路触发，漏挂一行就是三条通知静默
 * 不发——编译通过、类型通过、boot-smoke 通过、页面照用，只有客户那边什么都没有。
 * 一个不挂任何东西的 provider 正是这个纲要要消灭的那种缺陷，所以这里逐个点名。
 *
 * `inject` 与 `useFactory` 的形参是**位置对应**的两份清单，所以顺序也要钉：改了一边
 * 忘了另一边，注进去的就是另一个服务，而那是运行时才炸的错。
 */
import { describe, expect, it, vi } from "vitest";
import type { FactoryProvider } from "@nestjs/common";
import { MailService } from "@vxture/core-mail";
import {
  AccountService,
  NotificationPreferencesService,
} from "@vxture/service-account";
import { OrganizationService } from "@vxture/service-organization";
import { SmsService } from "@vxture/service-sms";
import {
  AddonService,
  COMMERCE_PG_POOL,
  OrderService,
  SubscriptionService,
} from "@vxture/service-subscription";
import {
  CUSTOMER_NOTIFIER,
  customerNotificationsProvider,
} from "./customer-notifications.wiring";

const provider = customerNotificationsProvider as FactoryProvider;

const stub = () => ({ setCustomerNotifier: vi.fn() });

describe("customerNotificationsProvider", () => {
  it("inject 清单逐项对上（顺序即形参顺序）", () => {
    expect(provider.provide).toBe(CUSTOMER_NOTIFIER);
    expect(provider.inject).toEqual([
      COMMERCE_PG_POOL,
      MailService,
      SmsService,
      NotificationPreferencesService,
      OrderService,
      SubscriptionService,
      AddonService,
      OrganizationService,
      AccountService,
    ]);
  });

  it("四个商务 / 组织服务都拿到同一个分发器（少挂一个 = 那一批通知静默不发）", () => {
    const wired = build();
    expect(wired.dispatcher).toBeDefined();
    for (const svc of [
      wired.orders,
      wired.subscriptions,
      wired.addons,
      wired.orgs,
    ]) {
      expect(svc.setCustomerNotifier).toHaveBeenCalledTimes(1);
      expect(svc.setCustomerNotifier).toHaveBeenCalledWith(wired.dispatcher);
    }
  });

  it("组织服务在名单上：邀请的接受 / 拒绝 / 撤销全走 console 这条路", () => {
    const wired = build();
    expect(wired.orgs.setCustomerNotifier).toHaveBeenCalledWith(
      wired.dispatcher,
    );
  });

  /*
   * 账号安全事件（2026-09-29）。这三条用例合起来就是「拆掉接线就红」的那道门：
   * 少挂 AccountService ⇒ 第一条红；把它挂到共享的那个分发器上 ⇒ 第二条红
   * （运营通告流会被客户每次改密、换号、解绑刷满，owner 裁定 5 明文不许）；
   * 忘了 `operatorMirror: null` ⇒ 第三条红。
   */
  it("账号服务拿到通知器（漏挂 = 十四条安全通知一句话都不发）", () => {
    const wired = build();
    expect(wired.accounts.setCustomerNotifier).toHaveBeenCalledTimes(1);
    expect(wired.accounts.setCustomerNotifier.mock.calls[0]?.[0]).toBeDefined();
  });

  it("账号服务拿到的**不是**共享那一个：安全事件不进运营通告流", () => {
    const wired = build();
    expect(wired.securityDispatcher).not.toBe(wired.dispatcher);
  });

  it("安全那一个显式关掉了运营镜像（共享那一个照旧镜像）", () => {
    const wired = build();
    expect(mirrorOf(wired.securityDispatcher)).toBeNull();
    expect(mirrorOf(wired.dispatcher)).not.toBeNull();
  });
});

/**
 * 一次装配，把七个被注入方都换成桩。`inject` 与 `useFactory` 的形参是**位置对应**的两份
 * 清单，所以这里的实参顺序也钉着上面那条用例里的顺序。
 */
function build() {
  const orders = stub();
  const subscriptions = stub();
  const addons = stub();
  const orgs = stub();
  const accounts = stub();
  const dispatcher = provider.useFactory(
    {},
    {},
    {},
    {},
    orders,
    subscriptions,
    addons,
    orgs,
    accounts,
  );
  return {
    dispatcher,
    orders,
    subscriptions,
    addons,
    orgs,
    accounts,
    securityDispatcher: accounts.setCustomerNotifier.mock.calls[0]?.[0],
  };
}

/**
 * 分发器有没有装运营镜像。读的是私有字段——刻意的：**这条用例要证的就是构造选项里那一个
 * `operatorMirror: null` 还在**，而那件事在公开面上看不出来（`notify` 要一个真 pool 才跑）。
 * 用私有字段当判据的代价是它随实现改名会红；那正是希望的：改名的人必须看到这条裁定。
 */
function mirrorOf(dispatcher: unknown): unknown {
  return (dispatcher as { operatorMirror?: unknown }).operatorMirror ?? null;
}
