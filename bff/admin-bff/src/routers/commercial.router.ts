/**
 * commercial.router.ts - 商业化运营只读路由（用量计量 / 卡券营销 / 商业总览）
 * @package @vxture/bff-admin
 *
 * Description: 商业化四端点只读接口，接 18-schema 三域（metering / promotion / billing）：
 *   - GET /api/commercial/usage-metering     用量计量：metering.usage_summary_months + quota_pools（配额/余量）
 *   - GET /api/commercial/promotions         营销批次：promotion.voucher_batches 聚合 promotion.vouchers/redemptions
 *   - GET /api/commercial/promotion-redemptions 核销明细：voucher_redemptions join vouchers/batches
 *   - GET /api/commercial/overview           商业总览：billing.invoices/payments/transactions
 *                                            + metering.subscriptions + promotion.voucher_redemptions 的 KPI 聚合
 *   前端契约见 portals/admin/src/api/admin-bff.ts::fetchUsageMeteringRecords /
 *   fetchPromotionOperations / fetchPromotionRedemptionRecords / fetchCommerceOverview。
 *
 * 18-schema remap（cutover 后）：commerce→billing/metering/promotion（表复数）；
 *   tenant.tenant→tenancy.tenants，展示字段迁 tenancy.tenant_profiles；租户 type=personal/organization
 *   归一到前端口径 individual/company；新库无 province/city → region 走空态兜底。
 *   metering.usage_summary_* 只挂 workspace_id/product_id/metric_key → 经 workspaces 反查 tenant；
 *   用量维度无显示名（product_metrics 仅 metric_unit）→ metricName 回落 metric_key；
 *   模型分维度（request/input/output tokens）无独立汇总列 → 归零。
 *   promotion.voucher_batches 软下线走 status='archived'（无 deleted_at），故列表不加软删过滤。
 *   核销 operatorName 为客户 realm 自助（user_id），无运营名 → 默认兜底。
 *
 * @author AI-Generated
 * @date 2026-07-04
 * @version 1.0
 *
 * @copyright Vxture Team
 *
 * @layer Application
 * @category Router
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { Pool } from "pg";
import { assertAnyCapability } from "../auth/capability";
import { RequireStepUp } from "../auth/step-up.decorator";
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

// ── 发券写端点契约（product_321 §4.2，TD-028 部分销号）─────────────────────────

interface CreateVoucherBatchBody {
  /** V1 只放行结算引擎已启用的两型（product_321 P7）。 */
  kind: "discount" | "credit_voucher";
  name: string;
  codePrefix?: string;
  /** discount: {discountType, value, maxOffCents?}; credit_voucher: {amountCents} */
  effect: Record<string, unknown>;
  totalCount: number;
  perUserLimit?: number;
  validFrom: string;
  validUntil: string;
  /** 定向租户批次；缺省 = 平台级（券必须再定向 user/workspace 才可用，P7）。 */
  tenantId?: string;
}

interface AssignVouchersBody {
  batchId: string;
  count?: number;
  targetUserId?: string;
  targetWorkspaceId?: string;
}

