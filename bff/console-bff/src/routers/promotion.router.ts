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
 *
 * ## 挂单反查(owner 2026-09-07)
 *
 * 「使用中」的券看不出押在哪张单上,客户只能干等——但 `promotion.vouchers` 上
 * **没有指向订单的列**,得从两条不同的路反查回去,因为预占与核销落的证据不是一份:
 *
 *   · **已核销**:`promotion.voucher_redemptions` 有 `payment_id`(和 `invoice_item_id`),
 *     都是真凭据,顺着 `payments.bill_id → invoices.order_id` 就到订单。
 *   · **使用中**:`reserve()` **不落核销行**(只把券置 `reserved`、`used_count+1`),
 *     唯一被持久化的线索是同事务里写进 `billing.payments.channel_raw_data` 的结算凭据
 *     `settlement.discountVoucherId / creditVoucherId`(见 subscription 域 P10)。
 *     所以这一段只能读 jsonb,不是偷懒——那里确实没有别的列可读。
 *
 * 两条路合成一条 CTE、**整页一次查完**(不按行 N+1),末了统一用 `orders.tenant_id`
 * 兜底收口:即便 jsonb 里塞了别家的 id,也跨不出本租户。出口仍是可视码 `order_no`。
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
import { RequireCapability } from "../auth/capability";

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
  /** 反查到的挂单可视码;查不到(或本就没挂单)为 null。见头注「挂单反查」。 */
  orderNo: string | null;
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
    orderNo: null, // 反查在 listVouchers 里整页一次补齐
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

@RequireCapability("tenant.billing.read")
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
    const views = rows.map(mapVoucher);
    // 只对「押着 / 用掉了」的券反查——可用与已过期的券本就没挂单,查了也是空。
    const linkable = views.filter(
      (v) => v.status === "reserved" || v.status === "redeemed",
    );
    if (linkable.length > 0) {
      const orders = await this.resolveHoldingOrders(
        req.tenant.id,
        linkable.map((v) => v.id),
      );
      for (const v of linkable) v.orderNo = orders.get(v.id) ?? null;
    }
    return views;
  }

  /**
   * 券 → 挂单可视码。两条证据路合成一条 CTE(见头注),整页一次查完。
   *
   * 同一张券可能对上多条支付(线下付款改过一次、或预占后重新申报),取**最近**的那条:
   * 客户问的是「现在押在哪」,不是历史。
   */
  private async resolveHoldingOrders(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    const res = await this.pool.query<{ voucher_id: string; order_no: string }>(
      `with linked as (
         -- ① 已核销:核销行上的真凭据(payment 优先,退回 invoice_item)
         select r.voucher_id::text as voucher_id, p.bill_id, r.redeemed_at as at
           from promotion.voucher_redemptions r
           join billing.payments p on p.id = r.payment_id
          where r.voucher_id = any($2::uuid[])
         union all
         select r.voucher_id::text as voucher_id, ii.bill_id, r.redeemed_at as at
           from promotion.voucher_redemptions r
           join billing.invoice_items ii on ii.id = r.invoice_item_id
          where r.voucher_id = any($2::uuid[]) and r.payment_id is null
         union all
         -- ② 使用中:预占不落核销行,只能读支付凭据里的结算快照
         select s.voucher_id, p.bill_id, p.created_at as at
           from billing.payments p
           cross join lateral (values
             (p.channel_raw_data -> 'settlement' ->> 'discountVoucherId'),
             (p.channel_raw_data -> 'settlement' ->> 'creditVoucherId')
           ) as s(voucher_id)
          where p.tenant_id = $1 and s.voucher_id = any($2::text[])
       )
       select distinct on (l.voucher_id) l.voucher_id, o.order_no
         from linked l
         join billing.invoices inv on inv.id = l.bill_id
         join billing.orders   o   on o.id  = inv.order_id
        where o.tenant_id = $1
        order by l.voucher_id, l.at desc`,
      [tenantId, ids],
    );
    return new Map(res.rows.map((r) => [r.voucher_id, r.order_no]));
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
