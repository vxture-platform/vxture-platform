/**
 * subscriptions.router.ts - 订阅运营路由
 * @package @vxture/bff-admin
 *
 * Description: 平台订阅运营只读接口，接 metering.subscriptions（18-schema）。
 *   列表 join product.plan_versions→product.plans 取套餐名、tenancy.tenants/tenant_profiles 取归属，
 *   聚合 metering.quota_pools 出配额快照；详情附 plan_components 权益、subscription_histories/
 *   subscription_renewals 运营时间线。写路径（续订/暂停/恢复/取消）见 completion-plan。
 *
 *   18-schema 备忘：旧 commerce.subscription → metering.subscriptions；tenant.tenant → tenancy.tenants
 *   （展示字段迁 tenancy.tenant_profiles）；套餐取 product.plans，方案归属经 product.solution_plans
 *   （2026-08-31 起）；无 province/city、无 app 归属列 → app 字段 / region 走空态兜底；无 subscription_code 列 → subscriptionCode 用 id。
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

import { SUBSCRIPTION_STATUSES, TIERS } from "@vxture-platform/shared";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import type { ComponentRole } from "@vxture-platform/shared";
import { extractClientIp, industryLabel } from "@vxture/core-utils";
import { assertAnyCapability } from "../auth/capability";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import { UUID_RE } from "./governance.shared";
import type {
  ProductSolutionCapabilityType,
  SubscriptionTierCode,
  RequestContext,
  SubscriptionEntitlementSnapshot,
  SubscriptionOperationCycle,
  SubscriptionOperationDetailRecord,
  SubscriptionOperationEvent,
  SubscriptionOperationQuotaSnapshot,
  SubscriptionOperationRecord,
  SubscriptionOperationStatus,
  SubscriptionSolutionAssociation,
  TenantOperationStatus,
  TenantOperationType,
} from "../types/console.types";

// 写路径请求契约（前端权威）：portals/admin/src/api/admin-bff.ts submitSubscriptionOperation
//   POST /api/subscriptions/:id/actions  body { action, reason }  → SubscriptionOperationDetailRecord。
type SubscriptionActionType = "renew" | "suspend" | "resume" | "cancel";

interface SubscriptionActionBody {
  action?: unknown;
  reason?: unknown;
}

// change_type（open varchar32，写审计快照口径，见 50_metering.sql §2）。
const ACTION_CHANGE_TYPE: Record<SubscriptionActionType, string> = {
  renew: "renewed",
  suspend: "suspended",
  resume: "resumed",
  cancel: "cancelled",
};

@Controller("api/subscriptions")
export class SubscriptionsRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  /**
   * 路由参数是**面向用户的订阅编码**（最近一次履约它的订单号，如 `ORD-202609-XXXX`），
   * 不是内部 UUID——地址栏是可见面，UUID 不在任何场景对外展示。同时仍接受 UUID：
   * 存量书签、审计日志里记的 id、内部工具都还在传它。
   *
   * 订阅的可读码 = `billing.orders.order_no`（经 `subscriptions.current_order_id`，
   * product_330）。旧列 `metering.subscriptions.order_no` 已停写待删，不再读。
   * 解不出来 → 404，与「传了个不存在的 UUID」同一个结果。
   */
  private async resolveSubscriptionId(value: string): Promise<string> {
    if (UUID_RE.test(value ?? "")) return value;
    if (!value) throw new NotFoundException("Subscription not found");
    const { rows } = await this.pool.query<{ id: string }>(
      `select s.id
         from metering.subscriptions s
         join billing.orders o on o.id = s.current_order_id
        where o.order_no = $1 and s.deleted_at is null
        limit 1`,
      [value],
    );
    if (!rows[0])
      throw new NotFoundException(`Subscription ${value} not found`);
    return rows[0].id;
  }

  @Get()
  async listSubscriptions(
    @Req() req: Request & RequestContext,
  ): Promise<SubscriptionOperationRecord[]> {
    assertCanReadSubscriptions(req);

    const { rows } = await this.pool.query<SubscriptionRow>(
      SUBSCRIPTION_LIST_SQL,
    );
    return rows.map(mapSubscriptionRow);
  }

  @Get(":id")
  async getSubscription(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<SubscriptionOperationDetailRecord> {
    assertCanReadSubscriptions(req);
    const subscriptionId = await this.resolveSubscriptionId(id);

    const { rows } = await this.pool.query<SubscriptionRow>(
      SUBSCRIPTION_DETAIL_SQL,
      [subscriptionId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }

    const base = mapSubscriptionRow(row);

    const [entitlementRes, historyRes, renewalRes] = await Promise.all([
      row.plan_version_id
        ? this.pool.query<EntitlementRow>(SUBSCRIPTION_ENTITLEMENT_SQL, [
            row.plan_version_id,
          ])
        : Promise.resolve({ rows: [] as EntitlementRow[] }),
      this.pool.query<HistoryRow>(SUBSCRIPTION_HISTORY_SQL, [subscriptionId]),
      this.pool.query<RenewalRow>(SUBSCRIPTION_RENEWAL_SQL, [subscriptionId]),
    ]);

    return {
      ...base,
      solutionAssociation: buildSolutionAssociation(row),
      entitlementSnapshot: entitlementRes.rows.map(mapEntitlementRow),
      operationTimeline: buildTimeline(historyRes.rows, renewalRes.rows),
    };
  }

  // ─── 写路径：订阅动作（renew/suspend/resume/cancel，事务） ────────────────────
  // 事务内：SELECT ... FOR UPDATE 锁行 + 前置状态校验（幂等/终态不变量）→ UPDATE
  //   metering.subscriptions（status/auto_renew/end_at）→ append metering.subscription_histories
  //   （append-only 快照，只 insert）。读回详情走 RO 池，映射同 getSubscription。
  @Post(":id/actions")
  async runSubscriptionAction(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: SubscriptionActionBody,
  ): Promise<SubscriptionOperationDetailRecord> {
    assertCanManageSubscriptions(req);

    const action = parseAction(body?.action);
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const remark = reason.length > 0 ? reason : null;
    const actorId = req.user?.id ?? null;
    const clientIp = extractClientIp(req);
    const subscriptionId = await this.resolveSubscriptionId(id);

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      const { rows } = await client.query<SubscriptionActionRow>(
        SUBSCRIPTION_LOCK_SQL,
        [subscriptionId],
      );
      const current = rows[0];
      if (!current) {
        throw new NotFoundException(`Subscription ${id} not found`);
      }

      const fromStatus = current.status;
      const toStatus = resolveTargetStatus(action, current);

      await client.query(SUBSCRIPTION_ACTION_UPDATE_SQL, [
        subscriptionId,
        toStatus,
        action,
      ]);

      await client.query(SUBSCRIPTION_HISTORY_INSERT_SQL, [
        current.tenant_id,
        subscriptionId,
        ACTION_CHANGE_TYPE[action],
        fromStatus,
        toStatus,
        actorId,
        remark,
        clientIp,
      ]);

      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }

    return this.loadSubscriptionDetail(subscriptionId);
  }

  // 读回订阅详情（RO 池），映射逻辑与 getSubscription 一致；供写路径提交后回填响应。
  private async loadSubscriptionDetail(
    id: string,
  ): Promise<SubscriptionOperationDetailRecord> {
    const { rows } = await this.pool.query<SubscriptionRow>(
      SUBSCRIPTION_DETAIL_SQL,
      [id],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }

    const base = mapSubscriptionRow(row);

    const [entitlementRes, historyRes, renewalRes] = await Promise.all([
      row.plan_version_id
        ? this.pool.query<EntitlementRow>(SUBSCRIPTION_ENTITLEMENT_SQL, [
            row.plan_version_id,
          ])
        : Promise.resolve({ rows: [] as EntitlementRow[] }),
      this.pool.query<HistoryRow>(SUBSCRIPTION_HISTORY_SQL, [id]),
      this.pool.query<RenewalRow>(SUBSCRIPTION_RENEWAL_SQL, [id]),
    ]);

    return {
      ...base,
      solutionAssociation: buildSolutionAssociation(row),
      entitlementSnapshot: entitlementRes.rows.map(mapEntitlementRow),
      operationTimeline: buildTimeline(historyRes.rows, renewalRes.rows),
    };
  }
}

