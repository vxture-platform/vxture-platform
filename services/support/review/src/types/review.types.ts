/**
 * 客户评价的领域类型。表定义见 deploy/database/ddl/72_support.sql §5。
 *
 * 三项分数各自可空——客户可以只评其中一两项。可空**不是**「没填等于 0 分」:
 * 聚合时走 AVG,它天然跳过 NULL,于是只评了产品的人不会把价格分的分母也撑大。
 */

/** 五分制。表上三条 CHECK 各自把 1..5 钉死,这里的类型是同一约束的前移。 */
export type ReviewScore = 1 | 2 | 3 | 4 | 5;

/**
 * 评价的来源。表上 `chk_product_reviews_origin` 要求 subscription_id 与
 * ticket_id **恰有其一**,所以这里用可辨识联合而不是两个可选字段——后者允许
 * 写出「两个都给」和「都不给」两种表会拒绝的形状。
 */
export type ReviewOrigin =
  | { readonly kind: "subscription"; readonly subscriptionId: string }
  | { readonly kind: "ticket"; readonly ticketId: string };

export interface ReviewRecord {
  readonly id: string;
  readonly tenantId: string;
  /** 评价人。裸值不建 FK:评价人注销后他留下的评价不该跟着消失。 */
  readonly accountId: string | null;
  readonly productId: string;
  readonly origin: ReviewOrigin;
  readonly productScore: ReviewScore | null;
  readonly priceScore: ReviewScore | null;
  readonly serviceScore: ReviewScore | null;
  readonly comment: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SubmitReviewInput {
  readonly tenantId: string;
  readonly accountId: string | null;
  readonly productId: string;
  readonly origin: ReviewOrigin;
  readonly productScore: ReviewScore | null;
  readonly priceScore: ReviewScore | null;
  readonly serviceScore: ReviewScore | null;
  readonly comment: string | null;
}

/**
 * 某个来源是否已经评过。
 *
 * 前端要靠它决定入口显示「评价」还是「已评价」——不能靠提交时撞唯一索引再报错,
 * 那是让用户写完一段留言才知道白写。
 */
export interface ReviewEligibility {
  readonly reviewed: boolean;
  /** 已评过时带回那条评价,用于回显。 */
  readonly review: ReviewRecord | null;
}

/** 单个产品的三项均分与样本数(admin 运营总览三卡)。 */
export interface ProductReviewAggregate {
  readonly productId: string;
  /** 各项分母**各算各的**:只评了产品的那条不进价格分的分母。 */
  readonly productScore: {
    readonly average: number | null;
    readonly count: number;
  };
  readonly priceScore: {
    readonly average: number | null;
    readonly count: number;
  };
  readonly serviceScore: {
    readonly average: number | null;
    readonly count: number;
  };
  /** 这个产品的评价条数(至少评了一项即计一条)。 */
  readonly reviewCount: number;
}

export interface ListReviewsParams {
  readonly productId?: string;
  readonly tenantId?: string;
  /** 只要带留言的——运营看留言列表时用。 */
  readonly withCommentOnly?: boolean;
  readonly limit: number;
  readonly offset: number;
}

export interface ListReviewsResult {
  readonly items: readonly ReviewRecord[];
  readonly total: number;
}
