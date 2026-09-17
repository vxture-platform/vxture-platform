/**
 * visible-id.ts — 标识能不能上屏。
 * @package @vxture/admin
 * @layer Application
 * @category Lib
 *
 * owner 铁律：**任何界面不展示 UUID**——文字、悬停提示、读屏标签、导出的 CSV 都算。
 * 一律用可视码（租户码 / 账号码 / 单号 / 产品码……）；拿不到可视码就说「未知 / —」，
 * 不拿 UUID 顶上。
 *
 * 为什么要一个函数而不是在每个格子里判断：上游的 id 字段有的是编码（`karda`、
 * `chat/default`），有的是 UUID（租户、账号、订单、审计对象），**同一个字段名在不同
 * 接口里两种都有**。每个调用点各记一次「这个会不会是 UUID」，漏一处就上屏。
 *
 * 2026-09-15 opera 计量页就是这样漏的：`workspaceDisplay` 查不到名字时退回
 * workspaceId、tooltip 写死两个 uuid，搬运单元格时连同兜底一起搬了过去。
 * 2026-09-17 admin /billing 是另一种形态：机读串里裹着 uuid 被整段打印
 * （那一处已由 admin-bff 的 humanRemark 在投影处堵掉）。
 *
 * 与 opera 的 `lib/visible-id.ts` 同一口径——三个运营平台可以重复、不能互相引用
 * （见 lint:operator-planes），所以各自一份。**改口径要两处一起改。**
 *
 * 不收 opera 那份的 `PLATFORM_SENTINEL_UUID`：全零 UUID 在 Atlas 的语义是「平台
 * 自检消耗」，admin 不碰模型计量，收进来只会让人问「哨兵是什么」。
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 这个值是不是 UUID（含前后空白的也认）。 */
export function isUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/**
 * 可以上屏就原样返回；空值或 UUID 返回 `fallback`。
 *
 * `fallback` 必填、且**不给默认值**：占位说什么是产品语汇（这一格该说「未知租户」
 * 还是「—」，只有调用点知道），给了默认值就会有人图省事一路用下去。
 */
export function visibleIdOr(
  value: string | null | undefined,
  fallback: string,
): string {
  if (value === null || value === undefined || value.trim() === "")
    return fallback;
  return isUuid(value) ? fallback : value;
}
