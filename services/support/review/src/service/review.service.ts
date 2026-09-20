import { Inject, Injectable } from "@nestjs/common";
import { PgReviewRepository } from "../repository/pg-review.repository";
import type {
  ListReviewsParams,
  ListReviewsResult,
  ProductReviewAggregate,
  ReviewEligibility,
  ReviewOrigin,
  ReviewRecord,
  SubmitReviewInput,
} from "../types/review.types";

/**
 * 提交评价的结果。
 *
 * `duplicate` 不是异常:同一次订阅只能评一次是**规则**,不是故障。让调用方拿到
 * 一个值去决定说什么话,比抛异常再在 BFF 里按 message 反猜要稳。
 */
export type SubmitReviewResult =
  | { readonly ok: true; readonly review: ReviewRecord }
  | { readonly ok: false; readonly reason: "duplicate" | "empty" };

@Injectable()
export class ReviewService {
  // 必须显式 @Inject:BFF 打包走 esbuild,它**不产 emitDecoratorMetadata**,
  // 靠参数类型推断的注入拿不到元数据。症状不是启动失败(boot-smoke 照样绿),
  // 而是**实例化出一个依赖为 undefined 的壳**——调用方拿到它,第一次用就
  // 「Cannot read properties of undefined」,表现为运行时 500。
  // 2026-09-20 实测:router 那一处补过了,服务包自己这一处漏了,是同一个坑的两半。
  constructor(
    @Inject(PgReviewRepository) private readonly repository: PgReviewRepository,
  ) {}

  /**
   * 落一条评价。
   *
   * 「三项至少评一项」表上有 CHECK,这里先挡一道——不是重复校验,是为了把它翻成
   * `empty` 这个调用方能识别的结果,而不是让客户吃一条 23514。
   */
  async submit(input: SubmitReviewInput): Promise<SubmitReviewResult> {
    const hasAnyScore =
      input.productScore !== null ||
      input.priceScore !== null ||
      input.serviceScore !== null;
    if (!hasAnyScore) return { ok: false, reason: "empty" };

    const comment = input.comment?.trim();
    const result = await this.repository.insert({
      ...input,
      comment: comment ? comment : null,
    });
    return result === "duplicate"
      ? { ok: false, reason: "duplicate" }
      : { ok: true, review: result };
  }

  /** 这个来源还能不能评——入口按钮拿它决定显示「评价」还是「已评价」。 */
  async checkEligibility(origin: ReviewOrigin): Promise<ReviewEligibility> {
    return this.repository.findByOrigin(origin);
  }

  /** 批量版本:订阅列表一次问完,免得每行一次查询。 */
  async findReviewedSubscriptionIds(
    subscriptionIds: readonly string[],
  ): Promise<readonly string[]> {
    return this.repository.findReviewedSubscriptionIds(subscriptionIds);
  }

  async aggregateByProduct(
    productIds: readonly string[],
  ): Promise<readonly ProductReviewAggregate[]> {
    return this.repository.aggregateByProduct(productIds);
  }

  async aggregateAll(): Promise<Omit<ProductReviewAggregate, "productId">> {
    return this.repository.aggregateAll();
  }

  async list(params: ListReviewsParams): Promise<ListReviewsResult> {
    return this.repository.list(params);
  }
}
