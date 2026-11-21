-- Read-only inventory for the B04 ownership cutover; never infer a personal tenant.
-- @package vxture-platform
-- @layer Infrastructure
-- @category verification
-- @author AI-Generated
-- @date 2026-11-19
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';

-- ===========================================================================
-- Tenant candidates are evidence for review, not permission to backfill.
-- ===========================================================================
SELECT v.id AS voucher_id, v.status, b.tenant_id AS batch_tenant_id,
       w.tenant_id AS workspace_tenant_id, v.assigned_tenant_id,
       CASE
         WHEN b.tenant_id IS NOT NULL AND w.tenant_id IS NOT NULL
              AND b.tenant_id <> w.tenant_id THEN 'conflicting_tenant_evidence'
         WHEN v.assigned_workspace_id IS NOT NULL AND v.assigned_user_id IS NOT NULL
              THEN 'conflicting_assignment_targets'
         WHEN v.assigned_tenant_id IS NOT NULL
              AND ((b.tenant_id IS NOT NULL AND b.tenant_id <> v.assigned_tenant_id)
                OR (w.tenant_id IS NOT NULL AND w.tenant_id <> v.assigned_tenant_id))
              THEN 'binding_scope_mismatch'
         WHEN v.assigned_tenant_id IS NULL AND coalesce(b.tenant_id, w.tenant_id) IS NOT NULL
              THEN 'deterministic_candidate_requires_validation'
         WHEN v.assigned_tenant_id IS NULL AND v.assigned_user_id IS NOT NULL
              THEN 'user_requires_explicit_tenant_selection'
         ELSE 'unbound_unassigned'
       END AS review_reason
FROM promotion.vouchers v
JOIN promotion.voucher_batches b ON b.id = v.batch_id
LEFT JOIN tenancy.workspaces w ON w.id = v.assigned_workspace_id
WHERE v.assigned_tenant_id IS NULL
   OR (b.tenant_id IS NOT NULL AND b.tenant_id <> v.assigned_tenant_id)
   OR (w.tenant_id IS NOT NULL AND w.tenant_id <> v.assigned_tenant_id)
   OR (v.assigned_workspace_id IS NOT NULL AND v.assigned_user_id IS NOT NULL)
ORDER BY v.id;

-- ===========================================================================
-- Reserved legacy vouchers: report every candidate, never choose the first.
-- JSON IDs stay text so malformed legacy payloads cannot abort this inventory.
-- ===========================================================================
SELECT v.id AS voucher_id, count(p.id) AS declaration_candidates,
       coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', p.id, 'invoice_id', i.id, 'order_id', o.id,
           'tenant_id', o.tenant_id, 'workspace_id', o.workspace_id,
           'scope_matches', p.tenant_id = o.tenant_id AND i.tenant_id = o.tenant_id
               AND (v.assigned_tenant_id IS NULL OR v.assigned_tenant_id = o.tenant_id)
               AND (b.tenant_id IS NULL OR b.tenant_id = o.tenant_id)
               AND (v.assigned_workspace_id IS NULL OR v.assigned_workspace_id = o.workspace_id)
       ) ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL), '[]') AS candidates,
       CASE WHEN count(p.id) = 1 THEN 'requires_locked_financial_validation'
            WHEN count(p.id) = 0 THEN 'missing_declaration_manual_review'
            ELSE 'multiple_declarations_manual_review' END AS review_reason
FROM promotion.vouchers v
JOIN promotion.voucher_batches b ON b.id = v.batch_id
LEFT JOIN billing.payments p
  ON p.pay_status = 'pending_verify'
 AND p.channel_raw_data->'settlement'->>'released' = 'false'
 AND (p.channel_raw_data->'settlement'->>'discountVoucherId' = v.id::text
   OR p.channel_raw_data->'settlement'->>'creditVoucherId' = v.id::text)
LEFT JOIN billing.invoices i ON i.id = p.bill_id
LEFT JOIN billing.orders o ON o.id = i.order_id
WHERE v.status = 'reserved'
  AND NOT EXISTS (SELECT 1 FROM promotion.voucher_reservations r
                  WHERE r.voucher_id = v.id AND r.status = 'active')
GROUP BY v.id, b.id
ORDER BY v.id;

-- ===========================================================================
-- Individually valid foreign keys do not prove aggregate ownership.
-- ===========================================================================
SELECT r.id AS reservation_id, r.voucher_id, r.order_id
FROM promotion.voucher_reservations r
JOIN promotion.vouchers v ON v.id = r.voucher_id
JOIN promotion.voucher_batches b ON b.id = v.batch_id
JOIN billing.orders o ON o.id = r.order_id
JOIN billing.invoices i ON i.id = r.invoice_id
JOIN tenancy.workspaces w ON w.id = r.workspace_id
LEFT JOIN billing.payments p ON p.id = r.declaration_payment_id
WHERE r.status = 'active' AND (
    r.tenant_id <> o.tenant_id OR r.workspace_id <> o.workspace_id
    OR w.tenant_id <> r.tenant_id OR i.order_id IS DISTINCT FROM o.id
    OR i.tenant_id <> r.tenant_id OR v.status <> 'reserved'
    OR v.assigned_tenant_id IS DISTINCT FROM r.tenant_id
    OR (b.tenant_id IS NOT NULL AND b.tenant_id <> r.tenant_id)
    OR (v.assigned_workspace_id IS NOT NULL AND v.assigned_workspace_id <> r.workspace_id)
    OR (r.declaration_payment_id IS NOT NULL
        AND (p.bill_id <> r.invoice_id OR p.tenant_id <> r.tenant_id)))
ORDER BY r.id;
-- ===========================================================================
-- Refund source inventory: existing refunds remain evidence, never auto-repaired.
-- B05 must lock orders and validate currency, cash legs and cumulative limits.
-- ===========================================================================
SELECT f.id AS refund_id, f.order_id, f.pay_record_id AS legacy_payment_id,
       f.refund_amount, f.refund_status, p.pay_source, p.pay_status,
       p.paid_amount AS source_paid_amount,
       CASE WHEN p.pay_source NOT IN ('online','offline') THEN 'non_cash_source_requires_manual_review'
            WHEN p.pay_status <> 'paid' THEN 'unpaid_source_requires_manual_review'
            WHEN f.refund_amount > coalesce(p.paid_amount,0) THEN 'possible_excess_requires_manual_review'
            ELSE 'source_requires_locked_allocation_validation' END AS review_reason
FROM billing.refunds f
JOIN billing.payments p ON p.id = f.pay_record_id
WHERE NOT EXISTS (SELECT 1 FROM billing.refund_allocations a WHERE a.refund_id = f.id)
ORDER BY f.id;

SELECT a.id AS allocation_id, a.refund_id, a.payment_id, 'allocation_scope_mismatch' AS review_reason
FROM billing.refund_allocations a
JOIN billing.refunds f ON f.id = a.refund_id
JOIN billing.payments p ON p.id = a.payment_id
WHERE p.pay_source NOT IN ('online','offline') OR p.tenant_id <> f.tenant_id OR p.bill_id <> f.bill_id
   OR a.currency IS DISTINCT FROM coalesce(p.currency,'CNY')
   OR a.currency IS DISTINCT FROM coalesce(f.currency,'CNY')
ORDER BY a.id;

COMMIT;
