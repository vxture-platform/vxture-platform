/**
 * Workforce password-change session closure regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { OperatorSelfService } from "./operator-self.service";
import { OidcService } from "./oidc.service";
import { OperatorSelfRouter } from "../routers/operator-self.router";

// ============================================================================
// Fixtures
// ============================================================================

function build() {
  const operators = {
    findById: vi.fn(async () => ({ credentialVersion: "credentials-v1" })),
    verifyOperatorPassword: vi.fn(async () => true),
    setOperatorPassword: vi.fn(async () => true),
  };
  const realmSession = { requireOperator: vi.fn(async () => "operator-1") };
  const refreshTokens = { revokeAllForOperator: vi.fn(async () => 2) };
  const liveSessions = new Set([
    "current-sid",
    "other-sid",
    "different-operator-sid",
  ]);
  const redis = {
    listOperatorSessions: vi.fn(async () => [
      { sid: "current-sid", sub: "opr_operator-1", clients: ["opera"] },
      { sid: "other-sid", sub: "opr_operator-1", clients: ["admin"] },
      {
        sid: "different-operator-sid",
        sub: "opr_operator-2",
        clients: ["admin"],
      },
    ]),
    deleteOidcSession: vi.fn(async (sid: string) => {
      liveSessions.delete(sid);
    }),
  };
  const token = { revokeSession: vi.fn(async () => {}) };
  const backChannel = vi.fn(async () => {});
  const oidc = Object.create(OidcService.prototype) as OidcService;
  Object.assign(oidc, { redis, token, sendBackChannelLogouts: backChannel });
  const endSessions = vi.spyOn(oidc, "endOperatorSessions");
  const service = new OperatorSelfService(
    operators as never,
    redis as never,
    realmSession as never,
    {} as never,
    {} as never,
    refreshTokens as never,
    {} as never,
    oidc,
    { require: vi.fn(async () => {}) } as never,
  );
  const router = new OperatorSelfRouter(service);
  const request = {
    cookies: { vx_sid_op: "current-sid", vx_sid: "customer-sid" },
  };
  const response = { clearCookie: vi.fn() };
  return {
    service,
    router,
    request,
    response,
    operators,
    realmSession,
    refreshTokens,
    liveSessions,
    redis,
    token,
    backChannel,
    endSessions,
  };
}

const BODY = {
  currentPassword: "old-password",
  newPassword: "new-password-1234",
};

// ============================================================================
// End-to-end orchestration within the identity boundary
// ============================================================================

describe("workforce password change", () => {
  it("ends current and other central sessions, revokes tokens and notifies applications", async () => {
    const {
      router,
      request,
      response,
      operators,
      realmSession,
      refreshTokens,
      liveSessions,
      token,
      backChannel,
    } = build();
    await expect(
      router.changePassword(BODY, request as never, response as never),
    ).resolves.toEqual({ ok: true });
    expect(realmSession.requireOperator).toHaveBeenCalledWith("current-sid");
    expect(operators.verifyOperatorPassword).toHaveBeenCalledWith(
      "operator-1",
      BODY.currentPassword,
    );
    expect(operators.setOperatorPassword).toHaveBeenCalledWith(
      "operator-1",
      BODY.newPassword,
      { forceChange: false, expectedCredentialVersion: "credentials-v1" },
    );
    expect(refreshTokens.revokeAllForOperator).toHaveBeenCalledExactlyOnceWith(
      "operator-1",
    );
    expect([...liveSessions]).toEqual(["different-operator-sid"]);
    expect(token.revokeSession).toHaveBeenCalledTimes(2);
    expect(backChannel).toHaveBeenCalledWith("current-sid", "opr_operator-1", [
      "opera",
    ]);
    expect(backChannel).toHaveBeenCalledWith("other-sid", "opr_operator-1", [
      "admin",
    ]);
    expect(response.clearCookie).toHaveBeenCalledExactlyOnceWith("vx_sid_op", {
      path: "/",
    });
  });

  it("still attempts central-session closure when refresh revocation fails", async () => {
    const f = build();
    f.refreshTokens.revokeAllForOperator.mockRejectedValue(
      new Error("refresh DB down"),
    );
    await expect(
      f.service.changePassword(
        "current-sid",
        BODY.currentPassword,
        BODY.newPassword,
      ),
    ).rejects.toThrow("refresh DB down");
    expect(f.endSessions).toHaveBeenCalledWith("operator-1");
    expect([...f.liveSessions]).toEqual(["different-operator-sid"]);
  });
  it("still attempts refresh revocation when central-session closure fails", async () => {
    const f = build();
    f.endSessions.mockRejectedValue(new Error("Redis down"));
    await expect(
      f.service.changePassword(
        "current-sid",
        BODY.currentPassword,
        BODY.newPassword,
      ),
    ).rejects.toThrow("Redis down");
    expect(f.refreshTokens.revokeAllForOperator).toHaveBeenCalledWith(
      "operator-1",
    );
  });

  it("rejects customer sessions before changing credentials", async () => {
    const { service, realmSession, operators, endSessions } = build();
    realmSession.requireOperator.mockRejectedValue(
      new Error("operator_session_required"),
    );
    await expect(
      service.changePassword(
        "customer-sid",
        BODY.currentPassword,
        BODY.newPassword,
      ),
    ).rejects.toThrow("operator_session_required");
    expect(operators.setOperatorPassword).not.toHaveBeenCalled();
    expect(endSessions).not.toHaveBeenCalled();
  });

  it("does not revoke sessions or clear cookies on an incorrect password", async () => {
    const { router, request, response, operators, refreshTokens, endSessions } =
      build();
    operators.verifyOperatorPassword.mockResolvedValue(false);
    await expect(
      router.changePassword(BODY, request as never, response as never),
    ).rejects.toThrow("invalid_current_password");
    expect(operators.setOperatorPassword).not.toHaveBeenCalled();
    expect(refreshTokens.revokeAllForOperator).not.toHaveBeenCalled();
    expect(endSessions).not.toHaveBeenCalled();
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it("does not revoke existing sessions if the password write fails", async () => {
    const { service, operators, refreshTokens, endSessions } = build();
    operators.setOperatorPassword.mockRejectedValue(new Error("write failed"));
    await expect(
      service.changePassword(
        "current-sid",
        BODY.currentPassword,
        BODY.newPassword,
      ),
    ).rejects.toThrow("write failed");
    expect(refreshTokens.revokeAllForOperator).not.toHaveBeenCalled();
    expect(endSessions).not.toHaveBeenCalled();
  });

  it("does not report success or clear the cookie when central-session cleanup fails", async () => {
    const { router, request, response, redis } = build();
    redis.listOperatorSessions.mockRejectedValue(
      new Error("session store unavailable"),
    );
    await expect(
      router.changePassword(BODY, request as never, response as never),
    ).rejects.toThrow("session store unavailable");
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it("rejects weak passwords before checking or changing credentials", async () => {
    const { service, operators } = build();
    await expect(
      service.changePassword("current-sid", BODY.currentPassword, "short"),
    ).rejects.toThrow("weak_password");
    expect(operators.verifyOperatorPassword).not.toHaveBeenCalled();
    expect(operators.setOperatorPassword).not.toHaveBeenCalled();
  });
});
