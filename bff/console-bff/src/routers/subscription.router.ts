/**
 * subscription.router.ts - 租户订阅管理路由
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * @author AI-Generated
 * @date 2026-05-02
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { FavoritesService } from "@vxture/service-account";
import { MailService } from "@vxture/core-mail";
import { BillingService } from "@vxture/service-billing";
import {
  PromotionService,
  computeSettlement,
  centsToYuan,
  yuanToCents,
  type AvailableVoucher,
  type DiscountEffect,
} from "@vxture/service-promotion";
import { SubscriptionService } from "@vxture/service-subscription";
import type {
  DeclarePaymentResult,
  SubscriptionRecord,
} from "@vxture/service-subscription";
import {
  SUBSCRIPTION_STATUSES,
  TIERS,
  type ProductEntitlementView,
  type Tier,
} from "@vxture/shared";
import type { RequestContext } from "../types/console.types";
import {
  buildPaymentChannels,
  type PaymentChannelInfo,
} from "../lib/payment-channels";
import { PlatformEntitlementsClient } from "../platform/platform-entitlements.client";

// Inline the DI token (repo-wide pattern): SubscriptionModule provides the pool.
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

// ============================================================================
// 订阅操作类型
// ============================================================================

type SubscriptionAction = "upgrade" | "pause" | "resume" | "cancel";

// ============================================================================
// /subscribe deep-link landing context (product_200 §3.2 / arda_303 §2.2)
// ============================================================================

/**
 * Intent vocabulary v1. `seat` is reserved (arda_303 §2.3) and products may
 * already emit it — it degrades as unknown BY DESIGN until implemented, so it
 * is deliberately NOT in this set. `subscribe` (product_320): the website
 * product card's deep link for a never-subscribed visitor → lands on the
 * plan ladder to place a first order.
 */
const KNOWN_INTENTS = ["subscribe", "upgrade", "renew", "addon"] as const;
type SubscribeIntent = (typeof KNOWN_INTENTS)[number];

// Order-creation intent (product_320 §2 O4) — distinct from the deep-link
// vocabulary above: it drives which subscription-service primitive runs.
const ORDER_INTENTS = ["new", "renew", "upgrade"] as const;
type OrderCreateIntent = (typeof ORDER_INTENTS)[number];
const CYCLE_UNITS = ["month", "year"] as const;

// ── payment flow vocabulary (product_321 P1) ────────────────────────────────

/** Six-state ordered derivation — wire slugs are the orderStatus contract. */
type OrderState =
  | "activating"
  | "completed"
  | "paid_pending_verify"
  | "cancelled"
  | "expired"
  | "pending_payment";

const DECLARE_CHANNELS = ["alipay", "bank_transfer"] as const;
type DeclareChannel = (typeof DECLARE_CHANNELS)[number];

/**
 * Payment TTL (P4, rev. 2026-08-20 — per tenant type); read per call so ops
 * can tune without redeploy. ORDER_PAYMENT_TTL_MINUTES = personal tenants
 * (default 30min) and the fallback for legacy rows without a persisted TTL;
 * ORDER_PAYMENT_TTL_MINUTES_ORG = organization tenants (default 2880 = 48h).
 */
const envMinutes = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : fallback;
};
const paymentTtlMinutes = (): number =>
  envMinutes("ORDER_PAYMENT_TTL_MINUTES", 30);
const paymentTtlMinutesFor = (
  tenantType: "personal" | "organization" | undefined,
): number =>
  tenantType === "organization"
    ? envMinutes("ORDER_PAYMENT_TTL_MINUTES_ORG", 2880)
    : paymentTtlMinutes();

const PRODUCT_CODE_RE = /^[a-z][a-z0-9_-]{0,63}$/;

interface SubscribePlanPrice {
  cycleUnit: string;
  cycleCount: number;
  price: string;
  currency: string;
}

interface SubscribePlanOption {
  planId: string;
  planCode: string;
  planName: string;
  planVersionId: string;
  tier: string;
  prices: SubscribePlanPrice[];
  /** Primary component feature list (plan_components.features) — 确认订单页的权益 chips。 */
  features: string[];
}

interface SubscribeCurrent {
  subscriptionId: string;
  status: string;
  planCode: string;
  planVersionId: string;
  tier: string | null;
  endAt: string | null;
  trialEndAt: string | null;
  autoRenew: boolean;
}

/**
 * A pending offline order for (tenant × product) — the tenant's suspended
 * offline_purchase subscription row with an unpaid invoice (product_320 §2 O1).
 * Its presence means the client shows the awaiting-confirmation panel instead
 * of the plan ladder.
 */
export interface PendingOrderSummary {
  orderId: string;
  orderNo: string;
  billNo: string | null;
  planCode: string;
  tier: string | null;
  cycleUnit: string;
  amount: string;
  currency: string;
  createdAt: string;
  /** 付款截止（P4）；已申报/有实收时 null */
  expireAt: string | null;
  /** 恢复现场用的六态（进付款页直达对应视图） */
  paymentState: OrderState;
}

export interface SubscribeContext {
  /** Normalized known intent, or null = unknown/absent → client degrades. */
  intent: SubscribeIntent | null;
  /** null = unknown product code → client degrades to the subscription home. */
  product: { code: string; name: string } | null;
  /** Validated against the @vxture/shared five-tier ladder; invalid → null. */
  targetTier: Tier | null;
  metric: string | null;
  /** Representative subscription covering (active tenant × product), if any. */
  current: SubscribeCurrent | null;
  /** Pending offline order for this product, if any (product_320). */
  pendingOrder: PendingOrderSummary | null;
  /** Purchasable ladder: public active plans' current locked version, tier-sorted. */
  plans: SubscribePlanOption[];
}

// ── order endpoints (product_320 §4.4) ──────────────────────────────────────

interface CreateOrderBody {
  productCode: string;
  planVersionId: string;
  cycleUnit: string;
  intent: string;
  upgradeOfSubscriptionId?: string;
}

interface OfflinePaymentInstructions {
  method: "bank_transfer";
  accountName: string;
  bankName: string;
  accountNo: string;
  /** 汇款备注：客户填 orderNo，运营据此核销 */
  reference: string;
}

interface CreateOrderResult {
  /** owner 2026-08-20 修订后恒为 pending_payment（0 元也是订单）；
   *  "active" 保留在值域内仅为旧客户端兼容，服务端不再产生。 */
  status: "pending_payment" | "active";
  /** subscription row id (= admin orderId 语义) */
  orderId: string | null;
  orderNo: string | null;
  billNo: string | null;
  amount: string | null;
  currency: string;
  planCode: string;
  cycleUnit: string | null;
  paymentInstructions: OfflinePaymentInstructions | null;
  /** 历史字段（原 free 即时开通返回新订阅 id）；现恒为 null。 */
  subscriptionId: string | null;
  /** 付款截止（P4，创建时刻 + TTL）。 */
  expireAt: string | null;
}

interface MyOrderRecord {
  orderId: string;
  orderNo: string;
  billNo: string | null;
  planCode: string;
  planName: string;
  tier: string | null;
  cycleUnit: string;
  amount: string;
  currency: string;
  /** Six-state contract (product_321 P1) — replaces pending/confirmed/closed. */
  orderStatus: OrderState;
  /** 'subscription' in V1; 'recharge' reserved for the wallet phase (P6). */
  orderType: "subscription";
  /** ISO deadline while counting down; null = TTL-exempt (paid_amount>0) or terminal. */
  expireAt: string | null;
  /** Money already collected on the invoice (legacy partial orders, P5). */
  paidAmount: string;
  /** Voucher reduction display: discount mirror + paid voucher legs. */
  voucherOff: string;
  createdAt: string;
  confirmedAt: string | null;
  // ── 订单表重构（product_330）追加的展示投影，全部可视码/名称，无 UUID ──
  productCode: string | null;
  productName: string | null;
  tenantName: string | null;
  workspaceName: string | null;
  /** workspace 可视码（bigint as string），4 位分组展示由前端负责。 */
  workspaceNo: string | null;
  /** 下单人展示名（user_profiles.display_name，回退登录账号）。 */
  subscriberName: string | null;
  /** 下单人 = 租户 owner 时给 owner 标签；其余暂不标注。 */
  subscriberRole: "owner" | null;
  /** 原价（折前，元字符串）= invoice total + discount mirror。 */
  listPrice: string;
  startAt: string | null;
  endAt: string | null;
  /** 付款申报时刻（最近一笔非代金券支付腿的创建时间）。 */
  declaredAt: string | null;
  /** 服务开通时刻（completed 单 = 订阅 start_at，周期起算锚点）。 */
  activatedAt: string | null;
}

