/**
 * commerce-services.provider.ts - module-less subscription/provisioning wire
 * @package @vxture/bff-admin
 *
 * admin-bff stays "operator governance face only" (app.module.ts: no
 * commerce service modules) — but offline-payment-confirm needs the
 * subscription lifecycle's provisioning hooks to actually notify arda
 * (product_320 §4.3; fixes the pre-existing raw-SQL activation bypass that
 * silently skipped the tenant.provisioned webhook). Built the same
 * module-less way arda-catalog.itest.spec.ts constructs these classes for a
 * live-DB test: a bare Pool in, a SubscriptionService out. The
 * ProvisioningService here only enqueues — dispatch config is never
 * exercised because delivery dispatch runs in platform-api (D13), not here.
 */
import { Provider } from "@nestjs/common";
import { Pool } from "pg";
import {
  AddonService,
  OrderService,
  PgAddonRepository,
  PgOrderRepository,
  PgSubscriptionRepository,
  SubscriptionService,
} from "@vxture/service-subscription";
import {
  PgPromotionRepository,
  PromotionService,
} from "@vxture/service-promotion";
import {
  PgProvisioningRepository,
  ProvisioningService,
} from "@vxture/service-provisioning";
import { ADMIN_BFF_RW_POOL } from "../tokens";

export const ADMIN_SUBSCRIPTION_SERVICE = "ADMIN_SUBSCRIPTION_SERVICE";
export const ADMIN_ORDER_SERVICE = "ADMIN_ORDER_SERVICE";
export const ADMIN_PROMOTION_SERVICE = "ADMIN_PROMOTION_SERVICE";
export const ADMIN_ADDON_SERVICE = "ADMIN_ADDON_SERVICE";

/**
 * 订单实体编排（product_330 P1-b2）：orders.router 的履约 / 作废 / 恢复走它。
 * 与 ADMIN_SUBSCRIPTION_SERVICE 同一套 module-less 装配（同一个 pool，独立实例）。
 */
export const orderServiceProvider: Provider = {
  provide: ADMIN_ORDER_SERVICE,
  inject: [ADMIN_BFF_RW_POOL, ADMIN_SUBSCRIPTION_SERVICE],
  useFactory: (pool: Pool, subscriptions: SubscriptionService): OrderService =>
    new OrderService(
      new PgOrderRepository(pool),
      new PgSubscriptionRepository(pool),
      subscriptions,
      new PromotionService(new PgPromotionRepository(pool)),
    ),
};

/**
 * Standalone AddonService for the addon-orders router (加油包核销,owner
 * 2026-08-20): settlement (leg flip + invoice clear + WS-level pool grant)
 * lives in one repo transaction — same module-less wire as above.
 */
export const addonServiceProvider: Provider = {
  provide: ADMIN_ADDON_SERVICE,
  inject: [ADMIN_BFF_RW_POOL],
  useFactory: (pool: Pool): AddonService =>
    new AddonService(new PgAddonRepository(pool)),
};

/**
 * Standalone PromotionService for the orders router (product_321 PR3):
 * confirm stage 1 finalizes reserved vouchers and payment-reject releases
 * them inside the router's own raw-SQL transaction (client-scoped
 * primitives). Same module-less shape as the subscription wire above.
 */
export const promotionServiceProvider: Provider = {
  provide: ADMIN_PROMOTION_SERVICE,
  inject: [ADMIN_BFF_RW_POOL],
  useFactory: (pool: Pool): PromotionService =>
    new PromotionService(new PgPromotionRepository(pool)),
};

export const commerceServicesProvider: Provider = {
  provide: ADMIN_SUBSCRIPTION_SERVICE,
  inject: [ADMIN_BFF_RW_POOL],
  useFactory: (pool: Pool): SubscriptionService => {
    const provisioning = new ProvisioningService(
      new PgProvisioningRepository(pool),
      {
        maxAttempts: 1,
        backoffBaseSec: 1,
        backoffCapSec: 1,
        leaseSeconds: 1,
        batchSize: 1,
        timeoutMs: 1000,
      },
      { resolve: () => null },
      { deliveryFailed: () => {} },
    );
    // 订单侧动作（作废 / 驳回释放券）已整体迁到 OrderService（product_330 P2 退役旧
    // 订单方法），SubscriptionService 只剩权益动作，不再依赖 PromotionService。
    return new SubscriptionService(
      new PgSubscriptionRepository(pool),
      provisioning,
    );
  },
};
