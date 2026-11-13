/**
 * User-bound product access accepts only verified OBO context.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-13
 */
import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { ProductSeatService } from "@vxture/service-subscription";
import type { S2sCallerCtx } from "../authn/s2s-caller";
import { PlatformProductAccessRouter } from "./platform-product-access.router";
const caller: S2sCallerCtx = {
  productCode: "cospace",
  subject: "usr_11111111-1111-4111-8111-111111111111",
  mode: "obo",
  delegated: false,
  orgId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333",
};
function fixture(allowed = true) {
  const hasUserAccess = vi.fn(async () => allowed);
  return {
    hasUserAccess,
    router: new PlatformProductAccessRouter({
      hasUserAccess,
    } as unknown as ProductSeatService),
  };
}
describe("product access", () => {
  it.each([true, false])(
    "returns the platform assignment %s without exposing the roster",
    async (allowed) => {
      const { router, hasUserAccess } = fixture(allowed);
      expect(await router.resolve({}, caller)).toEqual({
        product: "cospace",
        subject: caller.subject,
        org_id: caller.orgId,
        workspace_id: caller.workspaceId,
        allowed,
      });
      expect(hasUserAccess).toHaveBeenCalledWith({
        subject: caller.subject,
        orgId: caller.orgId,
        workspaceId: caller.workspaceId,
        productCode: "cospace",
      });
    },
  );
  it.each([
    undefined,
    { ...caller, mode: "service" as const },
    { ...caller, delegated: true },
    { ...caller, subject: "usr_1234567890" },
    { ...caller, subject: "opr_11111111-1111-4111-8111-111111111111" },
    { ...caller, workspaceId: null },
    { ...caller, orgId: null },
  ])("rejects unbound callers %#", async (value) => {
    const { router, hasUserAccess } = fixture();
    await expect(router.resolve({}, value)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(hasUserAccess).not.toHaveBeenCalled();
  });
  it.each(["workspace_id", "subject", "product", "org_id"])(
    "rejects browser-supplied scope %s",
    async (key) => {
      const { router, hasUserAccess } = fixture();
      await expect(
        router.resolve({ [key]: "other" }, caller),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(hasUserAccess).not.toHaveBeenCalled();
    },
  );
  it("propagates unavailable authority instead of granting", async () => {
    const { router, hasUserAccess } = fixture();
    hasUserAccess.mockRejectedValueOnce(new Error("offline"));
    await expect(router.resolve({}, caller)).rejects.toThrow("offline");
  });
});