// ─── 写路径辅助：动作解析 + 前置状态不变量 ───────────────────────────────────

function parseAction(raw: unknown): SubscriptionActionType {
  if (
    raw === "renew" ||
    raw === "suspend" ||
    raw === "resume" ||
    raw === "cancel"
  ) {
    return raw;
  }
  throw new BadRequestException(
    "Invalid subscription action (expected renew/suspend/resume/cancel)",
  );
}

function isPastEndAt(endAt: Date | string | null): boolean {
  if (!endAt) return false;
  const t = endAt instanceof Date ? endAt.getTime() : new Date(endAt).getTime();
  return Number.isFinite(t) && t < Date.now();
}

// 幂等/终态不变量守卫（前端 SubscriptionOperationDialog 的镜像，服务端强校验）。
//   返回目标 status；违反前置条件抛 409。cancelled=终态；resume 仅对有效期内的 suspended。
function resolveTargetStatus(
  action: SubscriptionActionType,
  current: SubscriptionActionRow,
): string {
  const status = current.status;
  // 钱的一侧不在这张表：下单只建 billing.orders（product_330 P1-b2），订阅行只在
  // 履约后才存在，所以这里的每一行都是权益实例，四个动作只看订阅态本身。
  switch (action) {
    case "renew":
      if (status === "cancelled") {
        throw new ConflictException(
          "Cancelled subscription is terminal and cannot be renewed",
        );
      }
      return "active";
    case "suspend":
      if (status === "suspended") {
        throw new ConflictException("Subscription is already suspended");
      }
      if (status === "cancelled") {
        throw new ConflictException(
          "Cancelled subscription is terminal and cannot be suspended",
        );
      }
      return "suspended";
    case "resume":
      if (status !== "suspended") {
        throw new ConflictException("Only suspended subscriptions can resume");
      }
      if (isPastEndAt(current.end_at)) {
        throw new ConflictException(
          "Suspended subscription has expired; renew before resuming",
        );
      }
      return "active";
    case "cancel":
      if (status === "cancelled") {
        throw new ConflictException("Subscription is already cancelled");
      }
      return "cancelled";
  }
}

