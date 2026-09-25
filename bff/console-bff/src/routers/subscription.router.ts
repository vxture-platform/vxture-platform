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
import {
  OrderService,
  SubscriptionService,
} from "@vxture/service-subscription";
import type {
  DeclarePaymentResult,
  RefundRecordView,
  SubscriptionRecord,
} from "@vxture/service-subscription";
import {
  SUBSCRIPTION_STATUSES,
  TIERS,
  type ProductEntitlementView,
  type Tier,
} from "@vxture-platform/shared";
import { isReleaseStageSubscribable } from "@vxture/core-utils";
import type { RequestContext } from "../types/console.types";
import { auditCustomerAction } from "../audit/audit-log";
import {
  buildPaymentChannels,
  type PaymentChannelInfo,
} from "../lib/payment-channels";
import { PlatformEntitlementsClient } from "../platform/platform-entitlements.client";
import { RequireCapability } from "../auth/capability";

// Inline the DI token (repo-wide pattern): SubscriptionModule provides the pool.
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

// ============================================================================
// 订阅操作类型
// ============================================================================

/**
 * 客户自助能对订阅做的事（2026-09-25 收窄）。
 *
 * **`pause` 与 `resume` 一起摘掉了。** owner 定：暂停是平台动作，客户不能控制暂停。
 * 而「控制 resume 就是控制暂停」——收 pause 不收 resume 更糟：平台因违规暂停了服务，
 * 客户调一次 resume 就把服务拿回去，那条端点带的是 `tenant.billing.manage`，任何租户
 * 管理员都能调。此前它对「是谁暂停的」一个字都不判。
 *
 * 从值域里删掉而不是保留后拒绝：这样重新接上去要先改这一行，编译期就拦住。
 * 界面上本来也只有退订一个按钮（console 的 SubscriptionPage 只调 cancel）。
 */
type SubscriptionAction = "upgrade" | "cancel";

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

/**
 * 订单轴 wire 值域（orderStatus 契约）。
 *
 * 原来是六态，把「已退款」压进了 `cancelled`——于是一张退过款的单在界面上写着「已取消 ·
 * 未付款」，而那张单**付过钱**。取消是「从没成立过」，退款是「成立过又退回」，两件事。
 * 另外两个也是压掉的：钱只到了一半（账单 `partial`）与退款在路上（退款单在审/在执行）。
 *
 * 十态里 `partially_refunded` 当前不可达（全仓没有创建部分退款单的路径，见 DDL 的
 * `chk_refunds_refund_type`）。先把它写进值域，折算退上线那天就不必再改一次契约。
 */
type OrderState =
  | "activating"
  | "completed"
  | "paid_pending_verify"
  | "partially_paid"
  | "refunding"
  | "refunded"
  | "partially_refunded"
  | "cancelled"
  | "expired"
  | "pending_payment";

/**
 * 已履约族：订单已经把服务开出去过。`completed` 之外的三个都是「开过之后钱有动静」，
 * 服务开通时刻这类派生字段必须一并认它们——只写 `=== "completed"` 的话，一张退款中的
 * 单会突然失去它的开通时间。
 */
const FULFILLED_STATES: ReadonlySet<OrderState> = new Set<OrderState>([
  "completed",
  "refunding",
  "refunded",
  "partially_refunded",
]);

/**
 * 还能继续付款的族。`partially_paid` 必须在里面：钱只到了一半的单，客户要能把剩下的补上。
 * 这一档是从 `pending_payment` 里分出来的——分完不把它加回这些判据，等于当天堵死补款。
 */
const PAYABLE_STATES: ReadonlySet<OrderState> = new Set<OrderState>([
  "pending_payment",
  "partially_paid",
]);

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
  /**
   * 这一档是凭邀请才出现的（`plans.is_public = false` + 本人持有有效邀请）。
   * 给页面一个据以标注的依据——同一个阶梯里别人看不到这一档，不说明白，
   * 客户会以为是人人可买的公开档。
   */
  inviteOnly: boolean;
}

/**
 * 「此人此刻持有一张指向该套餐的有效邀请」——邀请订阅的**唯一**判据。
 *
 * 看得见（subscribe-context 的套餐阶梯）与买得到（createOrder 的闸门）必须共用它。
 * 两边各写一份，迟早分叉成「看得见却买不到」或「买得到却没人看得见」——后者正是
 * 2026-09-22 上线时的样子：闸门认邀请，阶梯只认 is_public，券发下去客户点不到。
 *
 * 判据本身：批次是 invite 且在效期内、券已定向发放未核销、未超次数、未过期、
 * 定向到本人或本人租户的工作区、effect 指的就是这个套餐。
 *
 * 表别名与「这个套餐」两半由调用点给：消耗那条按参数比（$3/$4），阶梯那条按
 * 当前行比（pv.id / pl.plan_code）。其余每一个条件都只有这一份。
 */
function inviteMatchSql(o: {
  v: string;
  b: string;
  user: string;
  tenant: string;
  planVersion: string;
  planCode: string;
}): string {
  return `${o.b}.kind = 'invite' and ${o.b}.status = 'active'
      and ${o.v}.status = 'assigned'
      and ${o.v}.used_count < ${o.v}.max_uses
      and (${o.v}.expires_at is null or ${o.v}.expires_at > now())
      and ${o.b}.valid_from <= now() and ${o.b}.valid_until > now()
      and (
            ${o.v}.assigned_user_id = ${o.user}
         or ${o.v}.assigned_workspace_id in (
              select w.id from tenancy.workspaces w
               where w.tenant_id = ${o.tenant} and w.deleted_at is null
            )
          )
      and (
            ${o.b}.effect ->> 'planVersionId' = ${o.planVersion}
         or ${o.b}.effect ->> 'planCode' = ${o.planCode}
          )`;
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
  /**
   * 这一次暂停恢复后要不要顺延服务期（2026-09-25 步骤三）。
   *
   * 只有这个布尔，**没有暂停原因**：原因里有「客户违规」那一档，是运营的判断，不从客户
   * 界面读出来。客户需要知道的只有一件——停掉的这些天会不会还给他。
   *
   * null = 没在暂停中，或存量冻结行没有 episode（原因轴是后加的）→ 界面什么都不多说。
   */
  suspensionExtendsTerm: boolean | null;
}

/**
 * A pending order for (tenant × product) — an open billing.orders row
 * (pending_payment / pending_verify / paid，product_330 P1-b2). Its presence
 * means the client shows the awaiting-confirmation panel instead of the plan
 * ladder.
 */
