/**
 * quota.router.ts - 租户配额总览路由
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * 配额管理页(/quotas 重建,owner 2026-08-20 用量配额线)的读侧聚合:
 *   GET /api/quota/overview — 当前租户默认工作空间的配额全景:
 *     - storage: WS 级总账(product_220 §4.4)——limit = Σ 全来源池
 *       (ws_base 底池 + 订阅贡献 + 加油包),used = Σ 各产品 gauge 水位切片,
 *       remaining 不钳制(可为负 = 超冲,R4);
 *     - aiCredit: 池明细(来源/额度/本期已用/剩余/周期/效期,懒重置周期感知
 *       视图与 C2 同口径)+ 共享策略参与产品;
 *     - products: 按产品的池明细(产品级指标 + 平台指标贡献)+ 存储切片。
 *
 * 读侧 SQL 归 @vxture/service-subscription 的 MeteringReadService(console 批 3
 * 下沉,X5);这里只做权限门与视图映射。全页无 UUID 出口——产品用 product_code
 * 可视标识。
 */

import {
  Body,
  Controller,
  BadRequestException,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import {
  AddonService,
  MeteringReadService,
} from "@vxture/service-subscription";
import type {
  AddonPurchaseRecord,
  QuotaPoolRow,
} from "@vxture/service-subscription";
import {
  buildPaymentChannels,
  type PaymentChannelInfo,
} from "../lib/payment-channels";
import type { RequestContext } from "../types/console.types";
import { auditCustomerAction } from "../audit/audit-log";
import { RequireCapability } from "../auth/capability";

// Inline the DI token (repo-wide pattern): SubscriptionModule provides the pool.
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

// ============================================================================
// View types (mirrored by portals/console/src/api/console-bff.ts)
// ============================================================================

export interface QuotaPoolView {
  metric: string;
  /** subscription / manual_override / ws_base / addon_purchase */
  source: string;
  /** NULL = WS 级池(底池/加油包,不属任何产品) */
  productCode: string | null;
  productName: string | null;
  limit: number;
  /** 周期感知已用(懒重置视图:周期已翻篇按 0 计,与 C2 同口径) */
  used: number;
  /** 池内剩余,钳 0(总账层的负剩余由 storage.remaining 表达) */
  remaining: number;
  resetPeriod: string;
  expiresAt: string | null;
}

export interface StorageSliceView {
  productCode: string;
  productName: string;
  usedBytes: number;
  observedAt: string;
}

export interface ProductQuotaView {
  productCode: string;
  productName: string;
  metrics: {
    metric: string;
    limit: number;
    used: number;
    remaining: number;
    resetPeriod: string;
  }[];
  /** 该产品上报的存储水位切片;未上报为 null */
  storageUsedBytes: number | null;
}

export interface ConsoleQuotaOverview {
  storage: {
    limitBytes: number;
    usedBytes: number;
    /** 不钳制:负值 = 超冲(R4,产品侧准入自愈) */
    remainingBytes: number;
    sources: QuotaPoolView[];
    slices: StorageSliceView[];
  };
  aiCredit: {
    limit: number;
    used: number;
    remaining: number;
    pools: QuotaPoolView[];
    /** ai.credit 共享策略参与产品(默认共享 = 系统预置策略行,可后台调整) */
    sharingProducts: { productCode: string; productName: string }[];
  };
  products: ProductQuotaView[];
}

// ============================================================================
// QuotaRouter
// ============================================================================

// 付款时效(分钟):与订阅单同口径(个人 30 / 组织 2880,env 可调,product_321 P4)。
const envMinutes = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : fallback;
};
const paymentTtlMinutesFor = (
  tenantType: "personal" | "organization" | undefined,
): number =>
  tenantType === "organization"
    ? envMinutes("ORDER_PAYMENT_TTL_MINUTES_ORG", 2880)
    : envMinutes("ORDER_PAYMENT_TTL_MINUTES", 30);

