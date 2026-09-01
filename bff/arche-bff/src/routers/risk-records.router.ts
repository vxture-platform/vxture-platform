/**
 * risk-records.router.ts - 租户风险评估路由
 * @package @vxture/bff-arche
 *
 * Description: admin.risk_records 读写（TD-021）。设计权威 =
 *   docs/product/platform/admin/governance-write-paths.md §3.1/§4。
 *   「审阅」= 写 reviewer_id（与 openRiskCount 未处置语义一致）；risk_level
 *   任何变更清空 reviewer_id（重新待处置，防升险被静默吞掉）。所有写 =
 *   事务 + 事务内审计（audit-log.ts 约定）。
 *
 * @author AI-Generated
 * @date 2026-07-05
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
  Delete,
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
import type { RiskRecordItem } from "../types/governance.types";
import {
  GOVERNANCE_LIST_LIMIT,
  normalizeStringArray,
  requireOperatorId,
  requireText,
  requireUuid,
  toIso,
} from "./governance.shared";

const RISK_LEVELS: ReadonlySet<RiskRecordItem["riskLevel"]> = new Set([
  "normal",
  "follow_up",
  "high",
]);

@Controller("api/risk-records")
export class RiskRecordsRouter {
  constructor(
    @Inject(ARCHE_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ARCHE_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  // Contract: GET /api/risk-records?tenantId=&riskLevel=a,b&reviewed=true|false&tag=
  //   Most-recent LIST_LIMIT non-deleted rows, optionally filtered server-side.
  @Get()
  async listRiskRecords(
    @Req() req: Request & RequestContext,
    @Query("tenantId") tenantId?: string,
    @Query("riskLevel") riskLevel?: string,
    @Query("reviewed") reviewed?: string,
    @Query("tag") tag?: string,
  ): Promise<RiskRecordItem[]> {
    assertCanReadRiskRecords(req);

    const where: string[] = ["r.deleted_at is null"];
    const params: unknown[] = [];
    if (tenantId) {
      params.push(requireUuid(tenantId, "Invalid tenantId filter"));
      where.push(`r.tenant_id = $${params.length}`);
    }
    if (riskLevel) {
      const levels = riskLevel.split(",").map((v) => v.trim());
      for (const level of levels) {
        if (!RISK_LEVELS.has(level as RiskRecordItem["riskLevel"])) {
          throw new BadRequestException(
            "riskLevel must be of normal/follow_up/high",
          );
        }
      }
      params.push(levels);
      where.push(`r.risk_level = any($${params.length}::varchar[])`);
    }
    if (reviewed === "true") {
      where.push("r.reviewer_id is not null");
    } else if (reviewed === "false") {
      where.push("r.reviewer_id is null");
    } else if (reviewed !== undefined && reviewed !== "") {
      throw new BadRequestException("reviewed must be true or false");
    }
    if (tag) {
      params.push(tag.trim());
      where.push(`$${params.length} = any(r.tags)`);
    }
    params.push(GOVERNANCE_LIST_LIMIT);

    const { rows } = await this.pool.query<RiskRecordRow>(
      `${RISK_RECORD_SELECT} where ${where.join(" and ")}
       order by r.created_at desc limit $${params.length}`,
      params,
    );
    return rows.map(mapRiskRecordRow);
  }

  @Get(":id")
  async getRiskRecord(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<RiskRecordItem> {
    assertCanReadRiskRecords(req);
    const recordId = requireUuid(id, "Invalid risk record id");
    const { rows } = await this.pool.query<RiskRecordRow>(
      `${RISK_RECORD_SELECT} where r.id = $1 and r.deleted_at is null`,
      [recordId],
    );
    if (!rows[0]) {
      throw new NotFoundException("Risk record not found");
    }
    return mapRiskRecordRow(rows[0]);
  }

  // Contract: POST /api/risk-records
  //   body: { tenantId: uuid (must exist in tenancy.tenants, soft-deleted rows
  //           accepted — governance records outlive tenant closure, boundary #3),
  //           reason: string, riskLevel?: enum, riskScore?: 0-100, scope?: string,
  //           tags?: string[] }. source_table/source_id stay NULL (GQ7, manual entry).
  @Post()
  async createRiskRecord(
    @Req() req: Request & RequestContext,
    @Body() body: RiskRecordWriteBody,
  ): Promise<RiskRecordItem> {
    assertCanManageRiskRecords(req);
    requireOperatorId(req);
    const input = normalizeRiskRecordInput(body, { requireTenant: true });

    return withTransaction(this.rwPool, async (client) => {
      const tenant = await client.query(
        `select 1 from tenancy.tenants where id = $1`,
        [input.tenantId],
      );
      if (tenant.rowCount === 0) {
        throw new BadRequestException("tenantId does not reference a tenant");
      }
      const { rows } = await client.query<{ id: string }>(
        RISK_RECORD_INSERT_SQL,
        [
          input.tenantId,
          input.riskLevel,
          input.riskScore,
          input.scope,
          input.reason,
          input.tags,
        ],
      );
      const created = rows[0];
      if (!created) {
        throw new BadRequestException("Risk record insert returned no row");
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.risk.create",
        resourceType: "risk_record",
        resourceId: created.id,
        after: {
          tenantId: input.tenantId,
          riskLevel: input.riskLevel,
          riskScore: input.riskScore,
        },
      });
      return this.fetchRiskRecord(client, created.id);
    });
  }

  // Contract: PUT /api/risk-records/:id
  //   body: { reason, riskLevel?, riskScore?, scope?, tags? } — tenant_id is
  //   immutable app-side. Changing risk_level clears reviewer_id (re-enters the
  //   open-risk pool; see design GQ3).
  @Put(":id")
  async updateRiskRecord(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: RiskRecordWriteBody,
  ): Promise<RiskRecordItem> {
    assertCanManageRiskRecords(req);
    requireOperatorId(req);
    const recordId = requireUuid(id, "Invalid risk record id");
    const input = normalizeRiskRecordInput(body, { requireTenant: false });

    return withTransaction(this.rwPool, async (client) => {
      const before = await client.query<RiskRecordBeforeRow>(
        `select risk_level, risk_score, reviewer_id from admin.risk_records
         where id = $1 and deleted_at is null for update`,
        [recordId],
      );
      if (!before.rows[0]) {
        throw new NotFoundException("Risk record not found");
      }
      await client.query(RISK_RECORD_UPDATE_SQL, [
        recordId,
        input.riskLevel,
        input.riskScore,
        input.scope,
        input.reason,
        input.tags,
      ]);
      await insertOperatorAuditLog(client, req, {
        action: "governance.risk.update",
        resourceType: "risk_record",
        resourceId: recordId,
        before: {
          riskLevel: before.rows[0].risk_level,
          riskScore: before.rows[0].risk_score,
          reviewerId: before.rows[0].reviewer_id,
        },
        after: { riskLevel: input.riskLevel, riskScore: input.riskScore },
      });
      return this.fetchRiskRecord(client, recordId);
    });
  }

  // Contract: POST /api/risk-records/:id/review → reviewer_id = acting operator
  //   (idempotent overwrite; review time lives in the audit trail — no column).
  @Post(":id/review")
  async reviewRiskRecord(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<RiskRecordItem> {
    assertCanManageRiskRecords(req);
    const reviewerId = requireOperatorId(req);
    const recordId = requireUuid(id, "Invalid risk record id");

    return withTransaction(this.rwPool, async (client) => {
      const { rowCount } = await client.query(
        `update admin.risk_records
         set reviewer_id = $2, updated_at = now()
         where id = $1 and deleted_at is null`,
        [recordId, reviewerId],
      );
      if (rowCount === 0) {
        throw new NotFoundException("Risk record not found");
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.risk.review",
        resourceType: "risk_record",
        resourceId: recordId,
        after: { reviewerId },
      });
      return this.fetchRiskRecord(client, recordId);
    });
  }

  // Contract: DELETE /api/risk-records/:id → soft delete.
  @Delete(":id")
  async deleteRiskRecord(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{ id: string; status: "deleted" }> {
    assertCanManageRiskRecords(req);
    requireOperatorId(req);
    const recordId = requireUuid(id, "Invalid risk record id");

    return withTransaction(this.rwPool, async (client) => {
      const { rowCount } = await client.query(
        `update admin.risk_records
         set deleted_at = now(), updated_at = now()
         where id = $1 and deleted_at is null`,
        [recordId],
      );
      if (rowCount === 0) {
        throw new NotFoundException("Risk record not found");
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.risk.delete",
        resourceType: "risk_record",
        resourceId: recordId,
      });
      return { id: recordId, status: "deleted" };
    });
  }

  private async fetchRiskRecord(
    db: Pick<Pool, "query">,
    id: string,
  ): Promise<RiskRecordItem> {
    const { rows } = await db.query<RiskRecordRow>(
      `${RISK_RECORD_SELECT} where r.id = $1`,
      [id],
    );
    if (!rows[0]) {
      throw new NotFoundException("Risk record not found");
    }
    return mapRiskRecordRow(rows[0]);
  }
}

// tenancy.tenants / operator_account joins are display-only (no cross-schema FK,
// boundary #3) — LEFT JOIN so records survive tenant purge / operator removal.
const RISK_RECORD_SELECT = `
select
  r.id,
  r.tenant_id,
  t.name       as tenant_name,
  t.tenant_no::text as tenant_no,
  r.risk_level,
  r.risk_score,
  r.scope,
  r.reason,
  r.reviewer_id,
  coalesce(nullif(o.display_name, ''), o.username) as reviewer_name,
  r.tags,
  r.created_at,
  r.updated_at
from admin.risk_records r
left join tenancy.tenants t on t.id = r.tenant_id
left join admin.operator_account o on o.id = r.reviewer_id
`;

const RISK_RECORD_INSERT_SQL = `
insert into admin.risk_records
  (tenant_id, risk_level, risk_score, scope, reason, tags)
values
  ($1, $2, $3, $4, $5, $6::text[])
returning id
`;

// risk_level change clears reviewer_id in the same statement (design §3.1):
// an already-reviewed record whose level is edited re-enters openRiskCount.
const RISK_RECORD_UPDATE_SQL = `
update admin.risk_records
set reviewer_id = case when risk_level is distinct from $2::varchar then null else reviewer_id end,
    risk_level  = $2,
    risk_score  = $3,
    scope       = $4,
    reason      = $5,
    tags        = $6::text[],
    updated_at  = now()
where id = $1 and deleted_at is null
`;

interface RiskRecordRow {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  tenant_no: string | null;
  risk_level: RiskRecordItem["riskLevel"];
  risk_score: number | null;
  scope: string | null;
  reason: string;
  reviewer_id: string | null;
  reviewer_name: string | null;
  tags: string[] | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RiskRecordBeforeRow {
  risk_level: string;
  risk_score: number | null;
  reviewer_id: string | null;
}

interface RiskRecordWriteBody {
  tenantId?: unknown;
  riskLevel?: unknown;
  riskScore?: unknown;
  scope?: unknown;
  reason?: unknown;
  tags?: unknown;
}

interface NormalizedRiskRecordInput {
  tenantId: string;
  riskLevel: RiskRecordItem["riskLevel"];
  riskScore: number | null;
  scope: string | null;
  reason: string;
  tags: string[];
}

function mapRiskRecordRow(row: RiskRecordRow): RiskRecordItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantNo: row.tenant_no,
    riskLevel: row.risk_level,
    riskScore: row.risk_score,
    scope: row.scope,
    reason: row.reason,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    tags: row.tags ?? [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function normalizeRiskRecordInput(
  body: RiskRecordWriteBody,
  opts: { requireTenant: boolean },
): NormalizedRiskRecordInput {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body is required");
  }
  const tenantId = opts.requireTenant
    ? requireUuid(
        typeof body.tenantId === "string" ? body.tenantId : undefined,
        "tenantId is required (uuid)",
      )
    : "";
  const riskLevel =
    body.riskLevel === undefined || body.riskLevel === null
      ? "normal"
      : typeof body.riskLevel === "string" &&
          RISK_LEVELS.has(body.riskLevel as RiskRecordItem["riskLevel"])
        ? (body.riskLevel as RiskRecordItem["riskLevel"])
        : (() => {
            throw new BadRequestException(
              "riskLevel must be one of normal/follow_up/high",
            );
          })();
  let riskScore: number | null = null;
  if (body.riskScore !== undefined && body.riskScore !== null) {
    // App-level 0-100 convention (design GQ8; DDL has no CHECK).
    if (
      typeof body.riskScore !== "number" ||
      !Number.isInteger(body.riskScore) ||
      body.riskScore < 0 ||
      body.riskScore > 100
    ) {
      throw new BadRequestException("riskScore must be an integer 0-100");
    }
    riskScore = body.riskScore;
  }
  const scope =
    body.scope === undefined || body.scope === null || body.scope === ""
      ? null
      : requireText(body.scope, "scope", 160);
  return {
    tenantId,
    riskLevel,
    riskScore,
    scope,
    reason: requireText(body.reason, "reason", 10000),
    tags: normalizeStringArray(body.tags, "tags"),
  };
}

// ── capability guards（能力码见 governance-write-paths.md §4.3 / seed-catalog）──

function assertCanReadRiskRecords(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (
    !req.capabilities ||
    (!req.capabilities.includes("tenant:risk.read") &&
      !req.capabilities.includes("tenant:risk.manage"))
  ) {
    throw new ForbiddenException("Missing tenant:risk.read capability");
  }
}

function assertCanManageRiskRecords(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities || !req.capabilities.includes("tenant:risk.manage")) {
    throw new ForbiddenException("Missing tenant:risk.manage capability");
  }
}
