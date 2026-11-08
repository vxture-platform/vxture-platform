/**
 * Account lifecycle service transaction delegation.
 * @package @vxture/service-account
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { AccountService, accountPurgeAt } from "./account.service";

// ============================================================================
// Lifecycle service fixtures and delegation
// ============================================================================

function build(status: string | null = "active") {
  const result = {
    deletionRequestedAt: "2026-10-08T03:00:00.000Z",
    revokedSessions: 3,
    unboundIdentities: 2,
  };
  const users = {
    getUserById: vi.fn(async () => (status ? { status } : null)),
    requestDeletion: vi.fn(async () => result as typeof result | null),
    cancelDeletion: vi.fn(async () => null),
    revokeAllSessions: vi.fn(),
    revokeAllRefreshTokens: vi.fn(),
    removeAllIdentities: vi.fn(),
  };
  return {
    users,
    result,
    service: new AccountService(users as never, {} as never),
  };
}

describe("account lifecycle service", () => {
  it("returns committed cleanup counts without repeating cleanup outside the transaction", async () => {
    const f = build();
    expect(await f.service.requestDeletion("customer")).toEqual({
      ...f.result,
      purgeAt: "2026-11-07T03:00:00.000Z",
    });
    expect(f.users.requestDeletion).toHaveBeenCalledExactlyOnceWith("customer");
    expect(f.users.revokeAllSessions).not.toHaveBeenCalled();
    expect(f.users.revokeAllRefreshTokens).not.toHaveBeenCalled();
    expect(f.users.removeAllIdentities).not.toHaveBeenCalled();
  });
  it.each([
    [null, "account_not_found"],
    ["deleting", "account_already_deleting"],
    ["disabled", "account_not_active"],
  ])("rejects ineligible status %s", async (status, error) => {
    const f = build(status);
    await expect(f.service.requestDeletion("customer")).rejects.toThrow(error);
    expect(f.users.requestDeletion).not.toHaveBeenCalled();
  });
  it("rejects a state change between preflight and transaction", async () => {
    const f = build();
    f.users.requestDeletion.mockResolvedValue(null);
    await expect(f.service.requestDeletion("customer")).rejects.toThrow(
      "account_not_active",
    );
  });
  it("propagates transaction failure without returning success", async () => {
    const f = build();
    f.users.requestDeletion.mockRejectedValue(new Error("transaction failed"));
    await expect(f.service.requestDeletion("customer")).rejects.toThrow(
      "transaction failed",
    );
  });
  it("preserves the conflict response for ineligible or expired recovery", async () => {
    const f = build();
    await expect(f.service.cancelDeletion("customer")).rejects.toThrow(
      "account_not_deleting",
    );
  });
  it("uses a fixed duration across a daylight-saving transition", () => {
    expect(accountPurgeAt("2026-10-08T02:00:00-04:00")).toBe(
      "2026-11-07T06:00:00.000Z",
    );
  });
});
