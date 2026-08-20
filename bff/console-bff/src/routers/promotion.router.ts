/**
 * promotion.router.ts - 租户卡券路由
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * 「我的卡券」页(owner 2026-08-21 P0)读侧:
 *   GET /api/promotion/vouchers — 当前租户视角的卡券台账(全 kind/全状态;
 *   归属 = 定向租户批次 ∨ 定向本人 ∨ 定向默认工作空间,P7 同构谓词;
 *   过期为读侧派生,展示口径与支付页可用清单一致)。
 * 金额换算在本层出口(effect 里一律整数分 → 元字符串),全页无 UUID 出口
 * (券以 code 可视码标识;voucherId 仅作行 key 不展示)。
 */

import {
  Controller,
  BadRequestException,
  Get,
  Inject,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { PromotionService, centsToYuan } from "@vxture/service-promotion";
import type { TenantVoucherRecord } from "@vxture/service-promotion";
import type { RequestContext } from "../types/console.types";

// Inline the DI token (repo-wide pattern): SubscriptionModule provides the pool.
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

export interface ConsoleVoucherView {
  /** 行 key(不展示) */
  id: string;
  /** 券码(可视码) */
  code: string;
  kind: string;
  batchName: string;
  /** discount 专用 */
  discountType?: "percent" | "fixed";
  discountValue?: number;
  maxOff?: string | null;
  /** credit_voucher / recharge_card 面值(元字符串) */
  amount?: string;
  status: "available" | "reserved" | "redeemed" | "expired" | "revoked";
  usedCount: number;
  maxUses: number;
  expiresAt: string;
  redeemedAt: string | null;
  redemptionNo: string | null;
}

function mapVoucher(r: TenantVoucherRecord): ConsoleVoucherView {
  const view: ConsoleVoucherView = {
    id: r.voucherId,
    code: r.code,
    kind: r.kind,
    batchName: r.batchName,
    status: r.displayStatus,
    usedCount: r.usedCount,
    maxUses: r.maxUses,
    expiresAt: r.expiresAt.toISOString(),
    redeemedAt: r.redeemedAt ? r.redeemedAt.toISOString() : null,
    redemptionNo: r.redemptionNo,
  };
  if (r.kind === "discount") {
    const t = r.effect["discountType"];
    const v = r.effect["value"];
    const cap = r.effect["maxOffCents"];
    if (t === "percent" || t === "fixed") view.discountType = t;
    if (typeof v === "number") {
      view.discountValue = t === "fixed" ? Number(centsToYuan(v)) : v;
    }
    view.maxOff = typeof cap === "number" ? centsToYuan(cap) : null;
  } else {
    const cents = r.effect["amountCents"];
    if (typeof cents === "number") view.amount = centsToYuan(cents);
  }
  return view;
}

@Controller("api/promotion")
export class PromotionRouter {
  constructor(
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(PromotionService) private readonly promotion: PromotionService,
  ) {}

  @Get("vouchers")
  async listVouchers(
    @Req() req: Request & RequestContext,
  ): Promise<ConsoleVoucherView[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.user) throw new UnauthorizedException("No active session");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);
    const rows = await this.promotion.listTenantVouchers({
      tenantId: req.tenant.id,
      workspaceId,
      userId: req.user.id,
    });
    return rows.map(mapVoucher);
  }

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
}
