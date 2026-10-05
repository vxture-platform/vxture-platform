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
import { LegacyAuthUsageService } from "../platform/legacy-auth-usage.service";
import { parseVisibleSetQuery } from "../platform/sharing-view";

@Controller()
@UseGuards(PlatformAuthGuard)
export class PlatformSharingRouter {
  constructor(
    @Inject(SharingService)
    private readonly sharing: SharingService,
    // E6：旧凭据计数（legacy-auth-usage.service.ts）
    @Inject(LegacyAuthUsageService)
    private readonly legacyAuth: LegacyAuthUsageService,
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
    // 代上报票：`deny`——可见集是资产面产品自己的事（L3 在 L2 入口求值，atlas 从不调这里），
    // 而且下游会**写**物化行；一张代上报票不该能往任意工作空间写东西。
    const { workspaceId } = scopeToS2sCaller(
      s2sCaller,
      {
        workspaceId: parsed.workspaceId,
        productCodes: [parsed.productCode],
      },
      "trust-declared",
      "deny",
    );
    if (!s2sCaller) {
      // E6（2026-10-04）：谁还在走旧凭据——只在旧头那条路上记，Bearer 调用方不记。
      this.legacyAuth.record({
        route: "sharing.visible-set",
        productCode: parsed.productCode,
      });
    }
    return this.sharing.resolveVisibleSet(workspaceId, parsed.productCode);
  }
}
