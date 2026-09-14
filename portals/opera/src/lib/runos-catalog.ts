/**
 * runos-catalog.ts — 读完整个 Runos 能力目录。
 * @package @vxture/opera
 *
 * 能力目录列表是**游标分页**（runos v0.26.0：`{items, nextCursor, prevCursor, total}`，
 * 一页最多 1000 条）。注册页按页浏览，用不上这个；要用它的是「需要全量」的地方——
 * 权益配置页按能力 id 查分类、在授权选择器里搜能力。
 *
 * 2026-09-14 权益配置页白屏：它还按裸数组读这条接口，拿到信封后 `.map` 落在对象上。
 * 只拆出第一页的 `items` 也不对——那是 878 条里的前 100 条，其余能力在选择器里
 * 「搜不到」、分类显示「未分类」，而接口照样回 200。所以按游标读到底。
 *
 * **页数有上限，超了就报错，不截断**：读到一半交出去，和「这些能力不存在」在界面上
 * 一模一样。
 */

import { api } from "@/lib/api";

/** runos `MAX_PAGE_LIMIT`。一页取满，今天的目录一次就读完。 */
const PAGE_LIMIT = 1000;
const MAX_PAGES = 20;

interface CatalogPage<T> {
  items: T[];
  nextCursor: string | null;
}

export async function fetchWholeCapabilityCatalog<T>(): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) params.set("cursor", cursor);
    const data: CatalogPage<T> = await api.get<CatalogPage<T>>(
      `/api/runos/capabilities?${params.toString()}`,
    );
    rows.push(...data.items);
    if (data.nextCursor === null) return rows;
    cursor = data.nextCursor;
  }
  throw new Error(`CAPABILITY_CATALOG_TOO_LARGE (> ${PAGE_LIMIT * MAX_PAGES})`);
}