// TD-027: subscription domain codes. Actions (renew/suspend/resume/cancel) are
// routine writes (reversible, audited) — manage, no step-up.
function assertCanReadSubscriptions(req: Request & RequestContext): void {
  assertAnyCapability(req, [
    "commerce:subscription.read",
    "commerce:subscription.manage",
  ]);
}

function assertCanManageSubscriptions(req: Request & RequestContext): void {
  assertAnyCapability(req, ["commerce:subscription.manage"]);
}

// ─── 归一化辅助 ──────────────────────────────────────────────────────────────

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
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// subscriptions.status ∈ active/trialing/expired/cancelled/suspended → 前端运营口径。
/**
 * 库里的订阅态直接就是契约值域，不再改写。
 *
 * 原先这里做了一次改名，而改名里藏着一个错译：`expired`（权益已终止）被映射成
 * `overdue`（欠费宽限、权益仍在），两者含义正好相反；库里真正的 `overdue` 没有分支，
 * 落进 `default` 显示成"正常"——一个欠费的订阅在运营台上是绿的。
 *
 * `default` 兜底也一并去掉。DDL 的 CHECK 已经保证只有这六个值，真出现第七个说明
 * 契约破了，**这时候显示成"正常"是最坏的处理**：它把一次契约破裂伪装成一切正常。
 */
function normalizeStatus(raw: string): SubscriptionOperationStatus {
  const status = SUBSCRIPTION_STATUSES.find((value) => value === raw);
  if (!status) {
    throw new Error(`Unknown subscription status from DB: ${raw}`);
  }
  return status;
}

// subscriptions.cycle_unit ∈ day/week/month/year/perpetual → monthly/yearly/once。
function normalizeCycle(cycleUnit: string): SubscriptionOperationCycle {
  if (cycleUnit === "year") return "yearly";
  if (cycleUnit === "perpetual") return "once";
  return "monthly";
}

// tenants.type personal/organization → individual/company。
function normalizeTenantType(type: string): TenantOperationType {
  return type === "personal" ? "individual" : "company";
}

// tenants.status active/suspended/deleted → trial/active/suspended/cancelled。
function normalizeTenantStatus(status: string): TenantOperationStatus {
  if (status === "suspended") return "suspended";
  if (status === "deleted") return "cancelled";
  return "active";
}

