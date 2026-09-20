import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { REVIEW_PG_POOL } from "../tokens";
import type {
  ListReviewsParams,
  ListReviewsResult,
  ProductReviewAggregate,
  ReviewEligibility,
  ReviewOrigin,
  ReviewRecord,
  ReviewScore,
  SubmitReviewInput,
} from "../types/review.types";

interface ReviewRow {
  id: string;
  tenant_id: string;
  account_id: string | null;
  product_id: string;
  subscription_id: string | null;
  ticket_id: string | null;
  product_score: number | null;
  price_score: number | null;
  service_score: number | null;
  comment: string | null;
  created_at: Date;
  updated_at: Date;
}

function toScore(value: number | null): ReviewScore | null {
  // 表上三条 CHECK 已把范围钉死;这里只做窄化,不再重复校验——同一条判据写两处
  // 迟早对不上。
  return value === null ? null : (value as ReviewScore);
}

function toOrigin(row: ReviewRow): ReviewOrigin {
  // chk_product_reviews_origin 保证恰有其一,所以没有"两个都空"的分支。
  return row.subscription_id !== null
    ? { kind: "subscription", subscriptionId: row.subscription_id }
    : { kind: "ticket", ticketId: row.ticket_id as string };
}

function toRecord(row: ReviewRow): ReviewRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    productId: row.product_id,
    origin: toOrigin(row),
    productScore: toScore(row.product_score),
    priceScore: toScore(row.price_score),
    serviceScore: toScore(row.service_score),
    comment: row.comment,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT_COLUMNS = `
  id, tenant_id, account_id, product_id, subscription_id, ticket_id,
  product_score, price_score, service_score, comment, created_at, updated_at
`;

@Injectable()
export class PgReviewRepository {
  constructor(@Inject(REVIEW_PG_POOL) private readonly pool: Pool) {}

  /**
   * 落一条评价。
   *
   * **不做「先查再插」**:并发下两次提交都能查到「还没评过」,然后一起插。判重交给
   * 表上那两个部分唯一索引,这里把 23505 翻成调用方能识别的返回值。
   */
  async insert(input: SubmitReviewInput): Promise<ReviewRecord | "duplicate"> {
    const subscriptionId =
      input.origin.kind === "subscription" ? input.origin.subscriptionId : null;
    const ticketId =
      input.origin.kind === "ticket" ? input.origin.ticketId : null;

    try {
      const result = await this.pool.query<ReviewRow>(
        `INSERT INTO support.product_reviews
           (tenant_id, account_id, product_id, subscription_id, ticket_id,
            product_score, price_score, service_score, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${SELECT_COLUMNS}`,
        [
          input.tenantId,
          input.accountId,
          input.productId,
          subscriptionId,
          ticketId,
          input.productScore,
          input.priceScore,
          input.serviceScore,
          input.comment,
        ],
      );
      return toRecord(result.rows[0] as ReviewRow);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return "duplicate";
      throw error;
    }
  }

