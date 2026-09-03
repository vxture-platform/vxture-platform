/**
 * customer-notifications.wiring.ts — 客户通知分发器挂到订阅 / 订单服务（product_330 P2-g）。
 * @package @vxture/bff-console
 *
 * console 侧触发的通知：客户申请退款（refund.requested）、¥0 新订即时履约（order.fulfilled）。
 * 站内落 support.inbox_messages，邮件走 MailModule 的 MailService，按 NotificationPreferences
 * 的 subscription / billing 主题过滤，每次投递记 support.notification_logs。setter 注入，
 * 原因见 platform-api 同名文件。
 */
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Pool } from "pg";
import { MailService } from "@vxture/core-mail";
import { NotificationPreferencesService } from "@vxture/service-account";
import { NotificationDispatcher } from "@vxture/service-notification";
import {
  COMMERCE_PG_POOL,
  OrderService,
  SubscriptionService,
} from "@vxture/service-subscription";

@Injectable()
export class CustomerNotificationsWiring implements OnModuleInit {
  private readonly logger = new Logger(CustomerNotificationsWiring.name);

  constructor(
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(NotificationPreferencesService)
    private readonly prefs: NotificationPreferencesService,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
  ) {}

  onModuleInit(): void {
    const dispatcher = new NotificationDispatcher(this.pool, {
      mail: this.mail,
      prefs: this.prefs,
      consoleBaseUrl: process.env.CONSOLE_BASE_URL?.replace(/\/$/, ""),
      logger: this.logger,
    });
    this.orders.setCustomerNotifier(dispatcher);
    this.subscriptions.setCustomerNotifier(dispatcher);
  }
}
