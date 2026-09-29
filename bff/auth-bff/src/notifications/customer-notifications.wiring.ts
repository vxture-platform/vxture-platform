/**
 * customer-notifications.wiring.ts — 账号安全事件的通知开关（auth-bff，2026-09-29）。
 * @package @vxture/bff-auth
 *
 * ── 为什么认证面也要有一个 ──
 * `AccountService` 的通知器是 setter 注入的，**未注入 = 一条都不发**（那是它刻意的默认，
 * 见 service 里 `setCustomerNotifier` 那一段）。而十四条安全通知里有七条的写入方根本不在
 * console 那个进程上，全在这里：
 *   · `account.password_changed`（cause=`reset_by_email`）—— 邮件重置令牌那一条走
 *     AuthnService.resetPassword；**这一批存在的理由本身就是它**，凭据被令牌改掉、
 *     本人此前一句话都收不到。
 *   · `account.locked` / `account.unlocked` / `account.sessions_ended_by_operator`
 *     —— 三条运营处置全走 AccountAdminInternalRouter（admin-bff 的 S2S 落点在本进程）。
 *   · `account.new_device_signin` —— 判据是 `session.login_attempts`，只有 OidcService
 *     的登录流水写入方知道那件事。
 * 这个 provider 漏了，上面每一处都**照常编译、照常通过守卫、照常 boot-smoke 绿**，
 * 只是客户那边什么都没有（本仓最常见的缺陷是「做了没接」）。所以它配了一条用例。
 *
 * ── 形状照抄 console-bff 的 services/customer-notifications.wiring.ts ──
 * 工厂 provider 在模块初始化时即执行（Nest 急切实例化），用 setter 注入——AccountModule
 * 是自包含模块，跨模块的构造器令牌不可见。
 *
 * ── `operatorMirror: null` 是硬的，不是可选项 ──
 * owner 裁定 5：「安全事件不进运营通告流。」分发器缺省会拿同一个 pool 写一条
 * admin.operator_notices，且**不看模板**（`OPERATOR_MIRROR` 那张表里只有
 * `info | warning | broadcast` 三档，没有「不镜像」这一档）。表达「这条不镜像」的地方
 * 只有装配处那个显式 `null`——console-bff 给 AccountService 的那个分发器传的就是它，
 * 这里逐字相同。这是既有的逃生口，不是新发明的一档。
 *
 * ── 与 console 侧的一处已知差异：邮件只发纯文本 ──
 * console-bff / platform-api 的 `mail` 是 `@vxture/core-mail` 的 MailService（送 html +
 * text）；本进程用的是它自己早就装着的 `@vxture/service-mail`（`MailMessage` 只有
 * `{ to, subject, text }`，SmtpMailProvider 也只把 text 交给 nodemailer）。
 * `render()` 的 text 一支是**完整正文**（标题 + 正文 + 链接 + 页脚），所以这条路送出去的
 * 是一封内容齐全、没有 HTML 外壳的邮件——不是少一段信息。要与另两个面逐字一致，前置是
 * 给 auth-bff 再加一个 `@vxture/core-mail` 依赖，那超出本次授权，记在交付说明里。
 *
 * ── 这里**不挂** OrganizationService，是决定不是漏 ──
 * 本进程的 `GovernanceController.accept` 也能接受邀请，但它今天零调用方，权威面是
 * console-bff 的 `POST /api/iam/invitations/accept`（理由在那个控制器的注释里：一条会
 * 发通知的写路径该只有一个落点）。挂上它等于给那个面偷偷开一条第二通知源。
 */
import { Logger, type Provider } from "@nestjs/common";
import type { Pool } from "pg";
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
  ],
  useFactory: (
    pool: Pool,
    mail: MailService,
    sms: SmsService,
    prefs: NotificationPreferencesService,
    accounts: AccountService,
  ): NotificationDispatcher => {
    const logger = new Logger("SecurityNotifications");
    const dispatcher = new NotificationDispatcher(pool, {
      mail,
      sms,
      smsTemplates: smsTemplatesFromEnv(),
      prefs,
      consoleBaseUrl: process.env.CONSOLE_BASE_URL?.replace(/\/$/, ""),
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
      `security notifications wired (inbox + email, operator mirror off)${
        process.env.CONSOLE_BASE_URL
          ? `, links → ${process.env.CONSOLE_BASE_URL}`
          : ""
      }`,
    );
    return dispatcher;
  },
};
