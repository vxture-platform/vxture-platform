-- Read-only adoption report. Missing paid sources require manual reconciliation.
-- @package vxture-platform
-- @layer Infrastructure
-- @category verification
-- @author AI-Generated
-- @date 2026-11-19
BEGIN READ ONLY;
SELECT b.id,b.name,b.status,b.effect,count(v.id) instances,
       count(v.id) FILTER(WHERE v.funding_payment_id IS NULL) without_payment,
       count(v.id) FILTER(WHERE v.status='redeemed') historical_redemptions
FROM promotion.voucher_batches b LEFT JOIN promotion.vouchers v ON v.batch_id=b.id
WHERE b.kind='recharge_card' GROUP BY b.id ORDER BY b.created_at,b.id;
COMMIT;
