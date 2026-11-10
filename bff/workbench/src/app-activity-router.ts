/**
 * Cookie-authenticated portal favorites, launches and view preferences.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-10
 */
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { AppActivityService, FavoritesService } from "@vxture/service-account"; // ⚠️ 跨层引用: account domain owns preference and activity persistence.
import type { AppActivityScope, AppView } from "@vxture/service-account"; // ⚠️ 跨层引用: verified scope contract.
import { SessionService } from "./auth/session-service";
import { ScopeService } from "./scope-service";
import { CatalogService } from "./catalog-service";
import { ACTIVITY_WRITE_POOL, CONFIG, PRIMARY_POOL } from "./tokens";
import type { WorkbenchConfig } from "./config";
import { failure } from "./errors";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const VIEWS = new Set(["favorites", "recent", "frequent"]);
function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw failure(400, "WORKBENCH_INVALID_INPUT", "Invalid request");
  return body as Record<string, unknown>;
}

// ============================================================================
// Mutations never accept identity or workspace hints from the request body.
// ============================================================================
@Controller("api/me/app-activity")
export class AppActivityRouter {
  constructor(
    @Inject(SessionService) private readonly auth: SessionService,
    @Inject(ScopeService) private readonly scopes: ScopeService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(PRIMARY_POOL) private readonly reader: Pool,
    @Inject(ACTIVITY_WRITE_POOL) private readonly writer: Pool | null,
    @Inject(CONFIG) private readonly config: WorkbenchConfig,
  ) {}

  private async scope(req: Request): Promise<AppActivityScope> {
    const { user } = await this.auth.authenticate(req);
    await this.scopes.assertCurrent(user);
    if (
      req.method !== "GET" &&
      req.headers["x-workbench-scope"] !==
        `${user.userId}:${user.activeOrg}:${user.activeWorkspace}`
    )
      throw failure(
        409,
        "WORKBENCH_SCOPE_CHANGED",
        "Workspace changed; refresh before retrying",
      );
    return {
      userId: user.userId,
      tenantId: user.activeOrg!,
      workspaceId: user.activeWorkspace!,
    };
  }

  private write(req: Request): Pool {
    if (
      req.headers.origin !== this.config.origin ||
      req.headers["x-workbench-request"] !== "1" ||
      (req.headers["sec-fetch-site"] &&
        req.headers["sec-fetch-site"] !== "same-origin")
    )
      throw failure(
        403,
        "WORKBENCH_REQUEST_FORBIDDEN",
        "Same-origin request required",
      );
    if (!this.writer)
      throw failure(
        503,
        "WORKBENCH_ACTIVITY_UNAVAILABLE",
        "Application preferences are not connected",
      );
    return this.writer;
  }

  private async product(
    scope: AppActivityScope,
    code: string,
    launch: boolean,
  ): Promise<string> {
    const subscriptions = await this.catalog.subscriptions(
      scope.workspaceId,
      scope.tenantId,
      scope.userId,
    );
    const coverage = subscriptions.filter((row) => row.productCode === code);
    if (
      !coverage.length ||
      (launch &&
        !coverage.some(
          (row) =>
            ["active", "trialing", "overdue"].includes(row.status) &&
            !row.maintenance,
        ))
    )
      throw failure(
        403,
        "WORKBENCH_APP_FORBIDDEN",
        "Application is not available in this workspace",
      );
    const result = await this.reader.query<{ id: string }>(
      `select id from product.products where product_code = $1 and deleted_at is null
       and is_customer_visible and product_type ~ '_(agent|platform)$'
       and ($2::boolean = false or (status = 'active' and maintenance_window_id is null))`,
      [code, launch],
    );
    if (!result.rows[0])
      throw failure(404, "WORKBENCH_APP_NOT_FOUND", "Application not found");
    if (
      launch &&
      !(await this.catalog.entries()).some(
        (entry) => entry.code === code && entry.homeUrl,
      )
    )
      throw failure(
        403,
        "WORKBENCH_APP_FORBIDDEN",
        "Application entry is unavailable",
      );
    return result.rows[0].id;
  }

