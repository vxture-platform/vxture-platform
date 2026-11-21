/**
 * customer-voucher-ledger.ts - Scoped, filtered and paginated customer voucher ledger.
 * @package @vxture/service-promotion
 * @layer Domain
 * @category repository
 * @author AI-Generated
 * @date 2026-11-19
 */
import { BadRequestException } from "@nestjs/common";
import type { Pool } from "pg";
import type {
  TenantVoucherRecord,
  VoucherScope,
} from "../types/promotion.types";
import { mapTenantVoucherRow } from "./pg-promotion.repository";
import { assertVoucherClaimScope } from "../management/pg-voucher-claims";

export interface CustomerVoucherQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  query?: string;
  sort?: "code" | "expires" | "usedAt";
  direction?: "asc" | "desc";
}
export interface CustomerVoucherRecord extends TenantVoucherRecord {
  holderScope: "user" | "workspace" | "tenant";
  holderLabel: string;
  claimedAt: Date | null;
  returnPolicy: "none" | "full_reversal_only";
  orderNo: string | null;
  unavailableReason: string | null;
}
type LedgerRow = Parameters<typeof mapTenantVoucherRow>[0] & {
  availability_status: TenantVoucherRecord["availabilityStatus"];
  holder_scope: CustomerVoucherRecord["holderScope"];
  holder_label: string;
  claimed_at: Date | null;
  return_policy: CustomerVoucherRecord["returnPolicy"];
  order_no: string | null;
};

