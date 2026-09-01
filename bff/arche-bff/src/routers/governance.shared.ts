/**
 * governance.shared.ts — 治理写 router 共享帮手(arche-bff)
 * @package @vxture/bff-arche
 * @layer BFF
 *
 * risk-records / compliance-events / system-parameters / feature-toggles 等治理
 * 写 router 共用的输入校验与工具。自 admin-bff 平移至治理台(三平面拆分 PR②
 * Batch 2),校验口径不变;唯一差异是 `requireOperatorId` 读 `req.operator`——
 * arche 数据面中间件挂的是 operator(见 request-context.ts),不是 admin 的 user。
 */

import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { RequestContext } from "../types/request-context";

/**
 * 只校验**格式良好**,不校验 RFC 4122 的 version / variant 位。
 *
 * 这条护栏问的是"这串东西能不能安全当 uuid 参数用",不是"它是不是规范的
 * v1–v5 UUID"。Postgres 的 `uuid` 类型接受任意 128 位值——校验器比它所校验的列
 * 更严,就会出现库里存得下、接口反而不认的行。种子为幂等用固定 UUID 段(变体位
 * 不受控),admin 侧同名正则曾把活库数据挡在门外(2026-08-07);此处照宽口径。
 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GOVERNANCE_LIST_LIMIT = 500;

export function requireOperatorId(req: Request & RequestContext): string {
  const id = req.operator?.id;
  if (!id || !UUID_RE.test(id)) {
    throw new UnauthorizedException("Invalid platform operator principal");
  }
  return id;
}

export function requireUuid(
  value: string | undefined,
  message: string,
): string {
  if (!value || !UUID_RE.test(value)) {
    throw new BadRequestException(message);
  }
  return value;
}

export function requireText(
  value: unknown,
  field: string,
  maxLen: number,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new BadRequestException(`${field} exceeds ${maxLen} characters`);
  }
  return trimmed;
}

export function optionalText(
  value: unknown,
  field: string,
  maxLen: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireText(value, field, maxLen);
}

/** Non-empty trimmed strings, each ≤ itemMaxLen (array columns are varchar(64)/text[]). */
export function normalizeStringArray(
  value: unknown,
  field: string,
  itemMaxLen = 64,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${field} must be an array of strings`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.trim().length === 0 ||
      item.trim().length > itemMaxLen
    ) {
      throw new BadRequestException(`${field} contains an invalid value`);
    }
    out.push(item.trim());
  }
  return out;
}

export function parseIso(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required (ISO timestamp)`);
  }
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) {
    throw new BadRequestException(`${field} is not a valid timestamp`);
  }
  return ts.toISOString();
}

export function toIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export function toIsoOrNull(value: Date | string | null): string | null {
  return value ? toIso(value) : null;
}
