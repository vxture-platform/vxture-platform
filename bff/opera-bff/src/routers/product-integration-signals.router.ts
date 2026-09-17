/**
 * product-integration-signals.router.ts — 接入信号：平台自己看得见的接入事实。
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
 *   ── 2026-09-17 增：开通与投递（`acceptance` 那条链的另外两段）──
 *
 *   `acceptance`（端到端验收）的判据是 `login → provision → gate → consume →
 *   invalidate` 全链路。其中 gate / consume 就是上面的 C2 / C3，另外两段也各有台账：
 *
 *   - **provision**：`provisioning.provisionings` 里 `status='provisioned'` 的最近一行。
 *     取 status 而不是「有行」——行在 `pending` 时就已存在，那只说明有人点了开通。
 *   - **invalidate**：`provisioning.webhook_deliveries` 里 `status='delivered'` 的最近一行。
 *     判据是 **status**，不是 `delivered_at`。（2026-09-17 起 `markDelivered` 已同时写
 *     `delivered_at`，此前那一列建了却没人写。但判据仍然不换：status 是状态机的
 *     权威，时间戳是派生记录；存量行的 `delivered_at` 也仍是 NULL。）
 *
 *   两者都带 `workspace_id`，加上 C2 信号里的 `workspaceId`，门户可以判「这几段是否落在
 *   **同一个**工作区」——那才是「一条链走通了」，而不是四件不相干的事各发生过。
 *
 *   **这两张表都不是分区表**（`54_provisioning.sql` 无 PARTITION BY），所以两条查询
 *   有意**不带 `created_at` 下界**；C3 那条带，是因为 `metering.usage_events` 按月分区。
 *   照着 C3 抄一个时间窗到这里，只会把「半年前开通、至今在用」的产品判成没开通过。
 *
 *   ── 2026-09-17 再增：登录段与开通回执 ──
 *
 *   **`login` 段此前被写成「没有台账」，那句话错了一半**：auth-bff 的登录确实不写审计，
 *   但每一次成功的 OIDC 登录都会往 `session.refresh_tokens` 落一行、带 `client_id`——
 *   台账一直在写，只是没人读。（空的是 `oidc_consents`，它从来不是这一段的台账。）
 *   五段因此都有了台账。
 *
 *   **但 `acceptance` 仍是人工项**，理由换了一条、没有变弱：开通那一段的
 *   `status='provisioned'` 回答的是**平台已下令**，不是产品已就绪（`enqueue` 的 upsert
 *   当场就写它）。所以新增 `provisionAck`——产品经 `POST /provisioning/ack` 报回来的
 *   回执，落在 `provisionings.metadata` 的 `ack` 子对象里。
 *
 *   回执**不进**任何自动判定:现在一个产品都还没实现它，进了判定就是用一次平台升级把
 *   在产的产品全判成不合规。它只是把「平台已下令」与「产品已回执」两件事在界面上分开，
 *   让那一格不再拿前者冒充后者。
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

/**
 * 开通：这个产品最近一次真的被开通到某个工作区。
 *
 * `acceptance`（端到端验收）那条链的第二段。判据取 `status='provisioned'` 而不是
 * 「有行」——行在 `pending` 状态下就已经存在了，那只说明有人点了开通。
 */
/**
 * 开通回执：产品自己报回来的「这个工作区的空间我建好了」。
 *
 * 与 `provision` 的区别是这一节的要害:`provision` 是**平台下令**的时间，这一个才是
 * **产品确认**的时间。两者都在同一行上（回执写进 `provisionings.metadata.ack`，
 * 不改 `status` / `version` / `provisioned_at`），所以取的是「最近一次开通」那一行的回执。
 *
 * `null` = 没回执过。**这不算失败**:回执是本期新加的次要约定，在产产品都还没实现。
 */
