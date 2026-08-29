import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConsoleMailProvider } from "../providers/console.provider";
import type { SmtpMailProvider } from "../providers/smtp.provider";
import { resolveMailProvider } from "./mail.module";

/**
 * 只钉本模块的接线（SMTP_PASS 是判据、回退到 ConsoleMailProvider）；
 * fail-closed 矩阵见 core-utils `dev-fallback.utils.spec.ts`。
 */
const smtp = { kind: "smtp" } as unknown as SmtpMailProvider;
const consoleProvider = { kind: "console" } as unknown as ConsoleMailProvider;

afterEach(() => vi.unstubAllEnvs());

describe("resolveMailProvider 接线", () => {
  it("生产：SMTP_PASS 为空 → 抛错点名 MailModule；已配置 → SmtpMailProvider", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_PASS", "");
    expect(() => resolveMailProvider(smtp, consoleProvider)).toThrow(
      /MailModule.*SMTP_PASS.*ConsoleMailProvider/,
    );
    vi.stubEnv("SMTP_PASS", "p");
    expect(resolveMailProvider(smtp, consoleProvider)).toBe(smtp);
  });
});
