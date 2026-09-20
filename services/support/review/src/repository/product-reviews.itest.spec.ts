/**
 * product-reviews.itest.spec.ts — 评价表的不变式，打真库。
 *
 * 门控与兄弟包一致：
 *   REVIEW_ITEST=1 DATABASE_URL=postgresql://... pnpm --filter @vxture/service-review test
 *
 * ── 为什么这几条要有测试 ──
 * 这张表的正确性几乎全在**约束与聚合语义**上，而这两样都不会在类型层报错：
 *   · 三项分数各自可空 → 聚合必须各项各算各的分母。写成一个分母不会报错，
 *     只会在「只评一项」的客户多起来之后慢慢失真。
 *   · 判重靠两个部分唯一索引而不是先查再插 → 唯一索引一旦没建上，代码这边
 *     照样跑得通，只是同一个人能无限刷分。
 *   · 软删的行要退出聚合、且让那个来源可以重评 → 部分索引的 WHERE 子句少一半
 *     就坏，且坏得无声。
 *
 * 每个用例把自己造的行清掉；造的工单也清。不用事务包整个 describe：仓储方法
 * 各自从池里取连接，事务绑在某一条连接上，包不住。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgReviewRepository } from "./pg-review.repository";

const RUN = process.env.REVIEW_ITEST === "1";
const TICKET_PREFIX = "ITEST-REVIEW-";

describe.skipIf(!RUN)("support.product_reviews 不变式（真库）", () => {
  let pool: Pool;
  let repo: PgReviewRepository;
  let tenantId: string;
  let productId: string;
  const ticketIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    repo = new PgReviewRepository(pool);

    const tenant = await pool.query<{ id: string }>(
      `SELECT id FROM tenancy.tenants WHERE deleted_at IS NULL LIMIT 1`,
    );
    const product = await pool.query<{ id: string }>(
      `SELECT id FROM product.products WHERE deleted_at IS NULL LIMIT 1`,
    );
    // 读不到就抛，不是跳过——「没有基础数据」和「不变式不成立」是两回事，
    // 后者必须红。
    if (!tenant.rows[0] || !product.rows[0]) {
      throw new Error(
        "本地库缺 tenants / products 基础数据，先跑 db:local:all",
      );
    }
    tenantId = tenant.rows[0].id;
    productId = product.rows[0].id;

    for (let i = 0; i < 5; i += 1) {
      const row = await pool.query<{ id: string }>(
        `INSERT INTO support.tickets (tenant_id, ticket_no, title)
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, `${TICKET_PREFIX}${i}`, `集成测试工单 ${i}`],
      );
      ticketIds.push(row.rows[0]!.id);
    }
  });

  afterAll(async () => {
    if (ticketIds.length > 0) {
      await pool.query(
        `DELETE FROM support.product_reviews WHERE ticket_id = ANY($1::uuid[])`,
        [ticketIds],
      );
      await pool.query(
        `DELETE FROM support.tickets WHERE id = ANY($1::uuid[])`,
        [ticketIds],
      );
    }
    await pool.end();
  });

  async function clearReviews() {
    await pool.query(
      `DELETE FROM support.product_reviews WHERE ticket_id = ANY($1::uuid[])`,
      [ticketIds],
    );
  }

  it("三项分数各自可空，聚合时各项分母各算各的", async () => {
    await clearReviews();
    // 产品 5 / 价格 3 / 产品 1 + 服务 4 —— 故意让三项的分母互不相同。
    await repo.insert({
      tenantId,
      accountId: null,
      productId,
      origin: { kind: "ticket", ticketId: ticketIds[0]! },
      productScore: 5,
      priceScore: null,
      serviceScore: null,
      comment: null,
    });
    await repo.insert({
      tenantId,
      accountId: null,
      productId,
      origin: { kind: "ticket", ticketId: ticketIds[1]! },
      productScore: null,
      priceScore: 3,
      serviceScore: null,
      comment: null,
    });
    await repo.insert({
      tenantId,
      accountId: null,
      productId,
      origin: { kind: "ticket", ticketId: ticketIds[2]! },
      productScore: 1,
      priceScore: null,
      serviceScore: 4,
      comment: null,
    });

    const [aggregate] = await repo.aggregateByProduct([productId]);
    expect(aggregate).toBeDefined();
    // 产品分的分母是 2（(5+1)/2 = 3），不是 3——第二条没评产品。
    expect(aggregate!.productScore).toEqual({ average: 3, count: 2 });
    expect(aggregate!.priceScore).toEqual({ average: 3, count: 1 });
    expect(aggregate!.serviceScore).toEqual({ average: 4, count: 1 });
    // 条数与任一项的分母都不是一个数。
    expect(aggregate!.reviewCount).toBe(3);
  });

  it("一个工单只能评一次，且不是靠先查再插", async () => {
    await clearReviews();
    const first = await repo.insert({
      tenantId,
      accountId: null,
      productId,
      origin: { kind: "ticket", ticketId: ticketIds[0]! },
      productScore: 4,
      priceScore: null,
      serviceScore: null,
      comment: null,
    });
    expect(first).not.toBe("duplicate");

    const second = await repo.insert({
      tenantId,
      accountId: null,
      productId,
      origin: { kind: "ticket", ticketId: ticketIds[0]! },
      productScore: 1,
      priceScore: null,
      serviceScore: null,
      comment: null,
    });
    expect(second).toBe("duplicate");
  });

  it("软删的行退出聚合，且那个来源可以重评", async () => {
    await clearReviews();
    const created = await repo.insert({
      tenantId,
      accountId: null,
      productId,
      origin: { kind: "ticket", ticketId: ticketIds[0]! },
      productScore: 5,
      priceScore: null,
      serviceScore: null,
      comment: null,
    });
    expect(created).not.toBe("duplicate");

    await pool.query(
      `UPDATE support.product_reviews SET deleted_at = now() WHERE id = $1`,
      [(created as { id: string }).id],
    );

    const [afterDelete] = await repo.aggregateByProduct([productId]);
    expect(afterDelete).toBeUndefined();

    const eligibility = await repo.findByOrigin({
      kind: "ticket",
      ticketId: ticketIds[0]!,
    });
    expect(eligibility.reviewed).toBe(false);

    const again = await repo.insert({
      tenantId,
      accountId: null,
      productId,
      origin: { kind: "ticket", ticketId: ticketIds[0]! },
      productScore: 2,
      priceScore: null,
      serviceScore: null,
      comment: null,
    });
    expect(again).not.toBe("duplicate");
  });

  it("「有留言」筛选会动：纯空白不算留言", async () => {
    await clearReviews();
    const created = await repo.insert({
      tenantId,
      accountId: null,
      productId,
      origin: { kind: "ticket", ticketId: ticketIds[0]! },
      productScore: 4,
      priceScore: null,
      serviceScore: null,
      comment: null,
    });
    const id = (created as { id: string }).id;
    const countWithComment = async () =>
      (
        await repo.list({
          productId,
          withCommentOnly: true,
          limit: 10,
          offset: 0,
        })
      ).total;

    // 三个状态各测一次——只测「有留言时返回 1」证明不了谓词会动。
    expect(await countWithComment()).toBe(0);
    await pool.query(
      `UPDATE support.product_reviews SET comment = '   ' WHERE id = $1`,
      [id],
    );
    expect(await countWithComment()).toBe(0);
    await pool.query(
      `UPDATE support.product_reviews SET comment = '还不错' WHERE id = $1`,
      [id],
    );
    expect(await countWithComment()).toBe(1);
  });

  it("来源恰有其一：两个都给、都不给都被表拒绝", async () => {
    await clearReviews();
    await expect(
      pool.query(
        `INSERT INTO support.product_reviews
           (tenant_id, product_id, ticket_id, subscription_id, product_score)
         VALUES ($1, $2, $3, gen_random_uuid(), 5)`,
        [tenantId, productId, ticketIds[0]],
      ),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^235(14|03)$/) });

    await expect(
      pool.query(
        `INSERT INTO support.product_reviews (tenant_id, product_id, product_score)
         VALUES ($1, $2, 5)`,
        [tenantId, productId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("三项全空、分数越界都被表拒绝", async () => {
    await clearReviews();
    await expect(
      pool.query(
        `INSERT INTO support.product_reviews (tenant_id, product_id, ticket_id)
         VALUES ($1, $2, $3)`,
        [tenantId, productId, ticketIds[0]],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      pool.query(
        `INSERT INTO support.product_reviews
           (tenant_id, product_id, ticket_id, product_score)
         VALUES ($1, $2, $3, 6)`,
        [tenantId, productId, ticketIds[0]],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
