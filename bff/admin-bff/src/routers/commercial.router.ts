/**
 * commercial.router.ts - Commercial reporting and guarded voucher operations.
 * @package @vxture/bff-admin
 * @layer Application
 * @category router
 * @description
 * Read projections use the reporting pool. Voucher commands delegate their
 * transactions, durable receipts and audit trail to the promotion domain.
 * @author AI-Generated
 * @date 2026-11-19
 */

import {
  BadRequestException,
  HttpException,
  Body,
  Controller,
  Get,
  Inject,
  Optional,
  Post,
  Param,
  Query,
  Req,
  Header,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
// ⚠️ 跨层引用: Delegate voucher lifecycle and transaction ownership to the domain.
import {
  PgVoucherManagement,
  VoucherClaimCredentials,
  type CreateBatchCommand,
  type AssignVoucherCommand,
  type BatchAction,
  type OperatorCommand,
} from "@vxture/service-promotion";
// ⚠️ 跨层引用: Read validated key material from infrastructure configuration.
import { VxConfigService } from "@vxture/core-config";
import {
  readVoucherBatch,
  readVoucherInstances,
  readVoucherEvents,
} from "./voucher-management.read";
// ⚠️ 跨层引用: Billing verifies card sales sources within promotion transactions.
import { PgRechargeCardFunding } from "@vxture/service-billing";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { assertAnyCapability } from "../auth/capability";
import { RequireVoucherStepUp } from "../auth/step-up.decorator";
import { voucherStepUpRequired } from "../auth/voucher-step-up";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import type {
  BillingBillStatus,
  CommerceOverviewMetric,
  CommerceOverviewPlanRevenue,
  CommerceOverviewRiskItem,
  CommerceOverviewSnapshot,
  PromotionOperationRecord,
  PromotionOperationStatus,
  PromotionOperationType,
  PromotionRedemptionRecord,
  RequestContext,
  TenantOperationType,
  UsageMeteringRecord,
  UsageMeteringRisk,
} from "../types/console.types";
import { industryLabel } from "@vxture/core-utils";

// ── 发券写端点契约（product_321 §4.2，TD-028 部分销号）─────────────────────────

@Controller("api/commercial")
export class CommercialRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
    @Optional()
    @Inject(VxConfigService)
    private readonly config?: VxConfigService,
  ) {}

  // ===========================================================================
  // Operator voucher commands share the existing capability and step-up gates.
  // ===========================================================================
  @Post("voucher-batches")
  @RequireVoucherStepUp()
  async createVoucherBatch(
    @Req() req: Request & RequestContext,
    @Body() body: CreateBatchCommand,
  ) {
    return this.executeVoucher(req, (manager, actor) =>
      manager.createBatch(actor, body),
    );
  }

  @Post("voucher-batches/:id/actions")
  @RequireVoucherStepUp()
  async actOnVoucherBatch(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: BatchAction,
  ) {
    return this.executeVoucher(req, (manager, actor) =>
      manager.actOnBatch(actor, id, body),
    );
  }

  @Post("vouchers/assign")
  @RequireVoucherStepUp()
  async assignVouchers(
    @Req() req: Request & RequestContext,
    @Body() body: AssignVoucherCommand,
  ) {
    return this.executeVoucher(req, (manager, actor) =>
      manager.assign(actor, body),
    );
  }

  @Post("voucher-batches/:id/issue")
  @RequireVoucherStepUp()
  @Header("Cache-Control", "no-store")
  async issueVoucherCredentials(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body()
    body: OperatorCommand & { count: number; fundingPaymentId?: string },
  ) {
    return this.executeVoucher(req, (manager, actor) =>
      manager.issueClaimCredentials(
        actor,
        id,
        body,
        new VoucherClaimCredentials(this.config?.auth),
      ),
    );
  }

  @Post("vouchers/:id/revoke")
  @RequireVoucherStepUp()
  async revokeVoucher(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: OperatorCommand,
  ) {
    return this.executeVoucher(req, (manager, actor) =>
      manager.revoke(actor, id, body),
    );
  }

  /** Keep consumed credentials on the domain's receipt-only transaction path. */
  private async executeVoucher<T>(
    req: Request & RequestContext,
    work: (manager: PgVoucherManagement, actor: string) => Promise<T>,
  ): Promise<T> {
    assertCanManagePromotion(req);
    const manager = new PgVoucherManagement(
      this.rwPool,
      new PgRechargeCardFunding(this.rwPool),
      {
        replayOnly: req.voucherReplayOnly === true,
      },
    );
    try {
      return await work(manager, requireOperator(req));
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse();
        if (
          typeof body === "object" &&
          "code" in body &&
          body.code === "VOUCHER_STEP_UP_RECEIPT_MISSING"
        )
          throw voucherStepUpRequired(req);
      }
      throw error;
    }
  }

  @Get("voucher-batches/:id/funding-sources")
  @Header("Cache-Control", "no-store")
  async cardFundingSources(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ) {
    assertCanManagePromotion(req);
    const batch = await readVoucherBatch(this.pool, id);
    if (batch.kind !== "recharge_card" || !batch.tenantId) return [];
    return new PgRechargeCardFunding(this.pool).sources(batch.tenantId);
  }

  @Get("voucher-batches/:id")
  async voucherBatchDetail(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ) {
    assertCanReadPromotion(req);
    return readVoucherBatch(this.pool, id);
  }

  @Get("voucher-batches/:id/vouchers")
  async voucherBatchInstances(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Query("page") page?: string,
  ) {
    assertCanReadPromotion(req);
    return readVoucherInstances(this.pool, id, page);
  }

  @Get("voucher-batches/:id/events")
  async voucherBatchEvents(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Query("page") page?: string,
  ) {
    assertCanReadPromotion(req);
    return readVoucherEvents(this.pool, id, page);
  }

  @Get("voucher-operations/:key")
  async voucherOperationReceipt(
    @Req() req: Request & RequestContext,
    @Param("key") key: string,
    @Query("type") type: string,
    @Res() response?: Response,
  ) {
    assertCanManagePromotion(req);
    if (
      !key?.trim() ||
      key.length > 128 ||
      ![
        "batch_create",
        "batch_configure",
        "batch_review",
        "batch_pause",
        "batch_resume",
        "batch_archive",
        "batch_request_budget",
        "batch_approve_budget",
        "voucher_assign",
        "voucher_issue",
        "voucher_revoke",
      ].includes(type)
    )
      throw new BadRequestException("回执查询参数非法");
    const row = (
      await this.pool.query(
        'select id,batch_id as "batchId",operation_type as "operationType",result,created_at as "createdAt" from promotion.voucher_operations where actor_realm=\'operator\' and actor_id=$1 and operation_type=$2 and idempotency_key=$3',
        [requireOperator(req), type, key.trim()],
      )
    ).rows[0];
    // Explicit JSON preserves an absent receipt for strict JSON clients.
    if (response) response.json(row ?? null);
    return row ?? null;
  }

  @Get("usage-metering")
  async listUsageMetering(
    @Req() req: Request & RequestContext,
  ): Promise<UsageMeteringRecord[]> {
    assertCanManageCommercial(req);
    const { rows } =
      await this.pool.query<UsageMeteringRow>(USAGE_METERING_SQL);
    return rows.map(mapUsageMeteringRow);
  }

  @Get("promotions")
  async listPromotions(
    @Req() req: Request & RequestContext,
  ): Promise<PromotionOperationRecord[]> {
    assertCanManageCommercial(req);
    const { rows } = await this.pool.query<PromotionBatchRow>(PROMOTIONS_SQL);
    return rows.map(mapPromotionBatchRow);
  }

  @Get("promotions/page")
  async listPromotionsPage(
    @Req() req: Request & RequestContext,
    @Query("page") page = "1",
    @Query("pageSize") size = "20",
    @Query("status") status = "all",
    @Query("type") type = "all",
    @Query("q") q = "",
  ) {
    assertCanReadPromotion(req);
    const current = Number(page),
      pageSize = Number(size);
    if (
      !Number.isSafeInteger(current) ||
      current < 1 ||
      current > 1_000_000 ||
      ![10, 20, 50, 100].includes(pageSize) ||
      q.length > 200 ||
      ![
        "all",
        "draft",
        "active",
        "scheduled",
        "paused",
        "expired",
        "archived",
      ].includes(status) ||
      !["all", "discount", "coupon", "campaign"].includes(type)
    )
      throw new BadRequestException("分页或筛选参数非法");
    const source = `with batches as (${PROMOTIONS_BASE_SQL}), listing as (select *,
      case when status in ('draft','paused','archived') then status when valid_until<=now() then 'expired' when valid_from>now() then 'scheduled' else 'active' end display_status,
      case when kind='discount' then 'discount' when kind in ('credit_voucher','recharge_card') then 'coupon' else 'campaign' end promotion_type from batches),
      filtered as (select * from listing where ($1='all' or display_status=$1) and ($2='all' or promotion_type=$2)
        and ($3='' or strpos(lower(concat_ws(' ',name,code_prefix,id::text,kind,effect::text,owner_name)),lower($3))>0))`;
    const values = [status, type, q.trim()];
    const [counts, items] = await Promise.all([
      this.pool.query(
        `${source} select count(*)::int total,count(*) filter(where display_status='active')::int active,
        coalesce(sum(redemption_count),0)::int redemptions,coalesce(sum(tenant_count),0)::int tenants,
        count(*) filter(where promotion_type='coupon')::int coupons from filtered`,
        values,
      ),
      this.pool.query<PromotionBatchRow>(
        `${source} select * from filtered order by created_at desc,id desc limit $4 offset $5`,
        [...values, pageSize, (current - 1) * pageSize],
      ),
    ]);
    return {
      items: items.rows.map(mapPromotionBatchRow),
      total: counts.rows[0].total as number,
      page: current,
      pageSize,
      summary: counts.rows[0] as {
        total: number;
        active: number;
        redemptions: number;
        tenants: number;
        coupons: number;
      },
    };
  }

  @Get("promotion-redemptions")
  async listPromotionRedemptions(
    @Req() req: Request & RequestContext,
  ): Promise<PromotionRedemptionRecord[]> {
    assertCanManageCommercial(req);
    const { rows } = await this.pool.query<PromotionRedemptionRow>(
      PROMOTION_REDEMPTIONS_SQL,
    );
    return rows.map(mapPromotionRedemptionRow);
  }

  @Get("overview")
  async getOverview(
    @Req() req: Request & RequestContext,
  ): Promise<CommerceOverviewSnapshot> {
    assertCanManageCommercial(req);
    const [kpiResult, planResult] = await Promise.all([
      this.pool.query<OverviewKpiRow>(OVERVIEW_KPI_SQL),
      this.pool.query<OverviewPlanRow>(OVERVIEW_PLAN_SQL),
    ]);
    return buildOverviewSnapshot(kpiResult.rows[0] ?? null, planResult.rows);
  }
}

