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
 * breakdown via a read-only period-aware pool read.
 *
 * **2026-10-01（owner 裁定）**：请求体可带 `intent`。默认 `report` —— 行为与此前
 * 完全一致（旧调用方一个字不用改）。`reserve` 是事前问许可：硬限且额度不足时本端点
 * 回 **409** 且不写用量事件。下面这句「Every consume answers 200」自此只管 report 档。
 * Every consume answers 200
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
  Logger,
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
  private readonly logger = new Logger(PlatformUsageRouter.name);

  constructor(
    @Inject(PlatformUsageService)
    private readonly usage: PlatformUsageService,
  ) {}

  /**
   * POST /usage/consume
   * { workspace_id, product, metric, amount, idempotency_key, end_user_id?, intent? }
   */
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
      /* 不列它不会报错（parseConsumeBody 收的都是 unknown），但这份声明就会对下一个
         读者说「请求体没有这个字段」。 */
      intent?: unknown;
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
    //
    // 旧凭据那条路分两档（2026-10-02）：
    //   · `intent="reserve"` → **deny**。它是会**拒绝客户操作**的新机关，不该由一个
    //     身份不可证的调用方驱动（共享口令每个产品同一个值，请求体里的 `product` 是自报的）。
    //     它 2026-10-01 才上、没有任何产品在用，所以收紧**零破坏**。
    //   · 缺省的 `report` → 仍 `trust-declared`。它承载在产的用量上报流量，收紧之前必须
    //     先与五个对接方换凭据（E2/E3，owner 的取舍 + 对外协调）。
    //     **这一格是已登记的缺口，不是被忽略的缺口**：见
    //     `scripts/guardrails/s2s-legacy-scope.snapshot.json`。
    const { workspaceId } = scopeToS2sCaller(
      s2sCaller,
      {
        workspaceId: parsed.workspaceId,
        productCodes: [parsed.productCode],
      },
      parsed.intent === "reserve" ? "deny" : "trust-declared",
    );

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
      // 不接这一环，reserve 整条分支就是死代码——类型检查看不出来（intent 可选，
      // 不传完全合法），只有顺着调用链问「这个值从哪来、到哪去」才看得见。
      ...(parsed.intent ? { intent: parsed.intent } : {}),
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
    // 配额没覆盖住这次调用（2026-09-28 第二批）：库里本来一行都不留，运营看不见。
    // 这一刻顺手写一条运营通告——一个计费周期一条，见 noteQuotaExhausted。
    // 它自己已经不抛；这里再包一层是因为**响应不能因为通告而变**：调用方已经完成了扣减，
    // 让它收到 500 会让它以为用量没记上，然后重试（幂等键挡得住，但它会以为失败了）。
    if (responseBody.gated) {
      try {
        await this.usage.noteQuotaExhausted({
          workspaceId,
          productCode: parsed.productCode,
          metric: parsed.metric,
          amount: parsed.amount,
          remainingTotal: responseBody.remaining_total,
          pools,
          /* 409 = 预留被拒。通告文案按它分两档——判据取**这一刻真的回了什么**，
             不重新推一遍。 */
          denied: statusCode === 409,
        });
      } catch (err) {
        this.logger.warn(
          `配额耗尽的运营通告没写成（${parsed.productCode} / ${parsed.metric}）— ${String(err)}`,
        );
      }
    }
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
    // 旧凭据：`trust-declared`（在产的存量观测上报走这条，收紧要先换凭据）。
    const { workspaceId } = scopeToS2sCaller(
      s2sCaller,
      {
        workspaceId: parsed.workspaceId,
        productCodes: [parsed.productCode],
      },
      "trust-declared",
    );

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
