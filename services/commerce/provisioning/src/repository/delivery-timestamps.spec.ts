/**
 * delivery-timestamps.spec.ts —— 投递行的两个时间戳（2026-09-17）。
 *
 * ── 为什么要这一组 ──
 * provisioning 域两表**没有任何触发器**（`95_triggers.sql` 的 provisioning 段明写
 * 「无」），而 `updated_at` 那个 `NOT NULL DEFAULT now()` 只在 INSERT 时生效。于是
 * 两个缺写都**没有任何外在症状**：
 *   · `delivered_at` 永远为 NULL——建了一列却没人写，拿它当判据的检查永远不满足
 *     （opera 的接入信号就因此改用 `status='delivered'`，那里留着注释）；
 *   · `updated_at` 停在创建时间——一行重试好几次、最后投成或死信，运维查
 *     「这行最后一次动是什么时候」会得到错答案。
 *
 * 假 pool 直接捕 SQL：真库集成测（`dispatch.itest.spec.ts`）要 `PROVISION_ITEST=1`，
 * CI 跳过它——断言只放在那里等于没人站岗。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { PgProvisioningRepository } from "./pg-provisioning.repository";

/** 只记 SQL；返回空结果集就够这四个方法跑完。 */
function repoOf() {
  /* 参数签名要显式写出来：零参的 `vi.fn` 会把 `mock.calls[0]` 推成空元组，
     取 `[0]` 当场 TS2493。 */
  const query = vi.fn(async (_sql: string, _args?: unknown[]) => ({
    rows: [] as unknown[],
    rowCount: 0,
  }));
  const repo = new PgProvisioningRepository({ query } as unknown as Pool);
  return { repo, sql: () => String(query.mock.calls[0]?.[0] ?? "") };
}

/**
 * SET 子句（从 `set` 到 `where` 之间）——断言只看这一段，不被 WHERE 里的同名列干扰。
 *
 * 故意不用正则：这份文件第一版拿反斜杠 b 当单词边界，写入时被工具链吃掉一层、
 * 变成了不可见的退格符；五条断言一起报「SET 解析不到」，而被测的 SQL 其实是对的。字符串切分没有
 * 转义面，不会再出这类「工具链吃掉一层反斜杠」的事。
 */
function setClause(sql: string): string {
  const lower = sql.toLowerCase();
  const from = lower.indexOf("set ");
  const to = lower.indexOf("where", from);
  if (from < 0 || to < 0) {
    throw new Error(`SET 解析不到，SQL 变了：${sql}`);
  }
  return sql.slice(from + 4, to);
}

/** SET 里每一个赋值的列名（等号左侧，已去空白与换行）。 */
function assignedColumns(setText: string): string[] {
  return setText
    .split(",")
    .map((part) => part.split("=")[0] ?? "")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

describe("投递行的终态写入都刷 updated_at", () => {
  it("markDelivered：同时写 delivered_at 与 updated_at", async () => {
    const t = repoOf();
    await t.repo.markDelivered("d-1", 204);
    const set = setClause(t.sql());
    expect(set).toContain("delivered_at=now()");
    expect(set).toContain("updated_at=now()");
    expect(set).toContain("status='delivered'");
  });

  it("markRetry：刷 updated_at，但**不**写 delivered_at", async () => {
    const t = repoOf();
    await t.repo.markRetry("d-1", 2, new Date("2026-09-17T00:00:00Z"), 500);
    const set = setClause(t.sql());
    expect(set).toContain("updated_at=now()");
    /* 重试不是投成。写了就把「什么时候投成的」变成「什么时候最后试的」。 */
    expect(set).not.toContain("delivered_at");
  });

  it("markFailed：刷 updated_at，不写 delivered_at", async () => {
    const t = repoOf();
    await t.repo.markFailed("d-1", 8, 500);
    const set = setClause(t.sql());
    expect(set).toContain("updated_at=now()");
    expect(set).not.toContain("delivered_at");
  });

  it("recoverExpiredLeases：批量回队也刷 updated_at", async () => {
    const t = repoOf();
    await t.repo.recoverExpiredLeases();
    const set = setClause(t.sql());
    expect(set).toContain("updated_at=now()");
    expect(set).not.toContain("delivered_at");
  });

  it("四条 SET 列表都不碰锚点列（id / created_at）", async () => {
    /* `98_column_locks.sql` 给这张表的锚点是 id 与 created_at。SET 里一旦出现锚点列，
       生产的 platform_svc 会 42501 整条回滚——而本地开发库的 owner 身份对它是瞎的。 */
    const cases: Array<() => Promise<unknown>> = [];
    const a = repoOf();
    cases.push(() => a.repo.markDelivered("d-1", 200));
    const b = repoOf();
    cases.push(() => b.repo.markRetry("d-1", 1, new Date(), 500));
    const c = repoOf();
    cases.push(() => c.repo.markFailed("d-1", 8, 500));
    const d = repoOf();
    cases.push(() => d.repo.recoverExpiredLeases());

    const holders = [a, b, c, d];
    for (let i = 0; i < cases.length; i += 1) {
      await cases[i]!();
      expect(
        assignedColumns(setClause(holders[i]!.sql())),
        `第 ${i + 1} 条 SET 碰了锚点列`,
      ).not.toContain("id");
      expect(assignedColumns(setClause(holders[i]!.sql()))).not.toContain(
        "created_at",
      );
    }
  });
});