// ===========================================================================
// Stable SQL state precedence mirrors the legacy row mapper, then adds gates.
// ===========================================================================
const STATES = [
  "available",
  "reserved",
  "redeemed",
  "expired",
  "revoked",
  "not_started",
  "paused",
  "archived",
  "unavailable",
];
const SOURCE = `with owned as (
  select v.id,v.code,b.kind,b.name batch_name,b.effect,v.status,v.used_count,v.max_uses,
    b.status batch_status,b.valid_from,b.valid_until,v.expires_at,v.redeemed_at,
    r.redeemed_at last_redeemed_at,r.redemption_no,v.claimed_at,v.created_at,
    least(coalesce(v.expires_at,b.valid_until),b.valid_until) effective_expiry,
    case when v.assigned_user_id is not null then 'user' when v.assigned_workspace_id is not null then 'workspace' else 'tenant' end holder_scope,
    case when v.assigned_workspace_id is not null then w.name else t.name end holder_label,
    case when b.policy_snapshot->>'return_policy'='full_reversal_only' then 'full_reversal_only' else 'none' end return_policy,
    o.order_no,
    case when v.status in ('redeemed','revoked','reserved') then v.status
      when v.status='expired' or now()>=least(coalesce(v.expires_at,b.valid_until),b.valid_until) then 'expired'
      when now()<b.valid_from then 'not_started'
      when b.status in ('paused','archived') then b.status
      when v.status<>'assigned' or b.status<>'active' or v.max_uses<>1 or v.used_count>=v.max_uses
        or (b.kind='invite' and v.assigned_user_id is null and v.assigned_workspace_id is null)
        or b.kind not in ('discount','credit_voucher','invite','redemption','extension','recharge_card')
        or (b.effect->'effect_version' is not null and b.effect->'effect_version'<>'1'::jsonb)
        or (b.effect->>'currency' is not null and b.effect->>'currency'<>'CNY')
        or b.effect ? 'min_user_level' or b.effect ? 'applicable_plan_ids' then 'unavailable'
      when b.kind='credit_voucher' and not(case when jsonb_typeof(b.effect->'amount_cents')='number' then
        (b.effect->>'amount_cents')::numeric>0 and (b.effect->>'amount_cents')::numeric<=9007199254740991 and trunc((b.effect->>'amount_cents')::numeric)=(b.effect->>'amount_cents')::numeric else false end) then 'unavailable'
      when b.kind='discount' and not(coalesce(case when jsonb_typeof(b.effect->'value')='number' then
        ((b.effect->>'discount_type'='percent' and (b.effect->>'value')::numeric between 0 and 100)
          or (b.effect->>'discount_type'='fixed' and (b.effect->>'value')::numeric between 0 and 9007199254740991 and trunc((b.effect->>'value')::numeric)=(b.effect->>'value')::numeric))
        and (b.effect->'max_off_cents' is null or b.effect->'max_off_cents'='null'::jsonb or
          case when jsonb_typeof(b.effect->'max_off_cents')='number' then (b.effect->>'max_off_cents')::numeric between 0 and 9007199254740991 and trunc((b.effect->>'max_off_cents')::numeric)=(b.effect->>'max_off_cents')::numeric else false end)
        else false end,false)) then 'unavailable'
      when b.kind='redemption' and (
        v.funding_order_id is not null or v.funding_payment_id is not null or
        b.effect->>'funding_source' is distinct from 'operator_grant'
        or (b.effect - array['effect_version','currency','plan_version_id','duration_days','funding_source'])<>'{}'::jsonb
        or not(case when jsonb_typeof(b.effect->'duration_days')='number' then (b.effect->>'duration_days')::numeric between 1 and 3650 and trunc((b.effect->>'duration_days')::numeric)=(b.effect->>'duration_days')::numeric else false end)
        or not exists(select 1 from product.plan_versions rv join product.plans rp on rp.id=rv.plan_id
          join product.plan_components rc on rc.plan_version_id=rv.id and rc.component_role='primary'
          where rv.id::text=b.effect->>'plan_version_id' and rv.status='published' and rv.is_locked and rp.status='active' and rp.deleted_at is null
            and not exists(select 1 from product.plan_components cc join product.products cp on cp.id=cc.product_id where cc.plan_version_id=rv.id and (cp.status<>'active' or cp.deleted_at is not null or cp.release_stage not in ('beta','stable') or cp.maintenance_window_id is not null))
            and not exists(select 1 from metering.subscriptions s where s.workspace_id=$3 and s.product_id=rc.product_id and s.deleted_at is null and s.status in ('active','trialing','expiring','overdue','suspended'))
            and not exists(select 1 from billing.orders ro where ro.workspace_id=$3 and ro.product_id=rc.product_id and ro.status in ('pending_payment','pending_verify','paid')))
      ) then 'unavailable'
      when b.kind='extension' and (
        v.funding_order_id is not null or v.funding_payment_id is not null
        or (b.effect - array['effect_version','currency','extend_days','applicable_product_codes'])<>'{}'::jsonb
        or not(case when jsonb_typeof(b.effect->'extend_days')='number' then (b.effect->>'extend_days')::numeric between 1 and 3650 and trunc((b.effect->>'extend_days')::numeric)=(b.effect->>'extend_days')::numeric else false end)
        or not(case when b.effect->'applicable_product_codes' is null then true when jsonb_typeof(b.effect->'applicable_product_codes')='array' then
          jsonb_array_length(b.effect->'applicable_product_codes') between 1 and 100
          and not exists(select 1 from jsonb_array_elements(b.effect->'applicable_product_codes') allowed_code(value) where jsonb_typeof(allowed_code.value)<>'string' or (allowed_code.value#>>'{}')!~'^[a-zA-Z0-9_-]{1,128}$')
          and (select count(distinct allowed_code.value) from jsonb_array_elements(b.effect->'applicable_product_codes') allowed_code(value))=jsonb_array_length(b.effect->'applicable_product_codes') else false end)
        or not exists(select 1 from metering.subscriptions s join product.products pr on pr.id=s.product_id
          where s.tenant_id=$1 and s.workspace_id=$3 and s.deleted_at is null and s.status in ('active','expiring','overdue')
            and s.subscription_kind<>'trial' and s.end_at is not null and s.cycle_unit<>'perpetual'
            and (b.effect->'applicable_product_codes' is null or b.effect->'applicable_product_codes' @> to_jsonb(pr.product_code))
            and not exists(select 1 from metering.subscription_suspensions su where su.subscription_id=s.id and su.resumed_at is null)
            and not exists(select 1 from billing.orders eo where eo.workspace_id=s.workspace_id and eo.product_id=s.product_id and eo.status in ('pending_payment','pending_verify','paid'))
            and not exists(select 1 from product.plan_components cc join product.products cp on cp.id=cc.product_id where cc.plan_version_id=s.plan_version_id and (cp.status<>'active' or cp.deleted_at is not null or cp.release_stage not in ('beta','stable') or cp.maintenance_window_id is not null)))
      ) then 'unavailable'
      when b.kind='recharge_card' and (
        v.funding_order_id is not null
        or (b.effect-array['effect_version','currency','face_value_cents','bonus_cents','bonus_expires_in_days'])<>'{}'::jsonb
        or not(case when jsonb_typeof(b.effect->'face_value_cents')='number' and jsonb_typeof(b.effect->'bonus_cents')='number' then
          (b.effect->>'face_value_cents')::numeric>=0 and (b.effect->>'bonus_cents')::numeric>=0
          and trunc((b.effect->>'face_value_cents')::numeric)=(b.effect->>'face_value_cents')::numeric
          and trunc((b.effect->>'bonus_cents')::numeric)=(b.effect->>'bonus_cents')::numeric
          and (b.effect->>'face_value_cents')::numeric+(b.effect->>'bonus_cents')::numeric between 1 and 999999999999 else false end)
        or not(case when b.effect->'bonus_expires_in_days' is null then true when jsonb_typeof(b.effect->'bonus_expires_in_days')='number' then
          (b.effect->>'bonus_cents')::numeric>0 and (b.effect->>'bonus_expires_in_days')::numeric between 1 and 3650
          and trunc((b.effect->>'bonus_expires_in_days')::numeric)=(b.effect->>'bonus_expires_in_days')::numeric else false end)
        or not(case when jsonb_typeof(b.effect->'face_value_cents')='number' then case when (b.effect->>'face_value_cents')::numeric=0 then v.funding_payment_id is null
          else exists(select from billing.wallet_card_allocations a join billing.payments p on p.id=a.payment_id where a.voucher_id=v.id and a.status='reserved' and a.payment_id=v.funding_payment_id and a.amount*100=(b.effect->>'face_value_cents')::numeric and p.tenant_id=$1) end else false end)
        or exists(select from billing.credits c where c.tenant_id=$1 and (c.currency<>'CNY' or
          (c.balance<>0 and not exists(select from billing.wallet_accounts wa where wa.credit_id=c.id)) or
          c.balance<>(select coalesce(sum(e.amount),0) from billing.wallet_entries e join billing.wallet_lots l on l.id=e.lot_id where l.credit_id=c.id)))
      ) then 'unavailable'
      when b.kind='invite' and not exists(select 1 from product.plans ip join product.plan_versions iv on iv.plan_id=ip.id
        where ip.status='active' and ip.deleted_at is null and not ip.is_public and iv.status='published'
          and (coalesce(b.effect->>'plan_version_id',b.effect->>'planVersionId') is null or iv.id::text=coalesce(b.effect->>'plan_version_id',b.effect->>'planVersionId'))
          and (coalesce(b.effect->>'plan_code',b.effect->>'planCode') is null or ip.plan_code=coalesce(b.effect->>'plan_code',b.effect->>'planCode'))
          and (coalesce(b.effect->>'plan_version_id',b.effect->>'planVersionId',b.effect->>'plan_code',b.effect->>'planCode') is not null)
          and (b.effect->>'plan_version_id' is null or b.effect->>'planVersionId' is null or b.effect->>'plan_version_id'=b.effect->>'planVersionId')
          and (b.effect->>'plan_code' is null or b.effect->>'planCode' is null or b.effect->>'plan_code'=b.effect->>'planCode')) then 'unavailable'
      else 'available' end availability_status
  from promotion.vouchers v join promotion.voucher_batches b on b.id=v.batch_id
  join tenancy.tenants t on t.id=$1 left join tenancy.workspaces w on w.id=v.assigned_workspace_id
  left join lateral(select vr.redeemed_at,vr.redemption_no,coalesce(vr.order_id,inv.order_id) order_id
    from promotion.voucher_redemptions vr
    left join billing.payments p on p.id=vr.payment_id
    left join billing.invoice_items ii on ii.id=vr.invoice_item_id
    left join billing.invoices inv on inv.id=coalesce(p.bill_id,ii.bill_id)
    where vr.voucher_id=v.id and vr.tenant_id=$1 order by vr.redeemed_at desc,vr.id desc limit 1) r on true
  left join lateral(select rs.order_id from promotion.voucher_reservations rs
    where rs.voucher_id=v.id and rs.status='active' and v.status='reserved' order by rs.reserved_at desc,rs.id desc limit 1) hold on true
  left join lateral(select inv.order_id from billing.payments p join billing.invoices inv on inv.id=p.bill_id
    where v.status='reserved' and hold.order_id is null and p.tenant_id=$1 and p.pay_status='pending_verify'
      and coalesce(p.channel_raw_data#>>'{settlement,released}','false')='false'
      and (p.channel_raw_data#>>'{settlement,discountVoucherId}'=v.id::text or p.channel_raw_data#>>'{settlement,creditVoucherId}'=v.id::text)
    order by p.created_at desc,p.id desc limit 1) legacy on true
  left join billing.orders o on o.id=case when v.status='reserved' then coalesce(hold.order_id,legacy.order_id) when v.status='redeemed' then r.order_id end and o.tenant_id=$1
  where v.status<>'issued' and (v.claim_key_version is null or v.claimed_at is not null) and (v.claimed_at is not null or v.assigned_tenant_id is not null or v.assigned_user_id is not null or v.assigned_workspace_id is not null or b.tenant_id is not null)
    and (b.tenant_id is null or b.tenant_id=$1)
    and (v.assigned_tenant_id=$1 or (v.assigned_tenant_id is null and (b.tenant_id=$1 or v.assigned_workspace_id=$3)))
    and (v.assigned_user_id is null or v.assigned_user_id=$2)
    and (v.assigned_workspace_id is null or v.assigned_workspace_id=$3)
), filtered as(select * from owned where ($4='all' or availability_status=$4)
  and ($5='' or position(lower($5) in lower(code||' '||batch_name||' '||coalesce(order_no,'')))>0))`;

