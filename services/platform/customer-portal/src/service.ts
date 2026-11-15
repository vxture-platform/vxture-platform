/**
 * Transactional portal configuration, immutable review snapshots and publishing.
 * @package @vxture/service-customer-portal
 * @layer Domain
 * @category service
 * @author AI-Generated
 * @date 2026-11-15
 */
import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import {
  DEFAULT_CONFIGURATION,
  parseConfiguration,
  portalHostname,
  type PortalConfiguration,
} from "./configuration";

export interface PortalActor {
  id: string;
  surface: "admin" | "console";
}
export interface PortalVersion {
  id: string;
  version: number;
  configuration: PortalConfiguration;
  status: "pending" | "rejected" | "approved" | "withdrawn";
  note: string;
  reviewNote: string | null;
  submittedAt: string;
  reviewedAt: string | null;
}
export interface PortalRecord {
  id: string;
  tenantId: string;
  hostname: string;
  workspaceId: string;
  selfService: boolean;
  enabled: boolean;
  revision: number;
  draft: PortalConfiguration;
  publishedVersionId: string | null;
  updatedAt: string;
  updatedBy: string;
  updatedSurface: string;
  versions: PortalVersion[];
}
export interface PublishedPortal {
  id: string;
  tenantId: string;
  hostname: string;
  workspaceId: string;
  versionId: string;
  configuration: PortalConfiguration;
}
const PORTAL = `select id, tenant_id as "tenantId", hostname, workspace_id as "workspaceId",
  self_service as "selfService", enabled, revision, draft,
  published_version_id as "publishedVersionId", updated_at as "updatedAt",
  updated_by as "updatedBy", updated_surface as "updatedSurface"
  from tenancy.customer_portals`;
const VERSIONS = `select id, version, configuration, status, note, review_note as "reviewNote",
  submitted_at as "submittedAt", reviewed_at as "reviewedAt"
  from tenancy.customer_portal_versions where portal_id=$1 order by version desc limit 30`;

/** Domain errors are surfaced by each consumer's normal HTTP error boundary. */
export class CustomerPortalService {
  constructor(private readonly pool: Pool) {}

  /** Unmigrated installations have no portal entry; database failures still surface. */
  async selfServiceAvailable(tenantId: string): Promise<boolean> {
    const readiness = await this.pool.query<{ ready: boolean }>(
      `select to_regclass('tenancy.customer_portals') is not null as ready`,
    );
    if (!readiness.rows[0]?.ready) return false;
    const result = await this.pool.query(
      `select 1 from tenancy.customer_portals p
       join tenancy.tenants t on t.id=p.tenant_id
       where p.tenant_id=$1 and p.self_service and t.type='organization'
         and t.status='active' and t.deleted_at is null`,
      [tenantId],
    );
    return Boolean(result.rowCount);
  }

  // ========================================================================
  // Organization binding and platform-only provisioning
  // ========================================================================
  async tenantId(identifier: string): Promise<string> {
    const row = await this.pool.query<{ id: string }>(
      `select id from tenancy.tenants where deleted_at is null and type='organization'
       and (id::text=$1 or tenant_no::text=$1)`,
      [identifier],
    );
    if (!row.rows[0]) throw new NotFoundException("组织不存在");
    return row.rows[0].id;
  }

  async get(
    tenantId: string,
    actor: PortalActor,
  ): Promise<PortalRecord | null> {
    const { rows } = await this.pool.query<PortalRecord>(
      `${PORTAL} where tenant_id=$1`,
      [tenantId],
    );
    const portal = rows[0];
    if (!portal) return null;
    this.assertAccess(portal, actor);
    if (actor.surface === "console")
      await this.assertActiveOrganization(this.pool, tenantId);
    portal.versions = (
      await this.pool.query<PortalVersion>(VERSIONS, [portal.id])
    ).rows;
    return portal;
  }

