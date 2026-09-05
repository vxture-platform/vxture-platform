/**
 * inbox-list.ts — 收件箱列表的两条纯规则(批 6 从 InboxPage 抽出,批 8 加测试)。
 * @package @vxture/console
 * @layer Application
 * @category Lib
 */

/** 绝对地址(http/https)= 站外链接;其余按站内路径走本地路由。 */
export function isExternalLink(link: string): boolean {
  return /^https?:\/\//i.test(link);
}

/**
 * 追加分页时按 id 去重,后到的不覆盖已有行。
 * 兜住服务端游标在同一时间戳上重叠、以及重试与「加载更多」交错的情形。
 */
export function mergeById<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const seen = new Set(current.map((m) => m.id));
  return [...current, ...incoming.filter((m) => !seen.has(m.id))];
}
