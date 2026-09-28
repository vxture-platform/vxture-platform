/**
 * commerce-services.provider.spec.ts — 装配处「接了没接」的守卫（批 5）。
 * @package @vxture/bff-admin
 *
 * 本仓最常见的缺陷是「做了没接」：服务里有 setter、模板码也有了，而装配处一句
 * `setCustomerNotifier(...)` 没写——编译过、启动烟测过、线上一句话都不发。
 * 加油包核销此前就正是这一形状。tsc 看不见它（setter 是可选调用），
 * 所以这一条只能用测试钉住。
 *
 * 断言方式：`spyOn(原型).setCustomerNotifier`，跑一遍工厂，看它到底有没有被喂过东西、
 * 喂进去的是不是一个真的分发器。另外核注入清单里有 MailService——少了它，分发器会
 * 带着一个 undefined 的邮件发送方装起来：站内有信、邮件永远不发，而且不报错。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FactoryProvider, Provider } from "@nestjs/common";
import type { Pool } from "pg";
import { MailService } from "@vxture/core-mail";
import { NotificationDispatcher } from "@vxture/service-notification";
import {
  AddonService,
  OrderService,
  type SubscriptionService,
} from "@vxture/service-subscription";
import {
  ADMIN_ADDON_SERVICE,
  ADMIN_CUSTOMER_NOTIFIER,
  addonServiceProvider,
  customerNotifierProvider,
  orderServiceProvider,
} from "./commerce-services.provider";
import { ADMIN_BFF_RW_POOL } from "../tokens";

function factory(provider: Provider): FactoryProvider {
  return provider as FactoryProvider;
}

/** 装配只是把池存起来，工厂跑一遍不碰库。 */
function fakePool(): Pool {
  return {
    query: vi.fn(() => {
      throw new Error("wiring must not touch the DB");
    }),
    connect: vi.fn(() => {
      throw new Error("wiring must not touch the DB");
    }),
  } as unknown as Pool;
}

function fakeMail(): MailService {
  return { send: vi.fn() } as unknown as MailService;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("admin-bff 客户通知装配", () => {
  it("分发器是一个有名字的 provider：令牌 + 注入清单 + 真的造得出来", () => {
    const p = factory(customerNotifierProvider);
    expect(p.provide).toBe(ADMIN_CUSTOMER_NOTIFIER);
    expect(p.inject).toEqual([ADMIN_BFF_RW_POOL, MailService]);
    expect(p.useFactory(fakePool(), fakeMail())).toBeInstanceOf(
      NotificationDispatcher,
    );
  });

  it("订单服务装起来就带着通知器", () => {
    const spy = vi.spyOn(OrderService.prototype, "setCustomerNotifier");

    factory(orderServiceProvider).useFactory(
      fakePool(),
      {} as SubscriptionService,
      fakeMail(),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBeInstanceOf(NotificationDispatcher);
  });

  it("加油包服务装起来就带着通知器（此前这里什么都不接）", () => {
    const spy = vi.spyOn(AddonService.prototype, "setCustomerNotifier");

    const addons = factory(addonServiceProvider).useFactory(
      fakePool(),
      fakeMail(),
    );

    expect(addons).toBeInstanceOf(AddonService);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBeInstanceOf(NotificationDispatcher);
  });

  it("两个装配处的注入清单里都有 MailService", () => {
    expect(factory(orderServiceProvider).inject).toContain(MailService);
    expect(factory(addonServiceProvider).inject).toContain(MailService);
    expect(factory(addonServiceProvider).provide).toBe(ADMIN_ADDON_SERVICE);
  });

  it("分发器 provider 确实注册进了 app.module", () => {
    // 按源文本查而不是 import AppModule：后者会把整个模块图（配置、池、OIDC）
    // 连带拉起来，那不是这条断言要验的东西。
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "app.module.ts"),
      "utf8",
    );
    const providers = /providers:\s*\[([\s\S]*?)\n {2}\],/.exec(source)?.[1];
    expect(providers, "app.module.ts 里找不到 providers 数组").toBeTruthy();
    expect(providers).toContain("customerNotifierProvider");
  });
});
