/**
 * customer-notifications.wiring.spec.ts —— 这个进程的 service 到底有没有被挂上
 * （2026-09-29）。
 *
 * 为什么值得一条用例：装配处是「这个进程会不会发通知」的**唯一开关**，而漏挂一行的
 * 后果是静默不发——编译通过、类型通过、boot-smoke 通过、页面照用，只是客户那边什么
 * 都没有。本仓最常见的缺陷就是「做了没接」，一个不挂任何东西的 provider 正是这个
 * 纲要要消灭的那种缺陷。所以这里逐个服务点名，删掉任何一行当场红。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type {
  AddonService,
  OrderService,
  SubscriptionService,
} from "@vxture/service-subscription";
import type { OrganizationService } from "@vxture/service-organization";
import { CustomerNotificationsWiring } from "./customer-notifications.wiring";

const stub = () => ({ setCustomerNotifier: vi.fn() });

function build() {
  const orders = stub();
  const subscriptions = stub();
  const addons = stub();
  const orgs = stub();
  const wiring = new CustomerNotificationsWiring(
    {} as unknown as Pool,
    orders as unknown as OrderService,
    subscriptions as unknown as SubscriptionService,
    addons as unknown as AddonService,
    orgs as unknown as OrganizationService,
  );
  return { wiring, orders, subscriptions, addons, orgs };
}

describe("CustomerNotificationsWiring.onModuleInit", () => {
  it("四个服务都拿到同一个分发器（少挂一个 = 那一批通知静默不发）", () => {
    const { wiring, orders, subscriptions, addons, orgs } = build();
    wiring.onModuleInit();
    for (const svc of [orders, subscriptions, addons, orgs]) {
      expect(svc.setCustomerNotifier).toHaveBeenCalledTimes(1);
      expect(svc.setCustomerNotifier).toHaveBeenCalledWith(wiring.dispatcher);
    }
  });

  it("组织服务是这个进程里邀请到期通知的唯一出口，必须在名单上", () => {
    /* 到期那一档没有写入方可挂,只能靠本进程的 invitation-expiry 作业;
       它与 OrganizationService 在同一个进程里,这一行就是它的开关。 */
    const { wiring, orgs } = build();
    wiring.onModuleInit();
    expect(orgs.setCustomerNotifier).toHaveBeenCalledWith(wiring.dispatcher);
  });
});