  async checkHostname(
    tenantId: string,
    prefix: unknown,
    actor: PortalActor,
  ): Promise<{
    status: "invalid" | "available" | "occupied";
    message?: string;
  }> {
    this.assertAdmin(actor);
    let hostname: string;
    try {
      hostname = await this.resolveHostname(this.pool, tenantId, prefix);
    } catch (error) {
      if (error instanceof BadRequestException)
        return { status: "invalid", message: error.message };
      throw error;
    }
    await this.assertActiveOrganization(this.pool, tenantId);
    const occupied = await this.isHostnameOccupied(
      this.pool,
      tenantId,
      hostname,
    );
    return { status: occupied ? "occupied" : "available" };
  }

  private async resolveHostname(
    db: Pool | PoolClient,
    tenantId: string,
    prefix: unknown,
  ) {
    if (prefix !== "a") return portalHostname(prefix);
    const { rows } = await db.query(
      `select 1 from tenancy.tenants t where t.id=$1
       and t.name='如影智能研究院' and t.type='organization'
       and t.status='active' and t.deleted_at is null
       and not exists (select 1 from tenancy.tenants other
         where other.name=t.name and other.id<>t.id and other.deleted_at is null)`,
      [tenantId],
    );
    if (!rows.length)
      throw new BadRequestException(
        "a.ruyin.work 为如影智能研究院的平台专属预留域名",
      );
    return portalHostname(prefix, true);
  }

  private async isHostnameOccupied(
    db: Pool | PoolClient,
    tenantId: string,
    hostname: string,
  ): Promise<boolean> {
    const { rows } = await db.query<{ occupied: boolean; homeUrls: string[] }>(
      `with registered as (
        select w.edge_domain, w.home_url from product.product_webhooks w
        join product.products p on p.id=w.product_id
        where p.deleted_at is null
      ) select exists (
        select 1 from tenancy.customer_portals where hostname=$1 and tenant_id<>$2
      ) or exists (
        select 1 from registered where edge_domain=$1
      ) as occupied,
      array(select distinct home_url from registered where home_url is not null) as "homeUrls"`,
      [hostname, tenantId],
    );
    const { occupied, homeUrls } = rows[0]!;
    return (
      occupied ||
      homeUrls.some((href) => {
        const url = URL.parse(href);
        return (
          (url?.protocol === "https:" || url?.protocol === "http:") &&
          url.hostname.replace(/\.$/, "") === hostname
        );
      })
    );
  }

  private async assertHostnameAvailable(
    db: PoolClient,
    tenantId: string,
    hostname: string,
  ): Promise<void> {
    if (await this.isHostnameOccupied(db, tenantId, hostname))
      throw new ConflictException("该域名已被其他门户或平台产品占用");
  }