// ===========================================================================
// A single database snapshot supplies both summaries and the selected page.
// ===========================================================================
export class PgCustomerVoucherLedger {
  constructor(private readonly pool: Pool) {}
  /** Read a complete ledger page. @param scope - Verified session context. @param input - Bounded filters and stable ordering. @returns Page, counts and global metrics. @throws {BadRequestException} For invalid pagination or filters. */
  async page(scope: VoucherScope, input: CustomerVoucherQuery = {}) {
    if (input.query !== undefined && typeof input.query !== "string")
      throw new BadRequestException("卡券搜索参数非法");
    const page = input.page ?? 1,
      pageSize = input.pageSize ?? 20,
      status = input.status ?? "available",
      query = input.query?.trim() ?? "";
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1_000_000 ||
      ![10, 20, 50, 100].includes(pageSize) ||
      (!STATES.includes(status) && status !== "all") ||
      query.length > 200 ||
      (input.sort && !["code", "expires", "usedAt"].includes(input.sort)) ||
      (input.direction && !["asc", "desc"].includes(input.direction))
    )
      throw new BadRequestException("卡券筛选或分页参数非法");
    const sort =
      input.sort === "code"
        ? "code"
        : input.sort === "usedAt"
          ? "coalesce(last_redeemed_at,redeemed_at)"
          : "effective_expiry";
    const direction = input.direction === "desc" ? "desc" : "asc";
    const client = await this.pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      await assertVoucherClaimScope(client, scope);
      const values = [
        scope.tenantId,
        scope.userId,
        scope.workspaceId,
        status,
        query,
      ];
      const counts = (
        await client.query<{
          total: string;
          owned: string;
          available: string;
          redeemed: string;
          expiring_soon: string;
        }>(
          `${SOURCE}
        select (select count(*) from filtered) total,count(*) owned,
          count(*) filter(where availability_status='available') available,
          count(*) filter(where availability_status='redeemed') redeemed,
          count(*) filter(where availability_status='available' and effective_expiry<now()+interval '7 days') expiring_soon from owned`,
          values,
        )
      ).rows[0]!;
      const rows = (
        await client.query<LedgerRow>(
          `${SOURCE} select * from filtered order by ${sort} ${direction} nulls last,id asc limit $6 offset $7`,
          [...values, pageSize, (page - 1) * pageSize],
        )
      ).rows;
      await client.query("commit");
      return {
        items: rows.map(
          (r): CustomerVoucherRecord => ({
            ...mapTenantVoucherRow(r, new Date()),
            availabilityStatus: r.availability_status,
            holderScope: r.holder_scope,
            holderLabel: r.holder_label,
            claimedAt: r.claimed_at,
            returnPolicy: r.return_policy,
            orderNo: r.order_no,
            unavailableReason:
              r.availability_status === "unavailable"
                ? "unsupported_or_ineligible"
                : null,
          }),
        ),
        total: Number(counts.total),
        page,
        pageSize,
        summary: {
          total: Number(counts.owned),
          available: Number(counts.available),
          redeemed: Number(counts.redeemed),
          expiringSoon: Number(counts.expiring_soon),
        },
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
