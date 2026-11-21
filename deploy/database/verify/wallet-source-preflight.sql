-- Read-only wallet adoption report; unknown balances require manual provenance.
-- @package vxture-platform
-- @layer Infrastructure
-- @category verification
-- @author AI-Generated
-- @date 2026-11-19
BEGIN READ ONLY;
SELECT c.id,c.tenant_id,c.currency,c.balance,c.version,
       CASE WHEN c.balance=0 THEN 'zero_balance_can_activate'
            ELSE 'manual_source_reconciliation_required' END AS adoption_status,
       count(t.id) FILTER(WHERE t.balance_before<>t.balance_after) AS balance_postings,
       count(t.id) FILTER(WHERE t.trade_type='recharge' AND t.balance_before=t.balance_after) AS cash_receipts_not_wallet_deposits
  FROM billing.credits c LEFT JOIN billing.transactions t ON t.tenant_id=c.tenant_id
 GROUP BY c.id ORDER BY c.tenant_id;
COMMIT;
