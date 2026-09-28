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
  AddonService,
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
    AddonService,
  ],
  useFactory: (
    pool: Pool,
    mail: MailService,
    sms: SmsService,
    prefs: NotificationPreferencesService,
    orders: OrderService,
    subscriptions: SubscriptionService,
    addons: AddonService,
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
    /*
     * 加油包（2026-09-28 批 5）：console 侧**今天一条都发不出来**——这个进程上的
     * AddonService 只跑下单 / 申报 / 取消，四条通知的触发点（核销、巡检）都在别的进程。
     * 仍然挂上，理由与上面两个一样：装配处是「这个进程的 service 会不会发通知」的唯一
     * 开关，漏挂的后果是将来某条 console 自助写路径（自助退订加油包之类）接上 emit 时
     * **静默不发**，而编译器与守卫都不会有任何意见（本仓最常见的缺陷是「做了没接」）。
     * 代价是一行、零运行时行为；不挂的代价是一次查不出来的沉默。
     */
    addons.setCustomerNotifier(dispatcher);
    return dispatcher;
  },
};