// products.product_type（受管枚举 @vxture/core-utils）→ 能力型枚举。
const CAPABILITY_TYPES: ReadonlySet<ProductSolutionCapabilityType> = new Set([
  "platform",
  "agent",
  "model",
  "data",
  "service",
]);
function normalizeProductType(
  type: string | null,
): ProductSolutionCapabilityType {
  if (!type) return "platform";
  // 历史能力型精确值直接透传。
  if (CAPABILITY_TYPES.has(type as ProductSolutionCapabilityType)) {
    return type as ProductSolutionCapabilityType;
  }
  // 新旧 product_type 按 family 后缀归族：_agent→agent、_platform→platform、其余→service。
  if (type === "agent" || type.endsWith("_agent")) return "agent";
  if (type.endsWith("_platform")) return "platform";
  return "service";
}

// plan_components.tier → 订阅档位码。2026-08-31 起方案档位就是五档商业阶梯本身
// （TD-029 收口，@shared TIERS），不再把 business 折成 enterprise、starter 折成 free；
// 组件没有可识别档位（bundled 组件 tier=NULL、越梯 override）→ custom。
function normalizeTierCode(tier: string | null): SubscriptionTierCode {
  return tier && (TIERS as readonly string[]).includes(tier)
    ? (tier as SubscriptionTierCode)
    : "custom";
}

function tierName(code: SubscriptionTierCode): string {
  switch (code) {
    case "enterprise":
      return "企业版";
    case "business":
      return "商业版";
    case "pro":
      return "专业版";
    case "starter":
      return "入门版";
    case "free":
      return "免费版";
    default:
      return "自定义";
  }
}

function buildQuota(
  row: SubscriptionRow,
  cycle: SubscriptionOperationCycle,
): SubscriptionOperationQuotaSnapshot {
  // periodTokens/usedTokens = 该订阅全部 active quota_pools 的 quota_limit/quota_used 之和
  // （跨 metric 汇总，运营总览口径）。maxUsers/allowedModelCount/allowCustomModel 新库无独立列 → 兜底。
  const periodTokens = toNumber(row.quota_limit_sum);
  const usedTokens = toNumber(row.quota_used_sum);
  const usageRate =
    periodTokens > 0
      ? Math.min(Math.round((usedTokens / periodTokens) * 1000) / 1000, 1)
      : 0;
  const risk =
    usageRate >= 0.9 ? "danger" : usageRate >= 0.7 ? "warning" : "normal";
  return {
    maxUsers: 0,
    periodTokens,
    usedTokens,
    usageRate,
    quotaCycle: cycle,
    allowedModelCount: 0,
    allowCustomModel: false,
    risk,
  };
}

function operationHint(
  status: SubscriptionOperationStatus,
  autoRenew: boolean,
): string {
  switch (status) {
    case "overdue":
      return "存在逾期，需跟进催款";
    case "suspended":
      return "已暂停，待恢复";
    case "trialing":
      return "试用中";
    case "cancelled":
      return "已取消";
    default:
      return autoRenew ? "" : "未开启自动续订";
  }
}