// TD-027 边界判断（待 owner 定）：商业总览跨 metering/promotion/billing 三域，而
// promotion/usage 域尚无 perm 码（独立缺口）。本次将只读仪表盘归到财务读的最贴近码
// commerce:billing.read（super_admin/admin/finance/auditor 可见），以便退役
// platform.pricing.manage 桥；operation 若无 billing.read 则看不到本仪表盘。
function assertCanManageCommercial(req: Request & RequestContext): void {
  assertAnyCapability(req, [
    "commerce:billing.read",
    "commerce:billing.manage",
  ]);
}

// 发券/发放 = 危 promotion:campaign.manage（product_321 §3 新码，TD-028 部分销号）。
function assertCanReadPromotion(req: Request & RequestContext): void {
  assertAnyCapability(req, [
    "promotion:campaign.read",
    "promotion:campaign.manage",
    "commerce:billing.read",
    "commerce:billing.manage",
  ]);
}

function assertCanManagePromotion(req: Request & RequestContext): void {
  assertAnyCapability(req, ["promotion:campaign.manage"]);
}

// 版本位/变体位刻意不卡：判据与理由见 governance.shared.ts 的 `UUID_RE` 注释
//（校验器不该比存储层更严；种子 id 的变体位是段值本身，如 …-4000-d000-…）。
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireOperator(req: Request & RequestContext): string {
  const id = req.user?.id;
  if (!id || !UUID_RE.test(id)) {
    throw new UnauthorizedException("Invalid platform admin principal");
  }
  return id;
}

