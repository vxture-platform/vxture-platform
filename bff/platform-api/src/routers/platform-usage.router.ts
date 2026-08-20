/**
 * platform-usage.router.ts — C3 usage consume API (product_310 P2.2; contract
 * = ADR-11 §11.7 ③, channel spec = product_200 §4.1).
 *
 * Server-to-server only (PlatformAuthGuard, same dual-accept credential as
 * the C2 endpoint). Path follows the contract literal POST /usage/consume
 * (ADR-11 §11.7 is the path authority; D1's /platform/* note applies to the
 * C2 read API). nginx routes neither — internal network only.
 *
 * The commerce consume engine stays the single writer (idempotent waterfall);
 * this router only validates, resolves product_code → id, and enriches the
 * engine result with the contract's remaining_total / per-subscription
 * breakdown via a read-only period-aware pool read. Every consume answers 200
 * (2026-08-10): `gated` in the body reports that quota did not cover the call,
 * and the caller decides what that means — the platform records, it does not
 * adjudicate.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  Put,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { PlatformAuthGuard } from "../authn/platform-auth.guard";
import { S2sCaller, type S2sCallerCtx } from "../authn/s2s-caller";
import { scopeToS2sCaller } from "../authn/s2s-scope";
import { PlatformUsageService } from "../platform/platform-usage.service";
import {
  buildConsumeResponse,
  parseConsumeBody,
  parseGaugeBody,
  type ConsumeResponseBody,
} from "../platform/usage-view";

@Controller()
@UseGuards(PlatformAuthGuard)
export class PlatformUsageRouter {
  constructor(
    @Inject(PlatformUsageService)
    private readonly usage: PlatformUsageService,
  ) {}

  /** POST /usage/consume { workspace_id, product, metric, amount, idempotency_key, end_user_id? } */
  @Post("usage/consume")
  async consume(
    @Body()
    body: {
      workspace_id?: unknown;
      product?: unknown;
      metric?: unknown;
      amount?: unknown;
      idempotency_key?: unknown;
      end_user_id?: unknown;
    },
    @Res({ passthrough: true }) res: Response,
    @Headers("x-request-id") requestId?: string,
    @S2sCaller() s2sCaller?: S2sCallerCtx,
  ): Promise<ConsumeResponseBody> {
    let parsed;
    try {
      parsed = parseConsumeBody(body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    // TD-035: an S2S caller can only consume against its own product, and
    // its own workspace_id (the token's, not the caller-declared one) is used.
    const { workspaceId } = scopeToS2sCaller(s2sCaller, {
      workspaceId: parsed.workspaceId,
      productCodes: [parsed.productCode],
    });

    const productId = await this.usage.resolveProductId(parsed.productCode);
    if (!productId) throw new BadRequestException("unknown_product");

    // gauge metrics are stock, not consumable (D5): reject at the boundary.
    if (await this.usage.isGaugeMetric(parsed.metric)) {
      throw new BadRequestException("gauge_metric_use_put_usage_gauge");
    }

    const result = await this.usage.consume({
      workspaceId,
      productId,
      metricKey: parsed.metric,
      amount: parsed.amount,
      idempotencyKey: parsed.idempotencyKey,
      ...(requestId ? { requestId } : {}),
      ...(parsed.endUserId ? { endUserId: parsed.endUserId } : {}),
    });

    const pools = await this.usage.readPools(
      workspaceId,
      productId,
      parsed.metric,
    );
    const { statusCode, body: responseBody } = buildConsumeResponse(
      result,
      pools,
      parsed.metric,
    );
    res.status(statusCode);
    return responseBody;
  }

  /** PUT /usage/gauge { workspace_id, product, metric, value, observed_at } (D5). */
  @Put("usage/gauge")
  async gauge(
    @Body()
    body: {
      workspace_id?: unknown;
      product?: unknown;
      metric?: unknown;
      value?: unknown;
      observed_at?: unknown;
    },
    @S2sCaller() s2sCaller?: S2sCallerCtx,
  ): Promise<{
    workspace_id: string;
    product: string;
    metric: string;
    value: string;
    observed_at: string;
    applied: boolean;
  }> {
    let parsed;
    try {
      parsed = parseGaugeBody(body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    // TD-035: same S2S scope binding as consume().
    const { workspaceId } = scopeToS2sCaller(s2sCaller, {
      workspaceId: parsed.workspaceId,
      productCodes: [parsed.productCode],
    });

    const productId = await this.usage.resolveProductId(parsed.productCode);
    if (!productId) throw new BadRequestException("unknown_product");

    // must be a registered gauge metric (counter/unknown → wrong endpoint).
    if (!(await this.usage.isGaugeMetric(parsed.metric))) {
      throw new BadRequestException("not_a_gauge_metric");
    }

    const r = await this.usage.recordGauge({
      workspaceId,
      productId,
      metricKey: parsed.metric,
      value: parsed.value,
      observedAt: parsed.observedAt,
    });
    return {
      workspace_id: workspaceId,
      product: parsed.productCode,
      metric: parsed.metric,
      value: r.value,
      observed_at: r.observedAt.toISOString(),
      applied: r.applied,
    };
  }
}
