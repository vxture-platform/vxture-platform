/**
 * token-usage.service.ts — 原始 token 用量接收（vxture-platform#547 / atlas ADR-010 / 本仓 ADR-013）。
 *
 * Atlas 替各产品上报的推理用量，**按调用方产品归属**，原始事实与额度扣减分两层：
 *   ① 原始行落 `metering.token_usage_events`（append-only，四维 token 互不重叠、occurred_at =
 *      调用发生时刻）—— 换算规则随时会改，原始事实都在，可重算；
 *   ② 按 `metering.token_credit_rates`（运营可改的数据）换算成微 credit，加上该（工作空间 × 调用方
 *      产品）的小数结转（owner 2026-10-03「按工作区累计小数」），整数部分走**现有 consume 引擎**
 *      扣 `ai.credit` 池、写 `usage_events` —— 单一计量入口（metering §11）不破，幂等 / 瀑布 / 回执全部复用。
 *
 * 不换算的三种情况（owner 2026-10-03）：补报的历史（pre_cutover）、故障转移里失败的尝试
 * （failed_attempt：上游收了钱、客户没拿到结果，不扣客户）、发生时刻没有任何生效费率（no_rate：
 * 配置缺口不是客户的错）。三种都**照记原始行**，只是 credits_micro 为空、skip_reason 说清为什么。
 *
 * ── 事务边界（和为什么是两段）──
 * consume 引擎自开连接、自开事务（pg-consume.repository），没法包进本服务的事务。所以：
 *   tx1：幂等占位 → 费率 → 结转推进 → 原始行 → 回填幂等行（token_event_id / whole_due）→ commit
 *   tx2：consume（引擎自己的事务）→ 成功则回填 usage_event_id
 * tx2 失败时 tx1 已提交：原始事实与结转都在，只是扣减那一步没做成。**不静默**：记 error，且幂等行
 * `usage_event_id IS NULL AND whole_due > 0` 就是「待重放」—— 同键再来一次（Atlas 重试 / 补报）会
 * 走重放分支并**再试一次 consume**（引擎的幂等键挡住双扣），自愈，不必人工 replay。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { ConsumeService } from "@vxture/service-subscription";
import type {
  TokenCreditSkipReason,
  TokenUsageOutcome,
} from "@vxture-platform/shared";
import type { EngineConsumeResult } from "./usage-view";

const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

/** 1 credit = 1,000,000 微 credit。池里的 ai.credit 是整数，小数在结转表里攒。 */
export const MICRO_PER_CREDIT = 1_000_000n;
/** 换算后扣的是平台级共享键 ai.credit（product.platform_metrics，atomic / 月重置 / 恒硬限）。 */
export const CREDIT_METRIC_KEY = "ai.credit";
/** 走 consume 引擎时的幂等键前缀：与 Atlas 自己可能直接用 request_id 发的旧形态 consume 区分开。 */
export const CREDIT_IDEMPOTENCY_PREFIX = "tok";

export interface TokenUsageTokens {
  input: bigint;
  output: bigint;
  cacheWrite: bigint;
  cacheRead: bigint;
}

export interface TokenUsageInput {
  workspaceId: string;
  /** 调用方产品（S2S 令牌里的 act.sub），不是 atlas。 */
  productId: string;
  productCode: string;
  /** Atlas 一次逻辑请求一个；与 attempt_index 一起构成幂等键。 */
  requestId: string;
  attemptIndex: number;
  outcome: TokenUsageOutcome;
  /** 调用发生时刻（Atlas 的 started_at），不是上报时刻。 */
  occurredAt: Date;
  modelCode?: string;
  providerCode?: string;
  tokens: TokenUsageTokens;
  reasoningTokens?: bigint;
  rerankCandidates?: number;
  parsePages?: number;
  /** 补报历史：只记事实、不换算、不扣（owner 2026-10-03）。 */
  backfill: boolean;
}

export interface TokenUsageResult {
  tokenEventId: string | null;
  creditsMicro: bigint | null;
  creditSkipReason: TokenCreditSkipReason | null;
  /** 结转之后这次该扣的整数 credit（0 = 只进了结转）。 */
  wholeDue: bigint;
  /** 扣减那一行 usage_events.id；没扣（wholeDue=0 / 跳过 / 引擎失败）为 null。 */
  usageEventId: string | null;
  /** 引擎回的结果（有扣减时）；用于算 gated / remaining 等回执字段。 */
  consume: EngineConsumeResult | null;
  replayed: boolean;
  /** 本次扣减那一步没做成（引擎不可达等）；原始行与结转已提交，待同键重放自愈。 */
  settleFailed: boolean;
}

