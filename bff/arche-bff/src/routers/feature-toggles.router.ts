/**
 * feature-toggles.router.ts - 功能开关路由（admin.feature_flags）
 * @package @vxture/bff-arche
 *
 * Description: 平台功能开关读写（P2 占位板块建设）。接 admin.feature_flags（80_admin.sql）。
 *   全局开关(is_globally_enabled) + 灰度百分比(rollout_percentage 0-100) + 逐租户覆盖
 *   (tenant_overrides jsonb {tenant_id: bool}，命中优先于 rollout) + 归档(is_archived)。
 *   flag_key 是自然键(唯一)，创建后不可改(锚点)；写路径事务 + 事务内审计。
 *   能力守卫：读 release:feature_flag.read|.manage，写 release:feature_flag.manage（seed §4.3）。
 *
 * @author AI-Generated
 * @date 2026-07-11
 * @version 1.0
 *
 * @copyright Vxture Team
 *
 * @layer Application
 * @category Router
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { withTransaction } from "../db/tx";
import { ARCHE_BFF_RO_POOL, ARCHE_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import type { FeatureFlagRecord } from "../types/governance.types";
import {
  GOVERNANCE_LIST_LIMIT,
  optionalText,
  parseIso,
  requireOperatorId,
  requireText,
  requireUuid,
  toIso,
  toIsoOrNull,
} from "./governance.shared";

const FLAG_KEY_RE = /^[a-z0-9][a-z0-9._-]*$/i;

@Controller("api/feature-toggles")
export class FeatureTogglesRouter {
  constructor(
    @Inject(ARCHE_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ARCHE_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  // Contract: GET /api/feature-toggles?category=&environment=&archived=true|false
  //   archived omitted → active only (is_archived=false); most-recent LIMIT rows.
  @Get()
  async listFeatureFlags(
    @Req() req: Request & RequestContext,
    @Query("category") category?: string,
    @Query("environment") environment?: string,
    @Query("archived") archived?: string,
  ): Promise<FeatureFlagRecord[]> {
    assertCanReadFeatureFlags(req);

    const where: string[] = ["true"];
    const params: unknown[] = [];
    if (archived === "true") {
      where.push("f.is_archived = true");
    } else if (archived === "false" || archived === undefined) {
      where.push("f.is_archived = false");
    } else if (archived !== "all") {
      throw new BadRequestException("archived must be true/false/all");
    }
    if (category) {
      params.push(category);
      where.push(`f.category = $${params.length}`);
    }
    if (environment) {
      params.push(environment);
      where.push(`f.environment = $${params.length}`);
    }
    params.push(GOVERNANCE_LIST_LIMIT);

    const { rows } = await this.pool.query<FeatureFlagRow>(
      `${FEATURE_FLAG_SELECT} where ${where.join(" and ")}
       order by f.created_at desc limit $${params.length}`,
      params,
    );
    return rows.map(mapFeatureFlagRow);
  }

  @Get(":id")
  async getFeatureFlag(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<FeatureFlagRecord> {
    assertCanReadFeatureFlags(req);
    const flagId = requireUuid(id, "Invalid feature flag id");
    const { rows } = await this.pool.query<FeatureFlagRow>(
      `${FEATURE_FLAG_SELECT} where f.id = $1`,
      [flagId],
    );
    if (!rows[0]) {
      throw new NotFoundException("Feature flag not found");
    }
    return mapFeatureFlagRow(rows[0]);
  }

  // Contract: POST /api/feature-toggles
  //   body: { flagKey: string(<=128, [a-z0-9._-]), category?: string(<=64),
  //           environment?: string(<=32), description?: string(<=512),
  //           rolloutPercentage?: 0-100, tenantOverrides?: {uuid: bool},
  //           expiresAt?: ISO|null }. is_globally_enabled/is_archived start false.
  @Post()
  async createFeatureFlag(
    @Req() req: Request & RequestContext,
    @Body() body: FeatureFlagWriteBody,
  ): Promise<FeatureFlagRecord> {
    assertCanManageFeatureFlags(req);
    const createdBy = requireOperatorId(req);
    const input = normalizeCreateInput(body);

    return withTransaction(this.rwPool, async (client) => {
      let created: { id: string };
      try {
        const { rows } = await client.query<{ id: string }>(
          FEATURE_FLAG_INSERT_SQL,
          [
            input.flagKey,
            input.category,
            input.environment,
            input.description,
            input.rolloutPercentage,
            JSON.stringify(input.tenantOverrides),
            input.expiresAt,
            createdBy,
          ],
        );
        if (!rows[0]) {
          throw new BadRequestException("Feature flag insert returned no row");
        }
        created = rows[0];
      } catch (error) {
        throw translateFlagWriteError(error);
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.feature_flag.create",
        resourceType: "feature_flag",
        resourceId: created.id,
        after: { flagKey: input.flagKey, category: input.category },
      });
      return this.fetchFlag(client, created.id);
    });
  }

  // Contract: PUT /api/feature-toggles/:id — edit mutable fields (NOT flag_key,
  //   the natural key/anchor; NOT is_globally_enabled/is_archived — use actions).
  @Put(":id")
  async updateFeatureFlag(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: FeatureFlagWriteBody,
  ): Promise<FeatureFlagRecord> {
    assertCanManageFeatureFlags(req);
    const updatedBy = requireOperatorId(req);
    const flagId = requireUuid(id, "Invalid feature flag id");
    const input = normalizeUpdateInput(body);

    return withTransaction(this.rwPool, async (client) => {
      const { rowCount } = await client.query(FEATURE_FLAG_UPDATE_SQL, [
        flagId,
        input.category,
        input.environment,
        input.description,
        input.rolloutPercentage,
        JSON.stringify(input.tenantOverrides),
        input.expiresAt,
        updatedBy,
      ]);
      if (!rowCount) {
        throw new NotFoundException("Feature flag not found");
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.feature_flag.update",
        resourceType: "feature_flag",
        resourceId: flagId,
        after: {
          category: input.category,
          rolloutPercentage: input.rolloutPercentage,
        },
      });
      return this.fetchFlag(client, flagId);
    });
  }

  // Contract: POST /api/feature-toggles/:id/toggle — flip is_globally_enabled.
  @Post(":id/toggle")
  async toggleFeatureFlag(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<FeatureFlagRecord> {
    assertCanManageFeatureFlags(req);
    const updatedBy = requireOperatorId(req);
    const flagId = requireUuid(id, "Invalid feature flag id");

    return withTransaction(this.rwPool, async (client) => {
      const { rows } = await client.query<{ is_globally_enabled: boolean }>(
        `update admin.feature_flags
           set is_globally_enabled = not is_globally_enabled,
               updated_by = $2, updated_at = now()
         where id = $1
         returning is_globally_enabled`,
        [flagId, updatedBy],
      );
      if (!rows[0]) {
        throw new NotFoundException("Feature flag not found");
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.feature_flag.toggle",
        resourceType: "feature_flag",
        resourceId: flagId,
        after: { isGloballyEnabled: rows[0].is_globally_enabled },
      });
      return this.fetchFlag(client, flagId);
    });
  }

  // Contract: POST /api/feature-toggles/:id/archive — body { archived?: boolean }
  //   (default true). Retire/restore a flag without deleting the row.
  @Post(":id/archive")
  async archiveFeatureFlag(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { archived?: unknown },
  ): Promise<FeatureFlagRecord> {
    assertCanManageFeatureFlags(req);
    const updatedBy = requireOperatorId(req);
    const flagId = requireUuid(id, "Invalid feature flag id");
    const archived =
      body?.archived === undefined
        ? true
        : parseBool(body.archived, "archived");

    return withTransaction(this.rwPool, async (client) => {
      const { rowCount } = await client.query(
        `update admin.feature_flags
           set is_archived = $2, updated_by = $3, updated_at = now()
         where id = $1`,
        [flagId, archived, updatedBy],
      );
      if (!rowCount) {
        throw new NotFoundException("Feature flag not found");
      }
      await insertOperatorAuditLog(client, req, {
        action: archived
          ? "governance.feature_flag.archive"
          : "governance.feature_flag.restore",
        resourceType: "feature_flag",
        resourceId: flagId,
        after: { isArchived: archived },
      });
      return this.fetchFlag(client, flagId);
    });
  }

  private async fetchFlag(
    db: Pool | { query: Pool["query"] },
    flagId: string,
  ): Promise<FeatureFlagRecord> {
    const { rows } = await db.query<FeatureFlagRow>(
      `${FEATURE_FLAG_SELECT} where f.id = $1`,
      [flagId],
    );
    if (!rows[0]) {
      throw new NotFoundException("Feature flag not found");
    }
    return mapFeatureFlagRow(rows[0]);
  }
}

// ── guards ──────────────────────────────────────────────────────────────────

function assertCanReadFeatureFlags(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (
    !req.capabilities ||
    (!req.capabilities.includes("release:feature_flag.read") &&
      !req.capabilities.includes("release:feature_flag.manage"))
  ) {
    throw new ForbiddenException(
      "Missing release:feature_flag.read capability",
    );
  }
}

function assertCanManageFeatureFlags(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (
    !req.capabilities ||
    !req.capabilities.includes("release:feature_flag.manage")
  ) {
    throw new ForbiddenException(
      "Missing release:feature_flag.manage capability",
    );
  }
}

// ── input normalization ───────────────────────────────────────────────────────

interface FeatureFlagWriteBody {
  flagKey?: unknown;
  category?: unknown;
  environment?: unknown;
  description?: unknown;
  rolloutPercentage?: unknown;
  tenantOverrides?: unknown;
  expiresAt?: unknown;
}

interface NormalizedFlagInput {
  category: string;
  environment: string;
  description: string | null;
  rolloutPercentage: number;
  tenantOverrides: Record<string, boolean>;
  expiresAt: string | null;
}

function normalizeMutable(body: FeatureFlagWriteBody): NormalizedFlagInput {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body is required");
  }
  const category =
    body.category === undefined ||
    body.category === null ||
    body.category === ""
      ? "release"
      : requireText(body.category, "category", 64);
  const environment =
    body.environment === undefined ||
    body.environment === null ||
    body.environment === ""
      ? "all"
      : requireText(body.environment, "environment", 32);
  const expiresAt =
    body.expiresAt === undefined ||
    body.expiresAt === null ||
    body.expiresAt === ""
      ? null
      : parseIso(body.expiresAt, "expiresAt");
  return {
    category,
    environment,
    description: optionalText(body.description, "description", 512),
    rolloutPercentage: parseRolloutPercentage(body.rolloutPercentage),
    tenantOverrides: parseTenantOverrides(body.tenantOverrides),
    expiresAt,
  };
}

function normalizeCreateInput(
  body: FeatureFlagWriteBody,
): NormalizedFlagInput & { flagKey: string } {
  const flagKey = requireText(body?.flagKey, "flagKey", 128);
  if (!FLAG_KEY_RE.test(flagKey)) {
    throw new BadRequestException(
      "flagKey must be alphanumeric with . _ - separators",
    );
  }
  return { flagKey, ...normalizeMutable(body) };
}

function normalizeUpdateInput(body: FeatureFlagWriteBody): NormalizedFlagInput {
  return normalizeMutable(body);
}

function parseRolloutPercentage(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new BadRequestException("rolloutPercentage must be an integer 0-100");
  }
  return n;
}

function parseBool(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new BadRequestException(`${field} must be a boolean`);
}

// {uuid: boolean} — tenant id keys, boolean values; caps at 1000 entries.
function parseTenantOverrides(value: unknown): Record<string, boolean> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(
      "tenantOverrides must be an object of {tenantId: boolean}",
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 1000) {
    throw new BadRequestException("tenantOverrides exceeds 1000 entries");
  }
  const out: Record<string, boolean> = {};
  for (const [key, val] of entries) {
    requireUuid(key, "tenantOverrides key must be a tenant uuid");
    out[key] = parseBool(val, `tenantOverrides[${key}]`);
  }
  return out;
}

function translateFlagWriteError(error: unknown): Error {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : undefined;
  if (code === "23505") {
    return new BadRequestException("flagKey already exists");
  }
  return error instanceof Error ? error : new Error(String(error));
}

// ── SQL + mapping ─────────────────────────────────────────────────────────────

const FEATURE_FLAG_SELECT = `
select
  f.id,
  f.flag_key,
  f.category,
  f.environment,
  f.description,
  f.is_globally_enabled,
  f.is_archived,
  f.rollout_percentage,
  f.tenant_overrides,
  f.expires_at,
  f.created_at,
  f.updated_at
from admin.feature_flags f
`;

const FEATURE_FLAG_INSERT_SQL = `
insert into admin.feature_flags
  (flag_key, category, environment, description, is_globally_enabled, is_archived,
   rollout_percentage, tenant_overrides, expires_at, created_by, updated_by)
values
  ($1, $2, $3, $4, false, false, $5, $6::jsonb, $7, $8, $8)
returning id
`;

const FEATURE_FLAG_UPDATE_SQL = `
update admin.feature_flags
set category           = $2,
    environment        = $3,
    description        = $4,
    rollout_percentage = $5,
    tenant_overrides   = $6::jsonb,
    expires_at         = $7,
    updated_by         = $8,
    updated_at         = now()
where id = $1
`;

interface FeatureFlagRow {
  id: string;
  flag_key: string;
  category: string;
  environment: string;
  description: string | null;
  is_globally_enabled: boolean;
  is_archived: boolean;
  rollout_percentage: number;
  tenant_overrides: Record<string, boolean> | null;
  expires_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

function mapFeatureFlagRow(row: FeatureFlagRow): FeatureFlagRecord {
  return {
    id: row.id,
    flagKey: row.flag_key,
    category: row.category,
    environment: row.environment,
    description: row.description,
    isGloballyEnabled: row.is_globally_enabled,
    isArchived: row.is_archived,
    rolloutPercentage: Number(row.rollout_percentage ?? 0),
    tenantOverrides: row.tenant_overrides ?? {},
    expiresAt: toIsoOrNull(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