@Controller("api/commercial")
export class CommercialRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  // 创建券批次（product_321 §4.2）：kind 限 discount/credit_voucher，effect 结构化
  // 校验（金额整数分、percent 0-100），未实现的门槛字段（applicable_plan_ids /
  // min_user_level）显式拒绝——结算引擎会把带门槛的券过滤为不可用（P7），放行
  // 配置只会造出永远用不了的券。
  @Post("voucher-batches")
  @RequireStepUp()
  async createVoucherBatch(
    @Req() req: Request & RequestContext,
    @Body() body: CreateVoucherBatchBody,
  ): Promise<{ batchId: string }> {
    assertCanManagePromotion(req);
    const operatorId = requireOperator(req);
    const input = normalizeCreateBatchBody(body);

    const { rows } = await this.rwPool.query<{ id: string }>(
      `insert into promotion.voucher_batches (
         tenant_id, kind, name, code_prefix, effect,
         total_count, issued_count, per_user_limit,
         valid_from, valid_until, status, created_by,
         created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, 'active', $10, now(), now())
       returning id`,
      [
        input.tenantId,
        input.kind,
        input.name,
        input.codePrefix,
        JSON.stringify(input.effect),
        input.totalCount,
        input.perUserLimit,
        input.validFrom,
        input.validUntil,
        operatorId,
      ],
    );
    const row = rows[0];
    if (!row) throw new BadRequestException("批次创建失败");
    return { batchId: row.id };
  }

  // 定向发放（product_321 §4.2）：码按需生成（assign 时生成 voucher 行，
  // issued_count = 已发放数）；issued_count 原子自增抢占（受影响行数=1 防并发
  // 超发）；per_user_limit 仅对 user 目标生效。目标 = workspace / user 两维；
  // tenant 定向 = tenant 专属批次里发放不填两列（租户全员可用，P7）；平台级
  // 批次必须给定 user/workspace 目标（禁"通用无主券"）。
  @Post("vouchers/assign")
  @RequireStepUp()
  async assignVouchers(
    @Req() req: Request & RequestContext,
    @Body() body: AssignVouchersBody,
  ): Promise<{ codes: string[] }> {
    assertCanManagePromotion(req);
    requireOperator(req);
    const batchId = (body?.batchId ?? "").trim();
    if (!batchId) throw new BadRequestException("batchId 不能为空");
    const count = Number.isInteger(body?.count) ? (body.count as number) : 1;
    if (count < 1 || count > 200)
      throw new BadRequestException("count 取值 1-200");
    const targetUserId = body?.targetUserId?.trim() || null;
    const targetWorkspaceId = body?.targetWorkspaceId?.trim() || null;
    if (targetUserId && targetWorkspaceId)
      throw new BadRequestException("user / workspace 目标二选一");

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      const batchResult = await client.query<{
        id: string;
        tenant_id: string | null;
        kind: string;
        code_prefix: string | null;
        per_user_limit: number;
        status: string;
      }>(
        `select id, tenant_id, kind, code_prefix, per_user_limit, status
           from promotion.voucher_batches where id = $1 for update`,
        [batchId],
      );
      const batch = batchResult.rows[0];
      if (!batch) throw new BadRequestException("批次不存在");
      if (batch.status !== "active")
        throw new ConflictException("批次不是 active 状态，不能发放");
      if (!batch.tenant_id && !targetUserId && !targetWorkspaceId) {
        throw new BadRequestException(
          "平台级批次必须定向到 user 或 workspace（禁无主券，P7）",
        );
      }

      // per_user_limit：仅约束 user 目标（workspace/tenant-wide 发放不受限）。
      if (targetUserId) {
        const held = await client.query<{ held: string }>(
          `select count(*) as held from promotion.vouchers
            where batch_id = $1 and assigned_user_id = $2
              and status not in ('revoked')`,
          [batchId, targetUserId],
        );
        const heldCount = Number(held.rows[0]?.held ?? 0);
        if (heldCount + count > batch.per_user_limit) {
          throw new ConflictException(
            `超出每用户上限（已持 ${heldCount}/${batch.per_user_limit}）`,
          );
        }
      }

      // issued_count 原子抢占：受影响行数=1 才算占到发行量。
      const seized = await client.query(
        `update promotion.voucher_batches
            set issued_count = issued_count + $2, updated_at = now()
          where id = $1 and status = 'active'
            and issued_count + $2 <= total_count`,
        [batchId, count],
      );
      if (seized.rowCount !== 1) {
        throw new ConflictException("批次发行量不足");
      }

      const codes: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const code = voucherCode(batch.code_prefix);
        await client.query(
          `insert into promotion.vouchers (
             batch_id, code, status, max_uses, used_count,
             assigned_workspace_id, assigned_user_id, created_at
           ) values ($1, $2, 'assigned', 1, 0, $3, $4, now())`,
          [batchId, code, targetWorkspaceId, targetUserId],
        );
        codes.push(code);
      }

      await client.query("commit");
      return { codes };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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