export interface ProvisionAckSignal {
  ackedAt: string;
  /** `ready` = 空间就绪;`failed` = 产品侧建不起来（回执也能说坏消息）。 */
  status: string;
  /** 与 `provision.workspaceId` 同一个——回执落在同一行上。 */
  workspaceId: string;
}
export interface ProvisionSignal {
  lastProvisionedAt: string;
  /**
   * 开到哪个工作区。带 workspace 的那几段要落在**同一个** workspace 上才算走通了一条链
   * （登录段不在其内：`refresh_tokens` 没有 workspace_id，登录发生在选定工作区之前）。
   */
  workspaceId: string;
}

/**
 * 回调投递：平台最近一次把事件成功送到对方端点。
 *
 * `acceptance` 那条链的末段（invalidate）。判据是 `status='delivered'`，**不是
 * `delivered_at`**。理由在 2026-09-17 变过一次：原先是「那一列没人写」，现在
 * `markDelivered` 已经写它了；但判据仍不换——status 是状态机的权威，时间戳只是
 * 派生记录，而且补写之前落库的存量行永远是 NULL，换判据会把它们全判成未投递。
 */
export interface DeliverySignal {
  eventType: string;
  workspaceId: string;
  responseCode: number | null;
  lastAttemptAt: string | null;
}

/** C1 出站：对方最近一次换票去调别的产品。`target` 是它调的谁。 */
export interface S2sSignal {
  lastSeenAt: string;
  /** 被调方产品码（审计 `after.target_product`）。 */
  target: string;
  /** `obo`（有用户在场）/ `service`（后台通道）。 */
  mode: string;
}

/**
 * 登录：这个产品的客户端最近一次有人经平台登进去。
 *
 * `acceptance` 那条链的**首段**。台账一直在写，只是从来没人读：每一次成功的
 * OIDC 登录都会往 `session.refresh_tokens` 落一行（`oidc.service.ts` 的授权码兑换里
 * **无条件**签发，不按 scope 门控），行上带 `client_id`。
 *
 * **不是 `session.auth_sessions`**：那张表的 DDL 明写「会话 Redis-primary，OIDC 登录不写
 * durable auth_sessions」，拿它当判据会得到一条永远为空的检查。
 *
 * 运营者登录不会混进来：`TokenService.storeFor(realm)` 把 workforce 分流到
 * `admin.operator_refresh_token`，只有 customer realm 进这张表。
 */
export interface LoginSignal {
  lastLoginAt: string;
  /** 经哪个客户端登的（一个产品可能有 stable / beta / canary 三个）。 */
  clientId: string;
}

export interface IntegrationSignalsRecord {
  login: LoginSignal | null;
  entitlement: EntitlementSignal | null;
  consume: ConsumeSignal | null;
  s2s: S2sSignal | null;
  provision: ProvisionSignal | null;
  provisionAck: ProvisionAckSignal | null;
  delivery: DeliverySignal | null;
}

/** 只用到 GET；ioredis 满足它，单测给假的。 */
export interface SignalRedisReader {
  get(key: string): Promise<string | null>;
}

interface UsageEventRow {
  metric_key: string;
  created_at: Date | string;
}

interface ProvisionRow {
  workspace_id: string;
  provisioned_at: Date | string;
  /* 回执:同一行 metadata 里取，不另开一条查询。两列都可能为 NULL（没回执过）。 */
  ack_at: string | null;
  ack_status: string | null;
}

interface DeliveryRow {
  event_type: string;
  workspace_id: string;
  response_code: number | null;
  last_attempt_at: Date | string | null;
}

