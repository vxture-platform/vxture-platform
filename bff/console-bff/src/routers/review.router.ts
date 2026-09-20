/**
 * review.router.ts — 客户评价（产品 / 价格 / 服务三项，5 分制）。
 * @package @vxture/bff-console
 *
 * 两个入口共用这一条链路：订阅页操作菜单（`subscriptionId`）与工单完成
 * （`ticketId`）。落表在 @vxture/service-review，本文件只做三件事：
 * 取会话身份、**核归属**、把服务层的结果翻成 HTTP。
 *
 * ── 为什么归属一定要在这里核 ──
 * `subscriptionId` / `ticketId` 是请求体带来的。只凭它去写，任何登录用户都能拿
 * 别人的订阅号刷分——表上的唯一索引只保证「一个订阅一条」，不保证那个订阅是他的。
 * 所以 tenantId 与 accountId **只从会话取，绝不信请求体**，再回查这条订阅 /
 * 工单确实属于该租户。
 */
import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import {
  ReviewService,
  SubmitReviewDto,
  type ReviewOrigin,
  type ReviewRecord,
  type ReviewScore,
} from "@vxture/service-review";
import type { RequestContext } from "../types/console.types";
import { SelfScope } from "../auth/capability";

interface ReviewView {
  id: string;
  productId: string;
  productScore: number | null;
  priceScore: number | null;
  serviceScore: number | null;
  comment: string | null;
  createdAt: string;
}

function toView(review: ReviewRecord): ReviewView {
  return {
    id: review.id,
    productId: review.productId,
    productScore: review.productScore,
    priceScore: review.priceScore,
    serviceScore: review.serviceScore,
    comment: review.comment,
    createdAt: review.createdAt,
  };
}

@SelfScope()
@Controller("api/me/reviews")
export class ReviewRouter {
  constructor(
    // 必须显式 @Inject：打包走 esbuild，它**不产 emitDecoratorMetadata**，
    // 靠参数类型推断的注入在运行时拿到 undefined（boot-smoke 报
    // 「can't resolve dependencies of the ReviewRouter (?, COMMERCE_PG_POOL)」）。
    // 类型检查与打包都不会报错——只有真启动一次才看得见。
    @Inject(ReviewService) private readonly reviews: ReviewService,
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
  ) {}

  private session(req: Request & RequestContext): {
    accountId: string;
    tenantId: string;
  } {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!req.tenant) throw new UnauthorizedException("No active tenant");
    return { accountId: req.user.id, tenantId: req.tenant.id };
  }

  /**
   * 把入参里的来源 id 解成 `{ origin, productId }`，同时核归属。
   *
   * 产品也在这里查出来——**不收请求体里的 productId**。订阅评的是哪个产品是订阅
   * 自己说了算；让客户端传，评价就会挂到它没订的产品上，聚合分随之被污染。
   */
  private async resolveOrigin(
    tenantId: string,
    subscriptionId: string | undefined,
    ticketId: string | undefined,
  ): Promise<{ origin: ReviewOrigin; productId: string }> {
    const given = [subscriptionId, ticketId].filter(
      (value) => value !== undefined && value !== "",
    );
    if (given.length !== 1) {
      throw new BadRequestException("subscriptionId 与 ticketId 恰须给其一");
    }

    if (ticketId) {
      // 工单入口暂不开通。表与服务层都支持 ticket 来源，缺的是**工单到产品的
      // 关联**：`support.tickets` 上没有 product_id，也没有 subscription_id，
      // `category` 是 "frontend" 这类自由字符串，不是产品；而评价必须落到某个
      // 产品上，否则聚合里会多出谁也算不进去的孤儿。
      // 另外 console 目前没有任何工单界面，客户建不了工单——「工单完成后评价」
      // 预设的那条客户流程本身也还不存在。
      // 待 owner 定：给工单加 product_id，还是评价时让客户选产品。
      throw new BadRequestException("工单评价入口尚未开通");
    }

    const found = await this.pool.query<{ product_id: string | null }>(
      `select product_id from metering.subscriptions
        where id = $1 and tenant_id = $2 and deleted_at is null`,
      [subscriptionId, tenantId],
    );
    const productId = found.rows[0]?.product_id;
    // 不属于本租户与不存在合并成同一个回答：区分开会变成一个探测别家订阅
    // 是否存在的接口。
    if (!productId) throw new ForbiddenException("订阅不存在或不属于当前租户");
    return {
      origin: {
        kind: "subscription",
        subscriptionId: subscriptionId as string,
      },
      productId,
    };
  }

  /**
   * 这个来源还能不能评。入口按钮靠它决定显示「评价」还是「已评价」——不能让客户
   * 写完一段留言、点了提交才知道白写。
   */
  @Get("eligibility")
  async eligibility(
    @Req() req: Request & RequestContext,
    @Query("subscriptionId") subscriptionId?: string,
    @Query("ticketId") ticketId?: string,
  ): Promise<{ reviewed: boolean; review: ReviewView | null }> {
    const { tenantId } = this.session(req);
    const { origin } = await this.resolveOrigin(
      tenantId,
      subscriptionId,
      ticketId,
    );
    const result = await this.reviews.checkEligibility(origin);
    return {
      reviewed: result.reviewed,
      review: result.review ? toView(result.review) : null,
    };
  }

  /** 订阅列表一次问完哪些已评过，免得每行一次请求。 */
  @Get("reviewed-subscriptions")
  async reviewedSubscriptions(
    @Req() req: Request & RequestContext,
    @Query("ids") ids?: string,
  ): Promise<{ subscriptionIds: string[] }> {
    const { tenantId } = this.session(req);
    const requested = (ids ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (requested.length === 0) return { subscriptionIds: [] };

    // 先按租户过滤一遍再去问评价表：否则调用方可以拿任意 id 探测「这条订阅
    // 被评过没有」。
    const owned = await this.pool.query<{ id: string }>(
      `select id from metering.subscriptions
        where id = any($1::uuid[]) and tenant_id = $2 and deleted_at is null`,
      [requested, tenantId],
    );
    const reviewed = await this.reviews.findReviewedSubscriptionIds(
      owned.rows.map((row) => row.id),
    );
    return { subscriptionIds: [...reviewed] };
  }

  @Post()
  async submit(
    @Req() req: Request & RequestContext,
    @Body() body: SubmitReviewDto,
  ): Promise<{ review: ReviewView }> {
    const { accountId, tenantId } = this.session(req);
    const { origin, productId } = await this.resolveOrigin(
      tenantId,
      body.subscriptionId,
      body.ticketId,
    );

    const result = await this.reviews.submit({
      tenantId,
      accountId,
      productId,
      origin,
      productScore: (body.productScore ?? null) as ReviewScore | null,
      priceScore: (body.priceScore ?? null) as ReviewScore | null,
      serviceScore: (body.serviceScore ?? null) as ReviewScore | null,
      comment: body.comment ?? null,
    });

    if (result.ok) return { review: toView(result.review) };
    if (result.reason === "empty") {
      throw new BadRequestException("三项至少评一项");
    }
    // 409 而不是 400：这不是请求写错了，是这次机会已经用过。
    throw new ConflictException("这条订阅/工单已经评价过了");
  }
}