export interface PendingOrderSummary {
  orderId: string;
  orderNo: string;
  billNo: string | null;
  planCode: string;
  /** 展示名：套餐名 + 产品主名。此前只带 plan_code，页面把「vxtpl-starter」当名字给客户看。 */
  planName: string;
  productCode: string | null;
  productName: string | null;
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

/**
 * 续订会跨版本这件事本身，外加新旧差异（owner 2026-09-22）。
 *
 * **非空 = 续订会换版本**。差异三项可能全空（只翻了版本号、内容没变），那时界面不画
 * 对比表，但**仍要回送确认**——服务端那道闸门只看版本是否相同，它同时是自动续订的
 * 护栏。
 *
 * 续订 = 重新签一次，签的是套餐现在在售的那一版；内容可能与他当初买的不同。
 * **客户要有知情权与决策权**，所以差异由服务端算好给出去——判据不放前端，两边各算
 * 一份迟早会分叉成「界面说没变、下单却变了」。
 *
 * 只列**变了的**项：没变的条目摆出来会把真正变了的那一两条淹掉。
 */
export interface RenewVersionChange {
  /** 他当前钉着的版本；下单时要原样回送，作为「我看的是这一版」的凭据。 */
  fromPlanVersionId: string;
  /** 续订后会落到的版本（套餐当前在售版）。 */
  toPlanVersionId: string;
  /** 价格变化，按周期列；两边都有价才比得了，缺一侧给 null。 */
  prices: { cycleUnit: string; from: string | null; to: string | null }[];
  /** 配额变化；值统一转字符串，前端只负责展示不做解读。 */
  quota: { key: string; from: string | null; to: string | null }[];
  featuresAdded: string[];
  featuresRemoved: string[];
}

export interface SubscribeContext {
  /** Normalized known intent, or null = unknown/absent → client degrades. */
  intent: SubscribeIntent | null;
  /** null = unknown product code → client degrades to the subscription home. */
  product: { code: string; name: string } | null;
  /** Validated against the @vxture-platform/shared five-tier ladder; invalid → null. */
  targetTier: Tier | null;
  metric: string | null;
  /** Representative subscription covering (active tenant × product), if any. */
  current: SubscribeCurrent | null;
  /** Pending offline order for this product, if any (product_320). */
  pendingOrder: PendingOrderSummary | null;
  /** Purchasable ladder: public active plans' current locked version, tier-sorted. */
  plans: SubscribePlanOption[];
  /**
   * 续订会跨版本时的差异；null = 不跨版本、没有在用订阅、或该套餐已不在阶梯上
   * （退役——那种情况下压根不能续，见 `currentPlanRetired`）。
   */
  versionChange: RenewVersionChange | null;
  /**
   * 他在用的那个套餐**已不在售**（退役/下架），阶梯里找不到它。
   *
   * 这时既不能续订，也不该把他推进一个写着「升级」的按钮——那是同档位的假动作。
   * 界面据此明说「该套餐已下架，到期后需改选其他档」（owner 2026-09-22 裁定：
   * 退役 = 服务到本周期为止，不再续）。
   */
  currentPlanRetired: boolean;
}

// ── order endpoints (product_320 §4.4) ──────────────────────────────────────

interface CreateOrderBody {
  productCode: string;
  planVersionId: string;
  cycleUnit: string;
  intent: string;
  upgradeOfSubscriptionId?: string;
  /** 确认页的自动续费开关（owner 2026-09-03：默认关，需客户开启）；缺省 = false。 */
  autoRenew?: boolean;
  /**
   * 跨版本续订的客户确认（owner 2026-09-22）：值是他在确认页上看到差异时、
   * 原订阅钉着的那个版本 id。服务端比对它与原订阅当前的版本，不等就拒——期间若又
   * 发布了新版，旧确认失效，必须重新看一遍。
   */
  acceptVersionChangeFrom?: string;
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
  /** billing.orders.id（product_330） */
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

/** 升级折抵报价（product_330 §4.1）：金额两位小数字符串，比率 [0,1]。 */
export interface UpgradeQuoteResult {
  listPrice: string;
  credit: string;
  creditTime: string;
  creditUsage: string;
  payable: string;
  leftover: string;
  currency: string;
  daysLeft: number;
  daysTotal: number;
  usageRemainingRatio: number;
  consumableShare: number;
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
  /**
   * 该订单所开通的订阅**现在**是什么状态（SUBSCRIPTION_STATUSES）；未履约时 null。
   *
   * 「服务还在不在」只有订阅行能回答。订单状态回答的是「这张单走到哪一步」，它走完之后
   * 永远停在 fulfilled——拿它当服务状态，退订之后那一列就是一句假话（2026-09-24 实撞）。
   */
  subscriptionStatus: string | null;
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
  /** 履约后挂上的订阅 id（订单菜单「退订」要对它落锤，不能拿 orderId 冒充）；未履约 null。 */
  subscriptionId: string | null;
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
  /** 产品主名/编码：付款页标题要写「产品 · 套餐」，此前投影漏了它（SQL 早就选了）。 */
  productCode: string | null;
  productName: string | null;
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
  /** 退款单（product_330 §5）：最近一张；null = 没申请过 */
  refund: OrderRefundView | null;
}

/** 客户可见的退款单投影。 */
export interface OrderRefundView {
  refundNo: string;
  amount: string;
  currency: string;
  reason: string | null;
  /**
   * requested → approved | rejected → refunded | failed
   *
   * `failed` 是 2026-09-25 补的：打款失败的单 audit 仍是 approved，此前它落进 `approved`
   * 那一档，于是客户看到「退款已通过，等待打款」——而钱根本没退回去。
   */
  stage: "requested" | "approved" | "rejected" | "refunded" | "failed";
  auditRemark: string | null;
  requestedAt: string;
  auditedAt: string | null;
  refundedAt: string | null;
}

export interface RefundEligibilityResult {
  eligible: boolean;
  reasons: string[];
  /** 可退金额（2026-09-25 起按已消耗配额折算，不再恒等于实付） */
  amount: string;
  currency: string;
  /** 本单实付（折算前）——界面要能说清「退多少、留多少」 */
  paidAmount: string;
  /** 平台留下的那一份 = paidAmount − amount */
  keptAmount: string;
  windowEndsAt: string | null;
  usageRatio: number;
  windowHours: number;
  maxUsageRatio: number;
}

function mapRefundView(r: RefundRecordView): OrderRefundView {
  // 顺序要紧：执行结果先判，再判审核。失败单的 audit 是 approved，反过来写就会把
  // 「钱没退回去」说成「已通过，等待打款」。
  const stage: OrderRefundView["stage"] =
    r.refundStatus === "success"
      ? "refunded"
      : r.refundStatus === "failed"
        ? "failed"
        : r.auditStatus === "rejected"
          ? "rejected"
          : r.auditStatus === "approved"
            ? "approved"
            : "requested";
  return {
    refundNo: r.refundNo,
    amount: r.amount,
    currency: r.currency,
    reason: r.reason,
    stage,
    auditRemark: r.auditRemark,
    requestedAt: r.requestedAt.toISOString(),
    auditedAt: r.auditedAt?.toISOString() ?? null,
    refundedAt: r.refundedAt?.toISOString() ?? null,
  };
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
  /**
   * 产品最近一次发布的时刻（`products.released_at`，ISO）。
   *
   * **不是 `updated_at`**：那是行审计列，后台改一句描述也会变，对客户不是"产品有更新"。
   * `released_at` 才是"这一版什么时候发出来的"，与 `release_version` 成对出现。
   */
  releasedAt: string | null;
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
  /** 产品最近一次发布的时刻（`products.released_at`，ISO）。见 SubscribedProductView 同名字段。 */
  releasedAt: string | null;
  iconUrl: string | null;
  tags: string[];
  /**
   * 现行锁定版本各周期最低价（元字符串）。
   *
   * `"0.00"` 就是 0 元,**不要在文案上把它说成「免费版」/「永久免费」**:¥0 档同样是
   * 按周期的订阅、同样会到期(owner 2026-09-03 决策 5),说成"免费"是平台替产品做了一个
   * 没人授权的商业承诺。展示一律与其它价格同一格式(`¥0 起 / 月`),不特判。
   */
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
    // product_330 P1-b2：订单阶段（下单 / 申报 / 取消）全走订单实体编排
    @Inject(OrderService)
    private readonly orderService: OrderService,
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

  @RequireCapability("tenant.quota.read")
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

  @RequireCapability("tenant.quota.read")
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

  @RequireCapability("tenant.quota.read")
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

  @RequireCapability("tenant.billing.manage")
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
    /* 套餐阶梯要按人算邀请（非公开档凭邀请才出现），所以这里连 user 一起挡。 */
    if (!req.user || !req.tenant)
      throw new UnauthorizedException("租户上下文缺失");

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
        versionChange: null,
        currentPlanRetired: false,
      };
    }

    const [current, pendingOrder, plans] = await Promise.all([
      this.queryCurrentForProduct(req.tenant.id, product.code),
      this.queryPendingOrder(req.tenant.id, product.code),
      this.queryPlanLadder(product.code, req.user.id, req.tenant.id),
    ]);
    /*
     * 他在用的那一档，在阶梯里还找得到吗（按 plan_code 比，不按版本）。
     *   找得到且版本不同 → 续订会跨版本，算差异给客户看
     *   找不到           → 套餐已退役：不能续，界面明说下架
     * 没有在用订阅时两者都不成立。
     */
    const ladderSame = current
      ? (plans.find((p) => p.planCode === current.planCode) ?? null)
      : null;
    const isLive = current
      ? current.status === "active" || current.status === "trialing"
      : false;
    const currentPlanRetired =
      Boolean(current) && isLive && ladderSame === null;
    const versionChange =
      current &&
      ladderSame &&
      ladderSame.planVersionId !== current.planVersionId
        ? await this.queryVersionChange(
            current.planVersionId,
            ladderSame.planVersionId,
          )
        : null;