interface LoginRow {
  client_id: string;
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
    const [raw, login, usage, s2s, provision, delivery] = await Promise.all([
      this.redis.get(key),
      /*
       * 登录：`acceptance` 链的首段。两步合成一条 SQL——先用
       * `idx_oidc_clients_product_id` 把客户端收敛到这个产品（该表十几行），
       * 再回 `session.refresh_tokens` 取最近一行。按 **product_id 聚合**而不是单个
       * client_id：一个产品可能有 stable / beta / canary 三个客户端，哪个登都算。
       *
       * 查询形状：`refresh_tokens.client_id` **没有索引**（只有 user_id /
       * session_id / status / expires_at 四条）。最坏情况是「这个产品从没人登过」，
       * 要扫完整张表才能确定没有——而那恰好是本检查项最常被问的状态（与 C1
       * 出站那条同型）。今天可以这么查：该表只增不删但量级跟登录次数走，
       * 现阶段是万行以下。**到了不够用那天，加这条索引**，不要改判据：
       *   create index idx_refresh_tokens_client_created
       *       on session.refresh_tokens (client_id, created_at desc);
       *
       * **不带 `created_at` 下界**：这张表不是分区表，照搬 C3 的时间窗只会把
       * 「半年前登过、至今在用」的产品判成没人登过。
       */
      this.pool.query<LoginRow>(
        `SELECT rt.client_id, rt.created_at
           FROM session.refresh_tokens rt
          WHERE rt.client_id IN (
                  SELECT c.client_id
                    FROM appoidc.oidc_clients c
                   WHERE c.product_id = $1
                     AND c.client_kind = 'product'
                )
          ORDER BY rt.created_at DESC
          LIMIT 1`,
        [productId],
      ),
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
      /*
       * 开通与投递：`acceptance` 那条链的第二段与末段。
       *
       * **这两张表都不是分区表**（`54_provisioning.sql` 里没有 PARTITION BY），
       * 所以这里**有意不带 `created_at` 下界**——C3 那条带，是因为
       * `metering.usage_events` 按月分区、谓词里不给下界就要全分区扫。照着 C3 抄一个
       * 时间窗在这里只会白白把「半年前开通过、至今在用」的产品判成没开通过。
       *
       * 两条都靠 `idx_provisionings_product_id` / `idx_webhook_deliveries_product`
       * 收敛，再取最近一行。
       */
      this.pool.query<ProvisionRow>(
        `SELECT workspace_id, provisioned_at,
                metadata->'ack'->>'at'     AS ack_at,
                metadata->'ack'->>'status' AS ack_status
           FROM provisioning.provisionings
          WHERE product_id = $1
            AND status = 'provisioned'
            AND provisioned_at IS NOT NULL
          ORDER BY provisioned_at DESC
          LIMIT 1`,
        [productId],
      ),
      this.pool.query<DeliveryRow>(
        `SELECT event_type, workspace_id, response_code, last_attempt_at
           FROM provisioning.webhook_deliveries
          WHERE product_id = $1
            AND status = 'delivered'
          ORDER BY last_attempt_at DESC NULLS LAST
          LIMIT 1`,
        [productId],
      ),
    ]);

    const loggedIn = login.rows[0];
    const latest = usage.rows[0];
    const exchange = s2s.rows[0];
    const provisioned = provision.rows[0];
    const delivered = delivery.rows[0];
    return {
      login: loggedIn
        ? {
            lastLoginAt: toIso(loggedIn.created_at),
            clientId: loggedIn.client_id,
          }
        : null,
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
      provision: provisioned
        ? {
            lastProvisionedAt: toIso(provisioned.provisioned_at),
            workspaceId: provisioned.workspace_id,
          }
        : null,
      /* 回执的时间戳是平台自己写进 metadata 的 ISO 串（`recordAck`），不是列上的
         timestamptz——所以这里原样带出，不过 `toIso`。`status` 缺失时用占位词而不是
         让整条信号消失，与 s2s 那两个 jsonb 字段同一处理。 */
      provisionAck:
        provisioned && provisioned.ack_at
          ? {
              ackedAt: provisioned.ack_at,
              status: provisioned.ack_status ?? "（未记录）",
              workspaceId: provisioned.workspace_id,
            }
          : null,
      delivery: delivered
        ? {
            eventType: delivered.event_type,
            workspaceId: delivered.workspace_id,
            responseCode: delivered.response_code,
            lastAttemptAt: delivered.last_attempt_at
              ? toIso(delivered.last_attempt_at)
              : null,
          }
        : null,
    };
  }
}
