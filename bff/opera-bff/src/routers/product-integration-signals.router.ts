/**
 * product-integration-signals.router.ts — 接入信号：平台自己看得见的 C1 出站 / C2 / C3 事实。
 * @package @vxture/bff-opera
 * @layer Application
 * @category router
 * @description
 *   上线检查此前把 C2 权益接入、C3 计量上报写成「平台从外面观测不到」，靠操作员按对方
 *   回报勾。这不成立：对方接通之后，两件事都会在平台自己的存储里留下痕迹——
 *
 *   - **C2**：产品调 `GET /platform/entitlements`（platform-api），每次成功读取会在
 *     Redis 写一个按产品码的「最近一次」键（`integration-signal.service.ts`）。
 *   - **C3**：产品调 `POST /usage/consume`，落 `metering.usage_events`。
 *
 *   本端点把两条痕迹原样读出来，判断留给门户（`launch-checks.ts`）。两条都是
 *   **最近一次**，不是台账：C2 键 30 天过期、只存最后一笔；C3 只取最近一行。
 *   「有没有接通」这个问题这样就够答；「调了多少次」不归这里。
 *
 *   C2 键由 platform-api 写、这里读，两边各自拼同一个字符串
 *   （`<REDIS_KEY_PREFIX>integration:c2:<productCode>`）——两个 BFF 之间不许互相
 *   引用，所以形状靠注释与两边的单测互相钉住。
 *
 * @author AI-Generated
 * @date 2026-08-31
 */

import { Controller, Get, Inject, Param, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { internalError, notFound } from "../errors/api-error";
import { RP_REDIS, RP_RUNTIME, type RpRuntime } from "../oidc/oidc-rp.tokens";
import { OPERA_BFF_RO_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import { assertCanRead } from "./product-authz";
import { requireUuid, toIso } from "./router.shared";

// ============================================================================
// Types
// ============================================================================

/** C2：对方最近一次拉权益。`via` 是它用的凭据（`s2s` / `internal-auth`）。 */
export interface EntitlementSignal {
  lastSeenAt: string;
  via: string;
  /** 拉的是哪个工作区。共享内部令牌路径上取请求声明的那个；只给机器看，门户不上屏。 */
  workspaceId: string | null;
}

/** C3：对方最近一次上报用量。 */
export interface ConsumeSignal {
  lastEventAt: string;
  metricKey: string;
}

/** C1 出站：对方最近一次换票去调别的产品。`target` 是它调的谁。 */
export interface S2sSignal {
  lastSeenAt: string;
  /** 被调方产品码（审计 `after.target_product`）。 */
  target: string;
  /** `obo`（有用户在场）/ `service`（后台通道）。 */
  mode: string;
}

export interface IntegrationSignalsRecord {
  entitlement: EntitlementSignal | null;
  consume: ConsumeSignal | null;
  s2s: S2sSignal | null;
}

/** 只用到 GET；ioredis 满足它，单测给假的。 */
export interface SignalRedisReader {
  get(key: string): Promise<string | null>;
}

interface UsageEventRow {
  metric_key: string;
  created_at: Date | string;
}

interface S2sAuditRow {
  target_product: string | null;
  mode: string | null;
  created_at: Date | string;
}

// ============================================================================
// Constants
// ============================================================================

/** 与 platform-api `C2_SIGNAL_KEY_INFIX` 同一个字面量。 */
export const C2_SIGNAL_KEY_INFIX = "integration:c2:";

/**
 * C3 的回看窗口。`metering.usage_events` 按 `created_at` 月分区，谓词里带上这个下界
 * 才会做分区裁剪——否则「最近一行」要把历史分区全扫一遍。90 天对「接通了没有」
 * 足够：超过 90 天没有事件，即使曾经接通过，这一项也该重新变红让人看一眼。
 */
export const CONSUME_LOOKBACK = "90 days";

/**
 * C1 出站的回看窗口。同 C3 取 90 天，理由也同：`support.audit_logs` 按 `created_at`
 * 月分区，谓词带下界才裁剪；且超过 90 天没换过票，即使曾经接通过也该重新变红。
 */
export const S2S_LOOKBACK = "90 days";

/** 换票审计的 action 字面量，由 auth-bff 的 `TokenExchangeService.recordAudit` 写入。 */
export const S2S_AUDIT_ACTION = "oidc.token_exchange.issued";

// ============================================================================
// Helpers
// ============================================================================

/**
 * 解析 platform-api 写下的 C2 值。
 *
 * 键不存在 = 从没拉过，回 null。键在但形状不对是**本方的故障**（两边契约写错了），
 * 不能悄悄当成「没拉过」——那会让一个真接通了的产品一直红着，而日志里一个字没有。
 *
 * @throws {ApiError} 500 `INTEGRATION_SIGNAL_MALFORMED`
 */
export function parseEntitlementSignal(
  raw: string | null,
  key: string,
): EntitlementSignal | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw internalError(
      "INTEGRATION_SIGNAL_MALFORMED",
      `C2 signal at ${key} is not JSON`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { lastSeenAt?: unknown }).lastSeenAt !== "string" ||
    typeof (parsed as { via?: unknown }).via !== "string"
  ) {
    throw internalError(
      "INTEGRATION_SIGNAL_MALFORMED",
      `C2 signal at ${key} lacks lastSeenAt/via`,
    );
  }
  const value = parsed as {
    lastSeenAt: string;
    via: string;
    workspaceId?: unknown;
  };
  return {
    lastSeenAt: value.lastSeenAt,
    via: value.via,
    workspaceId:
      typeof value.workspaceId === "string" ? value.workspaceId : null,
  };
}

