/**
 * Workforce recovery and credential transaction regressions.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { describe, expect, it, vi } from "vitest";
import { OperatorPublicRouter } from "./operator-public.router";
import { OperatorAdminInternalRouter } from "./operator-admin-internal.router";

// ============================================================================
// Public completion must preserve the mailed binding and attempt both cleanups.
// ============================================================================
const TOKEN = "a".repeat(43);
function fixture() {
  const proof = {
    operatorId: "op-1",
    email: "proved@example.test",
    credentialVersion: "b".repeat(64),
  };
  const redis = { consumeOperatorPasswordReset: vi.fn(async () => proof) };
  const operators = { setOperatorPassword: vi.fn(async () => true) };
  const refresh = { revokeAllForOperator: vi.fn(async () => 1) };
  const oidc = { endOperatorSessions: vi.fn(async () => 1) };
  const router = new OperatorPublicRouter(
    redis as never,
    operators as never,
    refresh as never,
    oidc as never,
  );
  return { proof, redis, operators, refresh, oidc, router };
}
describe("operator password recovery completion", () => {
  it("passes only the consumed email and exact credential binding to the transaction", async () => {
    const f = fixture();
    await expect(
      f.router.resetPassword({ token: TOKEN, password: "Password1234" }),
    ).resolves.toEqual({ ok: true });
    expect(f.operators.setOperatorPassword).toHaveBeenCalledWith(
      "op-1",
      "Password1234",
      {
        forceChange: false,
        expectedCredentialVersion: f.proof.credentialVersion,
        verifyEmail: f.proof.email,
      },
    );
  });
  it("does not mutate or clear sessions for stale repository facts", async () => {
    const f = fixture();
    f.operators.setOperatorPassword.mockResolvedValue(false);
    await expect(
      f.router.resetPassword({ token: TOKEN, password: "Password1234" }),
    ).rejects.toThrow("invalid_or_expired_token");
    expect(f.refresh.revokeAllForOperator).not.toHaveBeenCalled();
    expect(f.oidc.endOperatorSessions).not.toHaveBeenCalled();
  });
  it.each(["refresh", "central"] as const)(
    "attempts both authorities if %s cleanup fails",
    async (failure) => {
      const f = fixture();
      if (failure === "refresh")
        f.refresh.revokeAllForOperator.mockRejectedValue(
          new Error("cleanup failed"),
        );
      else
        f.oidc.endOperatorSessions.mockRejectedValue(
          new Error("cleanup failed"),
        );
      await expect(
        f.router.resetPassword({ token: TOKEN, password: "Password1234" }),
      ).rejects.toThrow("cleanup failed");
      expect(f.refresh.revokeAllForOperator).toHaveBeenCalledWith("op-1");
      expect(f.oidc.endOperatorSessions).toHaveBeenCalledWith("op-1");
    },
  );
  it.each([
    {},
    { token: 42, password: "Password1234" },
    { token: TOKEN, password: "short" },
  ])("does not consume a proof for invalid input", async (body) => {
    const f = fixture();
    await expect(f.router.resetPassword(body)).rejects.toThrow();
    expect(f.redis.consumeOperatorPasswordReset).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Internal reset delivery also binds contact state and preserves cleanup attempts.
// ============================================================================
it("refuses reset issuance when the eligible email changes before proof capture", async () => {
  const operators = {
    getOperatorAdminView: vi.fn(async (id: string) => ({
      id,
      roleRank: id === "actor" ? 100 : 10,
      email: "owner@example.test",
      emailVerified: true,
    })),
    passwordResetProof: vi.fn(async () => null),
  };
  const storeOperatorPasswordReset = vi.fn();
  const sendPasswordReset = vi.fn();
  const router = new OperatorAdminInternalRouter(
    operators as never,
    {} as never,
    { storeOperatorPasswordReset } as never,
    {} as never,
    { sendPasswordReset } as never,
    {} as never,
  );
  await expect(
    router.resetPassword("target", { actorOperatorId: "actor" }),
  ).rejects.toThrow("reset_eligibility_changed");
  expect(storeOperatorPasswordReset).not.toHaveBeenCalled();
  expect(sendPasswordReset).not.toHaveBeenCalled();
});