// ── payment page contracts (product_321 §4.1) ───────────────────────────────
// PaymentChannelInfo / buildPaymentChannels 移至 ../lib/payment-channels
// (加油包购买共用同一套线下收款配置,2026-08-20)。

interface OrderVoucherOption {
  voucherId: string;
  code: string;
  kind: "discount" | "credit_voucher";
  batchName: string;
  /** discount */
  discountType?: "percent" | "fixed";
  discountValue?: number;
  maxOff?: string | null;
  /** credit_voucher face, yuan string */
  amount?: string;
  expiresAt: string;
}

interface OrderPaymentLeg {
  paymentId: string;
  kind: "cash" | "voucher" | "other";
  status: string;
  amount: string;
  channel: string | null;
  createdAt: string;
}

interface OrderDetailResult {
  orderId: string;
  orderNo: string;
  billNo: string | null;
  planCode: string;
  planName: string;
  tier: string | null;
  cycleUnit: string;
  currency: string;
  orderState: OrderState;
  orderType: "subscription";
  createdAt: string;
  expireAt: string | null;
  /** Base list price (pre-discount), yuan string. */
  listPrice: string;
  paidAmount: string;
  /** Latest reject reason to surface in the banner (P2), if any. */
  rejectReason: string | null;
  vouchers: OrderVoucherOption[];
  legs: OrderPaymentLeg[];
  paymentChannels: PaymentChannelInfo[];
}

interface QuoteBody {
  discountVoucherId?: string;
  creditVoucherId?: string;
}

interface QuoteResult {
  listPrice: string;
  discountOff: string;
  payable: string;
  paidAmount: string;
  voucherOff: string;
  balanceOff: string;
  cashDue: string;
  discountApplicable: boolean;
}

interface DeclareBody {
  payChannel: string;
  discountVoucherId?: string;
  creditVoucherId?: string;
  payerName?: string;
  transactionNo?: string;
  remark?: string;
}

interface SubscriptionActionBody {
  subscriptionId: string;
  action: SubscriptionAction;
  /** upgrade 操作必填 */
  planId?: string;
  /** pause / cancel 操作可选 */
  reason?: string;
  /** cancel 时是否立即生效，默认 false（到期取消） */
  immediate?: boolean;
}

// ── console "my subscriptions" view (distinct from SubscriptionRecord) ─────

interface MySubscriptionRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  plan_name: string;
  status: string;
  pay_amount: string | null;
  currency: string;
  cycle_unit: string;
  end_at: Date | null;
  auto_renew: boolean;
  subscription_kind: string;
}

export interface ConsoleSubscriptionView {
  id: string;
  tenantId: string;
  planId: string;
  planName: string;
  status: string;
  price: number;
  currency: string;
  cycle: string;
  nextBillingDate: string | null;
  autoRenew: boolean;
  isTrial: boolean;
}

// ── 产品订阅总览（console「我的订阅」卡片，product_330 页面重构）────────────
// 每行 = 当前 workspace 的一条订阅（free/trial 同为订阅），带产品与档位投影。

export interface SubscribedProductView {
  subscriptionId: string;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  productNick: string | null;
  /** 产品对外发布号（products.release_version）——平台只有一套最新实例，
   *  恒为当前最新版、随产品更新自动跟进；不存在按订阅冻结的旧版本。 */
  releaseVersion: string | null;
  planName: string;
  tier: string | null;
  /** plan_components.quota->>'member.max'；无席位口径的档为 null。 */
  seats: number | null;
  kind: string;
  cycleUnit: string;
  status: string;
  startAt: string | null;
  endAt: string | null;
  autoRenew: boolean;
  /** ★ 收藏（account.user_product_favorites）——收藏即排序优先。 */
  favorite: boolean;
}

/** 「新品推荐」卡：租户尚未订阅过的可单独订购产品 + 起价。 */
export interface RecommendedProductView {
  productId: string;
  productCode: string;
  productName: string;
  productNick: string | null;
  description: string | null;
  releaseVersion: string | null;
  iconUrl: string | null;
  tags: string[];
  /** 现行锁定版本各周期最低价（元字符串）；"0.00" = 提供免费版。 */
  minPrice: string;
  currency: string;
  favorite: boolean;
}

// ── workspace quota usage (header "配额 / Usage Quota" panel) ──────────────

interface QuotaMetricView {
  used: number;
  limit: number;
}

export interface QuotaUsageView {
  storage: QuotaMetricView;
  aiCredit: QuotaMetricView;
}

// ── workspace entitlements (product_220 §3 C2 envelope, console-facing view) ─

export interface WorkspaceEntitlementView {
  productCode: string;
  tier: string | null;
  status: string | null;
  bundled: boolean;
  limits: Record<string, number>;
}

// ============================================================================
// Router
// ============================================================================

@Controller("api/subscription")
export class SubscriptionRouter {
  private readonly logger = new Logger(SubscriptionRouter.name);

  constructor(
    @Inject(SubscriptionService)
    private readonly subscriptionService: SubscriptionService,
    @Inject(PromotionService)
    private readonly promotionService: PromotionService,
    @Inject(BillingService)
    private readonly billingService: BillingService,
    @Inject(MailService)
    private readonly mailService: MailService,
    @Inject(COMMERCE_PG_POOL)
    private readonly pool: Pool,
    @Inject(PlatformEntitlementsClient)
    private readonly entitlementsClient: PlatformEntitlementsClient,
    @Inject(FavoritesService)
    private readonly favoritesService: FavoritesService,
  ) {}

  // --------------------------------------------------------------------------
  // GET /api/subscription/credits — 租户钱包余额（product_321 P6：V1 只读展示）
  // --------------------------------------------------------------------------

  @Get("credits")
  async getCredits(
    @Req() req: Request & RequestContext,
  ): Promise<{ balance: string; currency: string }> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const record = await this.billingService.getCreditBalance(req.tenant.id);
    return {
      balance: record?.balance ?? "0.00",
      currency: record?.currency ?? "CNY",
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/subscription/quota-usage — 当前租户默认工作空间的配额用量
  // (header "配额 / Usage Quota" 面板；storage.bytes + ai.credit 是 L0 平台指标,
  // 与具体产品无关, 故按 workspace 聚合展示, 不做 product 归属区分)
  // --------------------------------------------------------------------------

  @Get("quota-usage")
  async getQuotaUsage(
    @Req() req: Request & RequestContext,
  ): Promise<QuotaUsageView> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);