function assertCanManagePromotion(req: Request & RequestContext): void {
  assertAnyCapability(req, ["promotion:campaign.manage"]);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireOperator(req: Request & RequestContext): string {
  const id = req.user?.id;
  if (!id || !UUID_RE.test(id)) {
    throw new UnauthorizedException("Invalid platform admin principal");
  }
  return id;
}

// 券码：{PREFIX-}{12位}，去混淆字符（0/O、1/I）统一大写（230 §5.3 归一化约定）。
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function voucherCode(prefix: string | null): string {
  const raw = randomUUID().replace(/-/g, "");
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    const byte = Number.parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return prefix ? `${prefix}${out}` : `VX-${out}`;
}

const GATE_FIELDS = ["applicable_plan_ids", "min_user_level"] as const;

function normalizeCreateBatchBody(body: CreateVoucherBatchBody): {
  kind: "discount" | "credit_voucher";
  name: string;
  codePrefix: string | null;
  effect: Record<string, unknown>;
  totalCount: number;
  perUserLimit: number;
  validFrom: string;
  validUntil: string;
  tenantId: string | null;
} {
  if (!body || typeof body !== "object")
    throw new BadRequestException("Request body is required");
  if (body.kind !== "discount" && body.kind !== "credit_voucher")
    throw new BadRequestException(
      "kind 仅支持 discount / credit_voucher（其余券型 V1 未启用）",
    );
  const name = (body.name ?? "").trim();
  if (name.length < 2 || name.length > 128)
    throw new BadRequestException("name 长度 2-128");
  const codePrefix = body.codePrefix?.trim() || null;
  if (codePrefix && !/^[A-Z0-9-]{2,16}$/.test(codePrefix))
    throw new BadRequestException(
      "codePrefix 仅限大写字母/数字/连字符，2-16 位",
    );

  const rawEffect = body.effect ?? {};
  for (const field of GATE_FIELDS) {
    if (field in rawEffect) {
      throw new BadRequestException(
        `${field} 门槛 V1 未实现，禁止配置（配置了也会被结算引擎过滤为不可用）`,
      );
    }
  }
  let effect: Record<string, unknown>;
  if (body.kind === "discount") {
    const discountType =
      rawEffect["discount_type"] ?? rawEffect["discountType"];
    const value = Number(rawEffect["value"]);
    const maxOff = rawEffect["max_off_cents"] ?? rawEffect["maxOffCents"];
    if (discountType !== "percent" && discountType !== "fixed")
      throw new BadRequestException("discount_type 必须是 percent / fixed");
    if (discountType === "percent" && !(value > 0 && value <= 100))
      throw new BadRequestException("percent 值域 (0,100]");
    if (discountType === "fixed" && !(Number.isSafeInteger(value) && value > 0))
      throw new BadRequestException("fixed 面额必须是正整数（分）");
    if (
      maxOff != null &&
      !(Number.isSafeInteger(Number(maxOff)) && Number(maxOff) > 0)
    )
      throw new BadRequestException("max_off_cents 必须是正整数（分）");
    effect = {
      discount_type: discountType,
      value,
      ...(maxOff != null ? { max_off_cents: Number(maxOff) } : {}),
    };
  } else {
    const amount = Number(
      rawEffect["amount_cents"] ?? rawEffect["amountCents"],
    );
    if (!(Number.isSafeInteger(amount) && amount > 0))
      throw new BadRequestException("amount_cents 必须是正整数（分）");
    effect = { amount_cents: amount, currency: "CNY" };
  }

  const totalCount = Number(body.totalCount);
  if (
    !(
      Number.isSafeInteger(totalCount) &&
      totalCount >= 1 &&
      totalCount <= 100_000
    )
  )
    throw new BadRequestException("totalCount 取值 1-100000");
  const perUserLimit = Number(body.perUserLimit ?? 1);
  if (
    !(
      Number.isSafeInteger(perUserLimit) &&
      perUserLimit >= 1 &&
      perUserLimit <= 100
    )
  )
    throw new BadRequestException("perUserLimit 取值 1-100");

  const validFrom = new Date(body.validFrom ?? "");
  const validUntil = new Date(body.validUntil ?? "");
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime()))
    throw new BadRequestException("validFrom / validUntil 必须是合法时间");
  if (validUntil.getTime() <= validFrom.getTime())
    throw new BadRequestException("validUntil 必须晚于 validFrom");

  const tenantId = body.tenantId?.trim() || null;
  if (tenantId && !UUID_RE.test(tenantId))
    throw new BadRequestException("tenantId 非法");

  return {
    kind: body.kind,
    name,
    codePrefix,
    effect,
    totalCount,
    perUserLimit,
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    tenantId,
  };
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
    industry: row.industry ?? "未设置",
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
  sub.order_no,
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
};

