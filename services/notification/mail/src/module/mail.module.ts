/**
 * mail.module.ts - 邮件服务 NestJS 模块
 * @package @vxture/service-mail
 * @layer Domain
 * @category Module
 *
 * 启动逻辑：
 *   - SMTP_PASS 已配置 → SmtpMailProvider（生产）
 *   - SMTP_PASS 未配置 → ConsoleMailProvider（开发 fallback）；
 *     NODE_ENV=production 下改为工厂抛错、拒绝启动（2026-08-30 fail-closed）
 *   - REDIS_URL / REDIS_HOST+REDIS_PORT → ioredis 客户端
 *
 * @author AI-Generated
 * @date 2026-05-02
 * @version 1.0
 * @copyright Vxture Team
 */

import { Logger, Module } from "@nestjs/common";
import Redis from "ioredis";
import { MAIL_PROVIDER, REDIS_CLIENT } from "../constants/tokens";
import { ConsoleMailProvider } from "../providers/console.provider";
import { SmtpMailProvider } from "../providers/smtp.provider";
import { MailService } from "../service/mail.service";
import { VerifyCodeService } from "../service/verifycode.service";
import type { IMailProvider } from "../types/mail.types";

/**
 * 选出 MAIL_PROVIDER 背后的驱动。
 *
 * 生产环境 fail-closed（2026-08-30 审计）：ConsoleMailProvider 只把邮件打到 stdout。
 * 邮箱验证码是 IdP 登录 / 注册链路的硬依赖——线上 SMTP_PASS 漏注入时，用户看到的是
 * 「验证码已发送」而邮件永远不到，且没有任何报错；这种坏法比启动失败隐蔽得多。
 * 所以生产环境缺 SMTP_PASS 直接在工厂里抛，让部署当场失败；非生产保留控制台回退
 * 并记一条警告。判据与 service-sms 的 fail-closed 一致（NODE_ENV）。
 *
 * @throws {Error} 生产环境且 SMTP_PASS 为空
 */
export function resolveMailProvider(
  smtp: SmtpMailProvider,
  consoleProvider: ConsoleMailProvider,
): IMailProvider {
  if (process.env["SMTP_PASS"]) return smtp;

  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "[MailModule] SMTP 未配置（SMTP_PASS 为空），生产环境拒绝回退到 ConsoleMailProvider",
    );
  }
  new Logger("MailModule").warn(
    "SMTP 未配置（SMTP_PASS 为空），邮件只打印到控制台、不会真正发送 —— 仅限非生产",
  );
  return consoleProvider;
}

@Module({
  providers: [
    // ─── Redis 客户端 ──────────────────────────────────────────────────────
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const url = process.env["REDIS_URL"];
        if (url) {
          return new Redis(url);
        }
        return new Redis({
          host: process.env["REDIS_HOST"] ?? "localhost",
          port: Number(process.env["REDIS_PORT"] ?? 6379),
        });
      },
    },

    // ─── 邮件驱动：生产用 SMTP，开发用 Console ─────────────────────────────
    SmtpMailProvider,
    ConsoleMailProvider,
    {
      provide: MAIL_PROVIDER,
      inject: [SmtpMailProvider, ConsoleMailProvider],
      useFactory: resolveMailProvider,
    },

    MailService,
    VerifyCodeService,
  ],
  exports: [MailService, VerifyCodeService],
})
export class MailModule {}