// ============================================================================
// Router
// ============================================================================

@Controller("api/products")
export class ProductIntegrationSignalsRouter {
  constructor(
    @Inject(OPERA_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(RP_REDIS) private readonly redis: SignalRedisReader,
    @Inject(RP_RUNTIME) private readonly rpRuntime: RpRuntime,
  ) {}

  /**
   * GET /api/products/:id/integration-signals
   *
   * @throws {ApiError} 400 `VALIDATION_INVALID_UUID` · 404 `CATALOG_PRODUCT_NOT_FOUND`
   */
  @Get(":id/integration-signals")
  async get(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<IntegrationSignalsRecord> {
    assertCanRead(req);
    const productId = requireUuid(id, "id");

    const product = await this.pool.query<{ product_code: string }>(
      `SELECT product_code FROM product.products
        WHERE id = $1 AND deleted_at IS NULL`,
      [productId],
    );
    const productCode = product.rows[0]?.product_code;
    if (!productCode) {
      throw notFound("CATALOG_PRODUCT_NOT_FOUND", "Product not found");
    }

    const key = `${this.rpRuntime.keyPrefix}${C2_SIGNAL_KEY_INFIX}${productCode}`;
    const [raw, usage, s2s] = await Promise.all([
      this.redis.get(key),
      /* 分区裁剪靠 created_at 的下界（见 CONSUME_LOOKBACK）。product_id 上没有
         单独索引（idx_usage_events_route 以 workspace_id 打头），裁剪后最多扫
         三四个月分区——对一个上线检查的点击来说够用；真到不够用那天加索引，
         不在这里改判据。 */
      this.pool.query<UsageEventRow>(
        `SELECT metric_key, created_at
           FROM metering.usage_events
          WHERE product_id = $1
            AND created_at >= now() - interval '${CONSUME_LOOKBACK}'
          ORDER BY created_at DESC
          LIMIT 1`,
        [productId],
      ),
      /*
       * C1 出站：**不新开一条写路径**。auth-bff 每次成功换票已经往
       * `support.audit_logs` 写一条（product_210 §6 的 append-only 审计），
       * 带 `after.caller_product`——那条痕迹一直在写，只是从来没人读。
       *
       * 这里按 `caller_product` 反查：调用方是本产品，说明它真的换过票去调别人。
       *
       * 查询形状：`idx_audit_logs_action` 先把行收敛到换票这一种，再靠
       * `created_at` 下界做分区裁剪，最后按 jsonb 过滤。`after->>'caller_product'`
       * **没有索引**——最坏情况是「这个产品从没换过票」，要把窗口内全部换票行扫完
       * 才能确定没有，而那恰好是本检查项最常被问的状态。
       *
       * 今天可以这么查：换票凭证 TTL 300 秒、在跑的智能体个位数，窗口内是几千行量级。
       * **到了不够用那天，加这条索引**，不要改判据：
       *   create index idx_audit_logs_s2s_caller
       *       on support.audit_logs ((after->>'caller_product'), created_at desc)
       *    where action = 'oidc.token_exchange.issued';
       */
      this.pool.query<S2sAuditRow>(
        `SELECT after->>'target_product' AS target_product,
                after->>'mode'           AS mode,
                created_at
           FROM support.audit_logs
          WHERE action = $1
            AND result = 'success'
            AND after->>'caller_product' = $2
            AND created_at >= now() - interval '${S2S_LOOKBACK}'
          ORDER BY created_at DESC
          LIMIT 1`,
        [S2S_AUDIT_ACTION, productCode],
      ),
    ]);

    const latest = usage.rows[0];
    const exchange = s2s.rows[0];
    return {
      entitlement: parseEntitlementSignal(raw, key),
      consume: latest
        ? {
            lastEventAt: toIso(latest.created_at),
            metricKey: latest.metric_key,
          }
        : null,
      s2s: exchange
        ? {
            lastSeenAt: toIso(exchange.created_at),
            /* 审计里这两个是 jsonb 取出来的，理论上可能缺；缺了不算故障
               （旧行可能没有这两个键），用占位词而不是让整条信号消失。 */
            target: exchange.target_product ?? "（未记录）",
            mode: exchange.mode ?? "（未记录）",
          }
        : null,
    };
  }
}