interface RateRow {
  id: string;
  input_micro_per_1k: string;
  output_micro_per_1k: string;
  cache_write_micro_per_1k: string;
  cache_read_micro_per_1k: string;
  rerank_micro_per_candidate: string;
  parse_micro_per_page: string;
}

interface IdemRow {
  token_event_id: string | null;
  credits_micro: string | null;
  credit_skip_reason: TokenCreditSkipReason | null;
  whole_due: string;
  usage_event_id: string | null;
}

/**
 * 纯函数：四维 token（每 1K 单价）+ rerank 候选 / parse 页（每单位单价）→ 微 credit。
 * 用 BigInt：token 数与单价都可能很大，Number 在 2^53 之上会静默失真。
 * `/ 1000n` 是整除（向下）：丢掉的是不到 1 微 credit（1e-9 credit）的零头，可忽略。
 */
export function creditsFor(
  tokens: TokenUsageTokens,
  rate: {
    inputMicroPer1k: bigint;
    outputMicroPer1k: bigint;
    cacheWriteMicroPer1k: bigint;
    cacheReadMicroPer1k: bigint;
    rerankMicroPerCandidate: bigint;
    parseMicroPerPage: bigint;
  },
  extras: { rerankCandidates?: number; parsePages?: number } = {},
): bigint {
  const perToken =
    tokens.input * rate.inputMicroPer1k +
    tokens.output * rate.outputMicroPer1k +
    tokens.cacheWrite * rate.cacheWriteMicroPer1k +
    tokens.cacheRead * rate.cacheReadMicroPer1k;
  const units =
    BigInt(extras.rerankCandidates ?? 0) * rate.rerankMicroPerCandidate +
    BigInt(extras.parsePages ?? 0) * rate.parseMicroPerPage;
  return perToken / 1000n + units;
}

/**
 * 纯函数：结转。本次微 credit 加上余额，整数部分扣、小数部分留。
 * 余额恒在 [0, 1e6)（DB CHECK 兜着同一条不变量）。
 */
export function splitCarry(
  carryMicro: bigint,
  creditsMicro: bigint,
): { whole: bigint; carry: bigint } {
  const total = carryMicro + creditsMicro;
  return { whole: total / MICRO_PER_CREDIT, carry: total % MICRO_PER_CREDIT };
}

@Injectable()
export class TokenUsageService {
  private readonly logger = new Logger(TokenUsageService.name);

  // Nest × esbuild：不保留装饰器元数据，令牌必须显式写（仓内通例）。
  constructor(
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(ConsumeService) private readonly consumeService: ConsumeService,
  ) {}

