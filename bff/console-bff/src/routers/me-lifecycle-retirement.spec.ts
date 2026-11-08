/**
 * Retired console lifecycle writes cannot bypass account-center proofs.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { GoneException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MeRouter } from "./me.router";

describe("console lifecycle write retirement", () => {
  function fixture() {
    const deletion = {
      request: vi.fn(),
      cancel: vi.fn(),
    };
    const router = new MeRouter(
      {} as never,
      deletion as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { router, deletion };
  }

  it("requires account-center deletion and recovery without invoking old writes", async () => {
    const { router, deletion } = fixture();
    const req = { user: { id: "customer" } } as never;
    await expect(
      router.requestAccountDeletion(req, { acknowledged: true } as never),
    ).rejects.toBeInstanceOf(GoneException);
    await expect(router.cancelAccountDeletion(req)).rejects.toMatchObject({
      response: { code: "account_center_required", path: "/account" },
    });
    expect(deletion.request).not.toHaveBeenCalled();
    expect(deletion.cancel).not.toHaveBeenCalled();
  });

  it("preserves authentication on retired endpoints", async () => {
    const { router } = fixture();
    await expect(
      router.requestAccountDeletion({} as never, {} as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      router.cancelAccountDeletion({} as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
