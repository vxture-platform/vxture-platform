/**
 * credit-pricing.router.ts —— 积分换算（token→credit 费率）的 admin 面读写（ADR-014 PR3a）。
 * @package @vxture/bff-admin
 * @layer BFF
 *
 * 换算功能归 admin（ADR-014 D5）：admin-bff 用自己的运营会话鉴权、直写平台库 metering
 * （与它直写 billing.* 同一套 RW 池与先例），不经 platform-api——费率写是运营/admin 面动作，
 * 不是产品 S2S 能驱动的。
 *
 * 读/写两个能力码（与 pricing:price_rule.* 并列的第三资源）：
 *   · pricing:credit_rate.read   —— 看配置、看费率、看推导预览
 *   · pricing:credit_rate.manage —— 改锚价/目标毛利、应用推导出的费率
 *
 * 费率行**不可改**（沿用 ADR-013 D4）：调价 = 事务内先关同作用域旧窗口（写 effective_to）、
 * 再插一条新 effective_from 的行，永不 UPDATE 价列（列锁 98 也挡着）。推导在服务端用共享工具
 * `credit-rate-derivation`（分维反推，各模型毛利趋同），锚价/目标毛利取自单例配置表。
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Put,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { assertAnyCapability } from "../auth/capability";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/console.types";
import {
  deriveFourDimRate,
  type PricingConfig,
  type VendorFourDim,
} from "../lib/credit-rate-derivation";

const READ = ["pricing:credit_rate.read", "pricing:credit_rate.manage"];
const MANAGE = ["pricing:credit_rate.manage"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireOperator(req: Request & RequestContext): string {
  const id = req.user?.id;
  if (!id || !UUID_RE.test(id)) {
    throw new UnauthorizedException("Invalid platform admin principal");
  }
  return id;
}

/** 非负整数（micro / bps 等），接受数字或字符串，统一回字符串；负数/非整数/溢出 400。 */
function nonNegIntStr(value: unknown, field: string): string {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${field} 要非负整数`);
    }
    return String(value);
  }
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    return value.trim();
  }
  throw new BadRequestException(`${field} 要非负整数`);
}

function scopeOrNull(
  value: unknown,
  field: string,
  max: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string")
    throw new BadRequestException(`${field} 要字符串`);
  const t = value.trim();
  if (t === "") return null;
  if (t.length > max)
    throw new BadRequestException(`${field} 过长（上限 ${max}）`);
  return t;
}

function decimalOrNull(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && /^\d+(\.\d+)?$/u.test(value.trim())) {
    return value.trim();
  }
  throw new BadRequestException(`${field} 要非负十进制`);
}

function toInstant(value: unknown, field: string): Date {
  if (value === undefined || value === null || value === "") return new Date();
  if (typeof value !== "string")
    throw new BadRequestException(`${field} 要 ISO 时间`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime()))
    throw new BadRequestException(`${field} 不是合法时间`);
  return d;
}

export interface CreditPricingConfigView {
  anchor_micro_cny_per_credit: string;
  target_margin_bps: number;
  updated_by: string | null;
  updated_at: string;
}

export interface CreditRateRow {
  id: string;
  provider_code: string | null;
  model_code: string | null;
  input_micro_per_1k: string;
  output_micro_per_1k: string;
  cache_write_micro_per_1k: string;
  cache_read_micro_per_1k: string;
  rerank_micro_per_candidate: string;
  parse_micro_per_page: string;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

const RATE_COLS = `id, provider_code, model_code,
  input_micro_per_1k::text, output_micro_per_1k::text,
  cache_write_micro_per_1k::text, cache_read_micro_per_1k::text,
  rerank_micro_per_candidate::text, parse_micro_per_page::text,
  effective_from, effective_to, note, created_by, created_at`;

@Controller("api/credit-pricing")
export class CreditPricingRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  /** GET 配置：锚价（micro-CNY/credit）+ 目标毛利（bps）。 */
  @Get("config")
  async getConfig(
    @Req() req: Request & RequestContext,
  ): Promise<CreditPricingConfigView> {
    assertAnyCapability(req, READ);
    const { rows } = await this.pool.query<CreditPricingConfigView>(
      `select anchor_micro_cny_per_credit::text as anchor_micro_cny_per_credit,
              target_margin_bps, updated_by, updated_at
         from metering.credit_pricing_config where singleton`,
    );
    if (!rows[0]) {
      throw new ConflictException(
        "换算配置缺失——先跑 2026-12-03-credit-pricing-config 迁移/种子。",
      );
    }
    return rows[0];
  }

  /** PUT 配置：改锚价/目标毛利（manage）。upsert 单例一行，只动可改列。 */
  @Put("config")
  async setConfig(
    @Req() req: Request & RequestContext,
    @Body()
    body: {
      anchor_micro_cny_per_credit?: unknown;
      target_margin_bps?: unknown;
    },
  ): Promise<CreditPricingConfigView> {
    assertAnyCapability(req, MANAGE);
    const operator = requireOperator(req);
    const anchor = nonNegIntStr(
      body.anchor_micro_cny_per_credit,
      "anchor_micro_cny_per_credit",
    );
    if (anchor === "0") {
      throw new BadRequestException("锚价必须 > 0");
    }
    const margin = Number(
      nonNegIntStr(body.target_margin_bps, "target_margin_bps"),
    );
    if (margin >= 10000) {
      throw new BadRequestException("目标毛利 bps 必须 < 10000（100% 无解）");
    }
    const { rows } = await this.rwPool.query<CreditPricingConfigView>(
      `insert into metering.credit_pricing_config
         (singleton, anchor_micro_cny_per_credit, target_margin_bps, updated_by, updated_at)
       values (true, $1, $2, $3, now())
       on conflict (singleton) do update
         set anchor_micro_cny_per_credit = excluded.anchor_micro_cny_per_credit,
             target_margin_bps           = excluded.target_margin_bps,
             updated_by                  = excluded.updated_by,
             updated_at                  = now()
       returning anchor_micro_cny_per_credit::text as anchor_micro_cny_per_credit,
                 target_margin_bps, updated_by, updated_at`,
      [anchor, margin, operator],
    );
    return rows[0]!;
  }

  /** GET 费率：includeHistory=false（默认）只给当下生效窗口。 */
  @Get("rates")
  async listRates(
    @Req() req: Request & RequestContext,
  ): Promise<{ rates: CreditRateRow[] }> {
    assertAnyCapability(req, READ);
    const includeHistory =
      typeof req.query?.["includeHistory"] === "string" &&
      req.query["includeHistory"] === "true";
    const where = includeHistory
      ? ""
      : "where effective_from <= now() and (effective_to is null or effective_to > now())";
    const { rows } = await this.pool.query<CreditRateRow>(
      `select ${RATE_COLS} from metering.token_credit_rates
        ${where}
        order by (model_code is not null) desc, (provider_code is not null) desc, effective_from desc`,
    );
    return { rates: rows };
  }

  /**
   * POST 推导预览（read）：给定每模型供应商四维成本 + 当前配置，逐维反推 credit 费率。
   * 不写库——换算面「应用」前让运营看一眼各模型推出来的费率（毛利按 target 收敛）。
   */
  @Post("rates/derive")
  async derive(
    @Req() req: Request & RequestContext,
    @Body()
    body: {
      models?: Array<{
        provider_code?: unknown;
        model_code?: unknown;
        unit_tokens?: unknown;
        input_unit_price?: unknown;
        output_unit_price?: unknown;
        cached_input_unit_price?: unknown;
        cache_write_unit_price?: unknown;
      }>;
    },
  ): Promise<{
    target_margin_bps: number;
    anchor_micro_cny_per_credit: string;
    derived: Array<{
      provider_code: string | null;
      model_code: string | null;
      input_micro_per_1k: string;
      output_micro_per_1k: string;
      cache_read_micro_per_1k: string;
      cache_write_micro_per_1k: string;
    }>;
  }> {
    assertAnyCapability(req, READ);
    const cfg = await this.loadConfig();
    const models = Array.isArray(body.models) ? body.models : [];
    const derived = models.map((m) => {
      const unitTokens = Number(m.unit_tokens ?? 1_000_000);
      if (!Number.isInteger(unitTokens) || unitTokens <= 0) {
        throw new BadRequestException("unit_tokens 要正整数");
      }
      const vendor: VendorFourDim = {
        unitTokens,
        inputUnitPrice:
          decimalOrNull(m.input_unit_price, "input_unit_price") ?? "0",
        outputUnitPrice:
          decimalOrNull(m.output_unit_price, "output_unit_price") ?? "0",
        cachedInputUnitPrice: decimalOrNull(
          m.cached_input_unit_price,
          "cached_input_unit_price",
        ),
        cacheWriteUnitPrice: decimalOrNull(
          m.cache_write_unit_price,
          "cache_write_unit_price",
        ),
      };
      const r = deriveFourDimRate(vendor, cfg);
      return {
        provider_code: scopeOrNull(m.provider_code, "provider_code", 64),
        model_code: scopeOrNull(m.model_code, "model_code", 128),
        input_micro_per_1k: r.inputMicroPer1k,
        output_micro_per_1k: r.outputMicroPer1k,
        cache_read_micro_per_1k: r.cacheReadMicroPer1k,
        cache_write_micro_per_1k: r.cacheWriteMicroPer1k,
      };
    });
    return {
      target_margin_bps: cfg.targetMarginBps,
      anchor_micro_cny_per_credit: cfg.anchorMicroCnyPerCredit.toString(),
      derived,
    };
  }

  /**
   * POST 应用一条费率（manage）：事务内先关同作用域旧窗口、再插新行——调价=开新窗口，
   * 永不改价列（不可改语义，可复算）。
   */
  @Post("rates")
  async applyRate(
    @Req() req: Request & RequestContext,
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
    },
  ): Promise<{ created: CreditRateRow; closed_id: string | null }> {
    assertAnyCapability(req, MANAGE);
    const operator = requireOperator(req);
    const provider = scopeOrNull(body.provider_code, "provider_code", 64);
    const model = scopeOrNull(body.model_code, "model_code", 128);
    const vals = {
      input: nonNegIntStr(body.input_micro_per_1k, "input_micro_per_1k"),
      output: nonNegIntStr(body.output_micro_per_1k, "output_micro_per_1k"),
      cacheWrite: nonNegIntStr(
        body.cache_write_micro_per_1k,
        "cache_write_micro_per_1k",
      ),
      cacheRead: nonNegIntStr(
        body.cache_read_micro_per_1k,
        "cache_read_micro_per_1k",
      ),
      rerank: nonNegIntStr(
        body.rerank_micro_per_candidate ?? 0,
        "rerank_micro_per_candidate",
      ),
      parse: nonNegIntStr(
        body.parse_micro_per_page ?? 0,
        "parse_micro_per_page",
      ),
    };
    const effectiveFrom = toInstant(body.effective_from, "effective_from");
    const note =
      body.note === undefined || body.note === null
        ? null
        : String(body.note).slice(0, 256);

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");
      const closed = await client.query<{ id: string }>(
        `update metering.token_credit_rates set effective_to = $3
          where coalesce(provider_code,'') = coalesce($1,'')
            and coalesce(model_code,'')    = coalesce($2,'')
            and effective_to is null and effective_from < $3
        returning id`,
        [provider, model, effectiveFrom],
      );
      const created = await client.query<CreditRateRow>(
        `insert into metering.token_credit_rates
           (provider_code, model_code, input_micro_per_1k, output_micro_per_1k,
            cache_write_micro_per_1k, cache_read_micro_per_1k,
            rerank_micro_per_candidate, parse_micro_per_page, effective_from, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         returning ${RATE_COLS}`,
        [
          provider,
          model,
          vals.input,
          vals.output,
          vals.cacheWrite,
          vals.cacheRead,
          vals.rerank,
          vals.parse,
          effectiveFrom,
          note,
          operator,
        ],
      );
      await client.query("commit");
      return {
        created: created.rows[0]!,
        closed_id: closed.rows[0]?.id ?? null,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (
        error &&
        typeof error === "object" &&
        (error as { code?: string }).code === "23505"
      ) {
        throw new ConflictException(
          "同一作用域在这个生效时刻已有一条费率——换个生效时刻或先关掉那条。",
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadConfig(): Promise<PricingConfig> {
    const { rows } = await this.pool.query<{
      anchor: string;
      target_margin_bps: number;
    }>(
      `select anchor_micro_cny_per_credit::text as anchor, target_margin_bps
         from metering.credit_pricing_config where singleton`,
    );
    if (!rows[0]) {
      throw new ConflictException("换算配置缺失——先跑迁移/种子。");
    }
    return {
      anchorMicroCnyPerCredit: BigInt(rows[0].anchor),
      targetMarginBps: rows[0].target_margin_bps,
    };
  }
}
