/**
 * tx.ts — 写路径的事务小工具。
 * @package @vxture/bff-opera
 *
 * `withTransaction` 用独立 client 包一个 BEGIN/COMMIT 单元，让"主写 + 事务内审计"
 * 成为原子的：审计插失败则整笔回滚，不会出现改了库但没留痕。任何抛出都回滚，
 * client 一定归还。
 */
import type { Pool, PoolClient } from "pg";

/** pg.Pool 与 pg.PoolClient 的公共面（两者都有 query）。 */
export type Queryable = Pick<PoolClient, "query">;

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
