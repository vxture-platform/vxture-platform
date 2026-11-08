/**
 * Account-center boundary regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { AvatarUploadController } from "./avatar-upload.controller";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { CustomerSelfGuard } from "../authn/customer-self.guard";

describe("customer avatar upload", () => {
  it("uses the shared customer authority", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AvatarUploadController),
    ).toContain(CustomerSelfGuard);
  });
  it("writes only the user resolved by the customer guard", async () => {
    const account = { setAvatar: vi.fn(async () => {}) };
    const controller = new AvatarUploadController(
      account as never,
      { auth: { OIDC_ISSUER: "https://accounts.vxture.com" } } as never,
    );
    const result = await controller.upload({
      customer: { userId: "123" },
      body: Buffer.from("89504e470d0a1a0a00000000", "hex"),
    } as never);
    expect(account.setAvatar).toHaveBeenCalledWith(
      "123",
      expect.objectContaining({ contentType: "image/png", source: "upload" }),
    );
    expect(result.picture).toContain("/avatar/usr_123?v=");
  });
  it.each([Buffer.alloc(0), Buffer.from("<svg></svg>"), "not bytes"])(
    "rejects invalid image bytes %j",
    async (body) => {
      const account = { setAvatar: vi.fn() };
      const controller = new AvatarUploadController(
        account as never,
        {} as never,
      );
      await expect(
        controller.upload({ customer: { userId: "123" }, body } as never),
      ).rejects.toThrow();
      expect(account.setAvatar).not.toHaveBeenCalled();
    },
  );
});
