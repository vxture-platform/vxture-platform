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

/**
 * **平台哨兵**：全零 UUID。Atlas 的 `COMMERCE_SENTINEL_UUID`（quota.service.ts）。
 *
 * 它在不同的位置说的是不同的事，所以显示也分开：
 *  - 在**租户 / 工作区**上：Atlas 自检探测（`model-probe.service.ts` 的 recordProbe，
 *    usageType=test）。「自检消耗的 token 是 Atlas 的运维成本，不是任何人的账单」。
 *    界面叫 **SYSTEM · 平台自检**。
 *  - 在**应用 / Agent** 上：调用方没有声明（`resolveApplicationScope` 补的位）。界面叫
 *    **未声明应用 / 未声明 Agent**——它不是自检，是没说。
 *
 * 不叫「平台哨兵」：那是 Atlas 代码里的术语，运营者看到只会问「哨兵是什么」。
 */
export const PLATFORM_SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";

export function isPlatformSentinel(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() === PLATFORM_SENTINEL_UUID;
}

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
