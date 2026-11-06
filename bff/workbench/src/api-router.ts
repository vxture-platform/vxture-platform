/**
 * Narrow workbench read endpoints with live scope checks and no administrative API.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-05
 */
import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Request } from "express";
import type { RpUser } from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: use the verified identity type.
import { SessionService } from "./auth/session-service";
import { ScopeService } from "./scope-service";
import { CatalogService } from "./catalog-service";
import { ResourceOverview } from "./resource-overview";

// ============================================================================
// Read-only routes authorize the verified active workspace before domain reads.
// ============================================================================
@Controller("api")
export class ApiRouter {
  constructor(
    @Inject(SessionService) private readonly auth: SessionService,
    @Inject(ScopeService) private readonly scopes: ScopeService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(ResourceOverview) private readonly overview: ResourceOverview,
  ) {}

  private async user(req: Request): Promise<RpUser> {
    const { user } = await this.auth.authenticate(req);
    await this.scopes.assertCurrent(user);
    return user;
  }

  @Get("me")
  async me(@Req() req: Request) {
    const { user } = await this.auth.authenticate(req);
    return {
      id: user.userId,
      name: user.name ?? user.preferredUsername ?? "用户",
      email: user.email,
      phone: user.phone,
      picture: user.picture,
    };
  }

  @Get("tenant-context")
  async context(@Req() req: Request) {
    return this.scopes.context((await this.auth.authenticate(req)).user);
  }

  @Get("tenant-context/options")
  async organizations(@Req() req: Request) {
    return this.scopes.organizations((await this.auth.authenticate(req)).user);
  }

  @Get("iam/workspaces/mine")
  async workspaces(@Req() req: Request) {
    return this.scopes.workspaces(await this.user(req));
  }

  @Get("products/catalog")
  async products() {
    return this.catalog.catalog();
  }

  @Get("me/apps")
  async applications(@Req() req: Request) {
    await this.user(req);
    return this.catalog.entries();
  }

  @Get("subscription/subscribed-products")
  async subscriptions(@Req() req: Request) {
    const user = await this.user(req);
    return this.catalog.subscriptions(user.activeWorkspace!, user.activeOrg!);
  }

  @Get("subscription/quota-usage")
  async resources(@Req() req: Request) {
    const { user } = await this.auth.authenticate(req);
    await this.scopes.assertRead(user, "tenant.quota.read");
    return this.overview.resources(user.activeWorkspace!);
  }

  @Get("subscription/credits")
  async balance(@Req() req: Request) {
    const { user } = await this.auth.authenticate(req);
    await this.scopes.assertRead(user, "tenant.billing.read", true);
    return this.overview.balance(user.activeOrg!);
  }

  @Get("subscription/monthly-bill")
  async monthlyBill(@Req() req: Request) {
    const { user } = await this.auth.authenticate(req);
    await this.scopes.assertRead(user, "tenant.billing.read", true);
    return this.overview.monthlyBill(user.activeOrg!);
  }
}
