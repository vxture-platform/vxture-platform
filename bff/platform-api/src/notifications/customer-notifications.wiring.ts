/**
 * customer-notifications.wiring.ts — 把客户通知分发器挂到订阅 / 订单服务上（product_330 P2-g）。
 * @package @vxture/bff-platform-api
 *
 * owner 2026-09-03「通知先做站内 + 邮件」：作业（到期提醒 / 到期 / 续费单 / ¥0 自动续费履约 /
 * 公告推送）发出的通知经 NotificationDispatcher 落 support.inbox_messages（站内）并按用户偏好
 * 发邮件（core-mail，SMTP_* 来自 platform-mail.env），每次投递记 support.notification_logs。
 * 用 setter 注入而不是构造器依赖：SubscriptionModule 是自包含模块，跨模块 DI 令牌不可见；
 * 三个 BFF 都用同一个 setter 装配（admin-bff 的 module-less 工厂同理）。
 * 分发器实例同时暴露给公告推送作业（announcement-broadcast.job）。
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
  readonly dispatcher: NotificationDispatcher;

  constructor(
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
  ) {
    this.dispatcher = new NotificationDispatcher(this.pool, {
      mail: new MailService(),
      prefs: new NotificationPreferencesService(this.pool),
      consoleBaseUrl: process.env.CONSOLE_BASE_URL?.replace(/\/$/, ""),
      logger: this.logger,
    });
  }

  onModuleInit(): void {
    this.orders.setCustomerNotifier(this.dispatcher);
    this.subscriptions.setCustomerNotifier(this.dispatcher);
    this.logger.log(
      `customer notifications wired (inbox + email${process.env.CONSOLE_BASE_URL ? ", links → " + process.env.CONSOLE_BASE_URL : ""})`,
    );
  }
}