    const entitlements = await this.resolveWorkspaceEntitlements(workspaceId);
    // No live subscriptions (or platform-api unreachable) → zero display,
    // never a 500: the quota header panel must degrade, not break the page.
    return aggregateWorkspaceQuota(
      entitlements ? Object.values(entitlements) : [],
    );
  }

  // --------------------------------------------------------------------------
  // GET /api/subscription/entitlements — 当前租户默认工作空间的权益概览
  // (TD-042 remediation: sources tier/status/bundled/limits from the C2
  // `/platform/entitlements` contract instead of leaving console blind to them)
  // --------------------------------------------------------------------------

  @Get("entitlements")
  async getEntitlements(
    @Req() req: Request & RequestContext,
  ): Promise<WorkspaceEntitlementView[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);

    const entitlements = await this.resolveWorkspaceEntitlements(workspaceId);
    if (!entitlements) return [];
    return Object.entries(entitlements).map(([productCode, view]) => ({
      productCode,
      tier: view.tier,
      status: view.status,
      bundled: view.bundled,
      limits: view.limits,
    }));
  }

  /**
   * C2 resolution for this workspace's ever-subscribed products, or `null` on
   * failure (platform-api unreachable / malformed response) — callers degrade
   * rather than propagate a 500.
   */
  private async resolveWorkspaceEntitlements(
    workspaceId: string,
  ): Promise<Record<string, ProductEntitlementView> | null> {
    const productCodes = await this.queryWorkspaceProductCodes(workspaceId);
    if (productCodes.length === 0) return {};
    return this.entitlementsClient.resolveWorkspaceEntitlements(
      workspaceId,
      productCodes,
    );
  }

  /**
   * Distinct product codes this workspace has ever had ANY plan_component
   * coverage for — primary (standalone purchase) OR bundled (product_220
   * §2: a product can carry real entitlement, e.g. `bundled: true`, with no
   * primary subscription of its own ever existing). Restricting to
   * `component_role = 'primary'` would silently hide bundled-only coverage
   * from the entitlements panel — the exact "both facts survive" case §2
   * calls out as the reason the bundled boolean exists in the first place.
   */
  private async queryWorkspaceProductCodes(
    workspaceId: string,
  ): Promise<string[]> {
    const res = await this.pool.query<{ product_code: string }>(
      `select distinct prod.product_code
         from metering.subscriptions ts
         join product.plan_components pc on pc.plan_version_id = ts.plan_version_id
         join product.products prod on prod.id = pc.product_id
        where ts.workspace_id = $1 and ts.deleted_at is null`,
      [workspaceId],
    );
    return res.rows.map((r) => r.product_code);
  }

  // --------------------------------------------------------------------------
  // GET /api/subscription/subscribe-context — /subscribe deep-link landing data
  //
  // The console side of the product→console conversion deep link (product_200
  // §3.2). Fault-tolerance contract (arda_303 §2.2): unknown intent → intent
  // null (client degrades to the subscription home) with a structured server
  // log — the observation channel that turns stray intents into vocabulary-
  // evolution signals; unknown target_tier/metric → dropped, flow proceeds.
  // --------------------------------------------------------------------------

  @Get("subscribe-context")
  async getSubscribeContext(
    @Req() req: Request & RequestContext,
    @Query()
    query: {
      product?: string;
      intent?: string;
      target_tier?: string;
      metric?: string;
    },
  ): Promise<SubscribeContext> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");

    const rawIntent = query.intent?.trim() ?? "";
    const intent = (KNOWN_INTENTS as readonly string[]).includes(rawIntent)
      ? (rawIntent as SubscribeIntent)
      : null;
    if (intent === null) {
      // Deliberate warn (not debug): unknown intents are the demand signal for
      // vocabulary evolution (e.g. the reserved `seat`), surfaced proactively.
      this.logger.warn(
        `subscribe deeplink: unknown intent "${rawIntent}" (product=${query.product ?? "-"}) — degrading to subscription home`,
      );
    }

    const rawTier = query.target_tier?.trim() ?? "";
    const targetTier = (TIERS as readonly string[]).includes(rawTier)
      ? (rawTier as Tier)
      : null;
    if (rawTier && targetTier === null) {
      this.logger.warn(
        `subscribe deeplink: invalid target_tier "${rawTier}" ignored (product=${query.product ?? "-"})`,
      );
    }

    const metric = query.metric?.trim().slice(0, 64) || null;

    const rawProduct = query.product?.trim() ?? "";
    let product: SubscribeContext["product"] = null;
    if (PRODUCT_CODE_RE.test(rawProduct)) {
      const res = await this.pool.query<{
        product_code: string;
        product_name: string;
      }>(
        `select product_code, product_name from product.products
          where product_code = $1 and deleted_at is null`,
        [rawProduct],
      );
      const row = res.rows[0];
      if (row) product = { code: row.product_code, name: row.product_name };
    }
    if (product === null) {
      this.logger.warn(
        `subscribe deeplink: unknown product "${rawProduct}" — degrading to subscription home`,
      );
      return {
        intent,
        product: null,
        targetTier,
        metric,
        current: null,
        pendingOrder: null,
        plans: [],
      };
    }

    const [current, pendingOrder, plans] = await Promise.all([
      this.queryCurrentForProduct(req.tenant.id, product.code),
      this.queryPendingOrder(req.tenant.id, product.code),
      this.queryPlanLadder(product.code),
    ]);
    return {
      intent,
      product,
      targetTier,
      metric,
      current,
      pendingOrder,
      plans,
    };
  }

  /**
   * Representative subscription for (tenant × product): same selection rules
   * as the C2 engine — D10 predicate (never-paid lapsed trials read as absent)
   * + @shared status-order precedence, tie → latest period end (open end
   * counts latest).
   */
  private async queryCurrentForProduct(
    tenantId: string,
    productCode: string,
  ): Promise<SubscribeCurrent | null> {
    const res = await this.pool.query<{
      id: string;
      status: string;
      plan_version_id: string;
      end_at: Date | null;
      trial_end_at: Date | null;
      auto_renew: boolean;
      tier: string | null;
      plan_code: string;
    }>(
      `select ts.id, ts.status, ts.plan_version_id, ts.end_at, ts.trial_end_at,
              ts.auto_renew, pc.tier, pl.plan_code
         from metering.subscriptions ts
         join product.plan_components pc
           on pc.plan_version_id = ts.plan_version_id and pc.component_role = 'primary'
         join product.products prod
           on prod.id = pc.product_id and prod.product_code = $2
         join product.plan_versions pv on pv.id = ts.plan_version_id
         join product.plans pl on pl.id = pv.plan_id
        where ts.tenant_id = $1
          and ts.deleted_at is null
          and not (ts.subscription_kind = 'trial'
                   and ts.status in ('expired', 'cancelled'))
        order by array_position($3::text[], ts.status) asc,
                 ts.end_at desc nulls first
        limit 1`,
      [tenantId, productCode, [...SUBSCRIPTION_STATUSES]],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      subscriptionId: row.id,
      status: row.status,
      planCode: row.plan_code,
      planVersionId: row.plan_version_id,
      tier: row.tier,
      endAt: row.end_at?.toISOString() ?? null,
      trialEndAt: row.trial_end_at?.toISOString() ?? null,
      autoRenew: row.auto_renew,
    };
  }

  /**
   * Public active plans whose CURRENT version is locked, with their prices.
   * TODO(shared-ladder): 本查询与 website-bff product-plans.router 是同一口径
   * 的两份 SQL；若第三处出现，应抽到共享查询层（如 @vxture/service-catalog）。
   */
  private async queryPlanLadder(
    productCode: string,
  ): Promise<SubscribePlanOption[]> {
    const res = await this.pool.query<{
      plan_id: string;
      plan_code: string;
      plan_name: string;
      plan_version_id: string;
      tier: string;
      features: string[] | null;
      prices: SubscribePlanPrice[];
    }>(
      `select pl.id as plan_id, pl.plan_code, pl.plan_name,
              pv.id as plan_version_id, pc.tier, pc.features,
              coalesce(
                jsonb_agg(jsonb_build_object(
                  'cycleUnit', pp.cycle_unit, 'cycleCount', pp.cycle_count,
                  'price', to_char(pp.price, 'FM999999999990.00'), 'currency', pp.currency
                ) order by pp.cycle_unit, pp.cycle_count)
                filter (where pp.id is not null), '[]'::jsonb
              ) as prices
         from product.products prod
         join product.plan_components pc
           on pc.product_id = prod.id and pc.component_role = 'primary'
         join product.plan_versions pv
           on pv.id = pc.plan_version_id and pv.is_locked = true
         join product.plans pl
           on pl.id = pv.plan_id and pl.current_version_id = pv.id
          and pl.deleted_at is null and pl.status = 'active'
          and pl.is_public = true and pl.is_customer_visible = true
         left join product.plan_prices pp on pp.plan_version_id = pv.id
        where prod.product_code = $1 and pc.tier is not null
        group by pl.id, pl.plan_code, pl.plan_name, pv.id, pc.tier, pc.features`,
      [productCode],
    );
    const rank = (t: string) => {
      const i = (TIERS as readonly string[]).indexOf(t);
      return i < 0 ? Infinity : i;
    };
    return res.rows
      .map((r) => ({
        planId: r.plan_id,
        planCode: r.plan_code,
        planName: r.plan_name,
        planVersionId: r.plan_version_id,
        tier: r.tier,
        prices: r.prices,
        features: r.features ?? [],
      }))
      .sort(
        (a: SubscribePlanOption, b: SubscribePlanOption) =>
          rank(a.tier) - rank(b.tier),
      );
  }

  // --------------------------------------------------------------------------
  // GET /api/subscription/my — 查询当前租户的全部订阅
  //
  // Deliberately bypasses SubscriptionService.listSubscriptions: that method
  // returns the raw metering.subscriptions row (SubscriptionRecord — no plan
  // name/price/cycle, shared with the admin BFF) and was previously handed to
  // the client typed as ConsoleSubscription, a distinct view-model contract.
  // The mismatch left planName/price/nextBillingDate undefined client-side,
  // crashing the page on amount.toLocaleString(). Query + map to the actual
  // contract here, same join pattern as ORDER_ROW_SELECT above.
  // --------------------------------------------------------------------------

  @Get("my")
  async getMySubscriptions(
    @Req() req: Request & RequestContext,
  ): Promise<ConsoleSubscriptionView[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const res = await this.pool.query<MySubscriptionRow>(
      `select ts.id, ts.tenant_id, pl.id as plan_id, pl.plan_name, ts.status,
              ts.pay_amount, ts.currency, ts.cycle_unit, ts.end_at, ts.auto_renew,
              ts.subscription_kind
         from metering.subscriptions ts
         join product.plan_versions pv on pv.id = ts.plan_version_id
         join product.plans pl on pl.id = pv.plan_id
        where ts.tenant_id = $1 and ts.deleted_at is null
        order by ts.created_at desc
        limit 100`,
      [req.tenant.id],
    );
    return res.rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      planId: r.plan_id,
      planName: r.plan_name,
      status: r.status,
      price: Number(r.pay_amount ?? 0),
      currency: r.currency,
      cycle: r.cycle_unit,
      nextBillingDate: r.end_at ? r.end_at.toISOString() : null,
      autoRenew: r.auto_renew,
      isTrial: r.subscription_kind === "trial",
    }));
  }

  // --------------------------------------------------------------------------
  // GET /api/subscription/subscribed-products — 「我的订阅」产品卡（product_330）
  //
  // 当前租户默认工作空间的订阅 × 产品投影：档位/席位/周期/起止/版本号/收藏。
  // free/trial 同为订阅；cancelled 不展示（从未生效或已终止的意愿态），
  // expired 保留（页面「全部」筛选可见）。收藏失败只降级不阻断（表刚上线，
  // 存量库未跑迁移时页面必须照常渲染）。
  // --------------------------------------------------------------------------

  @Get("subscribed-products")
  async getSubscribedProducts(
    @Req() req: Request & RequestContext,
  ): Promise<SubscribedProductView[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.user) throw new UnauthorizedException("No active session");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);
    const favorites = await this.safeFavoriteIds(req.user.id);

    const res = await this.pool.query<{
      subscription_id: string;
      product_id: string | null;
      product_code: string | null;
      product_name: string | null;
      product_nick: string | null;
      release_version: string | null;
      plan_name: string;
      tier: string | null;
      seats: string | null;
      subscription_kind: string;
      cycle_unit: string;
      status: string;
      start_at: Date | null;
      end_at: Date | null;
      auto_renew: boolean;
    }>(
      `select ts.id as subscription_id,
              prod.id as product_id, prod.product_code, prod.product_name,
              prod.product_nick, prod.release_version,
              pl.plan_name, pc.tier, pc.quota->>'member.max' as seats,
              ts.subscription_kind, ts.cycle_unit, ts.status,
              ts.start_at, ts.end_at, ts.auto_renew
         from metering.subscriptions ts
         join product.plan_versions pv on pv.id = ts.plan_version_id
         join product.plans pl on pl.id = pv.plan_id
         left join lateral (
           select tier, quota, product_id from product.plan_components
            where plan_version_id = ts.plan_version_id and component_role = 'primary'
            limit 1
         ) pc on true
         left join product.products prod on prod.id = pc.product_id
        where ts.workspace_id = $1 and ts.deleted_at is null
          and ts.status <> 'cancelled'
        order by coalesce(ts.start_at, ts.created_at) desc
        limit 100`,
      [workspaceId],
    );
    return res.rows.map((r) => ({
      subscriptionId: r.subscription_id,
      productId: r.product_id,
      productCode: r.product_code,
      productName: r.product_name,
      productNick: r.product_nick,
      releaseVersion: r.release_version,
      planName: r.plan_name,
      tier: r.tier,
      seats: r.seats != null && r.seats !== "" ? Number(r.seats) : null,
      kind: r.subscription_kind,
      cycleUnit: r.cycle_unit,
      status: r.status,
      startAt: r.start_at?.toISOString() ?? null,
      endAt: r.end_at?.toISOString() ?? null,
      autoRenew: r.auto_renew,
      favorite: r.product_id != null && favorites.has(r.product_id),
    }));
  }

  // --------------------------------------------------------------------------
  // GET /api/subscription/recommended-products — 「新品推荐」（product_330）
  //
  // 租户从未订阅过（任一工作空间、含 bundled 覆盖）的可单独订购产品 + 起价。
  // 起价 = 现行锁定版本各周期最低价；免费档无价目行时按 0 处理。
  // --------------------------------------------------------------------------

  @Get("recommended-products")
  async getRecommendedProducts(
    @Req() req: Request & RequestContext,
  ): Promise<RecommendedProductView[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.user) throw new UnauthorizedException("No active session");
    const favorites = await this.safeFavoriteIds(req.user.id);

    const res = await this.pool.query<{
      product_id: string;
      product_code: string;
      product_name: string;
      product_nick: string | null;
      description: string | null;
      release_version: string | null;
      icon_url: string | null;
      tags: string[] | null;
      min_price: string;
      currency: string;
    }>(
      `select prod.id as product_id, prod.product_code, prod.product_name,
              prod.product_nick, prod.description, prod.release_version,
              prod.icon_url, prod.tags,
              to_char(coalesce(min(pp.price), 0), 'FM999999999990.00') as min_price,
              coalesce(min(pp.currency), 'CNY') as currency
         from product.products prod
         join product.plan_components pc
           on pc.product_id = prod.id and pc.component_role = 'primary'
         join product.plan_versions pv
           on pv.id = pc.plan_version_id and pv.is_locked = true
         join product.plans pl
           on pl.id = pv.plan_id and pl.current_version_id = pv.id
          and pl.deleted_at is null and pl.status = 'active'
          and pl.is_public = true and pl.is_customer_visible = true
         left join product.plan_prices pp on pp.plan_version_id = pv.id
        where prod.deleted_at is null and prod.status = 'active'
          and prod.is_customer_visible = true
          and prod.standalone_subscribable = true
          and not exists (
            select 1 from metering.subscriptions ts
              join product.plan_components sub_pc
                on sub_pc.plan_version_id = ts.plan_version_id
             where ts.tenant_id = $1 and ts.deleted_at is null
               and sub_pc.product_id = prod.id
          )
        group by prod.id, prod.product_code, prod.product_name, prod.product_nick,
                 prod.description, prod.release_version, prod.icon_url, prod.tags, prod.sort
        order by prod.sort asc, prod.product_code asc
        limit 6`,
      [req.tenant.id],
    );
    return res.rows.map((r) => ({
      productId: r.product_id,
      productCode: r.product_code,
      productName: r.product_name,
      productNick: r.product_nick,
      description: r.description,
      releaseVersion: r.release_version,
      iconUrl: r.icon_url,
      tags: r.tags ?? [],
      minPrice: r.min_price,
      currency: r.currency,
      favorite: favorites.has(r.product_id),
    }));
  }

  // --------------------------------------------------------------------------
  // POST/DELETE /api/subscription/favorites/:productCode — 收藏开关（★）
  // 幂等：重复收藏/取消不报错。写路径走 @vxture/service-account（BFF 池只读惯例）。
  // --------------------------------------------------------------------------

  @Post("favorites/:productCode")
  async addFavorite(
    @Req() req: Request & RequestContext,
    @Param("productCode") productCode: string,
  ): Promise<{ productCode: string; favorite: boolean }> {
    if (!req.user) throw new UnauthorizedException("No active session");
    const productId = await this.resolveProductId(productCode);
    await this.favoritesService.add(req.user.id, productId);
    return { productCode, favorite: true };
  }

  @Delete("favorites/:productCode")
  async removeFavorite(
    @Req() req: Request & RequestContext,
    @Param("productCode") productCode: string,
  ): Promise<{ productCode: string; favorite: boolean }> {
    if (!req.user) throw new UnauthorizedException("No active session");
    const productId = await this.resolveProductId(productCode);
    await this.favoritesService.remove(req.user.id, productId);
    return { productCode, favorite: false };
  }

  private async resolveProductId(productCode: string): Promise<string> {
    const res = await this.pool.query<{ id: string }>(
      `select id from product.products
        where product_code = $1 and deleted_at is null`,
      [productCode],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundException("产品不存在");
    return row.id;
  }

  /** 收藏集合，失败降级为空（存量库未跑迁移时页面必须照常渲染）。 */
  private async safeFavoriteIds(userId: string): Promise<Set<string>> {
    try {
      return new Set(await this.favoritesService.listProductIds(userId));
    } catch (err) {
      this.logger.warn(`favorites unavailable, degrade to empty: ${err}`);
      return new Set();
    }
  }

  // --------------------------------------------------------------------------
  // POST /api/subscription/orders — 下单（线下支付，product_320 §4.4；
  // owner 2026-08-20 修订：0 元也是订单——free 档不再即时开通，与付费档同路
  // 产生 suspended 订阅 + unpaid（¥0）账单，付款环节 cashDue=0 走既有的
  // 即时结清（declarePayment instant-settle）自动开通）。
  // 返回订单号 + 线下汇款指引，等 admin 人工确认收款后开通。intent = new|renew|upgrade。
  // 档位冲突/不可购买 → 409/400 语义码。
  // --------------------------------------------------------------------------

  @Post("orders")
  async createOrder(
    @Req() req: Request & RequestContext,
    @Body() body: CreateOrderBody,
  ): Promise<CreateOrderResult> {
    if (!req.user || !req.tenant) throw new UnauthorizedException("会话已失效");

    const productCode = (body?.productCode ?? "").trim();
    if (!PRODUCT_CODE_RE.test(productCode))
      throw new BadRequestException("productCode 非法");
    const planVersionId = (body?.planVersionId ?? "").trim();
    if (!planVersionId) throw new BadRequestException("planVersionId 不能为空");
    const cycleUnit = (body?.cycleUnit ?? "").trim();
    if (!(CYCLE_UNITS as readonly string[]).includes(cycleUnit))
      throw new BadRequestException("cycleUnit 必须是 month 或 year");
    const intent = (body?.intent ?? "").trim();
    if (!(ORDER_INTENTS as readonly string[]).includes(intent))
      throw new BadRequestException("intent 必须是 new/renew/upgrade");
    const upgradeOf = body?.upgradeOfSubscriptionId?.trim() || undefined;
    if (intent === "upgrade" && !upgradeOf)
      throw new BadRequestException("upgrade 需要 upgradeOfSubscriptionId");

    // 价格 + 套餐名：无价格行 = 企业版/不可自助购买 → 拒单（0 元有价格行，正常建单）
    const plan = await this.lookupPlanPrice(planVersionId, cycleUnit);
    if (!plan)
      throw new BadRequestException({
        code: "NOT_PURCHASABLE",
        message: "该套餐/周期不可自助购买（如企业版请联系销售）",
      });

    // One open order per (tenant × product)，0 元订单同样受限（P3/§7.3）。
    await this.assertNoPendingOrderForProduct(req.tenant.id, productCode);

    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);
    const createdBy = req.user.id;

    // upgrade 归属校验：目标订阅须属本租户
    if (intent === "upgrade" && upgradeOf) {
      const target = await this.subscriptionService
        .getSubscription(upgradeOf)
        .catch(() => null);
      if (!target || target.tenantId !== req.tenant.id)
        throw new BadRequestException("升级目标订阅不存在或无权操作");
    }

    // 0 元与付费同路（owner 2026-08-20）：产生线下订单（suspended 订阅 + unpaid 账单）。
    // TTL 在此定格并随单持久化（P4 修订）：个人 30min / 组织 48h。
    const ttlMinutes = paymentTtlMinutesFor(req.tenant.tenantType);
    try {
      const order = await this.subscriptionService.createOfflineOrder({
        tenantId: req.tenant.id,
        workspaceId,
        planVersionId,
        cycleUnit,
        price: Number(plan.price),
        currency: plan.currency,
        createdBy,
        intent: intent as OrderCreateIntent,
        ...(upgradeOf ? { upgradeOfSubscriptionId: upgradeOf } : {}),
        itemName: plan.planName,
        paymentTtlMinutes: ttlMinutes,
      });
      return {
        status: "pending_payment",
        orderId: order.subscription.id,
        orderNo: order.orderNo,
        billNo: order.billNo,
        amount: Number(plan.price).toFixed(2),
        currency: plan.currency,
        planCode: plan.planCode,
        cycleUnit,
        paymentInstructions: buildPaymentInstructions(order.orderNo),
        subscriptionId: null,
        expireAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
      };
    } catch (err) {
      throw mapOrderError(err);
    }
  }

  // GET /api/subscription/orders — 我的订单（租户维度合成视图）
  @Get("orders")
  async getMyOrders(
    @Req() req: Request & RequestContext,
  ): Promise<MyOrderRecord[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const res = await this.pool.query<OrderRow>(MY_ORDERS_SQL, [req.tenant.id]);
    return res.rows.map(mapMyOrderRow);
  }

  // POST /api/subscription/orders/:orderId/cancel — 客户取消未付订单
  @Post("orders/:orderId/cancel")
  async cancelOrder(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
    @Body() body: { reason?: string },
  ): Promise<{ orderId: string; status: string }> {
    if (!req.user || !req.tenant) throw new UnauthorizedException("会话已失效");
    const id = orderId?.trim();
    if (!id) throw new BadRequestException("orderId 不能为空");

    // 归属校验
    const sub = await this.subscriptionService
      .getSubscription(id)
      .catch(() => null);
    if (!sub || sub.tenantId !== req.tenant.id)
      throw new BadRequestException("订单不存在或无权操作");

    try {
      const updated = await this.subscriptionService.cancelPendingOrder(id, {
        actorType: "customer",
        actorId: req.user.id,
        ...(body?.reason ? { remark: body.reason } : {}),
      });
      return { orderId: updated.id, status: updated.status };
    } catch (err) {
      throw mapOrderError(err);
    }
  }

  // --------------------------------------------------------------------------
  // Payment page endpoints (product_321 §4.1)
  // --------------------------------------------------------------------------

  /** GET /api/subscription/orders/:orderId — 付款页详情 */
  @Get("orders/:orderId")
  async getOrderDetail(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
  ): Promise<OrderDetailResult> {
    if (!req.user || !req.tenant) throw new UnauthorizedException("会话已失效");
    const row = await this.loadOrderRow(req.tenant.id, orderId?.trim());
    if (!row) throw new BadRequestException("订单不存在或无权查看");

    const state = deriveOrderState(row);
    const scope = {
      tenantId: req.tenant.id,
      workspaceId: row.workspace_id,
      userId: req.user.id,
    };
    const [vouchers, legs, rejectReason] = await Promise.all([
      state === "pending_payment"
        ? this.promotionService.listAvailableVouchers(scope)
        : Promise.resolve([] as AvailableVoucher[]),
      this.loadPaymentLegs(row.invoice_id),
      this.loadLatestRejectReason(orderId),
    ]);

    return {
      orderId: row.order_id,
      orderNo: row.order_no,
      billNo: row.bill_no,
      planCode: row.plan_code ?? "",
      planName: row.plan_name ?? "",
      tier: row.tier,
      cycleUnit: row.cycle_unit,
      currency: row.currency ?? "CNY",
      orderState: state,
      orderType: "subscription",
      createdAt: row.created_at.toISOString(),
      expireAt: deriveExpireAt(row, state),
      listPrice: baseListPrice(row),
      paidAmount: row.paid_amount ?? "0",
      rejectReason,
      vouchers: vouchers.map(mapVoucherOption),
      legs,
      paymentChannels: buildPaymentChannels(row.order_no),
    };
  }

  /** POST /api/subscription/orders/:orderId/quote — 纯试算（零副作用） */
  @Post("orders/:orderId/quote")
  async quoteOrder(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
    @Body() body: QuoteBody,
  ): Promise<QuoteResult> {
    if (!req.user || !req.tenant) throw new UnauthorizedException("会话已失效");
    const row = await this.loadOrderRow(req.tenant.id, orderId?.trim());
    if (!row) throw new BadRequestException("订单不存在或无权查看");
    if (deriveOrderState(row) !== "pending_payment")
      throw new ConflictException("订单不是待付款状态");

    const scope = {
      tenantId: req.tenant.id,
      workspaceId: row.workspace_id,
      userId: req.user.id,
    };
    // Same predicate as reserve (P7): a voucher usable here cannot fail at
    // declare for availability reasons.
    const discountId = body?.discountVoucherId?.trim() || null;
    const creditId = body?.creditVoucherId?.trim() || null;
    const [discount, credit] = await Promise.all([
      discountId
        ? this.promotionService.resolveForQuote(scope, discountId, "discount")
        : Promise.resolve(null),
      creditId
        ? this.promotionService.resolveForQuote(
            scope,
            creditId,
            "credit_voucher",
          )
        : Promise.resolve(null),
    ]);
    if (discountId && !discount)
      throw new BadRequestException("折扣券不可用，请刷新券列表");
    if (creditId && !credit)
      throw new BadRequestException("代金券不可用，请刷新券列表");

    const quote = computeSettlement({
      listPriceCents: yuanToCents(baseListPrice(row)),
      paidCents: yuanToCents(row.paid_amount ?? "0"),
      discountEffect: discount ? (discount.effect as DiscountEffect) : null,
      creditVoucherCents: credit
        ? (credit.effect as { amountCents: number }).amountCents
        : null,
    });
    return {
      listPrice: centsToYuan(quote.listPriceCents),
      discountOff: centsToYuan(quote.discountOffCents),
      payable: centsToYuan(quote.payableCents),
      paidAmount: centsToYuan(quote.paidCents),
      voucherOff: centsToYuan(quote.voucherOffCents),
      balanceOff: "0.00",
      cashDue: centsToYuan(quote.cashDueCents),
      discountApplicable: quote.discountApplicable,
    };
  }

  /** POST /api/subscription/orders/:orderId/payment-declare — 我已完成付款（P8） */
  @Post("orders/:orderId/payment-declare")
  async declarePayment(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
    @Body() body: DeclareBody,
  ): Promise<DeclarePaymentResult> {
    if (!req.user || !req.tenant) throw new UnauthorizedException("会话已失效");
    const id = orderId?.trim();
    if (!id) throw new BadRequestException("orderId 不能为空");

    const payChannel = (body?.payChannel ?? "").trim();
    if (!(DECLARE_CHANNELS as readonly string[]).includes(payChannel))
      throw new BadRequestException(
        "payChannel 必须是 alipay 或 bank_transfer",
      );
    // Channel must be enabled by env-derived config (§4.4) — no declaring
    // against a channel the payment page can't render.
    const channel = buildPaymentChannels("").find(
      (c) => c.channel === payChannel,
    );
    if (!channel?.enabled)
      throw new BadRequestException("该支付渠道未开放，请选择其它渠道");

    // Ownership (tenant scope), same assertion as cancel.
    const sub = await this.subscriptionService
      .getSubscription(id)
      .catch(() => null);
    if (!sub || sub.tenantId !== req.tenant.id)
      throw new BadRequestException("订单不存在或无权操作");

    try {
      return await this.subscriptionService.declarePayment({
        orderId: id,
        tenantId: req.tenant.id,
        userId: req.user.id,
        payChannel: payChannel as DeclareChannel,
        discountVoucherId: body?.discountVoucherId?.trim() || null,
        creditVoucherId: body?.creditVoucherId?.trim() || null,
        ...(body?.payerName?.trim()
          ? { payerName: body.payerName.trim() }
          : {}),
        ...(body?.transactionNo?.trim()
          ? { transactionNo: body.transactionNo.trim() }
          : {}),
        ...(body?.remark?.trim() ? { remark: body.remark.trim() } : {}),
      });
    } catch (err) {
      throw mapOrderError(err);
    }
  }

  /** Payment-page order row (single order, tenant-scoped). */
  private async loadOrderRow(
    tenantId: string,
    orderId: string | undefined,
  ): Promise<OrderRow | null> {
    if (!orderId) return null;
    const res = await this.pool.query<OrderRow>(
      `${ORDER_ROW_SELECT}
        where sub.tenant_id = $1 and sub.id = $2
          and sub.order_no is not null and sub.deleted_at is null
        limit 1`,
      [tenantId, orderId],
    );
    return res.rows[0] ?? null;
  }

  private async loadPaymentLegs(
    invoiceId: string | null,
  ): Promise<OrderPaymentLeg[]> {
    if (!invoiceId) return [];
    const res = await this.pool.query<{
      id: string;
      pay_source: string;
      pay_status: string;
      total_amount: string;
      pay_channel: string | null;
      created_at: Date;
    }>(
      `select id, pay_source, pay_status, total_amount, pay_channel, created_at
         from billing.payments where bill_id = $1
        order by created_at asc`,
      [invoiceId],
    );
    return res.rows.map((r) => ({
      paymentId: r.id,
      kind:
        r.pay_source === "voucher"
          ? "voucher"
          : r.pay_source === "offline"
            ? "cash"
            : "other",
      status: r.pay_status,
      amount: r.total_amount,
      channel: r.pay_channel,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /** Latest reject reason (P2 banner) from the payment_rejected history. */
  private async loadLatestRejectReason(
    orderId: string,
  ): Promise<string | null> {
    const res = await this.pool.query<{ remark: string | null }>(
      `select remark from metering.subscription_histories
        where subscription_id = $1 and change_type = 'payment_rejected'
        order by created_at desc limit 1`,
      [orderId],
    );
    return res.rows[0]?.remark ?? null;
  }

  /**
   * Duplicate pending-order guard (320 O1 predicate, 321-widened to include
   * partial): one open order per (tenant × product)。0 元订单与付费订单同路
   * （owner 2026-08-20），本守卫对两者一视同仁。
   */
  private async assertNoPendingOrderForProduct(
    tenantId: string,
    productCode: string,
  ): Promise<void> {
    const res = await this.pool.query<{ order_no: string }>(
      `select sub.order_no
         from metering.subscriptions sub
         join product.plan_components pc
           on pc.plan_version_id = sub.plan_version_id and pc.component_role = 'primary'
         join product.products prod on prod.id = pc.product_id
         join lateral (
           select bill_status from billing.invoices i
            where i.subscription_id = sub.id and i.deleted_at is null
            order by i.created_at desc limit 1
         ) inv on true
        where sub.tenant_id = $1 and prod.product_code = $2
          and sub.status = 'suspended'
          and sub.activation_method = 'offline_purchase'
          and inv.bill_status in ('unpaid', 'partial')
          and sub.deleted_at is null
        limit 1`,
      [tenantId, productCode],
    );
    if (res.rows[0]) {
      throw new ConflictException({
        code: "PENDING_ORDER_EXISTS",
        message: `已有待付款订单（${res.rows[0].order_no}），请先完成付款或取消该订单`,
      });
    }
  }

  /**
   * Pending offline order for (tenant × product): suspended + offline_purchase
   * subscription with an unpaid invoice (product_320 §2 O1 判定谓词).
   */
  private async queryPendingOrder(
    tenantId: string,
    productCode: string,
  ): Promise<PendingOrderSummary | null> {
    // 320 O1 predicate, 321-widened: 'unpaid' alone misses legacy partial
    // orders (bill_status IN ('unpaid','partial') — product_321 P1).
    const res = await this.pool.query<OrderRow>(
      `${ORDER_ROW_SELECT}
        where sub.tenant_id = $1
          and exists (
            select 1 from product.plan_components pcx
            join product.products prodx on prodx.id = pcx.product_id
            where pcx.plan_version_id = sub.plan_version_id
              and pcx.component_role = 'primary'
              and prodx.product_code = $2
          )
          and sub.status = 'suspended'
          and sub.activation_method = 'offline_purchase'
          and inv.bill_status in ('unpaid', 'partial')
          and sub.deleted_at is null
        order by sub.created_at desc
        limit 1`,
      [tenantId, productCode],
    );
    const r = res.rows[0];
    if (!r) return null;
    const state = deriveOrderState(r);
    return {
      orderId: r.order_id,
      orderNo: r.order_no,
      billNo: r.bill_no,
      planCode: r.plan_code ?? "",
      tier: r.tier,
      cycleUnit: r.cycle_unit,
      amount: r.pay_amount ?? "0",
      currency: r.currency ?? "CNY",
      createdAt: r.created_at.toISOString(),
      expireAt: deriveExpireAt(r, state),
      paymentState: state,
    };
  }

  /** 服务端解析租户 default workspace（不信任 req.tenant.workspace 字符串）。 */
  private async resolveDefaultWorkspace(tenantId: string): Promise<string> {
    const res = await this.pool.query<{ id: string }>(
      `select id from tenancy.workspaces
        where tenant_id = $1 and is_default and deleted_at is null
        limit 1`,
      [tenantId],
    );
    const id = res.rows[0]?.id;
    if (!id) throw new BadRequestException("租户缺少默认工作空间");
    return id;
  }

  /** 查 (plan_version, cycle) 的价格 + 套餐名；无价格行返回 null（不可自助购买）。 */
  private async lookupPlanPrice(
    planVersionId: string,
    cycleUnit: string,
  ): Promise<{
    price: string;
    currency: string;
    planCode: string;
    planName: string;
  } | null> {
    const res = await this.pool.query<{
      price: string;
      currency: string;
      plan_code: string;
      plan_name: string;
    }>(
      `select pp.price, pp.currency, plan.plan_code, plan.plan_name
         from product.plan_prices pp
         join product.plan_versions pv on pv.id = pp.plan_version_id
         join product.plans plan on plan.id = pv.plan_id
        where pp.plan_version_id = $1 and pp.cycle_unit = $2 and pp.cycle_count = 1
          and plan.current_version_id = pv.id
          and plan.status = 'active' and plan.is_public = true
        limit 1`,
      [planVersionId, cycleUnit],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      price: r.price,
      currency: r.currency,
      planCode: r.plan_code,
      planName: r.plan_name,
    };
  }

  // --------------------------------------------------------------------------
  // POST /api/subscription/actions — 执行订阅变更操作
  // --------------------------------------------------------------------------

  @Post("actions")
  async executeAction(
    @Req() req: Request & RequestContext,
    @Body() body: SubscriptionActionBody,
  ): Promise<SubscriptionRecord> {
    if (!req.user || !req.tenant) throw new UnauthorizedException("会话已失效");

    const { subscriptionId, action, planId, reason } = body ?? {};

    // ── 入参校验 ──────────────────────────────────────────────────────────
    if (!subscriptionId?.trim())
      throw new BadRequestException("subscriptionId 不能为空");

    const VALID: SubscriptionAction[] = [
      "upgrade",
      "pause",
      "resume",
      "cancel",
    ];
    if (!VALID.includes(action))
      throw new BadRequestException(`无效操作类型：${String(action)}`);

    if (action === "upgrade" && !planId?.trim()) {
      throw new BadRequestException("upgrade 操作需要提供 planId");
    }

    // ── 查订阅并校验租户归属 ──────────────────────────────────────────────
    let current: SubscriptionRecord;
    try {
      current = await this.subscriptionService.getSubscription(subscriptionId);
    } catch {
      throw new BadRequestException("订阅不存在");
    }

    if (current.tenantId !== req.tenant.id) {
      throw new UnauthorizedException("无权操作该订阅");
    }

    // ── 执行操作 ──────────────────────────────────────────────────────────
    const changedBy = req.user.email;
    let updated!: SubscriptionRecord;
    try {
      if (action === "upgrade") {
        // product_320 §4.4: 付费升级一律走下单流程（POST /orders, intent=upgrade）。
        // 真实定价落库后，此处直接换版会绕过计费 = 免费升级洞，堵死。
        throw new BadRequestException(
          "升级请通过下单流程完成：POST /api/subscription/orders (intent=upgrade)",
        );
      } else if (action === "pause") {
        // 'suspended' per the @vxture/shared six-value domain — the legacy
        // 'paused' literal never existed in the DDL CHECK and threw at write
        // time; actor_type CHECK only admits system/customer/operator, so the
        // legacy 'user' literal is 'customer' here (self-service actor).
        updated = await this.subscriptionService.updateSubscription(
          subscriptionId,
          {
            status: "suspended",
            operatorType: "customer",
            ...(changedBy
              ? { operatorId: changedBy, updatedBy: changedBy }
              : {}),
            ...(reason ? { operatorRemark: reason } : {}),
          },
        );
      } else if (action === "resume") {
        updated = await this.subscriptionService.updateSubscription(
          subscriptionId,
          {
            status: "active",
            operatorType: "customer",
            ...(changedBy
              ? { operatorId: changedBy, updatedBy: changedBy }
              : {}),
          },
        );
      } else {
        updated = await this.subscriptionService.cancelSubscription(
          subscriptionId,
          changedBy,
          reason,
        );
      }
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : "订阅操作失败",
      );
    }

    // ── 发送确认邮件（失败不阻断主流程）─────────────────────────────────
    void this.mailService
      .send(buildActionEmail(req.user.email, action, updated))
      .catch(() => {});

    return updated;
  }
}

// ============================================================================
// 内部：构建操作确认邮件
// ============================================================================

const ACTION_LABELS: Record<SubscriptionAction, string> = {
  upgrade: "套餐升级",
  pause: "订阅暂停",
  resume: "订阅恢复",
  cancel: "订阅取消",
};

function buildActionEmail(
  to: string,
  action: SubscriptionAction,
  sub: SubscriptionRecord,
) {
  const label = ACTION_LABELS[action];
  const subject = `[Vxture] 您的${label}操作已完成`;
  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <h2 style="margin-bottom:8px">${label}成功</h2>
  <p style="color:#555">您好，您的订阅操作已处理完成，详情如下：</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr style="background:#f5f5f5">
      <td style="padding:10px 12px;color:#888;width:120px">订阅 ID</td>
      <td style="padding:10px 12px">${sub.id}</td>
    </tr>
    <tr>
      <td style="padding:10px 12px;color:#888">套餐 ID</td>
      <td style="padding:10px 12px">${sub.planVersionId}</td>
    </tr>
    <tr style="background:#f5f5f5">
      <td style="padding:10px 12px;color:#888">当前状态</td>
      <td style="padding:10px 12px">${sub.status}</td>
    </tr>
  </table>
  <p style="color:#aaa;font-size:12px;margin-top:24px">
    如有疑问，请联系 Vxture 支持团队。<br>
    此邮件由系统自动发送，请勿回复。
  </p>
</div>`;

  return { to, subject, html };
}

// ============================================================================
// 内部：订单 helpers（product_320 §4.4）
// ============================================================================

/** ConflictException（档位冲突等）→ 保持 409；其余 → 400。 */
function mapOrderError(err: unknown): Error {
  if (err instanceof ConflictException) return err;
  return new BadRequestException(
    err instanceof Error ? err.message : "订单操作失败",
  );
}

/**
 * 线下汇款指引：收款账户来自平台配置（env）；未配置时字段留空占位，由 owner
 * 注入真实账户（product_320 §8 待办①）。reference = orderNo（运营据此核销）。
 */
function buildPaymentInstructions(orderNo: string): OfflinePaymentInstructions {
  return {
    method: "bank_transfer",
    accountName: process.env.OFFLINE_PAY_ACCOUNT_NAME ?? "",
    bankName: process.env.OFFLINE_PAY_BANK_NAME ?? "",
    accountNo: process.env.OFFLINE_PAY_ACCOUNT_NO ?? "",
    reference: orderNo,
  };
}

/**
 * Workspace-total {used, limit} for the two WS-level platform metrics
 * (storage.bytes gauge, ai.credit counter) — product-agnostic by design (this
 * is the header panel, product_220 §4.4), but the two metric kinds must be
 * aggregated differently across the per-product C2 views, or the result is
 * wrong rather than merely imprecise:
 *
 * - storage.bytes (gauge, WS-uniform): `platform-entitlements.service.ts`
 *   computes ONE workspace-wide row and injects the identical object into
 *   EVERY requested product's `quota_pools` (§4.4 — "same for every
 *   product"). Summing it across N subscribed products would multiply the
 *   true total by N. Read it once from whichever product view carries it.
 * - ai.credit (counter, per-product reserved pool, §4.3): each product's
 *   view shows only pools it can see — currently exactly its OWN
 *   contribution, because no tenant sharing-policy config UI exists yet to
 *   populate `metering.resource_sharing_policies` (TD-033, `Open`, no write
 *   path). Under that real invariant, summing every product's entry is safe
 *   and matches the pre-TD-042 workspace-total semantics with zero
 *   double-count risk. **Revisit this sum if/when TD-033 ships a sharing
 *   config UI** — a populated policy could then make one shared pool appear
 *   in more than one product's view, which this sum would double-count.
 */
function aggregateWorkspaceQuota(
  views: ProductEntitlementView[],
): QuotaUsageView {
  const allPools = views.flatMap((v) => v.quota_pools);

  const storagePool = allPools.find((p) => p.metric === "storage.bytes");
  const storage: QuotaMetricView = storagePool
    ? {
        used: storagePool.limit - storagePool.remaining,
        limit: storagePool.limit,
      }
    : EMPTY_QUOTA_METRIC;

  let aiLimit = 0;
  let aiUsed = 0;
  for (const p of allPools) {
    if (p.metric !== "ai.credit") continue;
    aiLimit += p.limit;
    aiUsed += p.limit - p.remaining;
  }
  const aiCredit: QuotaMetricView =
    aiLimit === 0 && aiUsed === 0
      ? EMPTY_QUOTA_METRIC
      : { used: aiUsed, limit: aiLimit };

  return { storage, aiCredit };
}

const EMPTY_QUOTA_METRIC: QuotaMetricView = { used: 0, limit: 0 };

interface OrderRow {
  order_id: string;
  order_no: string;
  workspace_id: string;
  activation_method: string;
  /** 每单付款时效（分钟，P4 修订）；NULL=存量单 → 回退 env */
  payment_ttl_minutes: number | null;
  invoice_id: string | null;
  bill_no: string | null;
  plan_code: string | null;
  plan_name: string | null;
  tier: string | null;
  cycle_unit: string;
  pay_amount: string | null;
  currency: string | null;
  sub_status: string;
  bill_status: string | null;
  total_amount: string | null;
  paid_amount: string | null;
  discount_amount: string | null;
  voucher_paid: string | null;
  has_pending_leg: boolean;
  has_expired_history: boolean;
  ttl_anchor: Date;
  paid_at: Date | null;
  created_at: Date;
  start_at: Date | null;
  end_at: Date | null;
  tenant_name: string | null;
  owner_user_id: string | null;
  workspace_name: string | null;
  workspace_no: string | null;
  product_code: string | null;
  product_name: string | null;
  created_by_type: string | null;
  created_by_id: string | null;
  subscriber_name: string | null;
  declared_at: Date | null;
}

// One projection for the list and the payment-page detail — the six-state
// inputs (bill status, declared leg, expiry history, TTL anchor) come from the
// same SQL so the two faces can never derive different states for one order.
const ORDER_ROW_SELECT = `
select
  sub.id               as order_id,
  sub.order_no,
  sub.workspace_id,
  sub.activation_method,
  sub.payment_ttl_minutes,
  inv.id               as invoice_id,
  inv.bill_no,
  plan.plan_code,
  plan.plan_name,
  pc.tier,
  sub.cycle_unit,
  sub.pay_amount,
  sub.currency,
  sub.status           as sub_status,
  inv.bill_status,
  inv.total_amount,
  inv.paid_amount,
  inv.discount_amount,
  coalesce((
    select sum(p.paid_amount) from billing.payments p
     where p.bill_id = inv.id and p.pay_status = 'paid' and p.pay_source = 'voucher'
  ), 0)                as voucher_paid,
  exists(
    select 1 from billing.payments p
     where p.bill_id = inv.id and p.pay_status = 'pending_verify'
  )                    as has_pending_leg,
  exists(
    select 1 from metering.subscription_histories h
     where h.subscription_id = sub.id and h.change_type = 'order_expired'
  )                    as has_expired_history,
  greatest(
    sub.created_at,
    coalesce((
      select max(h2.created_at) from metering.subscription_histories h2
       where h2.subscription_id = sub.id and h2.change_type = 'payment_rejected'
    ), sub.created_at)
  )                    as ttl_anchor,
  inv.paid_at,
  sub.created_at,
  sub.start_at,
  sub.end_at,
  tn.name              as tenant_name,
  tn.owner_user_id,
  ws.name              as workspace_name,
  ws.workspace_no::text as workspace_no,
  prod.product_code,
  prod.product_name,
  sub.created_by_type,
  sub.created_by_id,
  coalesce(up.display_name, u.account) as subscriber_name,
  (
    select max(p.created_at) from billing.payments p
     where p.bill_id = inv.id and p.pay_source <> 'voucher'
  )                    as declared_at
from metering.subscriptions sub
left join product.plan_versions pv on pv.id = sub.plan_version_id
left join product.plans plan on plan.id = pv.plan_id
left join lateral (
  select tier, product_id from product.plan_components
   where plan_version_id = sub.plan_version_id and component_role = 'primary' limit 1
) pc on true
left join product.products prod on prod.id = pc.product_id
left join tenancy.tenants tn on tn.id = sub.tenant_id
left join tenancy.workspaces ws on ws.id = sub.workspace_id
left join account.user_profiles up
  on sub.created_by_type = 'customer' and up.user_id = sub.created_by_id
left join account.users u
  on sub.created_by_type = 'customer' and u.id = sub.created_by_id
left join lateral (
  select id, bill_no, bill_status, total_amount, paid_amount, discount_amount, paid_at
    from billing.invoices i
   where i.subscription_id = sub.id and i.deleted_at is null
   order by i.created_at desc limit 1
) inv on true`;

const MY_ORDERS_SQL = `${ORDER_ROW_SELECT}
where sub.tenant_id = $1 and sub.order_no is not null and sub.deleted_at is null
order by sub.created_at desc
limit 100
`;

/** Six-state ordered derivation (product_321 P1 — first hit wins). */
function deriveOrderState(r: OrderRow): OrderState {
  if (r.bill_status === "paid") {
    // Upgrade orders close as cancelled with a paid invoice — still completed.
    return r.sub_status === "suspended" &&
      r.activation_method === "offline_purchase"
      ? "activating"
      : "completed";
  }
  if (r.has_pending_leg) return "paid_pending_verify";
  if (r.sub_status === "cancelled")
    return r.has_expired_history ? "expired" : "cancelled";
  return "pending_payment";
}

/**
 * TTL deadline (P4): only while pending payment with zero collected money.
 * Per-order TTL from the persisted column (rev. 2026-08-20); legacy rows
 * (NULL) fall back to the env personal default — byte-identical to the old
 * derivation, so pre-migration orders keep their exact deadline.
 */
function deriveExpireAt(r: OrderRow, state: OrderState): string | null {
  if (state !== "pending_payment") return null;
  if (Number(r.paid_amount ?? 0) > 0) return null; // TTL-exempt family
  const ttl = r.payment_ttl_minutes ?? paymentTtlMinutes();
  const deadline = new Date(r.ttl_anchor.getTime() + ttl * 60_000);
  return deadline.toISOString();
}

/**
 * Base (pre-discount) list price: invoice total already nets the discount
 * rows, so base = total + |discount mirror|; a clean invoice degrades to
 * total = order amount. No invoice → order amount.
 */
function baseListPrice(r: OrderRow): string {
  if (r.total_amount == null) return r.pay_amount ?? "0";
  return centsToYuan(
    yuanToCents(r.total_amount) + yuanToCents(r.discount_amount ?? "0"),
  );
}

function mapVoucherOption(v: AvailableVoucher): OrderVoucherOption {
  if (v.kind === "discount") {
    const e = v.effect as DiscountEffect;
    return {
      voucherId: v.voucherId,
      code: v.code,
      kind: v.kind,
      batchName: v.batchName,
      discountType: e.discountType,
      discountValue: e.value,
      maxOff: e.maxOffCents != null ? centsToYuan(e.maxOffCents) : null,
      expiresAt: v.expiresAt.toISOString(),
    };
  }
  const e = v.effect as { amountCents: number };
  return {
    voucherId: v.voucherId,
    code: v.code,
    kind: v.kind,
    batchName: v.batchName,
    amount: centsToYuan(e.amountCents),
    expiresAt: v.expiresAt.toISOString(),
  };
}

// buildPaymentChannels: see ../lib/payment-channels (shared with addon flow).

function mapMyOrderRow(r: OrderRow): MyOrderRecord {
  const state = deriveOrderState(r);
  return {
    orderId: r.order_id,
    orderNo: r.order_no,
    billNo: r.bill_no,
    planCode: r.plan_code ?? "",
    planName: r.plan_name ?? "",
    tier: r.tier,
    cycleUnit: r.cycle_unit,
    amount: r.pay_amount ?? "0",
    currency: r.currency ?? "CNY",
    orderStatus: state,
    orderType: "subscription",
    expireAt: deriveExpireAt(r, state),
    paidAmount: r.paid_amount ?? "0",
    voucherOff: centsToYuan(
      yuanToCents(r.discount_amount ?? "0") +
        yuanToCents(r.voucher_paid ?? "0"),
    ),
    createdAt: r.created_at.toISOString(),
    confirmedAt: r.paid_at ? r.paid_at.toISOString() : null,
    productCode: r.product_code,
    productName: r.product_name,
    tenantName: r.tenant_name,
    workspaceName: r.workspace_name,
    workspaceNo: r.workspace_no,
    subscriberName: r.created_by_type === "customer" ? r.subscriber_name : null,
    subscriberRole:
      r.created_by_type === "customer" &&
      r.created_by_id != null &&
      r.created_by_id === r.owner_user_id
        ? "owner"
        : null,
    listPrice: baseListPrice(r),
    startAt: r.start_at?.toISOString() ?? null,
    endAt: r.end_at?.toISOString() ?? null,
    declaredAt: r.declared_at?.toISOString() ?? null,
    // 服务开通时刻 = 订阅周期起算锚点（owner 口径：自服务开通,非确认收款）
    activatedAt:
      state === "completed" && r.start_at ? r.start_at.toISOString() : null,
  };
}
