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
import { NotificationPreferencesService } from "@vxture/service-account";
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
    ]);
  });

  it("四个服务都拿到同一个分发器（少挂一个 = 那一批通知静默不发）", () => {
    const orders = stub();
    const subscriptions = stub();
    const addons = stub();
    const orgs = stub();
    const dispatcher = provider.useFactory(
      {},
      {},
      {},
      {},
      orders,
      subscriptions,
      addons,
      orgs,
    );
    expect(dispatcher).toBeDefined();
    for (const svc of [orders, subscriptions, addons, orgs]) {
      expect(svc.setCustomerNotifier).toHaveBeenCalledTimes(1);
      expect(svc.setCustomerNotifier).toHaveBeenCalledWith(dispatcher);
    }
  });

  it("组织服务在名单上：邀请的接受 / 拒绝 / 撤销全走 console 这条路", () => {
    const orgs = stub();
    const dispatcher = provider.useFactory(
      {},
      {},
      {},
      {},
      stub(),
      stub(),
      stub(),
      orgs,
    );
    expect(orgs.setCustomerNotifier).toHaveBeenCalledWith(dispatcher);
  });
});
