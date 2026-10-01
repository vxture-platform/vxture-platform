/**
 * read-scope.utils.ts — 把 `ReadScope` 变成一段 SQL 谓词。
 * @package @vxture-platform/shared
 *
 * 一个实现，所有共用仓储复用——各写一遍的话，「tenant 档忘了加谓词」这种错会各错一次。
 * 语义与约束见 `types/read-scope.types.ts` 的文件头。
 */
import type { ReadScope } from "../types/read-scope.types";

export interface ScopeCondition {
  /** 要并进 WHERE 的那一段；`platform` 档为 `null`（按设计不加谓词）。 */
  readonly condition: string | null;
  /** 要追加到参数数组的值；`platform` 档为空数组。 */
  readonly values: readonly unknown[];
  /** 下一个可用的 `$n` 序号——调用方继续拼别的条件时从这里接。 */
  readonly nextParamIndex: number;
}

/**
 * 构造归属谓词。
 *
 * @param alias 表别名（`"i"` → `i.tenant_id`）；没有别名传 `null`。
 * @param scope 这次读取代表谁。
 * @param nextParamIndex 当前已用到第几个 `$n`（下一个要用的序号，1-based）。
 *
 * @throws `platform` 档的 `why` 为空（或只有空白）时抛——空理由等于没声明，
 *         而这一档是**唯一**能让查询跨租户的口子，不能靠「调用方大概写了」。
 */
export function scopeCondition(
  alias: string | null,
  scope: ReadScope,
  nextParamIndex: number,
): ScopeCondition {
  const prefix = alias ? `${alias}.` : "";
  switch (scope.kind) {
    case "tenant":
      return {
        condition: `${prefix}tenant_id = $${nextParamIndex}`,
        values: [scope.tenantId],
        nextParamIndex: nextParamIndex + 1,
      };
    case "workspace":
      return {
        condition: `${prefix}workspace_id = $${nextParamIndex}`,
        values: [scope.workspaceId],
        nextParamIndex: nextParamIndex + 1,
      };
    case "platform":
      if (!scope.why.trim()) {
        throw new Error(
          "ReadScope platform 档必须写 why —— 空理由等于没声明，而这一档是唯一能跨租户的口子",
        );
      }
      return { condition: null, values: [], nextParamIndex };
  }
}

/** 日志/审计用的一行描述，不含具体 id（避免把归属值写进日志）。 */
export function describeScope(scope: ReadScope): string {
  return scope.kind === "platform"
    ? `platform(${scope.why})`
    : `${scope.kind}(redacted)`;
}
