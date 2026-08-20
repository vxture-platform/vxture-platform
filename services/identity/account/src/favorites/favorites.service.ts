/**
 * FavoritesService — 用户产品收藏（account.user_product_favorites）。
 * @package @vxture/service-account
 * @layer Domain
 *
 * console「我的订阅 / 新品推荐」的 ★：收藏即排序优先。行存在即收藏——
 * add 幂等（on conflict do nothing）、remove 幂等（不存在即无事发生），
 * 表无可写列（98 列锁只 REVOKE），任何更新都是 bug。
 */

import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { ACCOUNT_PG_POOL } from "../tokens";

@Injectable()
export class FavoritesService {
  constructor(
    @Inject(ACCOUNT_PG_POOL)
    private readonly pool: Pool,
  ) {}

  /** 该用户收藏的 product_id 全集（量级 = 平台产品数,不分页）。 */
  async listProductIds(userId: string): Promise<string[]> {
    const res = await this.pool.query<{ product_id: string }>(
      `select product_id from account.user_product_favorites
        where user_id = $1
        order by created_at desc`,
      [userId],
    );
    return res.rows.map((r) => r.product_id);
  }

  async add(userId: string, productId: string): Promise<void> {
    await this.pool.query(
      `insert into account.user_product_favorites (user_id, product_id)
       values ($1, $2)
       on conflict (user_id, product_id) do nothing`,
      [userId, productId],
    );
  }

  async remove(userId: string, productId: string): Promise<void> {
    await this.pool.query(
      `delete from account.user_product_favorites
        where user_id = $1 and product_id = $2`,
      [userId, productId],
    );
  }
}