const KIND_LABEL: Record<string, string> = {
  credit_voucher: "代金券",
  recharge_card: "充值卡",
  redemption: "兑换码",
  discount: "折扣券",
  extension: "展期券",
};

function derivePromotionType(kind: string): PromotionOperationType {
  return PROMOTION_TYPE_BY_KIND[kind] ?? "campaign";
}

function derivePromotionStatus(
  status: string,
  validFrom: Date | string | null,
  validUntil: Date | string | null,
): PromotionOperationStatus {
  if (status === "archived") return "expired";
  if (status === "paused") return "paused";
  const now = Date.now();
  if (validFrom && new Date(validFrom).getTime() > now) return "scheduled";
  if (validUntil && new Date(validUntil).getTime() < now) return "expired";
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
  if (kind === "credit_voucher" || kind === "recharge_card") {
    const amount = Number(e["amount_cents"] ?? e["face_value_cents"]);
    return Number.isFinite(amount) && amount > 0
      ? `¥${(amount / 100).toFixed(2)}`
      : "未配置";
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

const PROMOTIONS_SQL = `
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
order by b.created_at desc
limit 500
`;

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
function normalizeBillStatus(value: string | null): BillingBillStatus {
  if (value && BILL_STATUSES.has(value as BillingBillStatus)) {
    return value as BillingBillStatus;
  }
  return "paid";
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
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code ?? "",
    tenantName: row.tenant_name ?? "",
    tenantType: normalizeTenantType(row.tenant_type),
    orderNo: row.order_no,
    billId: row.bill_id ?? "",
    billNo: row.bill_no ?? "",
    billStatus: normalizeBillStatus(row.bill_status),
    servicePlanName: row.plan_name,
    currency: "CNY",
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
  v.code                           as voucher_code,
  b.name                           as batch_name,
  rd.tenant_id,
  t.tenant_no::text                as tenant_code,
  t.name                           as tenant_name,
  t.type                           as tenant_type,
  sub.order_no,
  inv.id                           as bill_id,
  inv.bill_no,
  inv.bill_status,
  inv.total_amount,
  inv.discount_amount,
  inv.payable_amount,
  pl.plan_name,
  rd.redeemed_at
from promotion.voucher_redemptions rd
join promotion.vouchers v on v.id = rd.voucher_id
join promotion.voucher_batches b on b.id = v.batch_id
left join tenancy.tenants t on t.id = rd.tenant_id
left join billing.invoice_items ii on ii.id = rd.invoice_item_id
left join billing.invoices inv on inv.id = ii.bill_id
left join metering.subscriptions sub on sub.id = rd.subscription_id
left join product.plan_versions pv on pv.id = sub.plan_version_id
left join product.plans pl on pl.id = pv.plan_id
order by rd.redeemed_at desc
limit 500
`;

interface PromotionRedemptionRow {
  id: string;
  redemption_no: string;
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
