/**
 * Realm proof consumption and credential throttling regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { OperatorLoginGuard } from "./operator-login-guard.service";
import { TenantLoginGuard } from "../authn/tenant-login-guard.service";

describe("realm human-verification guards", () => {
  it("selects the domain on the server rather than accepting a browser domain", async () => {
    const captcha = { consume: vi.fn(async () => {}) };
    await new OperatorLoginGuard(captcha as never).verifyHuman("proof", "ip");
    await new TenantLoginGuard(captcha as never).verifyHuman("proof", "ip");
    expect(captcha.consume.mock.calls).toEqual([
      ["workforce", "proof"],
      ["customer", "proof"],
    ]);
  });
  it("propagates proof rejection and store failures", async () => {
    const captcha = {
      consume: vi.fn(async () => {
        throw new Error("human_verification_failed");
      }),
    };
    await expect(
      new OperatorLoginGuard(captcha as never).verifyHuman(undefined, "ip"),
    ).rejects.toThrow("human_verification_failed");
  });
  it("preserves workforce credential failure throttling after migration", () => {
    const guard = new OperatorLoginGuard({} as never);
    for (let i = 0; i < 5; i++) guard.recordFailure("ip", "operator");
    expect(() => guard.assertWithinRateLimit("ip", "OPERATOR")).toThrow(
      "too_many_attempts",
    );
    guard.recordSuccess("ip", "operator");
    expect(() => guard.assertWithinRateLimit("ip", "operator")).not.toThrow();
  });
});
