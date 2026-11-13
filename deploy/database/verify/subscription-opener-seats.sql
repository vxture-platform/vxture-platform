-- Read-only identity and capacity report before customer-opener repair.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category verification
-- @author AI-Generated
-- @date 2026-11-13
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT s.id AS subscription_id, s.workspace_id, p.product_code,
       s.created_by_type, s.created_by_id, u.account,
       (s.created_by_type = 'customer' AND u.status = 'active' AND u.deleted_at IS NULL
        AND tm.status = 'active' AND wm.status = 'active'
        AND t.status = 'active' AND t.deleted_at IS NULL
        AND w.status = 'active' AND w.deleted_at IS NULL) IS TRUE AS eligible_opener,
       metering.resolve_seat_max(s.workspace_id, pc.product_id) AS seat_max,
       (SELECT count(*) FROM metering.product_seats ps
        WHERE ps.workspace_id=s.workspace_id AND ps.product_id=pc.product_id
          AND ps.revoked_at IS NULL) AS occupied,
       EXISTS (SELECT 1 FROM metering.product_seats ps
        WHERE ps.workspace_id=s.workspace_id AND ps.product_id=pc.product_id
          AND ps.user_id=s.created_by_id AND ps.revoked_at IS NULL) AS opener_assigned,
       EXISTS (SELECT 1 FROM metering.product_seats ps
        WHERE ps.subscription_id=s.id AND ps.product_id=pc.product_id
          AND ps.user_id=s.created_by_id AND ps.revoked_by IS NOT NULL) AS explicitly_revoked
FROM metering.subscriptions s
JOIN product.plan_components pc ON pc.plan_version_id=s.plan_version_id
JOIN product.products p ON p.id=pc.product_id AND p.deleted_at IS NULL
JOIN tenancy.tenants t ON t.id=s.tenant_id
JOIN tenancy.workspaces w ON w.id=s.workspace_id AND w.tenant_id=t.id
LEFT JOIN account.users u ON u.id=s.created_by_id AND s.created_by_type='customer'
LEFT JOIN tenancy.tenant_memberships tm ON tm.tenant_id=t.id AND tm.user_id=u.id
LEFT JOIN tenancy.workspace_memberships wm ON wm.workspace_id=w.id AND wm.user_id=u.id
WHERE s.deleted_at IS NULL AND s.status IN ('active','trialing','expiring','overdue')
ORDER BY s.workspace_id,s.id,p.product_code;
ROLLBACK;
