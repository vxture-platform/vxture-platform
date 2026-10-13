/**
 * Product provisioning reconciliation read endpoint.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-10-12
 */
import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ProvisioningReadGuard } from "../authn/provisioning-read.guard";
import { S2sCaller, type S2sCallerCtx } from "../authn/s2s-caller";
import { ProvisioningReadService } from "../platform/provisioning-read.service";
import type { ProvisioningReadPage } from "../types/provisioning-read.types";

/** A separate read grant with no legacy-secret path or workspace write authority. */
@Controller("platform/provisioning")
@UseGuards(ProvisioningReadGuard)
export class PlatformProvisioningReadRouter {
  constructor(
    @Inject(ProvisioningReadService)
    private readonly provisioning: ProvisioningReadService,
  ) {}

  /** GET /platform/provisioning?cursor=&limit=; identity comes only from the guard. */
  @Get()
  @Header("Cache-Control", "no-store")
  list(
    @Query() query: Record<string, unknown>,
    @S2sCaller() caller: S2sCallerCtx,
  ): Promise<ProvisioningReadPage> {
    return this.provisioning.list(caller.productCode, query);
  }
}