  async provision(
    tenantId: string,
    input: unknown,
    actor: PortalActor,
  ): Promise<PortalRecord | null> {
    this.assertAdmin(actor);
    const body = this.object(input);
    const hostname = await this.resolveHostname(
      this.pool,
      tenantId,
      body.prefix,
    );
    if (
      typeof body.workspaceId !== "string" ||
      typeof body.selfService !== "boolean" ||
      typeof body.enabled !== "boolean"
    )
      throw new BadRequestException("请指定工作空间及开通状态");
    await this.transaction(async (db) => {
      await db.query(`select pg_advisory_xact_lock(hashtext($1), 1)`, [
        tenantId,
      ]);
      await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [hostname]);
      await this.resolveHostname(db, tenantId, body.prefix);
      const organization = await db.query(
        `select t.id from tenancy.tenants t
        join tenancy.workspaces w on w.tenant_id=t.id
        where t.id=$1 and t.type='organization' and t.status='active' and t.deleted_at is null
        and w.id::text=$2 and w.status='active' and w.deleted_at is null for share of t,w`,
        [tenantId, body.workspaceId],
      );
      if (!organization.rowCount)
        throw new BadRequestException("请选择该有效组织下的工作空间");
      const existing = (
        await db.query<PortalRecord>(
          `${PORTAL} where tenant_id=$1 for update`,
          [tenantId],
        )
      ).rows[0];
      if (
        existing &&
        (existing.hostname !== hostname ||
          existing.workspaceId !== body.workspaceId)
      )
        throw new ConflictException("首期不支持更换已绑定域名或默认工作空间");
      // Hold the hostname lock through the insert; a disabled binding still owns the name.
      if (!existing || body.enabled)
        await this.assertHostnameAvailable(db, tenantId, hostname);
      await db.query(
        `insert into tenancy.customer_portals
        (tenant_id, hostname, workspace_id, self_service, enabled, draft, updated_by, updated_surface)
        values ($1,$2,$3,$4,$5,$6,$7,'admin')
        on conflict (tenant_id) do update set self_service=excluded.self_service,
        enabled=excluded.enabled, updated_by=excluded.updated_by, updated_surface='admin', updated_at=now()`,
        [
          tenantId,
          hostname,
          body.workspaceId,
          body.selfService,
          body.enabled,
          DEFAULT_CONFIGURATION,
          actor.id,
        ],
      );
      const portal = (
        await db.query<{ id: string }>(
          `select id from tenancy.customer_portals where tenant_id=$1`,
          [tenantId],
        )
      ).rows[0]!;
      await this.audit(db, portal.id, actor, "provision", null);
    });
    return this.get(tenantId, actor);
  }

  // ========================================================================
  // Shared draft, optimistic concurrency and immutable review submission
  // ========================================================================
  async save(tenantId: string, input: unknown, actor: PortalActor) {
    const body = this.object(input);
    const configuration = parseConfiguration(body.configuration);
    await this.withPortal(tenantId, actor, async (db, portal) => {
      this.assertRevision(portal, body.revision);
      await this.assertAssets(db, portal.id, configuration);
      await db.query(
        `update tenancy.customer_portals set draft=$2, revision=revision+1,
        updated_by=$3, updated_surface=$4, updated_at=now() where id=$1`,
        [portal.id, configuration, actor.id, actor.surface],
      );
      await this.audit(db, portal.id, actor, "save", null);
    });
    return this.get(tenantId, actor);
  }

  async submit(tenantId: string, input: unknown, actor: PortalActor) {
    const body = this.object(input);
    const note = this.note(body.note);
    await this.withPortal(tenantId, actor, async (db, portal) => {
      this.assertRevision(portal, body.revision);
      const configuration = parseConfiguration(portal.draft);
      await this.assertAssets(db, portal.id, configuration);
      const pending = await db.query(
        `select 1 from tenancy.customer_portal_versions where portal_id=$1 and status='pending'`,
        [portal.id],
      );
      if (pending.rowCount)
        throw new ConflictException("已有待审核版本，请先撤回或完成审核");
      const result = await db.query<{ id: string }>(
        `insert into tenancy.customer_portal_versions
        (portal_id, version, configuration, note, submitted_by, submitted_surface)
        select $1, coalesce(max(version),0)+1, $2, $3, $4, $5
        from tenancy.customer_portal_versions where portal_id=$1 returning id`,
        [portal.id, configuration, note, actor.id, actor.surface],
      );
      await this.audit(db, portal.id, actor, "submit", result.rows[0]!.id);
    });
    return this.get(tenantId, actor);
  }

  async transition(
    tenantId: string,
    versionId: string,
    input: unknown,
    actor: PortalActor,
  ) {
    const body = this.object(input);
    if (
      !["withdraw", "reject", "approve", "publish"].includes(
        String(body.action),
      )
    )
      throw new BadRequestException("不支持的审核操作");
    const action = String(body.action);
    if (action !== "withdraw") this.assertAdmin(actor);
    const note = action === "reject" ? this.note(body.note) : "";
    await this.withPortal(tenantId, actor, async (db, portal) => {
      const version = (
        await db.query<PortalVersion>(
          `select id,status,configuration from tenancy.customer_portal_versions
        where id::text=$1 and portal_id=$2 for update`,
          [versionId, portal.id],
        )
      ).rows[0];
      if (!version) throw new NotFoundException("配置版本不存在");
      if (action === "publish") {
        if (version.status !== "approved")
          throw new ConflictException("只能发布审核通过的版本");
        await this.assertHostnameAvailable(db, tenantId, portal.hostname);
        await this.assertAssets(
          db,
          portal.id,
          parseConfiguration(version.configuration),
        );
        await db.query(
          `update tenancy.customer_portals set published_version_id=$2 where id=$1`,
          [portal.id, version.id],
        );
      } else {
        if (version.status !== "pending")
          throw new ConflictException("该版本已处理，请刷新页面");
        const status =
          action === "approve"
            ? "approved"
            : action === "reject"
              ? "rejected"
              : "withdrawn";
        await db.query(
          `update tenancy.customer_portal_versions set status=$2, review_note=$3,
          reviewed_by=$4, reviewed_at=now() where id=$1`,
          [version.id, status, note || null, actor.id],
        );
      }
      await this.audit(db, portal.id, actor, action, version.id);
    });
    return this.get(tenantId, actor);
  }

  // ========================================================================
  // Immutable raster assets, scoped previews and public published projection
  // ========================================================================
  async upload(tenantId: string, bytes: Buffer, actor: PortalActor) {
    if (bytes.length < 12 || bytes.length > 2 * 1024 * 1024)
      throw new BadRequestException("图片须小于 2 MB");
    const mime = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "image/png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? "image/jpeg"
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP"
          ? "image/webp"
          : null;
    if (!mime) throw new BadRequestException("仅支持 PNG、JPEG、WebP 图片");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await this.withPortal(tenantId, actor, async (db, portal) => {
      await db.query(
        `insert into tenancy.customer_portal_assets (portal_id,hash,mime,bytes)
        values ($1,$2,$3,$4) on conflict do nothing`,
        [portal.id, hash, mime, bytes],
      );
      await this.audit(db, portal.id, actor, "upload", null);
    });
    return { hash };
  }

  async published(hostname: string): Promise<PublishedPortal> {
    const row = (
      await this.pool.query<PublishedPortal>(
        `select p.id, p.tenant_id as "tenantId", p.hostname,
      p.workspace_id as "workspaceId", v.id as "versionId", v.configuration
      from tenancy.customer_portals p join tenancy.customer_portal_versions v
      on v.portal_id=p.id and v.id=p.published_version_id and v.status='approved'
      join tenancy.tenants t on t.id=p.tenant_id and t.status='active' and t.deleted_at is null
      join tenancy.workspaces w on w.id=p.workspace_id and w.tenant_id=p.tenant_id and w.status='active' and w.deleted_at is null
      where p.hostname=$1 and p.enabled`,
        [hostname],
      )
    ).rows[0];
    if (!row) throw new NotFoundException("门户未开通或暂不可用");
    return row;
  }

  async asset(portalId: string, hash: string) {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new NotFoundException("素材不存在");
    const asset = (
      await this.pool.query<{ mime: string; bytes: Buffer }>(
        `select mime, bytes from tenancy.customer_portal_assets where portal_id=$1 and hash=$2`,
        [portalId, hash],
      )
    ).rows[0];
    if (!asset) throw new NotFoundException("素材不存在");
    return asset;
  }

  /** Branding can organize or hide subscription links, but cannot grant access. */
  async applications(portal: PublishedPortal) {
    const { rows } = await this.pool.query<{
      code: string;
      name: string;
      description: string;
      href: string;
    }>(
      `select distinct p.product_code as code, p.product_name as name,
      coalesce(p.description, '') as description, pw.home_url as href
      from metering.subscriptions s
      join product.plan_components pc on pc.plan_version_id=s.plan_version_id
        and pc.component_role in ('primary', 'bundled')
      join product.products p on p.id=pc.product_id and p.deleted_at is null
        and p.is_customer_visible and p.status='active'
      join product.product_webhooks pw on pw.product_id=p.id and pw.home_url is not null
      where s.workspace_id=$1 and s.tenant_id=$2 and s.deleted_at is null
        and s.status in ('active','trialing','expiring') and s.start_at <= now()
        and (s.end_at is null or s.end_at > now())
        and (s.trial_end_at is null or s.status <> 'trialing' or s.trial_end_at > now())
      order by p.product_code`,
      [portal.workspaceId, portal.tenantId],
    );
    const overrides = new Map(
      portal.configuration.applications.map((item) => [item.code, item]),
    );
    return rows.flatMap((item) => {
      const override = overrides.get(item.code);
      if (override?.hidden) return [];
      try {
        const url = new URL(item.href);
        if (url.protocol !== "https:" || url.username || url.password)
          return [];
        return [
          { ...item, href: url.href, category: override?.group || "组织应用" },
        ];
      } catch {
        return [];
      }
    });
  }

  private assertAdmin(actor: PortalActor): void {
    if (actor.surface !== "admin")
      throw new ForbiddenException("仅平台可执行此操作");
  }
  private assertAccess(portal: PortalRecord, actor: PortalActor): void {
    if (actor.surface === "console" && !portal.selfService)
      throw new ForbiddenException("该组织未获门户配置授权");
  }
  private async assertActiveOrganization(
    db: Pool | PoolClient,
    tenantId: string,
  ) {
    const result = await db.query(
      `select 1 from tenancy.tenants
       where id=$1 and type='organization' and status='active' and deleted_at is null`,
      [tenantId],
    );
    if (!result.rowCount)
      throw new ForbiddenException("该组织当前不可配置门户");
  }
  private assertRevision(portal: PortalRecord, revision: unknown): void {
    if (!Number.isSafeInteger(revision) || portal.revision !== revision)
      throw new ConflictException("配置已更新，请重新载入后保存");
  }
  private object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new BadRequestException("请求格式无效");
    return value as Record<string, unknown>;
  }
  private note(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 1000)
      throw new BadRequestException("请填写不超过 1000 字的说明");
    return value.trim();
  }
  private async assertAssets(
    db: PoolClient,
    portalId: string,
    config: PortalConfiguration,
  ) {
    const hashes = [
      ...new Set(
        [config.logo, config.favicon, config.background].filter(
          (v): v is string => v !== null,
        ),
      ),
    ];
    if (!hashes.length) return;
    const result = await db.query(
      `select hash from tenancy.customer_portal_assets where portal_id=$1 and hash=any($2::text[])`,
      [portalId, hashes],
    );
    if (result.rowCount !== hashes.length)
      throw new BadRequestException("素材不存在或不属于当前组织");
  }
  private async audit(
    db: PoolClient,
    portalId: string,
    actor: PortalActor,
    action: string,
    versionId: string | null,
  ) {
    await db.query(
      `insert into tenancy.customer_portal_events (portal_id,actor_id,surface,action,version_id)
      values ($1,$2,$3,$4,$5)`,
      [portalId, actor.id, actor.surface, action, versionId],
    );
  }
  private async withPortal(
    tenantId: string,
    actor: PortalActor,
    work: (db: PoolClient, portal: PortalRecord) => Promise<void>,
  ) {
    await this.transaction(async (db) => {
      const portal = (
        await db.query<PortalRecord>(
          `${PORTAL} where tenant_id=$1 for update`,
          [tenantId],
        )
      ).rows[0];
      if (!portal) throw new NotFoundException("组织尚未开通门户");
      this.assertAccess(portal, actor);
      if (actor.surface === "console")
        await this.assertActiveOrganization(db, tenantId);
      await work(db, portal);
    });
  }
  private async transaction(work: (db: PoolClient) => Promise<void>) {
    const db = await this.pool.connect();
    try {
      await db.query("begin");
      await work(db);
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        throw new ConflictException("域名已占用或已有待审核版本");
      throw error;
    } finally {
      db.release();
    }
  }
}
