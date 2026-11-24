/**
 * Separate signed changes-v1 receiver; ACK follows durable invalidation.
 * @package @vxture/bff-arche
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-24
 */
import { Controller, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
// ⚠️ 跨层引用: Verify the protocol through the public RP transport.
import {
  IdentityEventVerifier,
  IdentityEventVerificationError,
} from "@vxture/core-oidc-rp";
import { RP_CHANGES, RP_EVENT_VERIFIER } from "../oidc/oidc-rp.tokens";
import {
  IdentityChangesAuthority,
  IdentityChangeConflict,
} from "../oidc/identity-changes.authority";

@Controller("auth/identity-events")
export class IdentityEventsRouter {
  constructor(
    @Inject(RP_CHANGES)
    private readonly authority: IdentityChangesAuthority | null,
    @Inject(RP_EVENT_VERIFIER)
    private readonly verifier: IdentityEventVerifier | null,
  ) {}
  /** @param req Typed compact JWS. @param res Durable acknowledgment. @returns Empty ACK or safe error code. */
  @Post()
  async receive(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    if (!this.authority || !this.verifier) {
      res.status(404).end();
      return;
    }
    if (
      !req.is("application/jwt") ||
      typeof req.body !== "string" ||
      Buffer.byteLength(req.body) > 65536
    ) {
      res.status(400).json({ code: "INVALID_REQUEST" });
      return;
    }
    try {
      const event = await this.verifier.verify(req.body);
      await this.authority.apply(event);
      res.status(204).end();
    } catch (error) {
      const status =
        error instanceof IdentityEventVerificationError
          ? error.unavailable
            ? 503
            : 401
          : error instanceof IdentityChangeConflict
            ? 409
            : 503;
      res.status(status).json({
        code:
          status === 503 ? "IDENTITY_UNAVAILABLE" : "IDENTITY_EVENT_REJECTED",
      });
    }
  }
}