// ── 公共工具 ────────────────────────────────────────────────────────────────

function toIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toIsoNullable(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toNumber(value: string | number | null): number {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTenantType(value: string | null): TenantOperationType {
  return value === "personal" ? "individual" : "company";
}

// ── 端点 1：用量计量 ──────────────────────────────────────────────────────────
// usage_summary_months（月降采样，纯统计）→ 经 workspaces 反查 tenant；
// quota_pools（余量 SoT）lateral 聚合同 workspace/product/metric 活跃池的 limit/used；
// 订阅/套餐名经首个命中池的 subscription_id → subscriptions → plan_versions → plans。

function deriveUsageRisk(usageRate: number): UsageMeteringRisk {
  if (usageRate >= 1) return "danger";
  if (usageRate >= 0.8) return "warning";
  return "normal";
}

function mapUsageMeteringRow(row: UsageMeteringRow): UsageMeteringRecord {
  const usedValue = toNumber(row.used_value);
  const quotaValue = toNumber(row.quota_limit);
  const usageRate =
    quotaValue > 0 ? Math.round((usedValue / quotaValue) * 10000) / 10000 : 0;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code,
    tenantName: row.tenant_name,
    tenantType: normalizeTenantType(row.tenant_type),
    region: "未设置",
    // 所属行业:console 存的是 core-utils 清单码,这里翻成中文标签;历史自由文本原样显示
    industry: row.industry ? industryLabel(row.industry) : "未设置",
    subscriptionId: row.subscription_id,
    orderNo: row.order_no,
    servicePlanName: row.plan_name,
    productCode: row.product_code,
    productName: row.product_name,
    productType: row.product_type,
    metricCode: row.metric_key,
    metricName: row.metric_key,
    metricUnit: row.metric_unit ?? "",
    cycleMonth: row.period_month,
    usedValue,
    quotaValue,
    usageRate,
    // C15: tierName + requestCount/inputTokens/outputTokens dropped — no source at
    // this grain (usage_summary_months has total_amount only; no tier/token cols).
    risk: deriveUsageRisk(usageRate),
    lastSyncedAt: toIso(row.updated_at),
    updatedAt: toIso(row.updated_at),
  };
}

const USAGE_METERING_SQL = `
select
  m.id,
  t.id                             as tenant_id,
  t.tenant_no::text                as tenant_code,
  t.name                           as tenant_name,
  t.type                           as tenant_type,
  profile.industry,
  p.product_code,
  p.product_name,
  p.product_type,
  m.metric_key,
  pm.metric_unit,
  m.period_month,
  m.total_amount                   as used_value,
  q.quota_limit,
  q.quota_used,
  q.subscription_id,
  cur.order_no,
  pl.plan_name,
  m.updated_at
from metering.usage_summary_months m
join tenancy.workspaces w on w.id = m.workspace_id
join tenancy.tenants t on t.id = w.tenant_id
left join tenancy.tenant_profiles profile on profile.tenant_id = t.id
join product.products p on p.id = m.product_id
left join product.product_metrics pm
  on pm.product_id = m.product_id and pm.metric_key = m.metric_key
left join lateral (
  select
    sum(qp.quota_limit) as quota_limit,
    sum(qp.quota_used)  as quota_used,
    (array_agg(qp.subscription_id order by qp.priority)
       filter (where qp.subscription_id is not null))[1] as subscription_id
  from metering.quota_pools qp
  where qp.workspace_id = m.workspace_id
    and qp.product_id = m.product_id
    and qp.metric_key = m.metric_key
    and qp.status = 'active'
) q on true
left join metering.subscriptions sub on sub.id = q.subscription_id
-- 订阅可读码 = 最近一次履约它的订单号（product_330；旧列 sub.order_no 停写待删）
left join billing.orders cur on cur.id = sub.current_order_id
left join product.plan_versions pv on pv.id = sub.plan_version_id
left join product.plans pl on pl.id = pv.plan_id
where t.deleted_at is null
order by m.period_month desc, m.updated_at desc
limit 500
`;

interface UsageMeteringRow {
  id: string;
  tenant_id: string;
  tenant_code: string;
  tenant_name: string;
  tenant_type: string | null;
  industry: string | null;
  product_code: string;
  product_name: string;
  product_type: string;
  metric_key: string;
  metric_unit: string | null;
  period_month: string;
  used_value: string | number | null;
  quota_limit: string | number | null;
  quota_used: string | number | null;
  subscription_id: string | null;
  order_no: string | null;
  plan_name: string | null;
  updated_at: Date | string | null;
}

// ── 端点 2：营销批次 ──────────────────────────────────────────────────────────
// voucher_batches（批次模板）聚合 vouchers → redemptions；kind 归一到前端三型；
// 状态机 active/paused/archived + 有效期窗口 → scheduled/active/expired/paused。

const PROMOTION_TYPE_BY_KIND: Record<string, PromotionOperationType> = {
  discount: "discount",
  credit_voucher: "coupon",
  recharge_card: "coupon",
  redemption: "campaign",
  extension: "campaign",
  /* 邀请券不减价也不抵扣——它归活动类。显式写出来而不是吃兜底：兜底值
     看不出是想好的还是漏了。 */
  invite: "campaign",
};

const KIND_LABEL: Record<string, string> = {
  credit_voucher: "代金券",
  recharge_card: "充值卡",
  redemption: "兑换码",
  discount: "折扣券",
  extension: "展期券",
  invite: "邀请券",
};

function derivePromotionType(kind: string): PromotionOperationType {
  return PROMOTION_TYPE_BY_KIND[kind] ?? "campaign";
}

function derivePromotionStatus(
  status: string,
  validFrom: Date | string | null,
  validUntil: Date | string | null,
): PromotionOperationStatus {
  if (status === "draft") return "draft";
  if (status === "archived") return "archived";
  if (status === "paused") return "paused";
  const now = Date.now();
  if (validFrom && new Date(validFrom).getTime() > now) return "scheduled";
  if (validUntil && new Date(validUntil).getTime() <= now) return "expired";
  return "active";
}

// 面额/折扣解读（TD-030 销号）：按 kind 从 effect JSONB 解出人话标签。
function faceLabel(kind: string, effect: unknown): string {
  const e =
    effect && typeof effect === "object"
      ? (effect as Record<string, unknown>)
      : {};
  if (kind === "discount") {
    const type = e["discount_type"];
    const value = Number(e["value"]);
    const maxOff = Number(e["max_off_cents"]);
    const base =
      type === "percent"
        ? `立减 ${Number.isFinite(value) ? value : "?"}%`
        : `立减 ¥${Number.isFinite(value) ? (value / 100).toFixed(2) : "?"}`;
    return Number.isFinite(maxOff) && maxOff > 0
      ? `${base}（封顶 ¥${(maxOff / 100).toFixed(2)}）`
      : base;
  }
  if (kind === "recharge_card")
    return (
      "本金 ¥" +
      (Number(e.face_value_cents ?? 0) / 100).toFixed(2) +
      " + 赠额 ¥" +
      (Number(e.bonus_cents ?? 0) / 100).toFixed(2)
    );
  if (kind === "credit_voucher") {
    const amount = Number(e["amount_cents"] ?? e["face_value_cents"]);
    return Number.isFinite(amount) && amount > 0
      ? `¥${(amount / 100).toFixed(2)}`
      : "未配置";
  }
  if (kind === "extension" || kind === "redemption") {
    const days = e[kind === "extension" ? "extend_days" : "duration_days"];
    return typeof days === "number" && Number.isSafeInteger(days) && days > 0
      ? `${kind === "extension" ? "展期" : "兑换"} ${days} 天`
      : "未配置";
  }
  if (kind === "invite") {
    /* 邀请券没有面额，它的「面额」就是解锁哪个套餐——那是这一行唯一要紧的事实，
       退回「—」等于把它藏了。套餐码是可读码（arda-starter 这种），不是 uuid。 */
    const plan =
      e["plan_code"] ??
      e["plan_version_id"] ??
      e["planCode"] ??
      e["planVersionId"];
    return typeof plan === "string" && plan ? `解锁 ${plan}` : "未配置";
  }
  return "—";
}

function mapPromotionBatchRow(
  row: PromotionBatchRow,
): PromotionOperationRecord {
  const kindLabel = KIND_LABEL[row.kind] ?? row.kind;
  const totalCount = toNumber(row.total_count);
  const issuedCount = toNumber(row.issued_count);
  const face = faceLabel(row.kind, row.effect);
  return {
    id: row.id,
    promotionCode: row.code_prefix ?? row.id,
    promotionName: row.name,
    promotionType: derivePromotionType(row.kind),
    /* 原始券型。`promotionType` 把 invite / redemption / extension 一起归成
       campaign，分辨不出——而发放弹窗必须知道这是不是邀请券（邀请不许发给
       「租户全员」，那样两个 assigned_* 列都为 NULL，发出来就是死券）。 */
    kind: row.kind,
    batchStatus: row.status as NonNullable<
      PromotionOperationRecord["batchStatus"]
    >,
    tenantId: row.tenant_id,
    totalCount,
    issuedCount,
    requiresCashFunding:
      row.kind === "recharge_card" &&
      row.effect !== null &&
      typeof row.effect === "object" &&
      Number((row.effect as Record<string, unknown>).face_value_cents) > 0,
    status: derivePromotionStatus(row.status, row.valid_from, row.valid_until),
    scopeLabel: row.tenant_id ? "定向租户" : "平台级",
    // TD-030: 面额随台账展示（此前只有 kind 标签）。
    discountLabel: `${kindLabel} · ${face}`,
    redemptionCount: toNumber(row.redemption_count),
    tenantCount: toNumber(row.tenant_count),
    startsAt: toIso(row.valid_from),
    endsAt: toIsoNullable(row.valid_until),
    ownerName: row.owner_name ?? "系统",
    description: `${kindLabel} ${face} · 已发 ${issuedCount}/${totalCount}`,
    updatedAt: toIso(row.updated_at),
  };
}

const PROMOTIONS_BASE_SQL = `
select
  b.id,
  b.tenant_id,
  b.kind,
  b.name,
  b.code_prefix,
  b.effect,
  b.total_count,
  b.issued_count,
  b.valid_from,
  b.valid_until,
  b.status,
  b.updated_at,
  b.created_at,
  o.display_name as owner_name,
  coalesce(r.redemption_count, 0) as redemption_count,
  coalesce(r.tenant_count, 0)     as tenant_count
from promotion.voucher_batches b
left join admin.operator_account o on o.id = b.created_by
left join lateral (
  select
    count(vr.id)                  as redemption_count,
    count(distinct vr.tenant_id)  as tenant_count
  from promotion.voucher_redemptions vr
  join promotion.vouchers v on v.id = vr.voucher_id
  where v.batch_id = b.id
) r on true
`;
const PROMOTIONS_SQL = `${PROMOTIONS_BASE_SQL} order by b.created_at desc,b.id desc limit 500`;

interface PromotionBatchRow {
  id: string;
  tenant_id: string | null;
  kind: string;
  name: string;
  code_prefix: string | null;
  effect: unknown;
  total_count: string | number | null;
  issued_count: string | number | null;
  valid_from: Date | string | null;
  valid_until: Date | string | null;
  status: string;
  updated_at: Date | string | null;
  owner_name: string | null;
  redemption_count: string | number | null;
  tenant_count: string | number | null;
}

// ── 端点 3：核销明细 ──────────────────────────────────────────────────────────
// voucher_redemptions join vouchers/batches；账单经 invoice_item_id → invoice_items → invoices；
// 订阅/套餐名经 subscription_id → subscriptions → plan_versions → plans。核销恒终态 redeemed。

const BILL_STATUSES: ReadonlySet<BillingBillStatus> = new Set([
  "unpaid",
  "paying",
  "paid",
  "partial",
  "cancelled",
  "overdue",
]);
function normalizeBillStatus(value: string | null): BillingBillStatus | null {
  if (value && BILL_STATUSES.has(value as BillingBillStatus)) {
    return value as BillingBillStatus;
  }
  return null;
}

function mapPromotionRedemptionRow(
  row: PromotionRedemptionRow,
): PromotionRedemptionRecord {
  return {
    id: row.id,
    // 取真列。此前是拿 `row.id` 冒充的，于是核销台账主列摆着一张 UUID——
    // UUID 只走内部，对外一律 *_no（DDL 56 表头，2026-08-07 补列）。
    redemptionNo: row.redemption_no,
    promotionCode: row.voucher_code,
    promotionName: row.batch_name,
    kind: row.kind,
    benefitLabel: faceLabel(row.kind, row.effect_snapshot),
    walletTransactions: row.wallet_transactions ?? [],
    subscriptionId: row.subscription_id,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code ?? "",
    tenantName: row.tenant_name ?? "",
    tenantType: normalizeTenantType(row.tenant_type),
    orderNo: row.order_no,
    billId: row.bill_id ?? "",
    billNo: row.bill_no ?? "",
    billStatus: row.bill_id ? normalizeBillStatus(row.bill_status) : null,
    servicePlanName: row.plan_name,
    currency: row.currency ?? "CNY",
    orderAmount: toNumber(row.total_amount),
    discountAmount: toNumber(row.discount_amount),
    payableAmount: toNumber(row.payable_amount),
    // Customer self-service — no operator for voucher redemptions (honest constant).
    operatorName: "客户自助",
    redeemedAt: toIso(row.redeemed_at),
    remark: null,
    // C15: status (no status column — every row is a completed redemption) and
    // tierName (no source) dropped.
  };
}

const PROMOTION_REDEMPTIONS_SQL = `
select
  rd.id,
  rd.redemption_no,
  rd.kind,
  rd.effect_snapshot,
  array(select tx.transaction_no from billing.wallet_operations wo join billing.transactions tx on tx.id=wo.transaction_id where wo.id in (rd.principal_wallet_operation_id,rd.bonus_wallet_operation_id) order by tx.transaction_no) wallet_transactions,
  rd.subscription_id,
  v.code                           as voucher_code,
  b.name                           as batch_name,
  rd.tenant_id,
  t.tenant_no::text                as tenant_code,
  t.name                           as tenant_name,
  t.type                           as tenant_type,
  cur.order_no,
  inv.id                           as bill_id,
  inv.bill_no,
  inv.bill_status,
  inv.total_amount,
  inv.discount_amount,
  inv.payable_amount,
  inv.currency,
  pl.plan_name,
  rd.redeemed_at
from promotion.voucher_redemptions rd
join promotion.vouchers v on v.id = rd.voucher_id
join promotion.voucher_batches b on b.id = v.batch_id
left join tenancy.tenants t on t.id = rd.tenant_id
left join billing.invoice_items ii on ii.id = rd.invoice_item_id
left join billing.payments pay on pay.id = rd.payment_id
left join promotion.voucher_reservations res on res.id = rd.reservation_id
left join billing.invoices inv on inv.id = coalesce(ii.bill_id,pay.bill_id,res.invoice_id)
left join metering.subscriptions sub on sub.id = rd.subscription_id
-- A time benefit must never inherit an unrelated paid order from its subscription.
left join billing.orders cur on cur.id = coalesce(rd.order_id,inv.order_id)
left join product.plan_versions pv on pv.id = sub.plan_version_id
left join product.plans pl on pl.id = pv.plan_id
order by rd.redeemed_at desc
limit 500
`;

interface PromotionRedemptionRow {
  id: string;
  redemption_no: string;
  wallet_transactions: string[];
  kind: string;
  effect_snapshot: unknown;
  subscription_id: string | null;
  voucher_code: string;
  batch_name: string;
  tenant_id: string;
  tenant_code: string | null;
  tenant_name: string | null;
  tenant_type: string | null;
  order_no: string | null;
  bill_id: string | null;
  bill_no: string | null;
  bill_status: string | null;
  total_amount: string | number | null;
  discount_amount: string | number | null;
  payable_amount: string | number | null;
  currency: string | null;
  plan_name: string | null;
  redeemed_at: Date | string | null;
}

// ── 端点 4：商业总览 ──────────────────────────────────────────────────────────
// 跨 billing.invoices/payments/transactions + metering.subscriptions
// + promotion.voucher_redemptions 的 COUNT/SUM KPI 卡；planRevenue 按套餐分组订阅。

function buildOverviewSnapshot(
  kpi: OverviewKpiRow | null,
  planRows: OverviewPlanRow[],
): CommerceOverviewSnapshot {
  const activeSubscriptions = toNumber(kpi?.active_subscriptions ?? 0);
  const paidTotal = toNumber(kpi?.paid_total ?? 0);
  const paidCount = toNumber(kpi?.paid_count ?? 0);
  const outstandingAmount = toNumber(kpi?.outstanding_amount ?? 0);
  const outstandingCount = toNumber(kpi?.outstanding_count ?? 0);
  const overdueCount = toNumber(kpi?.overdue_count ?? 0);
  const rechargeVolume = toNumber(kpi?.recharge_volume ?? 0);
  const rechargeCount = toNumber(kpi?.recharge_count ?? 0);
  const redemptionCount = toNumber(kpi?.redemption_count ?? 0);

  const metrics: CommerceOverviewMetric[] = [
    {
      key: "active_subscriptions",
      label: "活跃订阅",
      value: activeSubscriptions,
      tone: "blue",
      hint: "metering.subscriptions 中 status=active 的订阅数",
    },
    {
      key: "paid_total",
      label: "累计实收",
      value: paidCount,
      amount: paidTotal,
      currency: "CNY",
      tone: "green",
      hint: "billing.payments 中 pay_status=paid 的实付金额合计",
    },
    {
      key: "outstanding",
      label: "待收账单",
      value: outstandingCount,
      amount: outstandingAmount,
      currency: "CNY",
      tone: "amber",
      hint: "未付/部分付/逾期账单的应收未收金额",
    },
    {
      key: "recharge_volume",
      label: "充值流水",
      value: rechargeCount,
      amount: rechargeVolume,
      currency: "CNY",
      tone: "blue",
      hint: "billing.transactions 中 recharge 成功流水金额合计",
    },
    {
      key: "redemption_count",
      label: "卡券核销",
      value: redemptionCount,
      tone: "green",
      hint: "promotion.voucher_redemptions 核销记录总数",
    },
  ];

  const risks: CommerceOverviewRiskItem[] = [];
  if (overdueCount > 0) {
    risks.push({
      id: "overdue-invoices",
      title: "逾期账单待跟进",
      detail: `当前有 ${overdueCount} 张逾期账单，需要催收或调整。`,
      tone: "rose",
      href: "/billing",
    });
  }
  if (outstandingCount > 0) {
    risks.push({
      id: "outstanding-invoices",
      title: "待收账单未结清",
      detail: `${outstandingCount} 张账单尚有 ${outstandingAmount.toFixed(2)} 元应收未收。`,
      tone: "amber",
      href: "/billing",
    });
  }
  if (risks.length === 0) {
    risks.push({
      id: "healthy",
      title: "账务健康",
      detail: "当前无逾期或待收风险账单。",
      tone: "green",
      href: "/commerce-overview",
    });
  }

  const planRevenue: CommerceOverviewPlanRevenue[] = planRows.map((row) => ({
    planName: row.plan_name ?? "未命名套餐",
    subscriptionCount: toNumber(row.subscription_count),
    revenueAmount: toNumber(row.revenue_amount),
    currency: "CNY",
    // C15: tierName/paidAmount/discountAmount dropped — no source (see type note).
  }));

  return {
    generatedAt: new Date().toISOString(),
    metrics,
    risks,
    planRevenue,
  };
}

const OVERVIEW_KPI_SQL = `
select
  (select count(*)
     from metering.subscriptions
    where status = 'active' and deleted_at is null) as active_subscriptions,
  (select coalesce(sum(paid_amount), 0)
     from billing.payments
    where pay_status = 'paid') as paid_total,
  (select count(*)
     from billing.payments
    where pay_status = 'paid') as paid_count,
  (select coalesce(sum(payable_amount - coalesce(paid_amount, 0)), 0)
     from billing.invoices
    where bill_status in ('unpaid', 'partial', 'overdue')
      and deleted_at is null) as outstanding_amount,
  (select count(*)
     from billing.invoices
    where bill_status in ('unpaid', 'partial', 'overdue')
      and deleted_at is null) as outstanding_count,
  (select count(*)
     from billing.invoices
    where bill_status = 'overdue' and deleted_at is null) as overdue_count,
  (select coalesce(sum(amount), 0)
     from billing.transactions
    where trade_type = 'recharge' and trade_status = 'success') as recharge_volume,
  (select count(*)
     from billing.transactions
    where trade_type = 'recharge' and trade_status = 'success') as recharge_count,
  (select count(*)
     from promotion.voucher_redemptions) as redemption_count
`;

interface OverviewKpiRow {
  active_subscriptions: string | number | null;
  paid_total: string | number | null;
  paid_count: string | number | null;
  outstanding_amount: string | number | null;
  outstanding_count: string | number | null;
  overdue_count: string | number | null;
  recharge_volume: string | number | null;
  recharge_count: string | number | null;
  redemption_count: string | number | null;
}

const OVERVIEW_PLAN_SQL = `
select
  pl.plan_name,
  count(*)                            as subscription_count,
  coalesce(sum(s.pay_amount), 0)      as revenue_amount
from metering.subscriptions s
join product.plan_versions pv on pv.id = s.plan_version_id
join product.plans pl on pl.id = pv.plan_id
where s.deleted_at is null
group by pl.plan_name
order by revenue_amount desc
limit 20
`;

interface OverviewPlanRow {
  plan_name: string | null;
  subscription_count: string | number | null;
  revenue_amount: string | number | null;
}
