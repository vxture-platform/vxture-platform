/**
 * visible-id.ts — 标识能不能上屏。
 * @package @vxture/opera
 * @layer Application
 * @category Lib
 *
 * owner 铁律：**任何界面不展示 UUID**——文字、悬停提示、读屏标签、导出的 CSV 都算。一律用可视码
 * （T- / W- 主体码、产品码、入口码……）；拿不到可视码就说「未知 / —」，不拿 UUID 顶上。
 *
 * 为什么要一个函数而不是在每个格子里判断：上游的 id 字段有的是编码（`chat/default`、`karda`），
 * 有的是 UUID（租户、工作区、调用、审计对象），同一个字段名在不同表里两种都有。每个调用点
 * 各记一次「这个会不会是 UUID」，漏一处就上屏——2026-09-15 计量页就是这样漏的。
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** 可以上屏就原样返回；空值或 UUID 返回 `fallback`。 */
export function visibleIdOr(
  value: string | null | undefined,
  fallback: string,
): string {
  if (value === null || value === undefined || value.trim() === "")
    return fallback;
  return isUuid(value) ? fallback : value;
}
