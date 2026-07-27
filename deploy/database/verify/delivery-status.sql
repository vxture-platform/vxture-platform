-- deploy/database/verify/delivery-status.sql — poll helper for deploy/scripts/31-test-delivery.sh
SELECT status || '|' || coalesce(attempts::text, '0')
  FROM provisioning.webhook_deliveries
 WHERE id = :'delivery_id';
