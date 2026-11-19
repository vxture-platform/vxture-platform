/**
 * Tenant-scoped account observations for the confidential Console client.
 * @package @vxture/bff-auth
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-19
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { GovernanceService } from "@vxture/service-organization";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import type { Pool } from "pg";
import { OidcService } from "../oidc/oidc.service";
import { parseSessionStatusCredentials } from "../oidc/session-status";
import { IpGeolocationService } from "../oidc/ip-geolocation.service";
import { RedisService } from "../redis/redis.service";

// ===== Bounded request validation =====
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_SECONDS = 90;
type InsightRequest = {
  sid: string;
  tenantId: string;
  kind: "members" | "audit";
  ids: string[];
};
function parse(body: unknown): InsightRequest {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("invalid_request");
  const r = body as Record<string, unknown>;
  if (
    Object.keys(r).some(
      (k) => !["sid", "tenantId", "kind", "ids"].includes(k),
    ) ||
    typeof r.sid !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(r.sid) ||
    typeof r.tenantId !== "string" ||
    !UUID.test(r.tenantId) ||
    (r.kind !== "members" && r.kind !== "audit") ||
    !Array.isArray(r.ids) ||
    r.ids.length > 100 ||
    r.ids.some((id) => typeof id !== "string" || !UUID.test(id))
  )
    throw new BadRequestException("invalid_request");
  return {
    sid: r.sid,
    tenantId: r.tenantId,
    kind: r.kind,
    ids: [...new Set(r.ids as string[])],
  };
}

// ===== Central authority and tenant-scoped projections =====
@Controller("oidc/console-insights")
export class ConsoleInsightsRouter {
  constructor(
    @Inject(OidcService) private readonly oidc: OidcService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(GovernanceService) private readonly governance: GovernanceService,
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(IpGeolocationService)
    private readonly locations: IpGeolocationService,
  ) {}

  /**
   * Read observations for stored members or audit rows, never arbitrary IPs.
   * @param body Tenant and bounded record identifiers from Console.
   * @param authorization Confidential Console credentials.
   * @returns Tenant-scoped observations without session identifiers.
   * @throws For invalid credentials, expired sessions or missing tenant permissions.
   */
  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  async read(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    const creds = parseSessionStatusCredentials(authorization);
    if (creds.clientId !== "console")
      throw new ForbiddenException("console_client_required");
    const request = parse(body);
    const status = await this.oidc.sessionStatus(creds, {
      sid: request.sid,
      active: request.kind === "members",
    });
    if (!status.valid) throw new UnauthorizedException("invalid_session");
    const session = await this.redis.getOidcSession(request.sid);
    if (
      !session ||
      session.realm !== "customer" ||
      !session.sub.startsWith("usr_")
    )
      throw new UnauthorizedException("invalid_session");
    const permission =
      request.kind === "members" ? "tenant.member.read" : "tenant.audit.read";
    await this.governance.assertCan(
      session.sub.slice(4),
      { orgId: request.tenantId },
      permission,
    );
    if (request.kind === "audit") {
      const rows = await this.pool.query<{
        id: string;
        ip_address: string | null;
      }>(
        `select id, ip_address from support.audit_logs where tenant_id = $1 and id = any($2::uuid[]) and created_at >= now() - interval '90 days'`,
        [request.tenantId, request.ids],
      );
      return {
        items: await Promise.all(
          rows.rows.map(async (r) => ({
            id: r.id,
            location: await this.locations.locate(r.ip_address),
          })),
        ),
      };
    }
    const members = await this.pool.query<{
      user_id: string;
      session_ids: string[];
    }>(
      `select m.user_id, array(select r.session_id::text from session.refresh_tokens r
          where r.user_id = m.user_id and r.expires_at > now()
          group by r.session_id order by max(r.created_at) desc, r.session_id limit 21) as session_ids
       from tenancy.tenant_memberships m where m.tenant_id = $1 and m.user_id = any($2::uuid[]) and m.status <> 'removed'`,
      [request.tenantId, request.ids],
    );
    // Refresh rows only supply candidates, including rotated/revoked chains.
    // Only the live central session can establish recent foreground activity.
    const candidates = members.rows.map((row) => ({
      userId: row.user_id,
      // The authenticated actor's session is authoritative even when historical
      // refresh chains have filled the bounded candidate window.
      sessionIds:
        session.sub === `usr_${row.user_id}`
          ? [...new Set([request.sid, ...row.session_ids])]
          : row.session_ids,
    }));
    const items = await this.redis.customerPresence(candidates).catch(() =>
      candidates.map((row) => ({
        id: row.userId,
        presence: "unknown" as const,
      })),
    );
    return { items, activeWithinSeconds: ACTIVE_SECONDS };
  }
}
