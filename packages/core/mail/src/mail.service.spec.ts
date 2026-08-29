import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * MailService 的 fail-closed 守卫（2026-08-30 审计）。
 *
 * 要证的边：生产环境 SMTP 未配置时 send() **必须抛**，不能静默返回让换邮箱 /
 * 换手机验证码、订单与发票通知无声丢失；构造只告警一次、不抛（邮件不是 BFF
 * 启动的硬依赖）。同时钉住：生产 + SMTP 已配置时守卫不误伤，非生产仍是 no-op。
 *
 * nodemailer 整体替换成假 transporter——验的是守卫，不是 SMTP。sendMail 必须
 * vi.hoisted：vi.mock 会被提升到 import 之上，普通 const 那时还在 TDZ。
 */
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

import { MailService } from "./mail.service";

const warn = vi
  .spyOn(Logger.prototype, "warn")
  .mockImplementation(() => undefined);
const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

const payload = { to: "a@b.test", subject: "发票已开具", html: "<p>hi</p>" };

const unsetSmtp = () => {
  vi.stubEnv("SMTP_HOST", "");
  vi.stubEnv("SMTP_USER", "");
  vi.stubEnv("SMTP_PASS", "");
};
const setSmtp = () => {
  vi.stubEnv("SMTP_HOST", "smtp.example.test");
  vi.stubEnv("SMTP_USER", "u");
  vi.stubEnv("SMTP_PASS", "p");
};

afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockClear();
  log.mockClear();
  sendMail.mockClear();
});

describe("MailService —— 生产环境 fail-closed", () => {
  it("生产 + SMTP 未配置 → 构造只告警一次，send() 抛错而非静默返回", async () => {
    vi.stubEnv("NODE_ENV", "production");
    unsetSmtp();

    const service = new MailService();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/生产/);

    await expect(service.send(payload)).rejects.toThrow(
      /SMTP_HOST.*SMTP_USER.*SMTP_PASS.*生产/,
    );
    await expect(service.send(payload)).rejects.toThrow();
    // 抛错就是全部：没有每次 send 的 no-op 告警，也没有假的「已发送」日志。
    expect(warn).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("生产 + SMTP 已配置 → 正常走 transporter（守卫不误伤）", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setSmtp();

    const service = new MailService();
    await service.send(payload);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      to: "a@b.test",
      subject: "发票已开具",
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("MailService —— 非生产保留 no-op", () => {
  it.each(["development", "test"])(
    "NODE_ENV=%s + SMTP 未配置 → send() 静默返回，只留告警",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      unsetSmtp();

      const service = new MailService();
      await expect(service.send(payload)).resolves.toBeUndefined();

      expect(sendMail).not.toHaveBeenCalled();
      // 构造一次 + 每次 send 一次。
      expect(warn).toHaveBeenCalledTimes(2);
    },
  );
});