const PACK_CODE_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const ORDER_NO_RE = /^ORD-\d{6}-[0-9A-F]{10}$/;

export interface AddonPackView {
  packCode: string;
  packName: string;
  metricKey: string;
  amount: number;
  validityDays: number;
  price: string;
  currency: string;
}

export interface AddonOrderView {
  orderNo: string;
  billNo: string | null;
  packCode: string;
  packName: string;
  metricKey: string;
  amount: number;
  price: string;
  currency: string;
  status: "pending_payment" | "completed" | "cancelled";
  validityDays: number;
  /** 已申报待运营确认 */
  paymentDeclared: boolean;
  /** 未申报待支付单的付款截止(ISO);其余为 null */
  expireAt: string | null;
  activatedAt: string | null;
  /** 权益有效期至(= 开通 + validity_days) */
  validUntil: string | null;
  createdAt: string;
}

/**
 * 订单视图。付款截止 = 建单 + TTL;行上没记 TTL 时按**租户类型**回退(个人 30 /
 * 组织 2880),不再一律 30 分钟——审计 P0 #12:组织租户的旧单被画成「半小时后
 * 关闭」,而后台清扫按 2880 算。
 */
function mapAddonOrder(
  r: AddonPurchaseRecord,
  fallbackTtlMinutes: number,
): AddonOrderView {
  const expireAt =
    r.status === "pending_payment" && !r.paymentDeclared
      ? new Date(
          r.createdAt.getTime() +
            (r.paymentTtlMinutes ?? fallbackTtlMinutes) * 60_000,
        ).toISOString()
      : null;
  const validUntil = r.activatedAt
    ? new Date(
        r.activatedAt.getTime() + r.validityDays * 86_400_000,
      ).toISOString()
    : null;
  return {
    orderNo: r.orderNo,
    billNo: r.billNo,
    packCode: r.packCode,
    packName: r.packName,
    metricKey: r.metricKey,
    amount: Number(r.amount),
    price: r.price,
    currency: r.currency,
    status: r.status,
    validityDays: r.validityDays,
    paymentDeclared: r.paymentDeclared,
    expireAt,
    activatedAt: r.activatedAt ? r.activatedAt.toISOString() : null,
    validUntil,
    createdAt: r.createdAt.toISOString(),
  };
}

@RequireCapability("tenant.quota.read")
@Controller("api/quota")
export class QuotaRouter {
  constructor(
    /** 仅供租户审计写钩子(support.audit_logs INSERT,fire-and-forget)。 */
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(AddonService) private readonly addons: AddonService,
    @Inject(MeteringReadService)
    private readonly metering: MeteringReadService,
  ) {}

  // --------------------------------------------------------------------------
  // 加油包(自助购买闭环,owner 2026-08-20):目录 / 我的订单 / 下单 / 申报 / 取消
  // --------------------------------------------------------------------------

  @Get("addon-packs")
  async listAddonPacks(): Promise<AddonPackView[]> {
    const packs = await this.addons.listPacks();
    return packs.map((p) => ({
      packCode: p.packCode,
      packName: p.packName,
      metricKey: p.metricKey,
      amount: Number(p.amount),
      validityDays: p.validityDays,
      price: p.price,
      currency: p.currency,
    }));
  }

