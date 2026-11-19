/**
 * Read the calling product's live authorized identities in its ticket workspace.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-19
 */
import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Logger,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
// ⚠️ Cross-layer reference: the domain service owns application eligibility.
import { ProductSeatService } from "@vxture/service-subscription";
import { ProductRosterGuard } from "../authn/product-roster.guard";
import { S2sCaller, type S2sCallerCtx } from "../authn/s2s-caller";

// ============================================================================
// Ticket-bound pagination
// ============================================================================
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECT =
  /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
interface Cursor {
  v: 1;
  org: string;
  workspace: string;
  product: string;
  version: string;
  after: string;
}
function invalidQuery(): never {
  throw new BadRequestException({
    code: "PRODUCT_ROSTER_QUERY_INVALID",
    message: "Only a valid cursor and limit (1..200) are supported.",
    retryable: false,
  });
}
function parseQuery(query: Record<string, unknown>, caller: S2sCallerCtx) {
  if (Object.keys(query).some((key) => key !== "cursor" && key !== "limit"))
    invalidQuery();
  const rawLimit = query["limit"];
  if (
    rawLimit !== undefined &&
    (typeof rawLimit !== "string" || !/^[1-9]\d{0,2}$/.test(rawLimit))
  )
    invalidQuery();
  const limit = rawLimit === undefined ? 100 : Number(rawLimit);
  if (limit > 200) invalidQuery();
  const raw = query["cursor"];
  if (raw === undefined) return { limit, cursor: null };
  try {
    if (
      typeof raw !== "string" ||
      raw.length > 1024 ||
      !/^[A-Za-z0-9_-]+$/.test(raw)
    )
      throw Error();
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw Error();
    const cursor = JSON.parse(bytes.toString("utf8")) as Partial<Cursor> | null;
    if (
      !cursor ||
      Array.isArray(cursor) ||
      Object.keys(cursor).length !== 6 ||
      cursor.v !== 1 ||
      cursor.org !== caller.orgId ||
      cursor.workspace !== caller.workspaceId ||
      cursor.product !== caller.productCode ||
      typeof cursor.version !== "string" ||
      !/^[0-9a-f]{32}$/.test(cursor.version) ||
      typeof cursor.after !== "string" ||
      !SUBJECT.test(cursor.after)
    )
      throw Error();
    return { limit, cursor: cursor as Cursor };
  } catch {
    throw new BadRequestException({
      code: "PRODUCT_ROSTER_CURSOR_INVALID",
      message: "Cursor is invalid for this organization, workspace or product.",
      retryable: false,
    });
  }
}

// ============================================================================
// Read-only product endpoint
// ============================================================================
@Controller("platform/product-roster")
@UseGuards(ProductRosterGuard)
export class PlatformProductRosterRouter {
  private readonly logger = new Logger(PlatformProductRosterRouter.name);
  constructor(
    @Inject(ProductSeatService) private readonly seats: ProductSeatService,
  ) {}

  /**
   * Read a fresh, bounded roster; product servers enforce their own manager role.
   * @param query - Only optional cursor and limit; no identity selectors.
   * @param caller - Verified product ticket, never a Console cookie or shared key.
   * @returns Minimal OIDC subjects and display names with scope and revision.
   * @throws ForbiddenException For unbound tickets or a revoked OBO reader.
   * @throws BadRequestException For invalid query or foreign cursors.
   * @throws ConflictException When the roster changed between pages.
   * @throws ServiceUnavailableException When the authority cannot be read.
   */
  @Get()
  @Header("Cache-Control", "private, no-store")
  async list(
    @Query() query: Record<string, unknown>,
    @S2sCaller() caller: S2sCallerCtx | undefined,
  ) {
    if (
      !caller ||
      caller.delegated ||
      !caller.orgId ||
      !UUID.test(caller.orgId) ||
      !caller.workspaceId ||
      !UUID.test(caller.workspaceId) ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(caller.productCode) ||
      (caller.mode !== "obo" && caller.mode !== "service") ||
      (caller.mode === "obo" &&
        (!caller.subject || !SUBJECT.test(caller.subject))) ||
      (caller.mode === "service" && caller.subject != null)
    ) {
      throw new ForbiddenException({
        code: "PRODUCT_ROSTER_TICKET_REQUIRED",
        message:
          "A workspace-bound product service or user OBO ticket is required.",
        retryable: false,
      });
    }
    const { limit, cursor } = parseQuery(query, caller);
    const page = await this.seats
      .listAuthorizedUsers(
        {
          orgId: caller.orgId,
          workspaceId: caller.workspaceId,
          productCode: caller.productCode,
          ...(caller.mode === "obo"
            ? { requesterSubject: caller.subject }
            : {}),
        },
        cursor?.after ?? null,
        limit,
      )
      .catch(() => {
        this.logger.error("Product roster authority read failed");
        throw new ServiceUnavailableException({
          code: "PRODUCT_ROSTER_UNAVAILABLE",
          message: "Authorized users could not be read. Retry the request.",
          retryable: true,
        });
      });
    if (!page)
      throw new ForbiddenException({
        code: "PRODUCT_ROSTER_ACCESS_DENIED",
        message: "The requesting user no longer has product access.",
        retryable: false,
      });
    if (cursor && cursor.version !== page.version)
      throw new ConflictException({
        code: "PRODUCT_ROSTER_CHANGED",
        message: "The roster changed. Restart from the first page.",
        retryable: true,
      });
    const last = page.items.at(-1);
    const next: Cursor | null =
      page.hasMore && last
        ? {
            v: 1,
            org: caller.orgId,
            workspace: caller.workspaceId,
            product: caller.productCode,
            version: page.version,
            after: last.subject,
          }
        : null;
    return {
      org_id: caller.orgId,
      workspace_id: caller.workspaceId,
      product: caller.productCode,
      authorization_mode: "assigned_seats",
      version: page.version,
      items: page.items.map((item) => ({
        subject: item.subject,
        display_name: item.displayName,
        eligible: true,
      })),
      nextCursor: next
        ? Buffer.from(JSON.stringify(next)).toString("base64url")
        : null,
    };
  }
}
