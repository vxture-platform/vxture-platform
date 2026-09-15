/**
 * operator-names.ts — 把上游流水里的操作者 `opr_<uuid>` 换成运营者名字。
 * @package @vxture/opera-bff
 *
 * Atlas 的变更流水、runos 的管理事件、Atlas 自检的发起人，存的都是员工域令牌的 `sub`
 * （`opr_<admin.operator_account.id>`，auth-bff 签发）。原样交给页面就是在界面上露 UUID
 * ——owner 铁律不许（2026-09-15 查出 Atlas / runos 两张变更表都在这么显示）。
 *
 * 这里只回**名字**：查得到是显示名（没有就用户名）；是运营者但平台库里没有 →
 * 「平台无此运营者」；永不退回 id。
 */

import type { Pool } from "pg";

export const UNKNOWN_OPERATOR = "平台无此运营者";

const OPERATOR_SUB =
  /^opr_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const UUID_IN_TEXT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** 运营者 uuid（小写）→ 名字。 */
export type OperatorNames = ReadonlyMap<string, string>;

export function operatorUuidOf(actorId: string): string | null {
  const m = OPERATOR_SUB.exec(actorId.trim());
  return m?.[1] ? m[1].toLowerCase() : null;
}

/** 批量查名字。查询失败回空表：名字是增益，读不到不该让整页跟着失败。 */
export async function lookupOperatorNames(
  pool: Pick<Pool, "query">,
  actorIds: readonly string[],
): Promise<OperatorNames> {
  const ids = [
    ...new Set(
      actorIds.map(operatorUuidOf).filter((id): id is string => id !== null),
    ),
  ];
  if (ids.length === 0) return new Map();
  try {
    const { rows } = await pool.query<{ id: string; name: string }>(
      `select id::text as id,
              coalesce(nullif(btrim(display_name), ''), username) as name
         from admin.operator_account
        where id = any($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map((r) => [r.id.toLowerCase(), r.name]));
  } catch {
    return new Map();
  }
}

/**
 * 操作者怎么显示。
 *  - `"unknown"`（守卫先挡掉、没有身份）→ null，页面显示「未归属」。
 *  - `opr_<uuid>` → 名字；平台库里没有 →「平台无此运营者」。
 *  - 其它形态（服务身份等）只要不含 UUID 就原样，含 UUID 也按「平台无此运营者」。
 */
export function operatorDisplayName(
  actorId: string,
  names: OperatorNames,
): string | null {
  if (actorId === "unknown") return null;
  const uuid = operatorUuidOf(actorId);
  if (uuid) return names.get(uuid) ?? UNKNOWN_OPERATOR;
  return UUID_IN_TEXT.test(actorId) ? UNKNOWN_OPERATOR : actorId;
}
