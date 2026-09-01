/**
 * system-parameters.router.ts - 平台配置路由（admin.settings）
 * @package @vxture/bff-arche
 *
 * Description: 平台运行时配置读写（P2 占位板块建设）。接 admin.settings（80_admin.sql）。
 *   读：is_sensitive/is_encrypted 值脱敏（'••••••'）。编辑：仅非 is_sensitive、非 is_encrypted、
 *   非 is_readonly 的行可经本板块改值（is_encrypted 走 secret manager；is_readonly 业务禁改；
 *   is_sensitive 属安全邻接留待专用流）。config_key/group/type 为定义元数据，本板块不改。
 *   写路径事务 + 事务内审计。守卫：读 platform:setting.read，写 platform:setting.manage（seed §4.3）。
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
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
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
import type { PlatformSettingRecord } from "../types/governance.types";
import { requireOperatorId, requireUuid, toIso } from "./governance.shared";

const MASK = "••••••";

@Controller("api/system-parameters")
export class SystemParametersRouter {
  constructor(
    @Inject(ARCHE_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ARCHE_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  // Contract: GET /api/system-parameters?group=&search=
  //   sensitive/encrypted values masked in the response.
  @Get()
  async listSettings(
    @Req() req: Request & RequestContext,
    @Query("group") group?: string,
    @Query("search") search?: string,
  ): Promise<PlatformSettingRecord[]> {
    assertCanReadSettings(req);

    const where: string[] = ["true"];
    const params: unknown[] = [];
    if (group) {
      params.push(group);
      where.push(`s.config_group = $${params.length}`);
    }
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where.push(
        `(s.config_key ilike $${params.length} or s.description ilike $${params.length})`,
      );
    }

    const { rows } = await this.pool.query<SettingRow>(
      `${SETTING_SELECT} where ${where.join(" and ")}
       order by s.config_group asc, s.config_key asc`,
      params,
    );
    return rows.map(mapSettingRow);
  }

  // Contract: PUT /api/system-parameters/:id — update config_value only.
  //   Rejected (409) for is_sensitive/is_encrypted/is_readonly rows: those are
  //   not editable via this board (secret manager / business lock / secure flow).
  @Put(":id")
  async updateSetting(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { configValue?: unknown },
  ): Promise<PlatformSettingRecord> {
    assertCanManageSettings(req);
    const updatedBy = requireOperatorId(req);
    const settingId = requireUuid(id, "Invalid setting id");

    return withTransaction(this.rwPool, async (client) => {
      const current = await client.query<SettingLockRow>(
        `select id, value_type, is_sensitive, is_encrypted, is_readonly
         from admin.settings where id = $1 for update`,
        [settingId],
      );
      const row = current.rows[0];
      if (!row) {
        throw new NotFoundException("Setting not found");
      }
      if (row.is_readonly) {
        throw new ConflictException("该配置为只读，不可修改。");
      }
      if (row.is_encrypted) {
        throw new ConflictException(
          "加密配置经密钥管理器维护，不在本板块修改。",
        );
      }
      if (row.is_sensitive) {
        throw new ConflictException(
          "敏感配置需经专用安全流程修改，不在本板块修改。",
        );
      }

      const value = normalizeConfigValue(body?.configValue, row.value_type);
      await client.query(
        `update admin.settings
           set config_value = $2, updated_by = $3, updated_at = now()
         where id = $1`,
        [settingId, value, updatedBy],
      );
      await insertOperatorAuditLog(client, req, {
        action: "platform.setting.update",
        resourceType: "platform_setting",
        resourceId: settingId,
        after: { valueType: row.value_type },
      });

      const { rows } = await client.query<SettingRow>(
        `${SETTING_SELECT} where s.id = $1`,
        [settingId],
      );
      if (!rows[0]) {
        throw new NotFoundException("Setting not found");
      }
      return mapSettingRow(rows[0]);
    });
  }
}

function assertCanReadSettings(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (
    !req.capabilities ||
    (!req.capabilities.includes("platform:setting.read") &&
      !req.capabilities.includes("platform:setting.manage"))
  ) {
    throw new ForbiddenException("Missing platform:setting.read capability");
  }
}

function assertCanManageSettings(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes("platform:setting.manage")) {
    throw new ForbiddenException("Missing platform:setting.manage capability");
  }
}

// Validate the new value against the declared value_type (chk_settings_value_type).
function normalizeConfigValue(value: unknown, valueType: string): string {
  if (typeof value !== "string") {
    throw new BadRequestException("configValue must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new BadRequestException("configValue is required");
  }
  if (trimmed.length > 10000) {
    throw new BadRequestException("configValue exceeds 10000 characters");
  }
  if (valueType === "int") {
    if (!/^-?\d+$/.test(trimmed)) {
      throw new BadRequestException("configValue must be an integer");
    }
  } else if (valueType === "bool") {
    if (trimmed !== "true" && trimmed !== "false") {
      throw new BadRequestException("configValue must be true or false");
    }
  } else if (valueType === "json") {
    try {
      JSON.parse(trimmed);
    } catch {
      throw new BadRequestException("configValue must be valid JSON");
    }
  }
  return trimmed;
}

const SETTING_SELECT = `
select
  s.id,
  s.config_group,
  s.config_key,
  s.value_type,
  s.config_value,
  s.is_sensitive,
  s.is_encrypted,
  s.is_readonly,
  s.validation_rule,
  s.description,
  s.updated_at
from admin.settings s
`;

interface SettingRow {
  id: string;
  config_group: string;
  config_key: string;
  value_type: string;
  config_value: string;
  is_sensitive: boolean;
  is_encrypted: boolean;
  is_readonly: boolean;
  validation_rule: string | null;
  description: string | null;
  updated_at: Date | string | null;
}

interface SettingLockRow {
  id: string;
  value_type: string;
  is_sensitive: boolean;
  is_encrypted: boolean;
  is_readonly: boolean;
}

function mapSettingRow(row: SettingRow): PlatformSettingRecord {
  const masked = row.is_sensitive || row.is_encrypted;
  const valueType = (
    ["string", "int", "bool", "json"].includes(row.value_type)
      ? row.value_type
      : "string"
  ) as PlatformSettingRecord["valueType"];
  return {
    id: row.id,
    configGroup: row.config_group,
    configKey: row.config_key,
    valueType,
    configValue: masked ? MASK : row.config_value,
    isSensitive: row.is_sensitive,
    isEncrypted: row.is_encrypted,
    isReadonly: row.is_readonly,
    isMasked: masked,
    isEditable: !row.is_sensitive && !row.is_encrypted && !row.is_readonly,
    validationRule: row.validation_rule,
    description: row.description,
    updatedAt: toIso(row.updated_at),
  };
}