  @RequireCapability("tenant.billing.read")
  @Get("addon-orders")
  async listAddonOrders(
    @Req() req: Request & RequestContext,
  ): Promise<AddonOrderView[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);
    const rows = await this.addons.listPurchases(workspaceId);
    const ttl = paymentTtlMinutesFor(req.tenant.tenantType);
    return rows.map((r) => mapAddonOrder(r, ttl));
  }

  @RequireCapability("tenant.payment.manage")
  @Post("addon-orders")
  async createAddonOrder(
    @Req() req: Request & RequestContext,
    @Body() body: { packCode?: unknown },
  ): Promise<{ order: AddonOrderView; paymentChannels: PaymentChannelInfo[] }> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.user) throw new UnauthorizedException("No active session");
    const packCode = typeof body.packCode === "string" ? body.packCode : "";
    if (!PACK_CODE_RE.test(packCode)) {
      throw new BadRequestException("packCode 非法");
    }
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);
    const record = await this.addons.createOrder({
      tenantId: req.tenant.id,
      workspaceId,
      packCode,
      createdBy: req.user.id,
      paymentTtlMinutes: paymentTtlMinutesFor(req.tenant.tenantType),
    });
    auditCustomerAction(this.pool, req, {
      action: "addon.order.create",
      resourceType: "addon_order",
      resourceId: record.orderNo,
      after: { pack: record.packCode, price: record.price },
    });
    return {
      order: mapAddonOrder(record, paymentTtlMinutesFor(req.tenant.tenantType)),
      paymentChannels: buildPaymentChannels(record.orderNo),
    };
  }

  /** 加油包订单详情(支付页 /quotas/addon-pay/[orderNo] 数据源)。 */
  @RequireCapability("tenant.billing.read")
  @Get("addon-orders/:orderNo")
  async getAddonOrder(
    @Req() req: Request & RequestContext,
    @Param("orderNo") orderNo: string,
  ): Promise<{ order: AddonOrderView; paymentChannels: PaymentChannelInfo[] }> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!ORDER_NO_RE.test(orderNo)) throw new BadRequestException("订单号非法");
    const record = await this.addons.getByOrderNo(orderNo);
    if (!record || record.tenantId !== req.tenant.id) {
      throw new BadRequestException("加油包订单不存在");
    }
    return {
      order: mapAddonOrder(record, paymentTtlMinutesFor(req.tenant.tenantType)),
      paymentChannels: buildPaymentChannels(record.orderNo),
    };
  }

  /** 线下转账收款信息(渠道配置随 env;reference = 订单号,汇款附言用)。 */
  @RequireCapability("tenant.billing.read")
  @Get("addon-orders/:orderNo/payment-channels")
  async getAddonPaymentChannels(
    @Req() req: Request & RequestContext,
    @Param("orderNo") orderNo: string,
  ): Promise<PaymentChannelInfo[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!ORDER_NO_RE.test(orderNo)) throw new BadRequestException("订单号非法");
    return buildPaymentChannels(orderNo);
  }

  @RequireCapability("tenant.payment.manage")
  @Post("addon-orders/:orderNo/payment-declare")
  async declareAddonPayment(
    @Req() req: Request & RequestContext,
    @Param("orderNo") orderNo: string,
    @Body()
    body: { payerName?: unknown; transactionNo?: unknown; remark?: unknown },
  ): Promise<{ ok: true }> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!ORDER_NO_RE.test(orderNo)) throw new BadRequestException("订单号非法");
    const str = (v: unknown, max: number): string | undefined =>
      typeof v === "string" && v.trim() !== ""
        ? v.trim().slice(0, max)
        : undefined;
    await this.addons.declarePayment({
      tenantId: req.tenant.id,
      orderNo,
      payChannel: "bank",
      ...(str(body.payerName, 64)
        ? { payerName: str(body.payerName, 64)! }
        : {}),
      ...(str(body.transactionNo, 64)
        ? { transactionNo: str(body.transactionNo, 64)! }
        : {}),
      ...(str(body.remark, 256) ? { remark: str(body.remark, 256)! } : {}),
      actorId: req.user.id,
    });
    auditCustomerAction(this.pool, req, {
      action: "addon.order.payment_declare",
      resourceType: "addon_order",
      resourceId: orderNo,
    });
    return { ok: true };
  }

  @RequireCapability("tenant.payment.manage")
  @Post("addon-orders/:orderNo/cancel")
  async cancelAddonOrder(
    @Req() req: Request & RequestContext,
    @Param("orderNo") orderNo: string,
  ): Promise<{ ok: true }> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!ORDER_NO_RE.test(orderNo)) throw new BadRequestException("订单号非法");
    await this.addons.cancelOrder({
      orderNo,
      tenantId: req.tenant.id,
      reason: "customer cancelled",
    });
    auditCustomerAction(this.pool, req, {
      action: "addon.order.cancel",
      resourceType: "addon_order",
      resourceId: orderNo,
    });
    return { ok: true };
  }

  @Get("overview")
  async getOverview(
    @Req() req: Request & RequestContext,
  ): Promise<ConsoleQuotaOverview> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);

    const { pools, gauges, sharing } =
      await this.metering.getQuotaOverviewRows(workspaceId);

    const toView = (r: QuotaPoolRow): QuotaPoolView => ({
      metric: r.metricKey,
      source: r.poolSource,
      productCode: r.productCode,
      productName: r.productName,
      limit: r.quotaLimit,
      used: r.effectiveUsed,
      remaining: Math.max(0, r.quotaLimit - r.effectiveUsed),
      resetPeriod: r.resetPeriod,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    });

    // ── storage: WS 总账(gauge — used 来自水位切片,池的 used 无意义) ────────
    const storagePools = pools
      .filter((r) => r.metricKey === "storage.bytes")
      .map(toView);
    const storageSlices = gauges
      .filter((r) => r.metricKey === "storage.bytes")
      .map((r) => ({
        productCode: r.productCode,
        productName: r.productName,
        usedBytes: r.value,
        observedAt: r.observedAt.toISOString(),
      }));
    const storageLimit = storagePools.reduce((s, p) => s + p.limit, 0);
    const storageUsed = storageSlices.reduce((s, g) => s + g.usedBytes, 0);

    // ── ai.credit: 池明细 + 共享参与 ─────────────────────────────────────────
    const creditPools = pools
      .filter((r) => r.metricKey === "ai.credit")
      .map(toView);
    const creditLimit = creditPools.reduce((s, p) => s + p.limit, 0);
    const creditUsed = creditPools.reduce((s, p) => s + p.used, 0);
    const sharingProducts = sharing
      .filter((r) => r.metricKey === "ai.credit")
      .map((r) => ({
        productCode: r.productCode,
        productName: r.productName,
      }));

    // ── products: 按产品聚合池明细 + 存储切片 ────────────────────────────────
    const byProduct = new Map<string, ProductQuotaView>();
    const ensureProduct = (code: string, name: string): ProductQuotaView => {
      let v = byProduct.get(code);
      if (!v) {
        v = {
          productCode: code,
          productName: name,
          metrics: [],
          storageUsedBytes: null,
        };
        byProduct.set(code, v);
      }
      return v;
    };
    for (const r of pools) {
      if (!r.productCode) continue; // WS 级池不属任何产品
      const view = toView(r);
      ensureProduct(r.productCode, r.productName ?? r.productCode).metrics.push(
        {
          metric: view.metric,
          limit: view.limit,
          used: view.used,
          remaining: view.remaining,
          resetPeriod: view.resetPeriod,
        },
      );
    }
    for (const g of storageSlices) {
      ensureProduct(g.productCode, g.productName).storageUsedBytes =
        g.usedBytes;
    }

    return {
      storage: {
        limitBytes: storageLimit,
        usedBytes: storageUsed,
        remainingBytes: storageLimit - storageUsed,
        sources: storagePools,
        slices: storageSlices,
      },
      aiCredit: {
        limit: creditLimit,
        used: creditUsed,
        remaining: creditPools.reduce((s, p) => s + p.remaining, 0),
        pools: creditPools,
        sharingProducts,
      },
      products: [...byProduct.values()].sort((a, b) =>
        a.productCode.localeCompare(b.productCode),
      ),
    };
  }

  private async resolveDefaultWorkspace(tenantId: string): Promise<string> {
    const id = await this.metering.findDefaultWorkspaceId(tenantId);
    if (!id) throw new BadRequestException("租户缺少默认工作空间");
    return id;
  }
}
