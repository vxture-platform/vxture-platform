/**
 * Account security notification composition without tenant or Console dependencies.
 * @package @vxture/bff-auth
 * @layer Application
 * @category provider
 * @author AI-Generated
 * @date 2026-11-07
 */
import { Logger, type Provider } from "@nestjs/common";
import type { Pool } from "pg";
import { VxConfigService } from "@vxture/core-config";
import {
  AccountService,
  NotificationPreferencesService,
} from "@vxture/service-account";
import { MailService } from "@vxture/service-mail";
import {
  NotificationDispatcher,
  smsTemplatesFromEnv,
} from "@vxture/service-notification";
import { SmsService } from "@vxture/service-sms";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";

export const CUSTOMER_NOTIFIER = "AUTH_CUSTOMER_NOTIFIER";

export const customerNotificationsProvider: Provider = {
  provide: CUSTOMER_NOTIFIER,
  inject: [
    COMMERCE_PG_POOL,
    MailService,
    SmsService,
    NotificationPreferencesService,
    AccountService,
    VxConfigService,
  ],
  useFactory: (
    pool: Pool,
    mail: MailService,
    sms: SmsService,
    prefs: NotificationPreferencesService,
    accounts: AccountService,
    config: VxConfigService,
  ): NotificationDispatcher => {
    const logger = new Logger("SecurityNotifications");
    const dispatcher = new NotificationDispatcher(pool, {
      mail,
      sms,
      smsTemplates: smsTemplatesFromEnv(),
      prefs,
      accountsBaseUrl: config.platform.LOGIN_UI_BASE_URL,
      logger,
      /* 见文件头「operatorMirror: null 是硬的」。删掉这一行，客户每次改密、
         每次被解锁、每台新设备登录都会在运营通告列表里生成一行。 */
      operatorMirror: null,
    });
    accounts.setCustomerNotifier(dispatcher);
    /*
     * 启动日志一行（照 platform-api 那份 wiring 的做法）。**不是装饰**：以后问「运营锁了
     * 这个号，为什么客户没收到」时，第一个要排除的就是「这个进程到底有没有装通知器」，而
     * 未注入是静默的——启动日志里有没有这一行，是唯一一处不用改代码就能回答它的地方。
     * 顺带它也是这个工厂**真的在启动时跑过**的证据（provider 列了但没跑 = 同一个后果）。
     */
    logger.log(
      `account security notifications wired (tenant-independent, operator mirror off), links → ${config.platform.LOGIN_UI_BASE_URL}`,
    );
    return dispatcher;
  },
};
