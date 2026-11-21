/**
 * voucher-management.read.ts - Operator batch detail and paginated audit views.
 * @package @vxture/bff-admin
 * @layer Application
 * @category query
 * @author AI-Generated
 * @date 2026-11-19
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";

interface BatchDetailRow {
  revision: string;
  id: string;
  name: string;
  kind: string;
  status: string;
  tenantId: string | null;
  codePrefix: string | null;
  effect: Record<string, unknown>;
  totalCount: number;
  issuedCount: number;
  perUserLimit: number;
  perWorkspaceLimit: number | null;
  perTenantLimit: number | null;
  validFrom: Date;
  validUntil: Date;
  claimUntil: Date | null;
  useValidDays: number | null;
  returnPolicy: string;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  frozenAt: Date | null;
  compensationBatch: boolean;
  claimedCount: number;
  reservedCount: number;
  redeemedCount: number;
  revokedCount: number;
  expiredCount: number;
}
interface BudgetRequestRow {
  id: string;
  requestedBy: string;
  totalCount: number;
  reason: string;
}
interface InstanceRow {
  id: string;
  code: string;
  status: string;
  tenantId: string | null;
  userId: string | null;
  workspaceId: string | null;
  claimedAt: Date | null;
  expiresAt: Date;
  reservedOrderId: string | null;
  redeemedOrderId: string | null;
  redemptionNo: string | null;
  paymentId: string | null;
  invoiceItemId: string | null;
  subscriptionId: string | null;
  walletTransactions: string[];
  fundingPaymentNo: string | null;
  fundingStatus: string | null;
}
interface AuditEventRow {
  id: string;
  eventType: string;
  actorRealm: string;
  actorId: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  voucherId: string | null;
  orderId: string | null;
  createdAt: Date;
  operationId: string;
  operationType: string;
  actorName: string;
}

// ===========================================================================
// Paging and identity validation
// ===========================================================================
const PAGE_SIZE = 20;
function batchId(id: string): string {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    throw new BadRequestException("batchId 非法");
  return id;
}
function pageNumber(page = "1"): number {
  const value = Number(page);
  if (
    !/^\d+$/.test(page) ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 1_000_000
  )
    throw new BadRequestException("page 非法");
  return value;
}

// ===========================================================================
// Read-only views; credentials and financial source secrets are never selected.
// ===========================================================================
/** Read economic configuration and lifetime counts. @param pool - Read pool. @param id - Batch identity. @returns Operator detail. @throws {NotFoundException} When absent. */
export async function readVoucherBatch(pool: Pool, id: string) {
  batchId(id);
  const row = (
    await pool.query<BatchDetailRow>(
      `select b.id,b.name,b.kind,b.status,extract(epoch from b.updated_at)::text revision,b.tenant_id as "tenantId",b.code_prefix as "codePrefix",b.effect,
    b.total_count as "totalCount",b.issued_count as "issuedCount",b.per_user_limit as "perUserLimit",
    b.per_workspace_limit as "perWorkspaceLimit",b.per_tenant_limit as "perTenantLimit",b.valid_from as "validFrom",b.valid_until as "validUntil",
    b.claim_until as "claimUntil",b.use_valid_days as "useValidDays",coalesce(b.policy_snapshot->>'return_policy','none') as "returnPolicy",
    b.created_by as "createdBy",b.reviewed_by as "reviewedBy",b.reviewed_at as "reviewedAt",b.frozen_at as "frozenAt",
    coalesce((b.policy_snapshot->>'compensation_batch')::boolean,false) as "compensationBatch",
    c.* from promotion.voucher_batches b left join lateral (select
      count(*) filter(where v.claimed_at is not null or v.assigned_user_id is not null or v.assigned_workspace_id is not null or (v.status in ('assigned','reserved','redeemed') and b.tenant_id is not null))::int as "claimedCount",
      count(*) filter(where v.status='reserved')::int as "reservedCount",
      count(*) filter(where v.status='redeemed')::int as "redeemedCount",
      count(*) filter(where v.status='revoked')::int as "revokedCount",
      count(*) filter(where v.status='expired' or (v.status in ('issued','assigned') and least(v.expires_at,b.valid_until)<=now()))::int as "expiredCount"
      from promotion.vouchers v where v.batch_id=b.id) c on true where b.id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new NotFoundException("批次不存在");
  const pending = (
    await pool.query<BudgetRequestRow>(
      `select o.id,o.actor_id as "requestedBy",o.result->'totalCount' as "totalCount",e.reason
    from promotion.voucher_operations o left join promotion.voucher_events e on e.operation_id=o.id
    where o.batch_id=$1 and o.operation_type='batch_request_budget' and not exists
      (select 1 from promotion.voucher_operations a where a.batch_id=o.batch_id and a.operation_type='batch_approve_budget' and a.result->>'requestOperationId'=o.id::text)
      and (o.result->>'previousTotal')::int=$2 order by o.created_at desc,o.id`,
      [id, row.totalCount],
    )
  ).rows;
  return { ...row, pendingBudgetRequests: pending };
}

/** Page instances with exact reservation and redemption destinations. @param pool - Read pool. @param id - Batch identity. @param page - One-based page. @returns Bounded page and total. */
export async function readVoucherInstances(
  pool: Pool,
  id: string,
  page?: string,
) {
  batchId(id);
  const current = pageNumber(page);
  const total = Number(
    (
      await pool.query<{ n: number }>(
        "select count(*)::int n from promotion.vouchers where batch_id=$1",
        [id],
      )
    ).rows[0]?.n ?? 0,
  );
  const items = (
    await pool.query<InstanceRow>(
      `select v.id,v.code,v.status,v.assigned_tenant_id as "tenantId",v.assigned_user_id as "userId",
    v.assigned_workspace_id as "workspaceId",v.claimed_at as "claimedAt",least(v.expires_at,b.valid_until) as "expiresAt",
    r.order_id as "reservedOrderId",d.order_id as "redeemedOrderId",d.redemption_no as "redemptionNo",
    d.payment_id as "paymentId",d.invoice_item_id as "invoiceItemId",d.subscription_id as "subscriptionId",
    array(select tx.transaction_no from billing.wallet_operations wo join billing.transactions tx on tx.id=wo.transaction_id where wo.id in (d.principal_wallet_operation_id,d.bonus_wallet_operation_id) order by tx.transaction_no) as "walletTransactions",
    fp.pay_order_no as "fundingPaymentNo",a.status as "fundingStatus"
    from promotion.vouchers v join promotion.voucher_batches b on b.id=v.batch_id
    left join billing.wallet_card_allocations a on a.voucher_id=v.id
    left join billing.payments fp on fp.id=a.payment_id
    left join promotion.voucher_reservations r on r.voucher_id=v.id and r.status='active'
    left join lateral (select * from promotion.voucher_redemptions x where x.voucher_id=v.id order by x.redeemed_at desc,x.id desc limit 1) d on true
    where v.batch_id=$1 order by v.created_at desc,v.id desc limit $2 offset $3`,
      [id, PAGE_SIZE, (current - 1) * PAGE_SIZE],
    )
  ).rows;
  return { items, total, page: current, pageSize: PAGE_SIZE };
}

/** Page append-only events. @param pool - Read pool. @param id - Batch identity. @param page - One-based page. @returns Stable audit page. */
export async function readVoucherEvents(pool: Pool, id: string, page?: string) {
  batchId(id);
  const current = pageNumber(page);
  const total = Number(
    (
      await pool.query<{ n: number }>(
        "select count(*)::int n from promotion.voucher_events where batch_id=$1",
        [id],
      )
    ).rows[0]?.n ?? 0,
  );
  const items = (
    await pool.query<AuditEventRow>(
      `select e.id,e.event_type as "eventType",e.actor_realm as "actorRealm",e.actor_id as "actorId",e.reason,e.metadata,
    e.voucher_id as "voucherId",e.order_id as "orderId",e.created_at as "createdAt",e.operation_id as "operationId",
    o.operation_type as "operationType",coalesce(a.display_name,e.actor_realm) as "actorName"
    from promotion.voucher_events e join promotion.voucher_operations o on o.id=e.operation_id
    left join admin.operator_account a on e.actor_realm='operator' and a.id=e.actor_id
    where e.batch_id=$1 order by e.created_at desc,e.id desc limit $2 offset $3`,
      [id, PAGE_SIZE, (current - 1) * PAGE_SIZE],
    )
  ).rows;
  return { items, total, page: current, pageSize: PAGE_SIZE };
}
