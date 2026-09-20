/**
 * submit-review.dto.ts — 提交评价入参 DTO
 * @package @vxture/service-review
 *
 * @layer Domain
 * @category DTO
 */

import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

/**
 * 三项分数各自可空。空 = 这一项没评,**不是 0 分**——聚合走 AVG,NULL 自动跳过。
 *
 * 来源二选一:`subscriptionId` 与 `ticketId` 恰有其一,由 BFF 侧按入口填,
 * 表上 `chk_product_reviews_origin` 兜底。
 */
export class SubmitReviewDto {
  @ApiProperty({ description: "被评价的产品 ID" })
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: "订阅 ID（订阅页入口）", required: false })
  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @ApiProperty({ description: "工单 ID（工单完成入口）", required: false })
  @IsOptional()
  @IsUUID()
  ticketId?: string;

  @ApiProperty({ description: "产品评分 1-5", required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  productScore?: number;

  @ApiProperty({ description: "价格评分 1-5", required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  priceScore?: number;

  @ApiProperty({ description: "服务评分 1-5", required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  serviceScore?: number;

  @ApiProperty({ description: "留言，最长 512 字", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  comment?: string;
}
