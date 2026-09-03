/**
 * customer-notifications.wiring.ts — 客户通知分发器挂到订阅 / 订单服务（product_330 P2-g）。
 * @package @vxture/bff-console
 *
 * console 侧触发的通知：客户申请退款（refund.requested）、¥0 新订即时履约（order.fulfilled）。
 * 站内落 support.inbox_messages，邮件走 MailModule 的 MailService，按 NotificationPreferences
 * 的 subscription / billing 主题过滤，每次投递记 support.notification_logs。
 * 工厂 provider 在模块初始化时即执行（Nest 急切实例化），用 setter 注入——SubscriptionModule
 * 是自包含模块，跨模块的构造器令牌不可见。
 */
import { Logger, type Provider } from "@nestjs/common";
import type { Pool } from "pg";
import { MailService } from "@vxture/core-mail";
import { NotificationPreferencesService } from "@vxture/service-account";
import {
  NotificationDispatcher,
  smsTemplatesFromEnv,
} from "@vxture/service-notification";
import { SmsService } from "@vxture/service-sms";
import {
  COMMERCE_PG_POOL,
  OrderService,
  SubscriptionService,
} from "@vxture/service-subscription";

export const CUSTOMER_NOTIFIER = "CONSOLE_CUSTOMER_NOTIFIER";

export const customerNotificationsProvider: Provider = {
  provide: CUSTOMER_NOTIFIER,
  inject: [
    COMMERCE_PG_POOL,
    MailService,
    SmsService,
    NotificationPreferencesService,
    OrderService,
    SubscriptionService,
  ],
  useFactory: (
    pool: Pool,
    mail: MailService,
    sms: SmsService,
    prefs: NotificationPreferencesService,
    orders: OrderService,
    subscriptions: SubscriptionService,
  ): NotificationDispatcher => {
    const dispatcher = new NotificationDispatcher(pool, {
      mail,
      sms,
      smsTemplates: smsTemplatesFromEnv(),
      prefs,
      consoleBaseUrl: process.env.CONSOLE_BASE_URL?.replace(/\/$/, ""),
      logger: new Logger("CustomerNotifications"),
    });
    orders.setCustomerNotifier(dispatcher);
    subscriptions.setCustomerNotifier(dispatcher);
    return dispatcher;
  },
};
