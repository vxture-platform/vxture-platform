/**
 * customer-notifications.wiring.ts — 客户通知分发器挂到订阅 / 订单服务（product_330 P2-g）。
 * @package @vxture/bff-console
 *
 * console 侧触发的通知：客户申请退款（refund.requested）、¥0 新订即时履约（order.fulfilled）、
 * 入组邀请的接受 / 拒绝 / 撤销（tenant.invitation_accepted / _declined / _revoked）。
 * 站内落 support.inbox_messages，邮件走 MailModule 的 MailService，按 NotificationPreferences
 * 的 subscription / billing 主题过滤，每次投递记 support.notification_logs。
 * 工厂 provider 在模块初始化时即执行（Nest 急切实例化），用 setter 注入——SubscriptionModule
 * 是自包含模块，跨模块的构造器令牌不可见。
 */
import { Logger, type Provider } from "@nestjs/common";
import type { Pool } from "pg";
import { MailService } from "@vxture/core-mail";
import {
  AccountService,
  NotificationPreferencesService,
} from "@vxture/service-account";
import {
  NotificationDispatcher,
  smsTemplatesFromEnv,
} from "@vxture/service-notification";
import { OrganizationService } from "@vxture/service-organization";
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
    OrganizationService,
    AccountService,
  ],
  useFactory: (
    pool: Pool,
    mail: MailService,
    sms: SmsService,
    prefs: NotificationPreferencesService,
    orders: OrderService,
    subscriptions: SubscriptionService,
    addons: AddonService,
    orgs: OrganizationService,
    accounts: AccountService,
  ): NotificationDispatcher => {
    const options = {
      mail,
      sms,
      smsTemplates: smsTemplatesFromEnv(),
      prefs,
      consoleBaseUrl: process.env.CONSOLE_BASE_URL?.replace(/\/$/, ""),
      logger: new Logger("CustomerNotifications"),
    };
    const dispatcher = new NotificationDispatcher(pool, options);
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
    /*
     * 邀请四态（2026-09-29）：接受 / 拒绝 / 撤销三条转移的写入方都在
     * @vxture/service-organization，而三条都由 console 这条路触发（成员页撤销、
     * 收件箱里点同意 / 拒绝）——**这一处漏了，那三条就一句话都不发**，而编译器、
     * 守卫、boot-smoke 都不会有任何意见（本仓最常见的缺陷是「做了没接」）。
     * 到期那一条的写入方是巡检作业，不在本进程，由 platform-api 那侧挂。
     */
    orgs.setCustomerNotifier(dispatcher);
    /*
     * 账号安全事件（2026-09-29）：**另一个分发器**，只为了 `operatorMirror: null`。
     *
     * owner 裁定 5：「安全事件不进运营通告流。」而镜像在两处都是无条件的——`OPERATOR_MIRROR`
     * 的类型是 `Record<NotificationTemplateCode, …>`（每个模板都必须配一条，那张表里只有
     * `info | warning` 两档加一个 `broadcast`，**没有「不镜像」这一档**），分发器又在第一个
     * 站内收件人落库之后直接镜像、不看模板。所以把上面那个共享分发器交给 AccountService，
     * 等于让客户每次自助改密、换手机号、解绑第三方、下线一台设备都在运营通告列表里生成一行。
     *
     * 现有形状里表达「这条不镜像」的地方**只有装配处**：`operatorMirror` 显式传 `null`，
     * 那个选项的注释原话就是「显式 null = 不镜像（只给测试 / 明确不要镜像的装配处）」。
     * 这是**既有的逃生口，不是发明的一档**——裁定明文写着「没有就停下来说，不要自己发明」，
     * 所以这里用它，而没有去给 `OperatorMirrorEntry` 加字段、改分发器那条无条件路径。
     * dispatch 那一侧同一件事也记在 `operator-mirror.ts` 账号安全线那一段里，并把「要不要
     * 在模板这一层也能关掉」留作 owner 的开放项。
     *
     * 两个分发器共用同一个 pool / 邮件 / 短信 / 偏好：站内、邮件、偏好、投递账本的行为逐字
     * 相同，差别只有镜像这一件。多一个实例的代价是一个对象，不多一条连接。
     */
    accounts.setCustomerNotifier(
      new NotificationDispatcher(pool, { ...options, operatorMirror: null }),
    );
    return dispatcher;
  },
};