  /** 某个来源(订阅或工单)是否已评过。软删的行不算——删掉之后可以重评。 */
  async findByOrigin(origin: ReviewOrigin): Promise<ReviewEligibility> {
    const column =
      origin.kind === "subscription" ? "subscription_id" : "ticket_id";
    const value =
      origin.kind === "subscription" ? origin.subscriptionId : origin.ticketId;
    const result = await this.pool.query<ReviewRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM support.product_reviews
        WHERE ${column} = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [value],
    );
    const row = result.rows[0];
    return row
      ? { reviewed: true, review: toRecord(row) }
      : { reviewed: false, review: null };
  }

  /** 一次问多个来源,给订阅列表页用——每行一次查询会打出 N+1。 */
  async findReviewedSubscriptionIds(
    subscriptionIds: readonly string[],
  ): Promise<readonly string[]> {
    if (subscriptionIds.length === 0) return [];
    const result = await this.pool.query<{ subscription_id: string }>(
      `SELECT subscription_id
         FROM support.product_reviews
        WHERE subscription_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [subscriptionIds],
    );
    return result.rows.map((row) => row.subscription_id);
  }

  /**
   * 按产品聚合三项均分。
   *
   * 三个 AVG 各自跳过自己那一列的 NULL,于是**各项分母各算各的**;`reviewCount`
   * 是评过的条数,不是任一项的分母。把这四个数当同一个分母用,在「只评一项」的
   * 客户多起来之后会越错越远。
   */
  async aggregateByProduct(
    productIds: readonly string[],
  ): Promise<readonly ProductReviewAggregate[]> {
    if (productIds.length === 0) return [];
    const result = await this.pool.query<AggregateRow & { product_id: string }>(
      `SELECT product_id,
              AVG(product_score)::numeric(3,2) AS product_avg,
              COUNT(product_score)             AS product_cnt,
              AVG(price_score)::numeric(3,2)   AS price_avg,
              COUNT(price_score)               AS price_cnt,
              AVG(service_score)::numeric(3,2) AS service_avg,
              COUNT(service_score)             AS service_cnt,
              COUNT(*)                         AS review_cnt
         FROM support.product_reviews
        WHERE product_id = ANY($1::uuid[]) AND deleted_at IS NULL
        GROUP BY product_id`,
      [productIds],
    );
    return result.rows.map((row) => ({
      productId: row.product_id,
      ...toAggregate(row),
    }));
  }

  /** 全平台三项均分——admin 运营总览三卡取这个。 */
  async aggregateAll(): Promise<Omit<ProductReviewAggregate, "productId">> {
    const result = await this.pool.query<AggregateRow>(
      `SELECT AVG(product_score)::numeric(3,2) AS product_avg,
              COUNT(product_score)             AS product_cnt,
              AVG(price_score)::numeric(3,2)   AS price_avg,
              COUNT(price_score)               AS price_cnt,
              AVG(service_score)::numeric(3,2) AS service_avg,
              COUNT(service_score)             AS service_cnt,
              COUNT(*)                         AS review_cnt
         FROM support.product_reviews
        WHERE deleted_at IS NULL`,
    );
    return toAggregate(result.rows[0]);
  }

  /** 运营侧列表:按时间倒序,可只看带留言的。 */
  async list(params: ListReviewsParams): Promise<ListReviewsResult> {
    const where: string[] = ["deleted_at IS NULL"];
    const values: unknown[] = [];
    if (params.productId !== undefined) {
      values.push(params.productId);
      where.push(`product_id = $${values.length}`);
    }
    if (params.tenantId !== undefined) {
      values.push(params.tenantId);
      where.push(`tenant_id = $${values.length}`);
    }
    if (params.withCommentOnly === true) {
      // 空白串不算留言。前端已 trim,但运营列表的「有留言」是个筛选谓词,
      // 不能靠上游一定 trim 过。
      where.push("comment IS NOT NULL AND btrim(comment) <> ''");
    }
    const clause = where.join(" AND ");

    const totalResult = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM support.product_reviews WHERE ${clause}`,
      values,
    );
    values.push(params.limit, params.offset);
    const rows = await this.pool.query<ReviewRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM support.product_reviews
        WHERE ${clause}
        ORDER BY created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      items: rows.rows.map(toRecord),
      total: Number(totalResult.rows[0]?.total ?? 0),
    };
  }
}

interface AggregateRow {
  product_avg: string | null;
  product_cnt: string;
  price_avg: string | null;
  price_cnt: string;
  service_avg: string | null;
  service_cnt: string;
  review_cnt: string;
}

function toAggregate(
  row: AggregateRow | undefined,
): Omit<ProductReviewAggregate, "productId"> {
  return {
    productScore: {
      average: row?.product_avg == null ? null : Number(row.product_avg),
      count: Number(row?.product_cnt ?? 0),
    },
    priceScore: {
      average: row?.price_avg == null ? null : Number(row.price_avg),
      count: Number(row?.price_cnt ?? 0),
    },
    serviceScore: {
      average: row?.service_avg == null ? null : Number(row.service_avg),
      count: Number(row?.service_cnt ?? 0),
    },
    reviewCount: Number(row?.review_cnt ?? 0),
  };
}
