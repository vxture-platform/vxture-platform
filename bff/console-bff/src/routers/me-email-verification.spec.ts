/**
 * Exact-address current-email proof regression coverage.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { MeRouter } from "./me.router";

// ============================================================================
// A previously issued token cannot verify a concurrently replaced email
// ============================================================================
describe("current email ownership proof", () => {
  it("passes the token-bound email to the conditional repository update", async () => {
    const aggregator = {
      markCurrentUserEmailVerified: vi.fn(async () => ({
        email: "old@example.com",
        emailVerified: true,
      })),
    };
    const email = { verifyCode: vi.fn(() => ({ email: "old@example.com" })) };
    const router = new MeRouter(
      aggregator as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      email as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await router.verifyCurrentEmail({ user: { id: "user" } } as never, {
      emailVerifyToken: "token",
      code: "123456",
    });
    expect(aggregator.markCurrentUserEmailVerified).toHaveBeenCalledWith(
      "user",
      "old@example.com",
    );
  });
  it("rejects the completion when the stored email no longer matches", async () => {
    const aggregator = {
      markCurrentUserEmailVerified: vi.fn(async () => null),
    };
    const email = { verifyCode: vi.fn(() => ({ email: "old@example.com" })) };
    const router = new MeRouter(
      aggregator as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      email as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      router.verifyCurrentEmail({ user: { id: "user" } } as never, {
        emailVerifyToken: "token",
        code: "123456",
      }),
    ).rejects.toThrow();
  });
});
