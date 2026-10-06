/**
 * credit-rates.service.ts —— `metering.token_credit_rates` 的读写（ADR-014 PR1）。
 * @package @vxture/platform-api
 * @layer BFF
 *
 * ADR-013 建好了这张表、消耗侧也在读它（`token-usage.service` 的 `pickRate`），但一直
 * 只有 seed+迁移能写。ADR-014 把换算/定价功能搬到 admin：admin 按「每模型成本 ÷
 * ((1−目标毛利)×锚价)」逐维反推出 credit 费率后，经 admin-bff 调本服务落库。
 *
 * **不可改语义（沿用 ADR-013 D4）**：费率行一旦生效就不改价——调价 = 关掉同作用域那条
 * 还开着的行（写 `effective_to`）+ 插一条新 `effective_from` 的行。所以本服务只做两件写：
 * 新建（在一个事务里先关旧、再插新）与关闭（撤下某作用域的覆盖，让消费侧回落到更粗的档）。
 * 永远不 UPDATE 价列——那会把历史上已按旧价扣过的账改写成另一套，不可复算。
 *
 * 作用域三档（provider/model 是否为 NULL）与优先级 model > provider > default 都由
 * 消费侧的 `pickRate` 在查询时解析，本服务不重复那套逻辑，只按（provider,model）这对
 * 作用域键定位"同一档的那条开着的行"。
 */

import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

/** 一行费率。bigint 列经 pg 回来是字符串，原样透出，不在 JS number 里折精度。 */
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

/** 新建一条费率的入参。六个价字段是已校验的非负整数字符串（micro）。 */
export interface CreateCreditRateInput {
  providerCode: string | null;
  modelCode: string | null;
  inputMicroPer1k: string;
  outputMicroPer1k: string;
  cacheWriteMicroPer1k: string;
  cacheReadMicroPer1k: string;
  rerankMicroPerCandidate: string;
  parseMicroPerPage: string;
  /** 生效时刻；默认取 now()。关旧行用的也是它。 */
  effectiveFrom: Date;
  note: string | null;
  /** 发起这次调价的运营者（admin.operator_accounts）；可空。 */
  createdBy: string | null;
}

export class CreditRateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditRateConflictError";
  }
}

const RATE_COLUMNS = `id, provider_code, model_code,
  input_micro_per_1k::text, output_micro_per_1k::text,
  cache_write_micro_per_1k::text, cache_read_micro_per_1k::text,
  rerank_micro_per_candidate::text, parse_micro_per_page::text,
  effective_from, effective_to, note, created_by, created_at`;

@Injectable()
export class CreditRatesService {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  /**
   * 列出费率。`includeHistory=false`（默认）只给当下生效的（窗口含 now()）；true 给全部，
   * 用来在 admin 画每个作用域的生效时间轴。排序与 `pickRate` 同序：越具体越前、同档新窗在前。
   */
  async list(opts: {
    includeHistory: boolean;
    providerCode?: string | null;
    modelCode?: string | null;
  }): Promise<CreditRateRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (!opts.includeHistory) {
      where.push("effective_from <= now()");
      where.push("(effective_to is null or effective_to > now())");
    }
    if (opts.providerCode !== undefined) {
      params.push(opts.providerCode);
      where.push(`provider_code is not distinct from $${params.length}`);
    }
    if (opts.modelCode !== undefined) {
      params.push(opts.modelCode);
      where.push(`model_code is not distinct from $${params.length}`);
    }
    const res = await this.pool.query<CreditRateRow>(
      `select ${RATE_COLUMNS}
         from metering.token_credit_rates
        ${where.length ? `where ${where.join(" and ")}` : ""}
        order by (model_code is not null) desc, (provider_code is not null) desc,
                 effective_from desc`,
      params,
    );
    return res.rows;
  }

  /**
   * 新建一条费率。一个事务里：先把**同一作用域**那条还开着、且早于新生效时刻的行关到
   * 新生效时刻，再插新行。作用域键用 `coalesce(_,'')` 对齐表上的唯一索引（NULL 折成 ''）。
   *
   * 同一作用域若已有一条 `effective_from` 恰等于新生效时刻的行（多半是重复提交），插入会
   * 撞唯一索引——转成 `CreditRateConflictError`，由 router 回 409，而不是 500。
   */
  async create(
    input: CreateCreditRateInput,
  ): Promise<{ created: CreditRateRow; closedId: string | null }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const closed = await client.query<{ id: string }>(
        `update metering.token_credit_rates
            set effective_to = $3
          where coalesce(provider_code,'') = coalesce($1,'')
            and coalesce(model_code,'')    = coalesce($2,'')
            and effective_to is null
            and effective_from < $3
        returning id`,
        [input.providerCode, input.modelCode, input.effectiveFrom],
      );
      const created = await client.query<CreditRateRow>(
        `insert into metering.token_credit_rates
           (provider_code, model_code, input_micro_per_1k, output_micro_per_1k,
            cache_write_micro_per_1k, cache_read_micro_per_1k,
            rerank_micro_per_candidate, parse_micro_per_page,
            effective_from, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         returning ${RATE_COLUMNS}`,
        [
          input.providerCode,
          input.modelCode,
          input.inputMicroPer1k,
          input.outputMicroPer1k,
          input.cacheWriteMicroPer1k,
          input.cacheReadMicroPer1k,
          input.rerankMicroPerCandidate,
          input.parseMicroPerPage,
          input.effectiveFrom,
          input.note,
          input.createdBy,
        ],
      );
      await client.query("commit");
      return {
        created: created.rows[0]!,
        closedId: closed.rows[0]?.id ?? null,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      /* 23505 = unique_violation：同作用域同一生效时刻已有一行。 */
      if (
        error &&
        typeof error === "object" &&
        (error as { code?: string }).code === "23505"
      ) {
        throw new CreditRateConflictError(
          "同一作用域在这个生效时刻已有一条费率——换一个生效时刻，或先关掉那一条。",
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 关闭一条还开着的费率（撤下覆盖）。不是删——历史行留着可复算。关掉一条单模型覆盖后，
   * 该模型的调用会在消费侧回落到更粗的档（供应商档或默认兜底）。
   */
  async close(id: string, effectiveTo: Date): Promise<CreditRateRow | null> {
    const res = await this.pool.query<CreditRateRow>(
      `update metering.token_credit_rates
          set effective_to = $2
        where id = $1 and effective_to is null and effective_from <= $2
      returning ${RATE_COLUMNS}`,
      [id, effectiveTo],
    );
    return res.rows[0] ?? null;
  }
}
