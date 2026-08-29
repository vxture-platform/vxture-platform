import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConsoleMailProvider } from "../providers/console.provider";
import type { SmtpMailProvider } from "../providers/smtp.provider";
import { resolveMailProvider } from "./mail.module";

/**
 * MAIL_PROVIDER 选择器的 fail-closed 守卫（2026-08-30 审计）。
 *
 * 邮箱验证码是 IdP 登录 / 注册的硬依赖。要证的边：生产环境 SMTP_PASS 为空时
 * 工厂**必须抛**，不能让只打 stdout 的 ConsoleMailProvider 静默顶上；非生产的
 * 控制台回退仍要可用。用哨兵对象，验的是选择规则，不碰真正的 SMTP。
 */
const smtp = { kind: "smtp" } as unknown as SmtpMailProvider;
const consoleProvider = { kind: "console" } as unknown as ConsoleMailProvider;

const warn = vi
  .spyOn(Logger.prototype, "warn")
  .mockImplementation(() => undefined);

afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockClear();
});

describe("resolveMailProvider —— 生产环境 fail-closed", () => {
  it("生产 + SMTP_PASS 为空 → 工厂抛错，错误点名 SMTP_PASS 与模块", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_PASS", "");

    expect(() => resolveMailProvider(smtp, consoleProvider)).toThrow(
      /MailModule.*SMTP_PASS/,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("生产 + SMTP_PASS 已配置 → SmtpMailProvider", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_PASS", "p");

    expect(resolveMailProvider(smtp, consoleProvider)).toBe(smtp);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("resolveMailProvider —— 非生产保留控制台回退", () => {
  it.each(["development", "test"])(
    "NODE_ENV=%s + SMTP_PASS 为空 → ConsoleMailProvider，并告警一次",
    (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("SMTP_PASS", "");

      expect(resolveMailProvider(smtp, consoleProvider)).toBe(consoleProvider);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/SMTP_PASS/);
    },
  );

  it("非生产 + SMTP_PASS 已配置 → SmtpMailProvider，不告警", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SMTP_PASS", "p");

    expect(resolveMailProvider(smtp, consoleProvider)).toBe(smtp);
    expect(warn).not.toHaveBeenCalled();
  });
});
