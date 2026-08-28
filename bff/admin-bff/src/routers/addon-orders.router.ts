/**
 * addon-orders.router.ts - 加油包订单运营路由(核销)
 * @package @vxture/bff-admin
 * @layer Application
 * @category Router
 *
 * 加油包购买闭环的运营端(owner 2026-08-20 用量配额线):
 *   GET  /api/addon-orders                                — 待处理队列(已申报优先)
 *   POST /api/addon-orders/:purchaseId/offline-payment-confirm
 *        — 确认收款核销(step-up + commerce:payment.settle 危码):支付腿翻转/
 *          补插 + 流水 + 账单结清 + WS 级 quota_pool grant + 单据完结,
 *          全部在 AddonService 的单事务里;重复确认 = 安全 no-op。
 * 订单目录/定价的运营管理面(增改包/上下架)后置登记,先由 seed 预置。
 */

import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AddonService } from "@vxture/service-subscription";
import type { AddonPurchaseRecord } from "@vxture/service-subscription";
import { assertAnyCapability } from "../auth/capability";
import { RequireStepUp } from "../auth/step-up.decorator";
import { ADMIN_ADDON_SERVICE } from "../providers/commerce-services.provider";
import type { RequestContext } from "../types/console.types";

// 版本位/变体位刻意不卡：判据与理由见 governance.shared.ts 的 `UUID_RE` 注释
//（校验器不该比存储层更严；种子 id 的变体位是段值本身，如 …-4000-d000-…）。
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireOperatorId(value: string | undefined): string {
  if (!value || !UUID_RE.test(value)) {
    throw new UnauthorizedException("Invalid platform admin principal");
  }
  return value;
}

export interface AdminAddonOrderView {
  id: string;
  orderNo: string;
  billNo: string | null;
  packCode: string;
  packName: string;
  metricKey: string;
  amount: number;
  price: string;
  currency: string;
  status: string;
  /** true = 客户已申报转账,等待核销 */
  paymentDeclared: boolean;
  tenantId: string;
  createdAt: string;
  activatedAt: string | null;
}

function mapView(r: AddonPurchaseRecord): AdminAddonOrderView {
  return {
    id: r.id,
    orderNo: r.orderNo,
    billNo: r.billNo,
    packCode: r.packCode,
    packName: r.packName,
    metricKey: r.metricKey,
    amount: Number(r.amount),
    price: r.price,
    currency: r.currency,
    status: r.status,
    paymentDeclared: r.paymentDeclared,
    tenantId: r.tenantId,
    createdAt: r.createdAt.toISOString(),
    activatedAt: r.activatedAt ? r.activatedAt.toISOString() : null,
  };
}

@Controller("api/addon-orders")
export class AddonOrdersRouter {
  constructor(
    @Inject(ADMIN_ADDON_SERVICE) private readonly addons: AddonService,
  ) {}

  @Get()
  async list(
    @Req() req: Request & RequestContext,
  ): Promise<AdminAddonOrderView[]> {
    assertAnyCapability(req, ["commerce:order.read"]);
    const rows = await this.addons.listPendingOps();
    return rows.map(mapView);
  }

  @Post(":purchaseId/offline-payment-confirm")
  @RequireStepUp()
  async confirm(
    @Req() req: Request & RequestContext,
    @Param("purchaseId") purchaseId: string,
    @Body() body: { remark?: unknown },
  ): Promise<{ settled: boolean; order: AdminAddonOrderView | null }> {
    assertAnyCapability(req, ["commerce:payment.settle"]);
    const actorId = requireOperatorId(req.user?.id);
    if (!UUID_RE.test(purchaseId)) {
      throw new NotFoundException("加油包订单不存在");
    }
    const remark =
      typeof body?.remark === "string" && body.remark.trim() !== ""
        ? body.remark.trim().slice(0, 256)
        : undefined;
    const record = await this.addons.confirmPayment({
      purchaseId,
      operatorId: actorId,
      ...(remark ? { remark } : {}),
    });
    // null = 已结算(重复点击安全 no-op)
    return { settled: record != null, order: record ? mapView(record) : null };
  }
}
