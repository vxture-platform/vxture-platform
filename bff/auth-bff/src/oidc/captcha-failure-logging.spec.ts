import { Logger, UnauthorizedException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TenantLoginGuard } from "../authn/tenant-login-guard.service";
import {
  OperatorLoginGuard,
  captchaFailureLine,
} from "./operator-login-guard.service";

/**
 * What this pins: a captcha failure leaves ONE warn line with the verifier's
 * reason, and the 401 body stays a bare `human_verification_failed`.
 *
 * Why it is worth a spec: until 2026-08-29 both guards did `catch {}` and
 * threw the bare 401. A wrong `*_ALLOWED_HOSTNAMES`, a crossed secret and a
 * client that timed out and degraded were then indistinguishable, and a
 * production login incident was diagnosed by guesswork across several rounds.
 * The line is the difference between "a 401" and "reason=missing-token" -
 * which is the client-degrade path that LOOKS like a bot rejection.
 *
 * The token must never be in the line. Asserted with a token that would be
 * easy to spot if it leaked.
 */
const ENV_KEYS = [
  "CF_TURNSTILE_ENABLED",
  "CF_TURNSTILE_ADMIN_SECRET_KEY",
  "CF_TURNSTILE_ADMIN_ALLOWED_HOSTNAMES",
  "CF_TURNSTILE_TENANT_SECRET_KEY",
  "CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES",
] as const;

describe("captcha failure logging", () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
    {};
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.CF_TURNSTILE_ENABLED = "true";
    process.env.CF_TURNSTILE_ADMIN_SECRET_KEY = "test-admin-secret";
    process.env.CF_TURNSTILE_ADMIN_ALLOWED_HOSTNAMES = "accounts.example.test";
    process.env.CF_TURNSTILE_TENANT_SECRET_KEY = "test-tenant-secret";
    process.env.CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES = "accounts.example.test";
    warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  it("operator: no token -> one warn line with reason=missing-token, bare 401", async () => {
    // Guards read env when constructed, so construct AFTER the env is set.
    const guard = new OperatorLoginGuard();

    await expect(
      guard.verifyTurnstile(undefined, "203.0.113.9"),
    ).rejects.toMatchObject({
      constructor: UnauthorizedException,
      message: "human_verification_failed",
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toMatch(/^captcha_verification_failed /u);
    expect(line).toContain("surface=admin");
    expect(line).toContain("reason=missing-token");
    expect(line).toContain("ip=203.0.113.9");
  });

  it("tenant: same line shape, surface=tenant", async () => {
    const guard = new TenantLoginGuard();

    await expect(
      guard.verifyTurnstile(undefined, "198.51.100.4"),
    ).rejects.toMatchObject({ message: "human_verification_failed" });

    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("surface=tenant");
    expect(line).toContain("reason=missing-token");
  });

  /* A malformed token fails the verifier's own shape check before any network
     call (`invalid-token`), which is enough to prove the token itself is not
     echoed: this value would be unmistakable in the line if it were. */
  it("never puts the token in the line", async () => {
    const guard = new OperatorLoginGuard();
    const token = "LEAKED-TOKEN-" + "x".repeat(3000);

    await expect(guard.verifyTurnstile(token, "203.0.113.9")).rejects.toThrow();

    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("reason=invalid-token");
    expect(line).not.toContain("LEAKED-TOKEN");
  });

  it("stays silent when the verifier is disabled", async () => {
    process.env.CF_TURNSTILE_ENABLED = "false";
    const guard = new OperatorLoginGuard();

    await expect(
      guard.verifyTurnstile(undefined, "203.0.113.9"),
    ).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("classifies a non-verifier error as unexpected and flattens whitespace", () => {
    const line = captchaFailureLine(
      "admin",
      "203.0.113.9",
      new Error("boom\nsecond line"),
    );
    expect(line).toContain("reason=unexpected");
    expect(line).toContain('detail="boom second line"');
  });
});