  async ingest(input: TokenUsageInput): Promise<TokenUsageResult> {
    const client = await this.pool.connect();
    let committed: {
      tokenEventId: string;
      creditsMicro: bigint | null;
      skip: TokenCreditSkipReason | null;
      whole: bigint;
    };
    try {
      await client.query("begin");

      // 1. 幂等占位（键带归属 + attempt_index，与 §8 同一个理由：request_id 由 Atlas 自选）
      const claim = await client.query(
        `insert into metering.token_usage_idempotencies
           (workspace_id, product_id, request_id, attempt_index, created_at)
         values ($1, $2, $3, $4, now())
         on conflict (workspace_id, product_id, request_id, attempt_index) do nothing
         returning request_id`,
        [
          input.workspaceId,
          input.productId,
          input.requestId,
          input.attemptIndex,
        ],
      );
      if ((claim.rowCount ?? 0) === 0) {
        const prev = await client.query<IdemRow>(
          `select token_event_id, credits_micro, credit_skip_reason, whole_due, usage_event_id
             from metering.token_usage_idempotencies
            where workspace_id = $1 and product_id = $2 and request_id = $3 and attempt_index = $4
            for share`,
          [
            input.workspaceId,
            input.productId,
            input.requestId,
            input.attemptIndex,
          ],
        );
        await client.query("commit");
        client.release();
        return this.replay(input, prev.rows[0]);
      }

      // 2. 要不要换算，以及按哪条费率
      let skip: TokenCreditSkipReason | null =
        input.outcome === "failed"
          ? "failed_attempt"
          : input.backfill
            ? "pre_cutover"
            : null;
      let rate: RateRow | null = null;
      if (!skip) {
        rate = await this.pickRate(client, input);
        if (!rate) skip = "no_rate";
      }
      const creditsMicro =
        skip || !rate
          ? null
          : creditsFor(
              input.tokens,
              {
                inputMicroPer1k: BigInt(rate.input_micro_per_1k),
                outputMicroPer1k: BigInt(rate.output_micro_per_1k),
                cacheWriteMicroPer1k: BigInt(rate.cache_write_micro_per_1k),
                cacheReadMicroPer1k: BigInt(rate.cache_read_micro_per_1k),
                rerankMicroPerCandidate: BigInt(
                  rate.rerank_micro_per_candidate,
                ),
                parseMicroPerPage: BigInt(rate.parse_micro_per_page),
              },
              {
                ...(input.rerankCandidates !== undefined
                  ? { rerankCandidates: input.rerankCandidates }
                  : {}),
                ...(input.parsePages !== undefined
                  ? { parsePages: input.parsePages }
                  : {}),
              },
            );

      // 3. 结转推进（只有真有换算结果时才碰结转表；FOR UPDATE 串行化同一（空间 × 产品）的并发上报）
      let whole = 0n;
      if (creditsMicro !== null && creditsMicro > 0n) {
        await client.query(
          `insert into metering.token_credit_carry (workspace_id, product_id, carry_micro)
           values ($1, $2, 0)
           on conflict (workspace_id, product_id) do nothing`,
          [input.workspaceId, input.productId],
        );
        const carryRes = await client.query<{ carry_micro: string }>(
          `select carry_micro from metering.token_credit_carry
            where workspace_id = $1 and product_id = $2
            for update`,
          [input.workspaceId, input.productId],
        );
        const carry = BigInt(carryRes.rows[0]?.carry_micro ?? "0");
        const split = splitCarry(carry, creditsMicro);
        whole = split.whole;
        await client.query(
          `update metering.token_credit_carry
              set carry_micro = $3, updated_at = now()
            where workspace_id = $1 and product_id = $2`,
          [input.workspaceId, input.productId, split.carry.toString()],
        );
      }

      // 4. 原始行（append-only；分区键 created_at 由 DEFAULT now() 给，不经 JS 往返）
      const ev = await client.query<{ id: string; created_at: Date }>(
        `insert into metering.token_usage_events
           (workspace_id, product_id, request_id, attempt_index, outcome, occurred_at,
            model_code, provider_code,
            input_tokens, output_tokens, cache_write_tokens, cache_read_tokens,
            reasoning_tokens, rerank_candidates, parse_pages,
            credits_micro, credit_skip_reason, rate_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         returning id, created_at`,
        [
          input.workspaceId,
          input.productId,
          input.requestId,
          input.attemptIndex,
          input.outcome,
          input.occurredAt,
          input.modelCode ?? null,
          input.providerCode ?? null,
          input.tokens.input.toString(),
          input.tokens.output.toString(),
          input.tokens.cacheWrite.toString(),
          input.tokens.cacheRead.toString(),
          input.reasoningTokens !== undefined
            ? input.reasoningTokens.toString()
            : null,
          input.rerankCandidates ?? null,
          input.parsePages ?? null,
          creditsMicro !== null ? creditsMicro.toString() : null,
          skip,
          rate?.id ?? null,
        ],
      );
      const row = ev.rows[0]!;

      // 5. 回填幂等行（扣减那一步的回填位在这里，因为原始行不可更新）
      await client.query(
        `update metering.token_usage_idempotencies
            set token_event_id = $5, token_event_created_at = $6,
                credits_micro = $7, credit_skip_reason = $8, whole_due = $9
          where workspace_id = $1 and product_id = $2 and request_id = $3 and attempt_index = $4`,
        [
          input.workspaceId,
          input.productId,
          input.requestId,
          input.attemptIndex,
          row.id,
          row.created_at,
          creditsMicro !== null ? creditsMicro.toString() : null,
          skip,
          whole.toString(),
        ],
      );
      await client.query("commit");
      committed = { tokenEventId: row.id, creditsMicro, skip, whole };
    } catch (err) {
      await client.query("rollback");
      client.release();
      throw err;
    }
    client.release();

    // 6. 扣减（引擎自己的事务）；失败不抛——原始事实已提交，待同键重放自愈
    const settled = await this.settle(input, committed.whole);
    return {
      tokenEventId: committed.tokenEventId,
      creditsMicro: committed.creditsMicro,
      creditSkipReason: committed.skip,
      wholeDue: committed.whole,
      usageEventId: settled.usageEventId,
      consume: settled.consume,
      replayed: false,
      settleFailed: settled.failed,
    };
  }