  /**
   * Project account favorites and scope-bound activity onto authorized products.
   * @param req - Authenticated request.
   * @returns Preferred view and subscribed product activity.
   * @throws When identity, membership or activity storage is unavailable.
   */
  @Get()
  async list(@Req() req: Request) {
    const scope = await this.scope(req);
    if (!this.writer)
      throw failure(
        503,
        "WORKBENCH_ACTIVITY_UNAVAILABLE",
        "Application preferences are not connected",
      );
    const [activity, favorites, products, subscriptions] = await Promise.all([
      new AppActivityService(this.writer).read(scope),
      new FavoritesService(this.writer).listProductIds(scope.userId),
      this.reader.query<{ id: string; code: string }>(
        `select id, product_code as code from product.products where deleted_at is null and is_customer_visible`,
      ),
      this.catalog.subscriptions(
        scope.workspaceId,
        scope.tenantId,
        scope.userId,
      ),
    ]);
    return {
      view: activity.view,
      items: products.rows
        .filter((p) => subscriptions.some((s) => s.productCode === p.code))
        .map((p) => {
          const usage = activity.items.find((item) => item.productId === p.id);
          return {
            code: p.code,
            favorite: favorites.includes(p.id),
            lastUsedAt: usage?.lastUsedAt ?? null,
            launches30d: usage?.launches30d ?? 0,
          };
        }),
    };
  }

  /**
   * Persist one explicit account-wide favorite choice.
   * @param req - Same-origin request.
   * @param code - Subscribed application code.
   * @param input - Desired boolean state.
   * @returns Acknowledgement after persistence.
   * @throws When input, ownership or source checks fail.
   */
  @Post(":code/favorite")
  async favorite(
    @Req() req: Request,
    @Param("code") code: string,
    @Body() input: unknown,
  ) {
    const writer = this.write(req);
    const scope = await this.scope(req);
    const body = bodyObject(input);
    if (typeof body.favorite !== "boolean")
      throw failure(
        400,
        "WORKBENCH_INVALID_INPUT",
        "Expected favorite boolean",
      );
    const product = await this.product(scope, code, false);
    const service = new FavoritesService(writer);
    if (body.favorite) await service.add(scope.userId, product);
    else await service.remove(scope.userId, product);
    return { ok: true };
  }

  /**
   * Record a launch with server time and retry-safe identity.
   * @param req - Same-origin request.
   * @param code - Available subscribed application code.
   * @param input - Unique launch event UUID.
   * @returns Acknowledgement.
   * @throws When input, subscription or source checks fail.
   */
  @Post(":code/launch")
  async launch(
    @Req() req: Request,
    @Param("code") code: string,
    @Body() input: unknown,
  ) {
    const writer = this.write(req);
    const scope = await this.scope(req);
    const body = bodyObject(input);
    if (typeof body.eventId !== "string" || !UUID.test(body.eventId))
      throw failure(400, "WORKBENCH_INVALID_INPUT", "Expected event UUID");
    const product = await this.product(scope, code, true);
    await new AppActivityService(writer).record(scope, product, body.eventId);
    return { ok: true };
  }

  /**
   * Remember the lightweight home switch in the verified workspace.
   * @param req - Same-origin request.
   * @param input - One supported view.
   * @returns Acknowledgement.
   * @throws When input or source checks fail.
   */
  @Post("view")
  async view(@Req() req: Request, @Body() input: unknown) {
    const writer = this.write(req);
    const scope = await this.scope(req);
    const body = bodyObject(input);
    if (typeof body.view !== "string" || !VIEWS.has(body.view))
      throw failure(400, "WORKBENCH_INVALID_INPUT", "Invalid application view");
    await new AppActivityService(writer).setView(scope, body.view as AppView);
    return { ok: true };
  }
}
