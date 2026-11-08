/**
 * avatar-upload.controller.ts — user-initiated avatar upload (identity-platform-account.md §6 D-5).
 * @package @vxture/bff-auth
 *
 * PUT /api/me/avatar — the accounts surface (authenticated by the central tenant
 * session cookie `vx_sid`) replaces the logged-in user's custom avatar. The body
 * is the raw image bytes (express.raw, registered in main.ts). The content-type
 * is sniffed from the bytes (never the client header) and only raster PNG/JPEG/
 * WEBP is accepted; SVG/oversize are rejected. Stored bytes get a content hash
 * which becomes the `picture` URL version, so the next token carries the new URL.
 */
import {
  BadRequestException,
  Controller,
  Inject,
  Put,
  Delete,
  Req,
  UseGuards,
  SetMetadata,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { VxConfigService } from "@vxture/core-config";
import {
  AccountService,
  AVATAR_MAX_BYTES,
  sniffImageType,
} from "@vxture/service-account";
import {
  CustomerSelfGuard,
  type CustomerSelfRequest,
} from "../authn/customer-self.guard";
import { ACCOUNT_RAW_IMAGE } from "../accounts/accounts-origin.guard";

@Controller("api/me")
@UseGuards(CustomerSelfGuard)
export class AvatarUploadController {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** Restore the account's generated avatar without changing identity information. */
  @Delete("avatar")
  async restore(@Req() req: CustomerSelfRequest): Promise<{ ok: true }> {
    await this.account.deleteAvatar(req.customer.userId);
    return { ok: true };
  }

  @Put("avatar")
  @SetMetadata(ACCOUNT_RAW_IMAGE, true)
  async upload(@Req() req: CustomerSelfRequest): Promise<{ picture: string }> {
    const userId = req.customer.userId;

    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException("empty_body");
    }
    if (body.length > AVATAR_MAX_BYTES) {
      throw new BadRequestException("too_large");
    }
    const contentType = sniffImageType(body);
    if (!contentType) {
      // Not a supported raster image (rejects SVG/text → stored-XSS guard).
      throw new BadRequestException("unsupported_image");
    }

    const hash = createHash("sha256").update(body).digest("hex");
    await this.account.setAvatar(userId, {
      data: body,
      contentType,
      hash,
      source: "upload",
    });
    return {
      picture: `${this.config.auth.OIDC_ISSUER}/avatar/usr_${userId}?v=${hash}`,
    };
  }
}
