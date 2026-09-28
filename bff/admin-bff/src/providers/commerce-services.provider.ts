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
import { Logger, Provider } from "@nestjs/common";
import { Pool } from "pg";
import { MailService } from "@vxture/core-mail";
import { NotificationPreferencesService } from "@vxture/service-account";
import {
  NotificationDispatcher,
  smsTemplatesFromEnv,
} from "@vxture/service-notification";
import { SmsService } from "@vxture/service-sms";
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
 * 客户通知分发器的公开令牌（批 5）。
 *
 * 此前 `customerNotifier()` 只是本文件私有的一个工厂，订阅 / 订单两个 provider
 * 自己拿去 setter 注入。于是**不经服务层**的运营动作就没有落点可用——租户实名审核
 * 整段写在 tenants.router 的裸 SQL 里，客户那边一句话都收不到。把它作为独立
 * provider 暴露出来，路由用 `@Inject(ADMIN_CUSTOMER_NOTIFIER)` 显式取：
 * esbuild 打包不留装饰器元数据，隐式类型注入会静默拿到 undefined、启动烟测照绿。
 */
export const ADMIN_CUSTOMER_NOTIFIER = "ADMIN_CUSTOMER_NOTIFIER";

/**
 * 订单实体编排（product_330 P1-b2）：orders.router 的履约 / 作废 / 恢复走它。
 * 与 ADMIN_SUBSCRIPTION_SERVICE 同一套 module-less 装配（同一个 pool，独立实例）。
 */
/**
 * 客户通知分发器（product_330 P2-g，owner 2026-09-03「通知先做站内 + 邮件」）：运营侧动作
 * （确认收款履约 → order.fulfilled / subscription.renewed，退款审核 / 执行 → refund.*）
 * 站内落 support.inbox_messages、邮件走 MailModule 的 MailService（此前 admin-bff 注册了
 * MailModule 却无人用），按用户偏好过滤，投递记 support.notification_logs。
 */
function customerNotifier(
  pool: Pool,
  mail: MailService,
): NotificationDispatcher {
  return new NotificationDispatcher(pool, {
    mail,
    // P2-i：通知短信（阿里云短信服务）；模板码 ALIYUN_SMS_TPL_*，没配的模板不发
    sms: new SmsService(),
    smsTemplates: smsTemplatesFromEnv(),
    prefs: new NotificationPreferencesService(pool),
    consoleBaseUrl: process.env.CONSOLE_BASE_URL?.replace(/\/$/, ""),
    logger: new Logger("CustomerNotifications"),
  });
}

/**
 * 分发器 provider（批 5）：与订阅 / 订单那两处**同一个工厂**，只是这一份有名字，
 * 路由可以注入。用 RW 池——它要写 support.inbox_messages / notification_logs
 * 与运营镜像那条通告。
 */
export const customerNotifierProvider: Provider = {
  provide: ADMIN_CUSTOMER_NOTIFIER,
  inject: [ADMIN_BFF_RW_POOL, MailService],
  useFactory: (pool: Pool, mail: MailService): NotificationDispatcher =>
    customerNotifier(pool, mail),
};

export const orderServiceProvider: Provider = {
  provide: ADMIN_ORDER_SERVICE,
  inject: [ADMIN_BFF_RW_POOL, ADMIN_SUBSCRIPTION_SERVICE, MailService],
  useFactory: (
    pool: Pool,
    subscriptions: SubscriptionService,
    mail: MailService,
  ): OrderService => {
    const orders = new OrderService(
      new PgOrderRepository(pool),
      new PgSubscriptionRepository(pool),
      subscriptions,
      new PromotionService(new PgPromotionRepository(pool)),
    );
    orders.setCustomerNotifier(customerNotifier(pool, mail));
    return orders;
  },
};

/**
 * Standalone AddonService for the addon-orders router (加油包核销,owner
 * 2026-08-20): settlement (leg flip + invoice clear + WS-level pool grant)
 * lives in one repo transaction — same module-less wire as above.
 */
export const addonServiceProvider: Provider = {
  provide: ADMIN_ADDON_SERVICE,
  inject: [ADMIN_BFF_RW_POOL, MailService],
  useFactory: (pool: Pool, mail: MailService): AddonService => {
    const addons = new AddonService(new PgAddonRepository(pool));
    /* 批 5：运营确认线下付款 → 加油包激活。此前这里一个通知器都不接，于是核销成功
       客户一句话都收不到——买到手的东西什么时候能用只能自己去页面上翻。与订单侧
       （orderServiceProvider）同一条装配纪律，同一个工厂。 */
    addons.setCustomerNotifier(customerNotifier(pool, mail));
    return addons;
  },
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
  inject: [ADMIN_BFF_RW_POOL, MailService],
  useFactory: (pool: Pool, mail: MailService): SubscriptionService => {
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
    const subscriptions = new SubscriptionService(
      new PgSubscriptionRepository(pool),
      provisioning,
    );
    subscriptions.setCustomerNotifier(customerNotifier(pool, mail));
    return subscriptions;
  },
};