    return {
      intent,
      product,
      targetTier,
      metric,
      current,
      pendingOrder,
      plans,
      versionChange,
      currentPlanRetired,
    };
  }

  /**
   * 两个版本之间的差异（价格 / 配额 / 权益），只列**变了的**。
   *
   * 算在服务端，不给前端：同一个判据两边各算一份，迟早分叉成「界面说没变、下单却
   * 变了」——而这一条正是客户的知情权所依赖的东西（owner 2026-09-22）。
   *
   * 配额与权益取 primary 组件那一行：主售品决定客户拿到什么，bundled 是支撑件。
   */
  private async queryVersionChange(
    fromPlanVersionId: string,
    toPlanVersionId: string,
  ): Promise<RenewVersionChange | null> {
    const res = await this.pool.query<{
      plan_version_id: string;
      features: string[] | null;
      quota: Record<string, unknown> | null;
      prices: { cycleUnit: string; price: string }[];
    }>(
      `select pv.id as plan_version_id, pc.features, pc.quota,
              coalesce((
                select jsonb_agg(jsonb_build_object(
                         'cycleUnit', pp.cycle_unit,
                         'price', to_char(pp.price, 'FM999999999990.00'))
                       order by pp.cycle_unit)
                  from product.plan_prices pp
                 where pp.plan_version_id = pv.id and pp.cycle_count = 1
              ), '[]'::jsonb) as prices
         from product.plan_versions pv
         left join product.plan_components pc
           on pc.plan_version_id = pv.id and pc.component_role = 'primary'
        where pv.id = any($1::uuid[])`,
      [[fromPlanVersionId, toPlanVersionId]],
    );
    const byId = new Map(res.rows.map((r) => [r.plan_version_id, r]));
    const before = byId.get(fromPlanVersionId);
    const after = byId.get(toPlanVersionId);
    /* 读不到就不给差异——宁可不显示，也不显示一份半边的对比。 */
    if (!before || !after) return null;

    const priceOf = (
      row: { prices: { cycleUnit: string; price: string }[] },
      cycle: string,
    ) => row.prices?.find((x) => x.cycleUnit === cycle)?.price ?? null;
    const cycles = [
      ...new Set(
        [...(before.prices ?? []), ...(after.prices ?? [])].map(
          (x) => x.cycleUnit,
        ),
      ),
    ].sort();
    const prices = cycles
      .map((cycleUnit) => ({
        cycleUnit,
        from: priceOf(before, cycleUnit),
        to: priceOf(after, cycleUnit),
      }))
      .filter((x) => x.from !== x.to);

    const asText = (v: unknown) =>
      v === null || v === undefined ? null : String(v);
    const qa = before.quota ?? {};
    const qb = after.quota ?? {};
    const quota = [...new Set([...Object.keys(qa), ...Object.keys(qb)])]
      .sort()
      .map((key) => ({ key, from: asText(qa[key]), to: asText(qb[key]) }))
      .filter((x) => x.from !== x.to);

    const fa = new Set(before.features ?? []);
    const fb = new Set(after.features ?? []);
    const featuresAdded = [...fb].filter((x) => !fa.has(x)).sort();
    const featuresRemoved = [...fa].filter((x) => !fb.has(x)).sort();

    /*
     * 三项都没变（只是版本号翻了）**也要回这个块**，不能回 null。
     *
     * 「会不会跨版本」与「有没有差异」是两件事：服务端只要版本不同就要客户确认
     * （那道闸门同时是自动续订的护栏），回 null 会让界面无面板可确认、下单却被
     * 409 拦住，而且不给任何理由。差异为空时界面不画对比表，但仍要回送确认。
     */
    return {
      fromPlanVersionId,
      toPlanVersionId,
      prices,
      quota,
      featuresAdded,
      featuresRemoved,
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
      suspension_extends_term: boolean | null;
      auto_renew: boolean;
      tier: string | null;
      plan_code: string;
    }>(
      `select ts.id, ts.status, ts.plan_version_id, ts.end_at, ts.trial_end_at,
              /*
               * 这一次暂停恢复后要不要顺延服务期（2026-09-25 步骤三）。
               *
               * 只回传这个布尔，**不回传暂停原因**：原因里有 customer_violation 这一档，
               * 那是运营的判断，不该从客户界面读出来。客户需要知道的只有一件事——停掉的
               * 这些天会不会还给他。
               *
               * NULL = 没在暂停中，或存量冻结行没有 episode（原因轴 2026-09-25 才加）。
               * 界面据此什么都不多说，而不是猜一个。
               */
              (select sus.extends_term
                 from metering.subscription_suspensions sus
                where sus.subscription_id = ts.id and sus.resumed_at is null
                limit 1) as suspension_extends_term,
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
      suspensionExtendsTerm: row.suspension_extends_term,
    };
  }

  /**
   * Public active plans whose CURRENT version is locked, with their prices，
   * **外加本人凭邀请解锁的非公开档**。
   *
   * 邀请订阅那一半（2026-09-22 补）：`is_public = false` 的档默认不进阶梯，但持有
   * 有效邀请的人要看得见——否则券发下去，客户打开订阅页什么都没有，点不到下单。
   * 上线时只做了闸门认邀请、阶梯没认，整条链在客户那一侧是断的。判据与闸门共用
   * `inviteMatchSql`，不另写一份。
   *
   * 这里**不消耗**邀请，只是看：消耗在下单那一刻（`consumeInviteForPlan`）。
   * 刷一次订阅页就烧掉一张券，是这条链上最容易犯的错。
   *
   * TODO(shared-ladder): 本查询与 website-bff product-plans.router 是同一口径
   * 的两份 SQL；若第三处出现，应抽到共享查询层（如 @vxture/service-catalog）。
   * 注意那一份是**匿名公开目录**，没有会话就没有邀请可言，它的 is_public 过滤
   * 留着是对的——「同一口径」指的是公开那一半。
   *
   * **成熟度刷不在这里卡（2026-09-17，有意为之）**：开发中产品的阶梯照常返回，
   * 由 `createOrder` 在下单时明确拒（`PRODUCT_NOT_RELEASED`）。静默回空阶梯会让页面
   * 显示「无可用套餐」——用户不知道为什么；看得到价格、按下去被告知原因，更诚实。
   * 另：在这里加判据还会连带要求改 website-bff 那份同口径 SQL，恰好凑成上面说的第三处。
   */
  private async queryPlanLadder(
    productCode: string,
    userId: string,
    tenantId: string,
  ): Promise<SubscribePlanOption[]> {
    const res = await this.pool.query<{
      plan_id: string;
      plan_code: string;
      plan_name: string;
      plan_version_id: string;
      tier: string;
      features: string[] | null;
      prices: SubscribePlanPrice[];
      invite_only: boolean;
    }>(
      `select pl.id as plan_id, pl.plan_code, pl.plan_name,
              pv.id as plan_version_id, pc.tier, pc.features,
              (pl.is_public = false) as invite_only,
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
          and pl.is_customer_visible = true
          and (
                pl.is_public = true
             or exists (
                  select 1
                    from promotion.vouchers iv
                    join promotion.voucher_batches ib on ib.id = iv.batch_id
                   where ${inviteMatchSql({
                     v: "iv",
                     b: "ib",
                     user: "$2",
                     tenant: "$3",
                     planVersion: "pv.id::text",
                     planCode: "pl.plan_code",
                   })}
                )
              )
         left join product.plan_prices pp on pp.plan_version_id = pv.id
        where prod.product_code = $1 and pc.tier is not null
        group by pl.id, pl.plan_code, pl.plan_name, pl.is_public,
                 pv.id, pc.tier, pc.features`,
      [productCode, userId, tenantId],
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
        inviteOnly: r.invite_only,
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

  @RequireCapability("tenant.quota.read")
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

  @RequireCapability("tenant.billing.read")
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
      released_at: Date | null;
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
              prod.product_nick, prod.release_version, prod.released_at,
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
          -- 下单只建 billing.orders（product_330 P1-b2），订阅行只在履约后存在；旧模型的
          -- 待收款壳已在 P2 迁移里软删。页头「未支付、未开通的订单不在此列」由此成立。
          -- cancelled 不展示：从未生效或已终止的意愿态（含 P1-b1 双写期的升级镜像行）。
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
      releasedAt: r.released_at?.toISOString() ?? null,
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

  @RequireCapability("tenant.billing.read")
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
      released_at: Date | null;
      icon_url: string | null;
      tags: string[] | null;
      min_price: string;
      currency: string;
    }>(
      `select prod.id as product_id, prod.product_code, prod.product_name,
              prod.product_nick, prod.description, prod.release_version,
              prod.released_at,
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
          /* 预览版与停售中的不进推荐位：前者还不能订（下单路径同步卡着），
             推了只会把人送到一个按不下去的按钮前；后者只接受老客户续订，
             而推荐位面向的恰恰是尚未订阅这个产品的租户。
             （2026-10-29 承诺等级改名：developing → preview。） */
          and prod.release_stage not in ('preview', 'sunset')
          and not exists (
            select 1 from metering.subscriptions ts
              join product.plan_components sub_pc
                on sub_pc.plan_version_id = ts.plan_version_id
             where ts.tenant_id = $1 and ts.deleted_at is null
               and sub_pc.product_id = prod.id
          )
        group by prod.id, prod.product_code, prod.product_name, prod.product_nick,
                 prod.description, prod.release_version, prod.released_at,
                 prod.icon_url, prod.tags, prod.sort
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
      releasedAt: r.released_at?.toISOString() ?? null,
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

  @RequireCapability("tenant.billing.read")
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

  @RequireCapability("tenant.billing.read")
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
  // 产生待付款订单 + unpaid（¥0）账单，付款环节 cashDue=0 走既有的
  // 即时结清（declarePayment instant-settle）自动履约）。
  // product_330 P1-b2：下单只建 billing.orders，不再建 suspended 订阅行；履约时才建/改订阅。
  // 返回订单号 + 线下汇款指引，等 admin 人工确认收款后开通。intent = new|renew|upgrade。
  // 档位冲突/不可购买 → 409/400 语义码。
  // --------------------------------------------------------------------------

  @RequireCapability("tenant.billing.manage")
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

    /*
     * 成熟度兜底（2026-09-17）。「开发中不可订」此前**只长在官网卡片上**：
     * `ProductCatalogCard` 判 developing 就隐掉订阅按钮，而服务端从头到尾没有一处读
     * `release_stage`——权威源里那个 `isReleaseStageSubscribable` 写了，却没有调用者。
     *
     * 必须卡在这里而不是只卡列表查询：`lookupPlanPrice` 只按 plan_version_id 查价，
     * 根本不碰产品行，所以「列表里滤掉了」不等于「下单拦得住」。
     */
    /*
     * 一次查库答两件事：这个套餐到底卖的是哪个产品，那个产品能不能订。
     *
     * **归属校验**：`productCode` 与 `planVersionId` 是请求体里**各自独立**送来的两个
     * 字段，此前全程没有一处校验它们属于同一个产品：`lookupPlanPrice` 只按
     * plan 查价、不碰产品行，`assertNoPendingOrderForProduct` 只按产品查在途单。
     * 不合一的后果不只是绕过下面的成熟度门——订单落库时产品与套餐就是对不上的。
     *
     * **成熟度兜底**：「开发中不可订」此前只长在官网卡片上（`ProductCatalogCard`
     * 判 developing 就隐掉按钮），而服务端从头到尾没有一处读 `release_stage`——权威源里
     * 那个 `isReleaseStageSubscribable` 写了，却没有调用者。
     *
     * 卡在这里而不是只卡列表查询：列表能滤掉不等于下单拦得住。
     */
    const soldRow = await this.pool.query<{
      product_code: string;
      product_status: string;
      release_stage: string;
      plan_is_public: boolean;
      plan_code: string;
    }>(
      `select prod.product_code, prod.status as product_status,
              prod.release_stage,
              pl.is_public as plan_is_public, pl.plan_code
         from product.plan_components pc
         join product.products prod on prod.id = pc.product_id
         join product.plan_versions pv on pv.id = pc.plan_version_id
         join product.plans pl on pl.id = pv.plan_id
        where pc.plan_version_id = $1
          and pc.component_role = 'primary'
          and prod.deleted_at is null
        limit 1`,
      [planVersionId],
    );
    const sold = soldRow.rows[0];
    if (!sold || sold.product_code !== productCode) {
      throw new BadRequestException({
        code: "PLAN_PRODUCT_MISMATCH",
        message: "套餐与产品不匹配，请重新选择。",
      });
    }
    /*
     * 生命周期轴：没上线的产品不能下单（2026-09-24）。
     *
     * 这一条**此前不存在**——上面那句只查 `release_stage`，整个下单路径从头到尾没读
     * 过 `prod.status`。两个目录（console 的 subscribe-context、官网的定价端点）都按
     * `status = 'active'` 过滤，所以界面上到不了这里；但**判据不在界面上**：只要拿到
     * 一个 planVersionId，一个「信息填好了、东西还没建」的产品照样能被下单成功。
     *
     * 2026-09-24 有 13 个只填了信息的产品要转 `developing`，这个洞当场变成实际风险
     * （它们中若有仍挂着公开套餐的，下单会成功）。不靠「承诺等级反正也是 preview」
     * 兜——那是两根轴碰巧一致，而下一行那条判据只看得见其中一根。
     */
    if (sold.product_status !== "active") {
      throw new ConflictException({
        code: "PRODUCT_NOT_LIVE",
        message: "该产品尚未上线，还不能订阅。",
      });
    }
    if (!isReleaseStageSubscribable(sold.release_stage)) {
      throw new ConflictException({
        code: "PRODUCT_NOT_RELEASED",
        /* 「开发中」自 2026-09-24 起是生命周期轴上的一个状态（见上一条），这里说的是
           承诺等级最低那一档——2026-10-29 已对外改称「预览版」。两句话必须分得开，
           否则客户拿着错的词去问运营，而运营在两个不同的轴上找。 */
        message: "该产品尚在预览阶段，还未开放订阅。",
      });
    }

    /*
     * 非公开套餐不可自助购买（2026-09-22）。
     *
     * `plans.is_public` 此前**只是个列表过滤**：console-bff 在 `subscribe-context`
     * 与 `recommended-products` 两处滤掉它，而本端点从头到尾没读过这一列。后果是
     * 「非公开」只做到了看不见——**知道 planVersionId 的人照样下得了单**。
     *
     * 这正是上面那段成熟度注释写过的同一条教训（「列表能滤掉不等于下单拦得住」），
     * 当时补了 `release_stage` 却没有回头看同在一条路径上的 `is_public`。
     *
     * 放在成熟度之后：两者都是「这东西现在不该卖」，但成熟度是产品级、可见性是
     * 套餐级，先答产品再答套餐，报错也按这个次第给。
     *
     * **凭邀请解锁**（2026-09-22）：非公开套餐本身不开放自助购买，但持有一张有效
     * 邀请（`promotion.vouchers` 的 `kind='invite'`）的人可以买。邀请**只解锁
     * 「能买」，不改变「要付钱」**——客户照常下单、照常付款，与运营直接发订阅
     * （`operator_grant`，无订单无钱）和兑换码（`redemption`，输码抵扣）是三件事。
     */
    if (!sold.plan_is_public) {
      /*
       * 续订例外：邀请挡的是**进门**，不是挡已经在里面的人续费。
       *
       * 少了这一条，把一个在售档改成邀请制就会连带掐断老客户的续订——界面上
       * 只是 409，而客户什么都没做错；更糟的是 `consumeInviteForPlan` 每次都要
       * 烧掉一张券，等于「每个周期续一次要重发一张邀请」。都不是这条机制的本意。
       *
       * 范围按**套餐**（跨版本）而不是按版本：续订延长的就是手上这一档。换档是
       * `upgrade`，那是新进一档，照样要邀请。
       */
      const renewingOwnPlan =
        intent === "renew" &&
        (await this.holdsSubscriptionOnPlan(req.tenant.id, planVersionId));
      if (!renewingOwnPlan) {
        const invite = await this.consumeInviteForPlan({
          userId: req.user.id,
          tenantId: req.tenant.id,
          planVersionId,
          planCode: sold.plan_code,
        });
        if (!invite) {
          throw new ConflictException({
            code: "PLAN_NOT_PUBLIC",
            message: "该套餐未对外开放自助购买，请联系销售。",
          });
        }
      }
    }

    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);
    const createdBy = req.user.id;

    // One open order per (workspace × product)，0 元订单同样受限（P3/§7.3）；
    // 库级部分唯一索引 uidx_orders_open_per_product 兜底并发。
    await this.assertNoPendingOrderForProduct(workspaceId, productCode);

    // 原订阅：upgrade / renew 由客户端指定；renew 未指定时取本产品的代表订阅（续订即延长它）。
    let effectiveIntent = intent as OrderCreateIntent;
    let fromSubscriptionId = upgradeOf;
    if (effectiveIntent === "renew") {
      const current = await this.queryCurrentForProduct(
        req.tenant.id,
        productCode,
      );
      if (!fromSubscriptionId) {
        if (!current)
          throw new BadRequestException("没有可续订的订阅，请直接订阅");
        fromSubscriptionId = current.subscriptionId;
      }
      // 续订只延长"同一套餐、可续"的订阅（在用 / 到期族）；已取消的、或到期后换档的，
      // 都不是续订——按 new 建新订阅（原订阅已不在用，档位守卫放行）。
      const from =
        current && current.subscriptionId === fromSubscriptionId
          ? current
          : null;
      const live = from && ["active", "trialing"].includes(from.status);
      const lapsed =
        from && ["expiring", "overdue", "expired"].includes(from.status);
      if (
        from &&
        !(
          (live && from.planVersionId === planVersionId) ||
          (lapsed && from.planVersionId === planVersionId)
        )
      ) {
        effectiveIntent = live ? "upgrade" : "new";
        if (effectiveIntent === "new") fromSubscriptionId = undefined;
      }
    }
    // 归属校验：原订阅须属本租户（服务层再校 workspace / 状态 / 套餐）
    if (fromSubscriptionId) {
      const target = await this.subscriptionService
        .getSubscription(fromSubscriptionId)
        .catch(() => null);
      if (!target || target.tenantId !== req.tenant.id)
        throw new BadRequestException("目标订阅不存在或无权操作");
    }

    // 0 元与付费同路（owner 2026-08-20）：产生待付款订单（billing.orders + unpaid 账单）。
    // TTL 在此定格并随单持久化（P4 修订）：个人 30min / 组织 48h。
    const ttlMinutes = paymentTtlMinutesFor(req.tenant.tenantType);
    try {
      const { order, billNo } = await this.orderService.createOrder({
        tenantId: req.tenant.id,
        workspaceId,
        planVersionId,
        cycleUnit,
        price: Number(plan.price),
        currency: plan.currency,
        createdBy,
        intent: effectiveIntent,
        ...(fromSubscriptionId ? { fromSubscriptionId } : {}),
        itemName: plan.planName,
        paymentTtlMinutes: ttlMinutes,
        autoRenew: body.autoRenew === true,
        /* 原样透传，判据在服务层（它才拿得到原订阅当前钉着的版本）。 */
        ...(typeof body.acceptVersionChangeFrom === "string" &&
        body.acceptVersionChangeFrom.trim()
          ? { acceptVersionChangeFrom: body.acceptVersionChangeFrom.trim() }
          : {}),
      });
      return {
        status: "pending_payment",
        orderId: order.id,
        orderNo: order.orderNo,
        billNo,
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

  // GET /api/subscription/upgrade-quote — 升级折抵报价（product_330 §4.1，零副作用）
  // 与下单时落库的是同一函数；确认页拿它显示「套餐价 / 升级折抵 / 应付」。
  @RequireCapability("tenant.billing.manage")
  @Get("upgrade-quote")
  async getUpgradeQuote(
    @Req() req: Request & RequestContext,
    @Query()
    query: {
      subscriptionId?: string;
      planVersionId?: string;
      cycleUnit?: string;
    },
  ): Promise<UpgradeQuoteResult> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const subscriptionId = query.subscriptionId?.trim() ?? "";
    const planVersionId = query.planVersionId?.trim() ?? "";
    const cycleUnit = query.cycleUnit?.trim() ?? "";
    if (!UUID_RE.test(subscriptionId))
      throw new BadRequestException("subscriptionId 非法");
    if (!planVersionId) throw new BadRequestException("planVersionId 不能为空");
    if (!(CYCLE_UNITS as readonly string[]).includes(cycleUnit))
      throw new BadRequestException("cycleUnit 必须是 month 或 year");
    const target = await this.subscriptionService
      .getSubscription(subscriptionId)
      .catch(() => null);
    if (!target || target.tenantId !== req.tenant.id)
      throw new BadRequestException("订阅不存在或无权操作");
    const plan = await this.lookupPlanPrice(planVersionId, cycleUnit);
    if (!plan)
      throw new BadRequestException({
        code: "NOT_PURCHASABLE",
        message: "该套餐/周期不可自助购买（如企业版请联系销售）",
      });
    const q = await this.orderService.quoteUpgrade(
      subscriptionId,
      Number(plan.price),
    );
    return {
      listPrice: q.pNew.toFixed(2),
      credit: q.credit.toFixed(2),
      creditTime: q.creditTime.toFixed(2),
      creditUsage: q.creditUsage.toFixed(2),
      payable: q.payable.toFixed(2),
      leftover: q.leftover.toFixed(2),
      currency: plan.currency,
      daysLeft: q.daysLeft,
      daysTotal: q.daysTotal,
      usageRemainingRatio: q.u,
      consumableShare: q.alpha,
    };
  }

  // GET /api/subscription/orders — 我的订单（租户维度合成视图）
  @RequireCapability("tenant.billing.read")
  @Get("orders")
  async getMyOrders(
    @Req() req: Request & RequestContext,
  ): Promise<MyOrderRecord[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const res = await this.pool.query<OrderRow>(MY_ORDERS_SQL, [req.tenant.id]);
    return res.rows.map(mapMyOrderRow);
  }

  // POST /api/subscription/orders/:orderId/cancel — 客户取消未付订单
  @RequireCapability("tenant.billing.manage")
  @Post("orders/:orderId/cancel")
  async cancelOrder(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
    @Body() body: { reason?: string },
  ): Promise<{ orderId: string; status: string }> {
    if (!req.user || !req.tenant) throw new UnauthorizedException("会话已失效");
    const id = orderId?.trim();
    if (!id) throw new BadRequestException("orderId 不能为空");

    // 归属校验（tenant scope）
    const row = await this.loadOrderRow(req.tenant.id, id);
    if (!row) throw new BadRequestException("订单不存在或无权操作");

    try {
      const updated = await this.orderService.cancel(row.order_id, {
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
  @RequireCapability("tenant.billing.read")
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
    const [vouchers, legs, rejectReason, refund] = await Promise.all([
      PAYABLE_STATES.has(state)
        ? this.promotionService.listAvailableVouchers(scope)
        : Promise.resolve([] as AvailableVoucher[]),
      this.loadPaymentLegs(row.invoice_id),
      this.loadLatestRejectReason(row.order_id),
      this.orderService.getRefundForOrder(row.order_id),
    ]);

    return {
      orderId: row.order_id,
      orderNo: row.order_no,
      billNo: row.bill_no,
      planCode: row.plan_code ?? "",
      planName: row.plan_name ?? "",
      productCode: row.product_code,
      productName: row.product_name,
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
      refund: refund ? mapRefundView(refund) : null,
    };
  }

  /** GET /api/subscription/orders/:orderId/refund-eligibility — 24h 退款资格（product_330 §5） */
  @RequireCapability("tenant.billing.read")
  @Get("orders/:orderId/refund-eligibility")
  async getRefundEligibility(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
  ): Promise<RefundEligibilityResult> {
    if (!req.user || !req.tenant) throw new UnauthorizedException("会话已失效");
    const row = await this.loadOrderRow(req.tenant.id, orderId?.trim());
    if (!row) throw new BadRequestException("订单不存在或无权查看");
    const e = await this.orderService.getRefundEligibility(row.order_id);
    return {
      eligible: e.eligible,
      reasons: e.reasons,
      amount: e.amount,
      currency: e.currency,
      paidAmount: e.paidAmount,
      keptAmount: e.keptAmount,
      windowEndsAt: e.windowEndsAt?.toISOString() ?? null,
      usageRatio: e.usageRatio,
      windowHours: e.policy.windowHours,
      maxUsageRatio: e.policy.maxUsageRatio,
    };
  }

  /** POST /api/subscription/orders/:orderId/refund-request — 客户申请退款 */
  @RequireCapability("tenant.billing.manage")
  @Post("orders/:orderId/refund-request")
  async requestRefund(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
    @Body() body: { reason?: string },
  ): Promise<OrderRefundView> {
    if (!req.user || !req.tenant) throw new UnauthorizedException("会话已失效");
    const row = await this.loadOrderRow(req.tenant.id, orderId?.trim());
    if (!row) throw new BadRequestException("订单不存在或无权操作");
    const reason = body?.reason?.trim().slice(0, 512) || null;
    try {
      const refund = await this.orderService.requestRefund(row.order_id, {
        userId: req.user.id,
        reason,
        clientIp: req.ip ?? null,
      });
      auditCustomerAction(this.pool, req, {
        action: "order.refund_request",
        resourceType: "order",
        resourceId: row.order_no,
        after: { refundNo: refund.refundNo, amount: refund.amount },
      });
      return mapRefundView(refund);
    } catch (err) {
      throw mapOrderError(err);
    }
  }

  /** POST /api/subscription/orders/:orderId/quote — 纯试算（零副作用） */
  @RequireCapability("tenant.billing.read")
  @Post("orders/:orderId/quote")
  async quoteOrder(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
    @Body() body: QuoteBody,
  ): Promise<QuoteResult> {
    if (!req.user || !req.tenant) throw new UnauthorizedException("会话已失效");
    const row = await this.loadOrderRow(req.tenant.id, orderId?.trim());
    if (!row) throw new BadRequestException("订单不存在或无权查看");
    if (!PAYABLE_STATES.has(deriveOrderState(row)))
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
  @RequireCapability("tenant.payment.manage")
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
    const row = await this.loadOrderRow(req.tenant.id, id);
    if (!row) throw new BadRequestException("订单不存在或无权操作");

    try {
      return await this.orderService.declarePayment({
        orderId: row.order_id,
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
    if (!UUID_RE.test(orderId)) return null;
    const res = await this.pool.query<OrderRow>(
      `${ORDER_ROW_SELECT}
        where o.tenant_id = $1 and o.id = $2
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

  /** Latest reject reason (P2 banner) from the payment_rejected order event. */
  private async loadLatestRejectReason(
    orderId: string,
  ): Promise<string | null> {
    const res = await this.pool.query<{ remark: string | null }>(
      `select remark from billing.order_events
        where order_id = $1 and event_type = 'payment_rejected'
        order by created_at desc limit 1`,
      [orderId],
    );
    return res.rows[0]?.remark ?? null;
  }

  /**
   * Duplicate pending-order guard: one open order per (workspace × product)
   * （product_330 P1-b2：billing.orders 未终态即在途）。0 元订单与付费订单同路
   * （owner 2026-08-20），本守卫对两者一视同仁。
   */
  /**
   * 查验并消耗一张邀请（`promotion.vouchers`，`kind='invite'`）。
   *
   * 返回被用掉那张的 id；没有可用的邀请返回 null（调用方据此拒单）。
   *
   * ── 为什么查验与消耗必须是**同一条 UPDATE** ──
   * 先 SELECT 再 UPDATE 会让两个并发下单读到同一张有效邀请、各自认为自己拿到了。
   * 所以用一条带 `WHERE` 全部条件的 UPDATE：**谁的 UPDATE 影响到行，谁就拿到**，
   * 判据是 rowCount 而不是先前读到的那一行。并发下另一条自然影响 0 行。
   *
   * ── 有效的定义 ──
   * 状态是 `assigned`（已定向发放、未核销未撤回未过期）、未到期（券上的
   * `expires_at` 与批次的 `valid_until` 都要看，券上的可覆盖批次但不能延长过批次）、
   * 定向到本人或本人所在租户的工作区、且 effect 指的就是这个套餐。
   *
   * ── 消耗时刻：下单时 ──
   * 走非 discount 类的既定直达路径 `assigned → redeemed`。**代价：订单取消后邀请
   * 已烧掉，需运营重发**——已知且接受（owner 2026-09-22）。不等到订阅创建，是因为
   * 那要把 invite 一路从订单穿到 services/commerce/subscription，跨包；而「解锁
   * 能买」这件事在下单那一刻就兑现了。
   */
  /**
   * 这个租户手上是否已经有一份**同一套餐**（跨版本）的订阅。
   *
   * 只给邀请闸门的续订例外用：判「已经在门里」，所以不看版本、不看状态是否
   * 刚好 active（过期待续的也算在门里，那正是要续的那一份）。
   */
  private async holdsSubscriptionOnPlan(
    tenantId: string,
    planVersionId: string,
  ): Promise<boolean> {
    const res = await this.pool.query<{ one: number }>(
      `select 1 as one
         from metering.subscriptions ts
         join product.plan_versions mine on mine.id = ts.plan_version_id
         join product.plan_versions want on want.plan_id = mine.plan_id
        where ts.tenant_id = $1 and ts.deleted_at is null
          and want.id = $2
        limit 1`,
      [tenantId, planVersionId],
    );
    return res.rows.length > 0;
  }

  private async consumeInviteForPlan(params: {
    userId: string;
    tenantId: string;
    planVersionId: string;
    planCode: string;
  }): Promise<string | null> {
    const { userId, tenantId, planVersionId, planCode } = params;

    const consumed = await this.pool.query<{ id: string; batch_id: string }>(
      `update promotion.vouchers v
          set status      = 'redeemed',
              used_count  = v.used_count + 1,
              redeemed_at = now()
         from promotion.voucher_batches b
        where b.id = v.batch_id
          and ${inviteMatchSql({
            v: "v",
            b: "b",
            user: "$1",
            tenant: "$2",
            planVersion: "$3",
            planCode: "$4",
          })}
          and v.id = (
            -- 多张都有效时取最早过期的那张，先用快到期的。
            select v2.id from promotion.vouchers v2
              join promotion.voucher_batches b2 on b2.id = v2.batch_id
             where ${inviteMatchSql({
               v: "v2",
               b: "b2",
               user: "$1",
               tenant: "$2",
               planVersion: "$3",
               planCode: "$4",
             })}
             order by v2.expires_at asc nulls last, v2.created_at asc
             limit 1
          )
       returning v.id, v.batch_id`,
      [userId, tenantId, planVersionId, planCode],
    );

    const row = consumed.rows[0];
    if (!row) return null;

    /* 台账：每次核销一行。`subscription_id` 此刻还没有（订阅要等付款后才建），
       四个效果 FK 列按 kind 填——invite 一个都不填，去向记在 effect_snapshot 里。 */
    await this.pool.query(
      `insert into promotion.voucher_redemptions
         (redemption_no, voucher_id, tenant_id, workspace_id, user_id, kind, effect_snapshot)
       select
         'RV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
         $1, $2,
         (select w.id from tenancy.workspaces w
           where w.tenant_id = $2 and w.deleted_at is null
           order by w.is_default desc, w.created_at asc limit 1),
         $3, 'invite',
         jsonb_build_object('planCode', $4::text, 'planVersionId', $5::text, 'unlockedAt', now())`,
      [row.id, tenantId, userId, planCode, planVersionId],
    );

    return row.id;
  }

  private async assertNoPendingOrderForProduct(
    workspaceId: string,
    productCode: string,
  ): Promise<void> {
    const open = await this.orderService.findOpenOrderForProduct(
      workspaceId,
      productCode,
    );
    if (open) {
      throw new ConflictException({
        code: "PENDING_ORDER_EXISTS",
        message: `已有待付款订单（${open.orderNo}），请先完成付款或取消该订单`,
      });
    }
  }

  /**
   * Pending order for (tenant × product): an open billing.orders row
   * （pending_payment / pending_verify / paid，product_330 P1-b2）。
   */
  private async queryPendingOrder(
    tenantId: string,
    productCode: string,
  ): Promise<PendingOrderSummary | null> {
    const res = await this.pool.query<OrderRow>(
      `${ORDER_ROW_SELECT}
        where o.tenant_id = $1
          and prod.product_code = $2
          and o.status in ('pending_payment', 'pending_verify', 'paid')
        order by o.created_at desc
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
      planName: r.plan_name ?? "",
      productCode: r.product_code,
      productName: r.product_name,
      tier: r.tier,
      cycleUnit: r.cycle_unit,
      amount: r.payable_amount,
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

  /**
   * 查 (plan_version, cycle) 的价格 + 套餐名；无价格行返回 null（不可自助购买）。
   *
   * **这里只查价，不判能不能买。** 原来这条 SQL 里还带着 `plan.is_public = true`，
   * 于是「可见性」这一道门同时长在两个地方——而它排在下单路径的**最前面**，
   * 在邀请解锁（createOrder 的 `consumeInviteForPlan`）之前。后果是邀请订阅整条
   * 分支在真库里永远走不到：非公开套餐在这一步就返回 0 行 → NOT_PURCHASABLE 400。
   *
   * 单测照不出来，因为桩对第一次查询无条件回一行价格，不模拟这个上游过滤。
   * 判据与执行点分家，是同一件事拆成两道门的必然代价——所以把判据收回闸门那一处。
   */
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
          and plan.status = 'active'
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

  @RequireCapability("tenant.billing.manage")
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

    const VALID: SubscriptionAction[] = ["upgrade", "cancel"];
    if (!VALID.includes(action)) {
      /* pause / resume 单独给一句人话：它们不是拼错，是**不再对客户开放**。 */
      if (action === ("pause" as string) || action === ("resume" as string)) {
        throw new BadRequestException("暂停与恢复是平台操作，请联系客服处理");
      }
      throw new BadRequestException(`无效操作类型：${String(action)}`);
    }

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
    // actor_id 是 uuid 列(边界#2 裸值解引用 account.users)——此前误传 email,
    // 首个真实操作即 invalid uuid 500(2026-08-21 修);邮件仍用 email。
    const changedBy = req.user.id;
    let updated!: SubscriptionRecord;
    try {
      if (action === "upgrade") {
        // product_320 §4.4: 付费升级一律走下单流程（POST /orders, intent=upgrade）。
        // 真实定价落库后，此处直接换版会绕过计费 = 免费升级洞，堵死。
        throw new BadRequestException(
          "升级请通过下单流程完成：POST /api/subscription/orders (intent=upgrade)",
        );
        /*
         * 这里原来还有 pause / resume 两支（2026-09-25 删）。
         *
         * 删 resume 比删 pause 更要紧：它把 status 直接写回 `active`，**对「是谁暂停的」
         * 一个字都不判**。于是平台因违规暂停之后，客户自己调一次 resume 就把服务拿回去
         * 了——而这条端点带的权限是 `tenant.billing.manage`，任何租户管理员都能调。
         *
         * 暂停与恢复现在只由运营做（admin 的 subscriptions.router），原因必填。
         */
      } else {
        /*
         * 自助退订 = 立即终止（服务即停）。
         *
         * 「不退款」那半句 2026-09-25 作废：owner 定「站在客户视角，退订就是退款」。
         * 终止之后由 `settleAfterCancel` 统一处理钱与消息——24 小时内全额退（替客户
         * 发起，不让他再去找入口），超窗口或 0 元则如实告知。它**永不抛**：退订已经
         * 生效了，钱与消息是后续，抛出去会让一次成功的退订看起来失败。
         *
         * actorType=customer 让历史/审计如实记发起方。
         */
        updated = await this.subscriptionService.cancelSubscription(
          subscriptionId,
          changedBy,
          reason,
          "customer",
        );
        await this.orderService.settleAfterCancel({
          subscriptionId,
          tenantId: req.tenant.id,
          actorUserId: changedBy,
          clientIp: req.ip ?? null,
        });
      }
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : "订阅操作失败",
      );
    }

    auditCustomerAction(this.pool, req, {
      action: `subscription.${action}`,
      resourceType: "subscription",
      resourceId: subscriptionId,
      after: { status: updated.status },
    });

    // ── 发送确认邮件（失败不阻断主流程）─────────────────────────────────
    void this.mailService
      .send(buildActionEmail(req.user.email, action, updated))
      .catch(() => {});

    return updated;
  }

  // --------------------------------------------------------------------------
  // POST /api/subscription/subscriptions/:id/auto-renew — 到期不续 / 恢复续费
  // (owner 2026-08-21 P0 订阅自助收尾;「到期不续」= auto_renew=false 派生态,
  //  product_220 §3 cancel_at_period_end 口径,无独立列)
  // --------------------------------------------------------------------------

  @RequireCapability("tenant.billing.manage")
  @Post("subscriptions/:id/auto-renew")
  async setAutoRenew(
    @Req() req: Request & RequestContext,
    @Param("id") subscriptionId: string,
    @Body() body: { enabled?: unknown },
  ): Promise<{ subscriptionId: string; autoRenew: boolean }> {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (typeof body.enabled !== "boolean") {
      throw new BadRequestException("enabled 必须为布尔值");
    }

    const current = await this.subscriptionService
      .getSubscription(subscriptionId)
      .catch(() => null);
    if (!current || current.tenantId !== req.tenant.id) {
      throw new BadRequestException("订阅不存在或无权操作");
    }

    const updated = await this.subscriptionService.setAutoRenew(
      subscriptionId,
      body.enabled,
      { actorId: req.user.id, actorType: "customer" },
    );
    auditCustomerAction(this.pool, req, {
      action: body.enabled
        ? "subscription.auto_renew_on"
        : "subscription.auto_renew_off",
      resourceType: "subscription",
      resourceId: subscriptionId,
      after: { autoRenew: updated.autoRenew },
    });
    return { subscriptionId, autoRenew: updated.autoRenew };
  }
}

// ============================================================================
// 内部：构建操作确认邮件
// ============================================================================

/* 值域收窄后这里也跟着少两条——编译期逃不掉（Record 穷尽）。 */
const ACTION_LABELS: Record<SubscriptionAction, string> = {
  upgrade: "套餐升级",
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** billing.orders 投影（product_330 P1-b2）：订单是主体，订阅只在履约后经 subscription_id 挂上。 */
interface OrderRow {
  order_id: string;
  order_no: string;
  workspace_id: string;
  /** 履约后挂上的订阅；未履约 null */
  subscription_id: string | null;
  /** 该订阅**当前**状态；未履约（无订阅）时 null。服务在不在看它，不看 order_status。 */
  subscription_status: string | null;
  /** billing.orders.status（订单实体状态机） */
  order_status: string;
  /** 每单付款时效（分钟，P4 修订）；NULL=存量单 → 回退 env */
  payment_ttl_minutes: number | null;
  invoice_id: string | null;
  bill_no: string | null;
  plan_code: string | null;
  plan_name: string | null;
  tier: string | null;
  cycle_unit: string;
  /** 订单应付（NUMERIC(12,2) 字符串） */
  payable_amount: string;
  currency: string | null;
  bill_status: string | null;
  total_amount: string | null;
  paid_amount: string | null;
  discount_amount: string | null;
  voucher_paid: string | null;
  ttl_anchor: Date;
  /** 有退款单在审或在执行（`audit_status='pending'`，或已通过但还没落 success/failed）。 */
  refund_in_flight: boolean;
  /** 已退成功金额合计（NUMERIC 字符串）；没退过是 "0"。 */
  refunded_amount: string | null;
  paid_at: Date | null;
  created_at: Date;
  /** 履约订阅的周期（new 新建 / upgrade、renew 原订阅）；未履约 null */
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

// One projection for the list, the payment-page detail and the subscribe-context
// pending panel — state comes from billing.orders.status alone, so the faces can
// never derive different states for one order.
const ORDER_ROW_SELECT = `
select
  o.id                 as order_id,
  o.order_no,
  o.workspace_id,
  o.subscription_id,
  o.status             as order_status,
  o.payment_ttl_minutes,
  inv.id               as invoice_id,
  inv.bill_no,
  plan.plan_code,
  plan.plan_name,
  pc.tier,
  o.cycle_unit,
  o.payable_amount,
  o.currency,
  inv.bill_status,
  inv.total_amount,
  inv.paid_amount,
  inv.discount_amount,
  coalesce((
    select sum(p.paid_amount) from billing.payments p
     where p.bill_id = inv.id and p.pay_status = 'paid' and p.pay_source = 'voucher'
  ), 0)                as voucher_paid,
  greatest(
    o.created_at,
    coalesce((
      select max(e.created_at) from billing.order_events e
       where e.order_id = o.id and e.event_type = 'payment_rejected'
    ), o.created_at)
  )                    as ttl_anchor,
  /*
   * 退款两问，都挂订单（refunds.order_id，product_330 §5）。
   *
   * 在途 = 还没落定：待审，或审过了但执行还没出结果。被驳回（rejected）与执行失败
   * （failed）都不算在途——它们不阻塞下一次申请（getRefundEligibility 同口径），也不
   * 该让订单一直显示「退款中」。
   *
   * 本段在模板串里，不要写反引号：它会当场结束这个字符串，报错落在几十行以外。
   */
  exists (
    select 1 from billing.refunds r
     where r.order_id = o.id
       and r.audit_status <> 'rejected'
       and r.refund_status not in ('success', 'failed')
  )                    as refund_in_flight,
  coalesce((
    select sum(r.refund_amount) from billing.refunds r
     where r.order_id = o.id and r.refund_status = 'success'
  ), 0)                as refunded_amount,
  inv.paid_at,
  o.created_at,
  sub.start_at,
  sub.end_at,
  /*
   * 订阅当前状态（2026-09-24）。此前这条 join 只取了 start_at / end_at，**没取 status**,
   * 于是订单列表那一列「服务状态」只能由订单自己的状态派生——订单走到 fulfilled 就永远
   * 显示「服务中」，订阅被退订/暂停/过期都不会变。实撞：owner 退订 vxtpl 之后，两张单
   * （含一张已收款的付费单）仍写着「服务中」，而服务已经没有了。
   *
   * 「服务还在不在」的答案在订阅行上，不在订单上。订单只回答「这张单走到哪一步」。
   */
  sub.status           as subscription_status,
  tn.name              as tenant_name,
  tn.owner_user_id,
  ws.name              as workspace_name,
  ws.workspace_no::text as workspace_no,
  prod.product_code,
  prod.product_name,
  o.created_by_type,
  o.created_by_id,
  coalesce(up.display_name, u.account) as subscriber_name,
  coalesce(o.declared_at, (
    select max(p.created_at) from billing.payments p
     where p.bill_id = inv.id and p.pay_source <> 'voucher'
  ))                   as declared_at
from billing.orders o
left join metering.subscriptions sub on sub.id = o.subscription_id
left join product.plan_versions pv on pv.id = o.plan_version_id
left join product.plans plan on plan.id = pv.plan_id
left join lateral (
  select tier from product.plan_components
   where plan_version_id = o.plan_version_id and component_role = 'primary' limit 1
) pc on true
left join product.products prod on prod.id = o.product_id
left join tenancy.tenants tn on tn.id = o.tenant_id
left join tenancy.workspaces ws on ws.id = o.workspace_id
left join account.user_profiles up
  on o.created_by_type = 'customer' and up.user_id = o.created_by_id
left join account.users u
  on o.created_by_type = 'customer' and u.id = o.created_by_id
left join lateral (
  select id, bill_no, bill_status, total_amount, paid_amount, discount_amount, paid_at
    from billing.invoices i
   where i.order_id = o.id and i.deleted_at is null
   order by i.created_at desc limit 1
) inv on true`;

const MY_ORDERS_SQL = `${ORDER_ROW_SELECT}
where o.tenant_id = $1
order by o.created_at desc
limit 100
`;

/**
 * 订单实体状态 → 订单轴十态（wire contract）。
 *
 * 三个派生分支不是订单实体状态能回答的，各有自己的权威源：
 *   · 部分到账 —— 账单知道「收了多少、还差多少」，订单只知道「够不够」。够了才翻 `paid`，
 *     不够则订单实体停在原态，钱记在 `invoices.bill_status='partial'` 上。所以这一档必须
 *     问账单，**但只在「待付款」上派生**：那时客户能把剩下的补上（`markDeclaredTx` 收
 *     `pending_payment`）。待核对 + partial 不改写，理由见那一支的注释。
 *   · 退款中 —— 退款单在审或在执行，服务通常已经停了，但钱还在路上。订单实体此刻仍是
 *     `fulfilled`，只有 `refunds` 知道。
 *   · 部分退款 —— 同上，且退款成功但金额小于实付。
 *
 * 分支顺序有讲究：`fulfilled` 那一支里「在途」要压在「已部分退」前面，否则一张先退过一
 * 半、又在申请第二笔的单会显示成部分退款，把正在走的流程藏掉。
 */
function deriveOrderState(r: OrderRow): OrderState {
  switch (r.order_status) {
    case "pending_verify":
      // 账单 partial 在这一支**不**改写状态。确认收款不足额之后订单停在 pending_verify，
      // 而 markDeclaredTx 只接 pending_payment ⇒ 客户没法再申报一次。显示成「部分到账」
      // 会连带把付款区打开（它在 PAYABLE_STATES 里），给客户一个按下去必定 409 的按钮。
      // 这张单等的是运营再确认剩余款，所以照实说「已申报 · 待核对」。
      return "paid_pending_verify";
    case "paid":
      return "activating";
    case "fulfilled":
      if (r.refund_in_flight) return "refunding";
      if (isPartiallyRefunded(r)) return "partially_refunded";
      return "completed";
    case "refunded":
      return "refunded";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "pending_payment":
    default:
      return r.bill_status === "partial" ? "partially_paid" : "pending_payment";
  }
}

/**
 * 部分退款 = 退成功过，且退回去的比收进来的少。
 *
 * 判据是**金额**不是 `refund_type`：类型是申请时写下的意图，金额是事实。反过来用类型推
 * 金额，遇到一张 `normal` 却只退了一半的单就会说成全额退。
 */
function isPartiallyRefunded(r: OrderRow): boolean {
  const refunded = Number(r.refunded_amount ?? 0);
  if (!(refunded > 0)) return false;
  const collected = Number(r.paid_amount ?? 0);
  return collected > 0 && refunded < collected;
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
  if (r.total_amount == null) return r.payable_amount;
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
      // fixed 的 effect.value 是整数分;对外一律用元(与 promotion.router 的卡券页
      // 同口径——此前这里给分、卡券页给元,付款页只好自己 /100,两处随时会打架)。
      discountValue:
        e.discountType === "fixed" ? Number(centsToYuan(e.value)) : e.value,
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
    // 订单金额 = 订单实体应付（product_330）；不看订阅行 pay_amount（履约后会被改写）。
    amount: r.payable_amount,
    currency: r.currency ?? "CNY",
    orderStatus: state,
    /* 服务在不在：读订阅，不读订单（见 ORDER_ROW_SELECT 里那段注释）。 */
    subscriptionStatus: r.subscription_status,
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
    // 周期 = 履约订阅的周期（new 新建 / upgrade、renew 原订阅），未履约为空
    startAt: r.start_at?.toISOString() ?? null,
    endAt: r.end_at?.toISOString() ?? null,
    declaredAt: r.declared_at?.toISOString() ?? null,
    subscriptionId: r.subscription_id,
    // 服务开通时刻 = 订阅周期起算锚点（owner 口径：自服务开通,非确认收款）。
    // 认整个已履约族：退款中/已退款的单也开通过，开通时间不会因为退款而消失。
    activatedAt:
      FULFILLED_STATES.has(state) && r.start_at
        ? r.start_at.toISOString()
        : null,
  };
}
