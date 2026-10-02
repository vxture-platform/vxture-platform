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
    //
    // 旧凭据：`trust-declared`，但**这一格是五处里后果最重的一处**——
    // `resolveVisibleSet` 下游的 `materialize` 会**往那个自报的工作空间写**物化行
    // （`sharing.service.ts`），不只是读。收紧它同样要先换凭据，所以今天只能登记。
    // 下一轮的判据（完备性复核给的）：拿别的工作空间 uuid 走旧凭据打这里要求 4xx，
    // 且 `sharing.visible_set_current` 上不许新增该工作空间的物化行。
    const { workspaceId } = scopeToS2sCaller(
      s2sCaller,
      {
        workspaceId: parsed.workspaceId,
        productCodes: [parsed.productCode],
      },
      "trust-declared",
    );
    return this.sharing.resolveVisibleSet(workspaceId, parsed.productCode);
  }
}
