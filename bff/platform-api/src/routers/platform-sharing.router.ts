/**
 * platform-sharing.router.ts — C2 visible-set resolution API (product_310
 * P4.3; contract = product_200 §3.2, architecture = data_sharing_100 §4).
 *
 * Server-to-server only (PlatformAuthGuard, same dual-accept credential as
 * /platform/entitlements — product_210 T2). nginx does not route /platform/*
 * — internal network only.
 *
 * The response is the grant-hit portion of the caller's visible set; the
 * owned / P-level components are assembled at the L2 product entry
 * (data_sharing_100 §2). Asset-plane products only (Arda/Karda/Terra/Runos);
 * L3 agents are evaluated at the L2 entry and never call this directly.
 */
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import { SharingService, type VisibleSetResult } from "@vxture/service-sharing";
import { PlatformAuthGuard } from "../authn/platform-auth.guard";
import { S2sCaller, type S2sCallerCtx } from "../authn/s2s-caller";
import { scopeToS2sCaller } from "../authn/s2s-scope";
import { parseVisibleSetQuery } from "../platform/sharing-view";

@Controller()
@UseGuards(PlatformAuthGuard)
export class PlatformSharingRouter {
  constructor(
    @Inject(SharingService)
    private readonly sharing: SharingService,
  ) {}

  /** GET /platform/sharing/visible-set?workspace_id={W}&product={P} */
  @Get("platform/sharing/visible-set")
  @Header("Cache-Control", "private, max-age=30")
  async visibleSet(
    @Query() query: { workspace_id?: string; product?: string },
    @S2sCaller() s2sCaller: S2sCallerCtx | undefined,
  ): Promise<VisibleSetResult> {
    let parsed;
    try {
      parsed = parseVisibleSetQuery(query);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    // TD-035: an S2S caller can only ask about its own product, and its own
    // workspace_id (the token's, not the caller-declared one) is used.
    const { workspaceId } = scopeToS2sCaller(s2sCaller, {
      workspaceId: parsed.workspaceId,
      productCodes: [parsed.productCode],
    });
    return this.sharing.resolveVisibleSet(workspaceId, parsed.productCode);
  }
}
