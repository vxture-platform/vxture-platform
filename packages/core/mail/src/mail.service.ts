/**
 * mail.service.ts - 事务邮件发送服务
 * @package @vxture/core-mail
 * @layer Infrastructure
 * @category Service
 *
 * @description
 *   封装 nodemailer，提供单一 send() 接口。
 *   SMTP 配置通过 MailModule.forRoot(config) 或 forRootAsync 注入。
 *   smtp 为 null 时进入 no-op 模式：send() 仅打印警告，不抛出异常；
 *   NODE_ENV=production 下 no-op 改为 send() 抛错（2026-08-30 fail-closed），
 *   构造仍不抛——邮件不是 BFF 启动的硬依赖。
 *
 * @author AI-Generated
 * @date 2026-05-03
 */

import { Injectable, Logger } from "@nestjs/common";
import nodemailer from "nodemailer";
import type { MailPayload, SmtpConfig } from "./mail.types";

// ============================================================================
// MailService
// ============================================================================

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: ReturnType<
    typeof nodemailer.createTransport
  > | null;
  private readonly from: string;
  /**
   * 生产环境且 SMTP 未配置：send() 抛错而不是静默返回（2026-08-30 审计）。
   * 换邮箱 / 换手机验证码、订单与发票通知一旦静默丢失，用户端看到的是「已发送」，
   * 没有任何一处会报错——这种坏法比抛错隐蔽得多。构造时不抛：邮件不是 admin-bff /
   * console-bff 启动的硬依赖，让整个进程起不来会把无关接口一起拖死；只在构造时
   * 告警一次，让「生产跑在无 SMTP 状态」在启动日志里可见。
   */
  private readonly failClosed: boolean;

  constructor() {
    const smtp = resolveSmtpConfig();

    if (!smtp) {
      this.transporter = null;
      this.from = "";
      this.failClosed = process.env["NODE_ENV"] === "production";
      this.logger.warn(
        this.failClosed
          ? "SMTP 未配置（SMTP_HOST / SMTP_USER / SMTP_PASS 任一为空），生产环境所有 send() 调用将抛错而非静默跳过"
          : "SMTP 未配置，邮件服务以 no-op 模式运行，所有 send() 调用将被静默跳过",
      );
      return;
    }

    this.failClosed = false;
    this.from = smtp.from;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });

    this.logger.log(
      `邮件服务已初始化 [${smtp.host}:${smtp.port}，from: ${smtp.from}]`,
    );
  }

  // ============================================================================
  // 公共接口
  // ============================================================================

  /**
   * 发送一封事务邮件。
   * smtp 未配置时：非生产静默返回；生产抛错（见 failClosed）。
   * 发送失败时抛出原始 Error，由调用方决定是否 swallow。
   *
   * @throws {Error} 生产环境且 SMTP 未配置
   */
  async send(payload: MailPayload): Promise<void> {
    if (!this.transporter) {
      if (this.failClosed) {
        throw new Error(
          `[MailService] SMTP 未配置（SMTP_HOST / SMTP_USER / SMTP_PASS 任一为空），生产环境拒绝静默跳过邮件：subject="${payload.subject}"`,
        );
      }
      this.logger.warn(
        `[no-op] 跳过发送邮件：subject="${payload.subject}" to="${[payload.to].flat().join(", ")}"`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to: Array.isArray(payload.to) ? payload.to.join(", ") : payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });

    this.logger.log(
      `邮件已发送：subject="${payload.subject}" to="${[payload.to].flat().join(", ")}"`,
    );
  }
}

function resolveSmtpConfig(): SmtpConfig | null {
  const host = process.env["SMTP_HOST"];
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  if (!host || !user || !pass) {
    return null;
  }

  return {
    host,
    port: Number(process.env["SMTP_PORT"] ?? 465),
    secure: process.env["SMTP_SECURE"] !== "false",
    user,
    pass,
    from: process.env["SMTP_FROM"] ?? `Vxture Studio <no-reply@${host}>`,
  };
}
