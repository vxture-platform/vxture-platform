/**
 * product-integration-signals.router.ts — 接入信号：平台自己看得见的 C2 / C3 事实。
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

export interface IntegrationSignalsRecord {
  entitlement: EntitlementSignal | null;
  consume: ConsumeSignal | null;
}

/** 只用到 GET；ioredis 满足它，单测给假的。 */
export interface SignalRedisReader {
  get(key: string): Promise<string | null>;
}

interface UsageEventRow {
  metric_key: string;
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
    const [raw, usage] = await Promise.all([
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
    ]);

    const latest = usage.rows[0];
    return {
      entitlement: parseEntitlementSignal(raw, key),
      consume: latest
        ? {
            lastEventAt: toIso(latest.created_at),
            metricKey: latest.metric_key,
          }
        : null,
    };
  }
}