function mapSubscriptionRow(row: SubscriptionRow): SubscriptionOperationRecord {
  const cycle = normalizeCycle(row.cycle_unit);
  const status = normalizeStatus(row.raw_status);
  const payAmount = toNumber(row.pay_amount);
  // 收入是真实收入（owner 2026-09-03）：不再把年付折成月均。字段名保留给旧客户端，
  // 值 = 本周期实付；一次性买断也是实收。
  const monthlyRevenue = payAmount;
  const tierCode = normalizeTierCode(row.tier_code);
  const planName = row.plan_name ?? "未关联套餐";
  const operatorName =
    row.operator_name ?? (row.created_by_type === "system" ? "系统" : "—");

  // 订阅的可视码 = 最近一次履约它的订单号（billing.orders 经 current_order_id，product_330）。
  // 不再退回 s.order_no：那列是升级 / 续订前的首单号，已停写待删。
  const currentOrderNo = row.current_order_no;
  return {
    id: row.id,
    subscriptionCode: currentOrderNo ?? row.id,
    orderNo: currentOrderNo,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code,
    tenantName: row.tenant_name,
    tenantType: normalizeTenantType(row.tenant_type),
    tenantStatus: normalizeTenantStatus(row.tenant_status),
    region: row.country_code ?? "未设置",
    // 所属行业:console 存的是 core-utils 清单码,这里翻成中文标签;历史自由文本原样显示
    industry: row.industry ? industryLabel(row.industry) : "未设置",
    solutionCode: row.solution_code,
    solutionName: row.solution_name ?? planName,
    servicePlanCode: row.plan_code ?? "",
    servicePlanName: planName,
    tierCode,
    tierName: tierName(tierCode),
    status,
    rawStatus: row.raw_status,
    cycleType: cycle,
    autoRenew: row.auto_renew,
    currency: row.currency ?? "CNY",
    payAmount,
    monthlyRevenue,
    quota: buildQuota(row, cycle),
    appCode: null,
    appName: null,
    appNameZh: null,
    operatorName,
    operationHint: operationHint(status, row.auto_renew),
    startAt: toIso(row.start_at),
    endAt: toIsoNullable(row.end_at),
    trialEndAt: toIsoNullable(row.trial_end_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function buildSolutionAssociation(
  row: SubscriptionRow,
): SubscriptionSolutionAssociation {
  const tierCode = normalizeTierCode(row.tier_code);
  // 2026-08-31：套餐绑进了方案（product.solution_plans）就按方案归属；没绑的仍是
  // 「只有套餐」的旧形态。此前 solutionCode 恒 null 是因为库里没有方案表。
  return {
    solutionCode: row.solution_code,
    solutionName: row.solution_name ?? row.plan_name ?? "未关联套餐",
    tierCode,
    tierName: tierName(tierCode),
    source: row.solution_code ? "solution" : "legacy_plan",
    note: row.plan_code ? `套餐 ${row.plan_code}` : "",
  };
}

function quotaSummary(quota: Record<string, unknown> | null): string {
  if (!quota) return "—";
  const parts = Object.entries(quota).map(([k, v]) => `${k}: ${String(v)}`);
  return parts.length > 0 ? parts.join("、") : "—";
}

function mapEntitlementRow(
  row: EntitlementRow,
): SubscriptionEntitlementSnapshot {
  return {
    productCode: row.product_code,
    productName: row.product_name,
    productType: normalizeProductType(row.product_type),
    source: "self",
    included: row.component_role === "bundled",
    quotaSummary: quotaSummary(row.quota),
    note: row.tier ? `档位 ${row.tier}` : "",
  };
}

// ─── 运营时间线（histories + renewals 归并，按时间倒序） ──────────────────────

const CHANGE_TITLE: Record<string, string> = {
  created: "订阅创建",
  renewed: "订阅续订",
  upgraded: "套餐升级",
  downgraded: "套餐降级",
  cancelled: "订阅取消",
};

function historyTone(changeType: string): SubscriptionOperationEvent["tone"] {
  if (changeType === "cancelled" || changeType === "downgraded")
    return "warning";
  if (changeType === "created" || changeType === "renewed") return "success";
  return "neutral";
}

function renewalTone(status: string): SubscriptionOperationEvent["tone"] {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "abandoned") return "danger";
  if (status === "dunning") return "warning";
  return "neutral";
}

function buildTimeline(
  histories: HistoryRow[],
  renewals: RenewalRow[],
): SubscriptionOperationEvent[] {
  const events: SubscriptionOperationEvent[] = [];

  for (const h of histories) {
    const statusDelta =
      h.from_status && h.to_status
        ? `${h.from_status} → ${h.to_status}`
        : (h.remark ?? "");
    events.push({
      id: h.id,
      title: CHANGE_TITLE[h.change_type] ?? h.change_type,
      description: statusDelta,
      actor: h.actor_type,
      at: toIso(h.created_at),
      tone: historyTone(h.change_type),
    });
  }

  for (const r of renewals) {
    events.push({
      id: r.id,
      title: `续订周期 #${r.cycle_seq}`,
      description:
        r.failure_reason ??
        (r.amount !== null
          ? `应扣 ¥${toNumber(r.amount).toFixed(2)}`
          : r.status),
      actor: "system",
      at: toIso(r.created_at),
      tone: renewalTone(r.status),
    });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return events;
}

// ─── SQL（列均逐列对照 50_metering.sql / 40_product.sql / 20_tenancy.sql） ────

const SUBSCRIPTION_BASE_SQL = `
select
  s.id,
  s.tenant_id,
  s.plan_version_id,
  s.subscription_kind,
  s.cycle_unit,
  s.cycle_count,
  s.status as raw_status,
  s.auto_renew,
  s.currency,
  s.pay_amount,
  s.created_by_type,
  s.created_by_id,
  s.start_at,
  s.end_at,
  s.trial_end_at,
  s.created_at,
  s.updated_at,
  t.tenant_no::text as tenant_code,
  t.name as tenant_name,
  t.type as tenant_type,
  t.status as tenant_status,
  tp.industry,
  tp.country_code,
  pl.plan_code,
  pl.plan_name,
  sol.solution_code,
  sol.solution_name,
  op.display_name as operator_name,
  tier.tier as tier_code,
  quota.quota_limit_sum,
  quota.quota_used_sum,
  cur.order_no as current_order_no
from metering.subscriptions s
join tenancy.tenants t on t.id = s.tenant_id
-- 最近一次履约本订阅的订单（product_330）：订阅可视码 / 订单跳转都用它
left join billing.orders cur on cur.id = s.current_order_id
left join tenancy.tenant_profiles tp on tp.tenant_id = t.id
left join product.plan_versions pv on pv.id = s.plan_version_id
left join product.plans pl on pl.id = pv.plan_id
-- 套餐若被某个方案的档位绑定，这条订阅就归属该方案（solution_plans.plan_id 唯一，最多一条）
left join product.solution_plans spl on spl.plan_id = pl.id
left join product.solutions sol on sol.id = spl.solution_id and sol.deleted_at is null
left join admin.operator_account op
  on op.id = s.created_by_id and s.created_by_type = 'operator'
left join lateral (
  select pc.tier
  from product.plan_components pc
  where pc.plan_version_id = s.plan_version_id
  order by case pc.tier
    when 'enterprise' then 0
    when 'business'   then 1
    when 'pro'        then 2
    when 'starter'    then 3
    when 'standard'   then 4
    else 5
  end
  limit 1
) tier on true
left join lateral (
  select
    coalesce(sum(qp.quota_limit), 0)::bigint as quota_limit_sum,
    coalesce(sum(qp.quota_used), 0)::bigint  as quota_used_sum
  from metering.quota_pools qp
  where qp.subscription_id = s.id and qp.status = 'active'
) quota on true
`;

const SUBSCRIPTION_LIST_SQL = `
${SUBSCRIPTION_BASE_SQL}
where s.deleted_at is null
  -- product_330 P1-b1 双写期的升级镜像行（下单时建的 suspended 行，升级履约到原订阅后被标
  -- cancelled）不是权益实例，不列。判据：它指向的订单履约到了另一条订阅
  -- （orders.status='fulfilled' 且 orders.subscription_id <> 本行）。镜像行是 cancelled 不是
  -- 待收款壳，不在 P2 软删范围内，所以这条过滤要留着。钱与履约在「交易订单」看。
  and not exists (
    select 1 from billing.orders o
     where o.id = s.current_order_id and o.status = 'fulfilled' and o.subscription_id <> s.id
  )
order by s.created_at desc
limit 500
`;

const SUBSCRIPTION_DETAIL_SQL = `
${SUBSCRIPTION_BASE_SQL}
where s.id = $1 and s.deleted_at is null
`;

const SUBSCRIPTION_ENTITLEMENT_SQL = `
select
  p.product_code,
  p.product_name,
  p.product_type,
  pc.tier,
  pc.component_role,
  pc.quota
from product.plan_components pc
join product.products p on p.id = pc.product_id
where pc.plan_version_id = $1
order by pc.sort_order asc, pc.priority asc
`;

const SUBSCRIPTION_HISTORY_SQL = `
select
  id,
  change_type,
  from_status,
  to_status,
  actor_type,
  actor_id,
  remark,
  created_at
from metering.subscription_histories
where subscription_id = $1
order by created_at desc
limit 200
`;

const SUBSCRIPTION_RENEWAL_SQL = `
select
  id,
  cycle_seq,
  status,
  scheduled_at,
  amount,
  failure_reason,
  created_at
from metering.subscription_renewals
where subscription_id = $1
order by created_at desc
limit 200
`;

// ─── 行接口 ──────────────────────────────────────────────────────────────────

interface SubscriptionRow {
  id: string;
  /** billing.orders.order_no of current_order_id（product_330）；没履约过的行 null */
  current_order_no: string | null;
  tenant_id: string;
  plan_version_id: string | null;
  subscription_kind: string;
  cycle_unit: string;
  cycle_count: number;
  raw_status: string;
  auto_renew: boolean;
  currency: string | null;
  pay_amount: string | null;
  created_by_type: string;
  created_by_id: string | null;
  start_at: Date | string;
  end_at: Date | string | null;
  trial_end_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  tenant_code: string;
  tenant_name: string;
  tenant_type: string;
  tenant_status: string;
  industry: string | null;
  country_code: string | null;
  plan_code: string | null;
  plan_name: string | null;
  solution_code: string | null;
  solution_name: string | null;
  operator_name: string | null;
  tier_code: string | null;
  quota_limit_sum: string | null;
  quota_used_sum: string | null;
}

interface EntitlementRow {
  product_code: string;
  product_name: string;
  product_type: string | null;
  tier: string | null; // 可含 override_tier_code(无 CHECK 约束,可越梯)→ 不收紧为 Tier
  component_role: ComponentRole;
  quota: Record<string, unknown> | null;
}

interface HistoryRow {
  id: string;
  change_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_type: string;
  actor_id: string | null;
  remark: string | null;
  created_at: Date | string;
}

interface RenewalRow {
  id: string;
  cycle_seq: number;
  status: string;
  scheduled_at: Date | string;
  amount: string | null;
  failure_reason: string | null;
  created_at: Date | string;
}

// ─── 写路径 SQL（列均逐列对照 50_metering.sql §1/§2） ─────────────────────────

const SUBSCRIPTION_LOCK_SQL = `
select
  s.id,
  s.tenant_id,
  s.status,
  s.auto_renew,
  s.cycle_unit,
  s.cycle_count,
  s.end_at,
  s.subscription_kind
from metering.subscriptions s
where s.id = $1 and s.deleted_at is null
for update of s
`;

// $1 id / $2 target status / $3 action。
//   auto_renew：suspend/cancel 关闭，其余保持。
//   end_at：cancel 落到 now()；renew 从 max(end_at, now()) 按 cycle_unit×cycle_count 延长
//     （perpetual 保持 NULL，遵守 chk_subscriptions_perpetual_open）；其余保持。
//   subscription_kind：renew 把 trial 行翻成 paid（D10 不变量，product_220 §3）——
//     "试用转正必须新建 paid 行或翻转 kind"，否则续订后再流失会被 C2 的
//     trial-exclusion 谓词误判回 null（付费流失口径污染）。非 trial 行不受影响。
const SUBSCRIPTION_ACTION_UPDATE_SQL = `
update metering.subscriptions s
set
  status = $2,
  subscription_kind = case
    when $3 = 'renew' and s.subscription_kind = 'trial' then 'paid'
    else s.subscription_kind
  end,
  auto_renew = case
    when $3 in ('suspend', 'cancel') then false
    else s.auto_renew
  end,
  end_at = case
    when $3 = 'cancel' then now()
    when $3 = 'renew' and s.cycle_unit <> 'perpetual'
      then coalesce(greatest(s.end_at, now()), now()) + make_interval(
        years  => case when s.cycle_unit = 'year'  then s.cycle_count else 0 end,
        months => case when s.cycle_unit = 'month' then s.cycle_count else 0 end,
        weeks  => case when s.cycle_unit = 'week'  then s.cycle_count else 0 end,
        days   => case when s.cycle_unit = 'day'   then s.cycle_count else 0 end
      )
    else s.end_at
  end,
  updated_at = now()
where s.id = $1 and s.deleted_at is null
`;

// append-only 快照（只 insert）。$1 tenant_id / $2 subscription_id / $3 change_type /
//   $4 from_status / $5 to_status / $6 actor_id / $7 remark / $8 client_ip。actor_type 固定 operator。
const SUBSCRIPTION_HISTORY_INSERT_SQL = `
insert into metering.subscription_histories (
  tenant_id,
  subscription_id,
  change_type,
  from_status,
  to_status,
  actor_type,
  actor_id,
  remark,
  client_ip
) values ($1, $2, $3, $4, $5, 'operator', $6, $7, $8)
`;

interface SubscriptionActionRow {
  id: string;
  tenant_id: string;
  status: string;
  auto_renew: boolean;
  cycle_unit: string;
  cycle_count: number;
  end_at: Date | string | null;
  subscription_kind: string;
}
