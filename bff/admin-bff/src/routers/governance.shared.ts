/**
 * governance.shared.ts - TD-021 治理三 router 共享帮手
 * @package @vxture/bff-admin
 *
 * Description: risk-records / compliance-events / maintenance-windows 三个
 *   治理 router 共用的输入校验与工具（设计权威 =
 *   docs/product/platform/admin/governance-write-paths.md §4.2）。
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

import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { RequestContext } from "../types/console.types";

/**
 * 只校验**格式良好**，不校验 RFC 4122 的 version / variant 位。
 *
 * 这条护栏问的是"这串东西能不能安全当 uuid 参数用"，不是"它是不是规范的
 * v1–v5 UUID"。Postgres 的 `uuid` 类型接受任意 128 位值——校验器比它所校验的列
 * 更严，就会出现**库里存得下、接口反而不认**的行。
 *
 * 原正则要求 version ∈ [1-5] 且 variant ∈ [89ab]。生产数据全部来自
 * `gen_random_uuid()`（DDL 里 91 处默认值），产出的是 v4、variant 必在 [89ab]，
 * 所以线上一直没被触发。真正被挡住的是**不由该函数生成的 id**：
 *
 *   - 本地种子为幂等用固定 UUID 段拼 id（见 deploy/database/seed/seed-bulk*），
 *     变体位是段值本身。2026-08-07 实测活库，27 张有数据的表被拒，其中
 *     `admin.operator_account` 102 行里 100 行不合格——也就是说
 *     `requireOperatorId` 会把绝大多数种子操作者判成"无效主体"直接 401，
 *     本地根本没法验任何治理写路径。
 *   - 将来的数据导入 / 从别的系统迁入的 GUID 同理（微软风格 GUID 的变体位就常
 *     不在 [89ab]）。
 *
 * 发现于把维护窗口迁去 opera 时第一次真按下"开始维护"（此前走查只看不点）。
 *
 * 没改种子而是改这里：种子的固定段是为幂等**刻意**设计的，改它会翻动所有既有
 * 本地库的 id；而"校验器不该比存储层更严"本身就是这条护栏的缺陷，与种子无关。
 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GOVERNANCE_LIST_LIMIT = 500;

export function requireOperatorId(req: Request & RequestContext): string {
  const id = req.user?.id;
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