  /**
   * 重放：回先前结果；若扣减那一步当时没做成（usage_event_id 空而 whole_due > 0），再试一次 ——
   * 引擎按 (workspace, product, 幂等键) 挡住双扣，所以重试是安全的。
   */
  private async replay(
    input: TokenUsageInput,
    prev: IdemRow | undefined,
  ): Promise<TokenUsageResult> {
    const wholeDue = BigInt(prev?.whole_due ?? "0");
    let usageEventId = prev?.usage_event_id ?? null;
    let consume: EngineConsumeResult | null = null;
    let failed = false;
    if (wholeDue > 0n && !usageEventId) {
      const settled = await this.settle(input, wholeDue);
      usageEventId = settled.usageEventId;
      consume = settled.consume;
      failed = settled.failed;
    }
    return {
      tokenEventId: prev?.token_event_id ?? null,
      creditsMicro:
        prev?.credits_micro != null ? BigInt(prev.credits_micro) : null,
      creditSkipReason: prev?.credit_skip_reason ?? null,
      wholeDue,
      usageEventId,
      consume,
      replayed: true,
      settleFailed: failed,
    };
  }

  /** 走现有 consume 引擎扣 ai.credit；成功回填 usage_event_id。永不抛。 */
  private async settle(
    input: TokenUsageInput,
    whole: bigint,
  ): Promise<{
    usageEventId: string | null;
    consume: EngineConsumeResult | null;
    failed: boolean;
  }> {
    if (whole <= 0n)
      return { usageEventId: null, consume: null, failed: false };
    try {
      const result = await this.consumeService.consume({
        workspaceId: input.workspaceId,
        productId: input.productId,
        metricKey: CREDIT_METRIC_KEY,
        amount: whole.toString(),
        idempotencyKey: `${CREDIT_IDEMPOTENCY_PREFIX}:${input.requestId}:${input.attemptIndex}`,
        requestId: input.requestId,
        // 事后报账：调用方已经把事做了，永远记账、永远 200（2026-08-10 裁定那一档）。
        intent: "report",
      });
      if (result.eventId) {
        await this.pool.query(
          `update metering.token_usage_idempotencies
              set usage_event_id = $5
            where workspace_id = $1 and product_id = $2 and request_id = $3 and attempt_index = $4`,
          [
            input.workspaceId,
            input.productId,
            input.requestId,
            input.attemptIndex,
            result.eventId,
          ],
        );
      }
      return {
        usageEventId: result.eventId ?? null,
        consume: result,
        failed: false,
      };
    } catch (err) {
      this.logger.error(
        `token usage settle failed (workspace=${input.workspaceId} product=${input.productCode} ` +
          `request=${input.requestId}#${input.attemptIndex} whole=${whole}) — 原始行与结转已提交，` +
          `usage_event_id 留空待同键重放自愈: ${String(err)}`,
      );
      return { usageEventId: null, consume: null, failed: true };
    }
  }

  /**
   * 选费率：按 occurred_at 落在生效窗口内，模型精确 > 供应商 > 默认档。
   * 一行都没有 = 配置缺口（no_rate），照记事实不扣。
   */
  private async pickRate(
    client: PoolClient,
    input: TokenUsageInput,
  ): Promise<RateRow | null> {
    const res = await client.query<RateRow>(
      `select id, input_micro_per_1k, output_micro_per_1k, cache_write_micro_per_1k,
              cache_read_micro_per_1k, rerank_micro_per_candidate, parse_micro_per_page
         from metering.token_credit_rates
        where effective_from <= $3
          and (effective_to is null or effective_to > $3)
          and (model_code is null or model_code = $2)
          and (provider_code is null or provider_code = $1)
        order by (model_code is not null) desc, (provider_code is not null) desc, effective_from desc
        limit 1`,
      [input.providerCode ?? null, input.modelCode ?? null, input.occurredAt],
    );
    return res.rows[0] ?? null;
  }
}
