/**
 * platform-credit-rates.router.ts —— `metering.token_credit_rates` 的读写口（ADR-014 PR1）。
 * @package @vxture/platform-api
 * @layer BFF
 *
 * Server-to-server only（PlatformAuthGuard，与 C2/C3 同一套内部凭据）；nginx 不路由，
 * 只在内网可达。预期调用方是 admin-bff（换算/定价功能在 admin，ADR-014 D5）——它按
 * 每模型成本反推出四维费率后调这里落库。本 router 只做校验与落库，**不做反推**（那是
 * admin 的商业判断）；也不做作用域优先级解析（那在消费侧 `pickRate`）。
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { PlatformAuthGuard } from "../authn/platform-auth.guard";
import {
  CreditRateConflictError,
  CreditRatesService,
  type CreditRateRow,
} from "../platform/credit-rates.service";

/** 非负整数（micro）。接受数字或字符串，统一回字符串；负数/非整数/溢出都 400。 */
function toMicro(value: unknown, field: string): string {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${field} 要非负整数`);
    }
    return String(value);
  }
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    return value.trim();
  }
  throw new BadRequestException(`${field} 要非负整数（micro）`);
}

/** 作用域码：空串/缺省 → null（通配档）；否则 trim 后校验长度。 */
function toScope(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException(`${field} 要字符串`);
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} 过长（上限 ${max}）`);
  }
  return trimmed;
}

/** 可选 ISO 时间；缺省回 now()。非法时间 400。 */
function toInstant(value: unknown, field: string): Date {
  if (value === undefined || value === null || value === "") return new Date();
  if (typeof value !== "string") {
    throw new BadRequestException(`${field} 要 ISO 时间字符串`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`${field} 不是合法时间`);
  }
  return d;
}

@Controller()
@UseGuards(PlatformAuthGuard)
export class PlatformCreditRatesRouter {
  constructor(
    @Inject(CreditRatesService)
    private readonly rates: CreditRatesService,
  ) {}

  /** GET platform/credit-rates?includeHistory=&provider_code=&model_code= */
  @Get("platform/credit-rates")
  async list(
    @Query("includeHistory") includeHistory?: string,
    @Query("provider_code") providerCode?: string,
    @Query("model_code") modelCode?: string,
  ): Promise<{ rates: CreditRateRow[] }> {
    const rows = await this.rates.list({
      includeHistory: includeHistory === "true",
      /* 只有查询真带了键才作为过滤条件（区分"未过滤"与"过滤 NULL 档"）。 */
      ...(providerCode !== undefined
        ? { providerCode: providerCode === "" ? null : providerCode }
        : {}),
      ...(modelCode !== undefined
        ? { modelCode: modelCode === "" ? null : modelCode }
        : {}),
    });
    return { rates: rows };
  }

  /**
   * POST platform/credit-rates —— 新建一条费率（事务内先关同作用域旧行、再插新行）。
   * 调价走这里（开新窗口），不改旧行。
   */
  @Post("platform/credit-rates")
  async create(
    @Body()
    body: {
      provider_code?: unknown;
      model_code?: unknown;
      input_micro_per_1k?: unknown;
      output_micro_per_1k?: unknown;
      cache_write_micro_per_1k?: unknown;
      cache_read_micro_per_1k?: unknown;
      rerank_micro_per_candidate?: unknown;
      parse_micro_per_page?: unknown;
      effective_from?: unknown;
      note?: unknown;
      created_by?: unknown;
    },
  ): Promise<{ created: CreditRateRow; closed_id: string | null }> {
    const note =
      body.note === undefined || body.note === null
        ? null
        : String(body.note).slice(0, 256);
    const createdBy = toScope(body.created_by, "created_by", 64);
    try {
      const { created, closedId } = await this.rates.create({
        providerCode: toScope(body.provider_code, "provider_code", 64),
        modelCode: toScope(body.model_code, "model_code", 128),
        inputMicroPer1k: toMicro(body.input_micro_per_1k, "input_micro_per_1k"),
        outputMicroPer1k: toMicro(
          body.output_micro_per_1k,
          "output_micro_per_1k",
        ),
        cacheWriteMicroPer1k: toMicro(
          body.cache_write_micro_per_1k,
          "cache_write_micro_per_1k",
        ),
        cacheReadMicroPer1k: toMicro(
          body.cache_read_micro_per_1k,
          "cache_read_micro_per_1k",
        ),
        rerankMicroPerCandidate: toMicro(
          body.rerank_micro_per_candidate ?? 0,
          "rerank_micro_per_candidate",
        ),
        parseMicroPerPage: toMicro(
          body.parse_micro_per_page ?? 0,
          "parse_micro_per_page",
        ),
        effectiveFrom: toInstant(body.effective_from, "effective_from"),
        note,
        createdBy,
      });
      return { created, closed_id: closedId };
    } catch (error) {
      if (error instanceof CreditRateConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  /**
   * POST platform/credit-rates/:id/close —— 关掉一条还开着的费率（撤下覆盖，不是删）。
   * 关掉后该作用域的调用在消费侧回落到更粗的档。已关/不存在 → 409。
   */
  @Post("platform/credit-rates/:id/close")
  async close(
    @Param("id") id: string,
    @Body() body: { effective_to?: unknown },
  ): Promise<{ closed: CreditRateRow }> {
    const row = await this.rates.close(
      id,
      toInstant(body.effective_to, "effective_to"),
    );
    if (!row) {
      throw new ConflictException(
        "这条费率不存在、或已经关闭、或生效时刻晚于关闭时刻。",
      );
    }
    return { closed: row };
  }
}
