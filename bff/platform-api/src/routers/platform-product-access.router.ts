/**
 * Resolve the calling user's application assignment using an OBO ticket only.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-13
 */
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ProductSeatService } from "@vxture/service-subscription";
import { PlatformAuthGuard } from "../authn/platform-auth.guard";
import { S2sCaller, type S2sCallerCtx } from "../authn/s2s-caller";
import { scopeToS2sCaller } from "../authn/s2s-scope";

@Controller()
@UseGuards(PlatformAuthGuard)
export class PlatformProductAccessRouter {
  constructor(
    @Inject(ProductSeatService) private readonly seats: ProductSeatService,
  ) {}

  @Get("platform/product-access")
  @Header("Cache-Control", "no-store")
  async resolve(
    @Query() query: Record<string, unknown>,
    @S2sCaller() caller: S2sCallerCtx | undefined,
  ) {
    // Subject, organization, workspace and product all come from the verified ticket.
    if (
      !caller ||
      caller.delegated ||
      caller.mode !== "obo" ||
      !caller.subject ||
      !/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        caller.subject,
      ) ||
      !caller.orgId ||
      !caller.workspaceId
    ) {
      throw new ForbiddenException("user_bound_product_ticket_required");
    }
    if (Object.keys(query).length)
      throw new BadRequestException("context_from_token_only");
    // This new user-bound capability accepts neither legacy nor delegated credentials.
    const { workspaceId } = scopeToS2sCaller(
      caller,
      { workspaceId: caller.workspaceId, productCodes: [caller.productCode] },
      "deny",
      "deny",
    );
    const allowed = await this.seats.hasUserAccess({
      subject: caller.subject,
      orgId: caller.orgId,
      workspaceId,
      productCode: caller.productCode,
    });
    return {
      product: caller.productCode,
      workspace_id: workspaceId,
      org_id: caller.orgId,
      subject: caller.subject,
      allowed,
    };
  }
}
