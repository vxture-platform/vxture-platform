-- voucher-migration-legacy.sql - Legacy balances, cards and a verified cash receipt.
-- @package vxture-platform
-- @layer Infrastructure
-- @category test-fixture
-- @author AI-Generated
-- @date 2026-11-19
-- Loaded only before B02/B10/B11 into the rehearsal's generated database.

-- ===========================================================================
-- Historical balances are intentionally unclassified; migration must preserve them.
-- ===========================================================================
INSERT INTO tenancy.tenants (id,name,type,owner_user_id) VALUES
 ('00000000-0000-4000-8000-000000000100','B13 zero balance','organization','00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000101','B13 negative balance','organization','00000000-0000-4000-8000-000000000001');
INSERT INTO billing.credits (id,tenant_id,balance,total_granted,total_consumed,version) VALUES
 ('00000000-0000-4000-8000-000000000110','00000000-0000-4000-8000-000000000002',75,75,0,2),
 ('00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000100',0,0,0,0),
 ('00000000-0000-4000-8000-000000000112','00000000-0000-4000-8000-000000000101',-5,0,5,1);
INSERT INTO billing.transactions
 (id,tenant_id,transaction_no,trade_type,source_method,amount,balance_before,balance_after,actor_type)
VALUES
 ('00000000-0000-4000-8000-000000000130','00000000-0000-4000-8000-000000000002','TXN-B13-LEGACY-GRANT','grant','operator',25,0,25,'system'),
 ('00000000-0000-4000-8000-000000000131','00000000-0000-4000-8000-000000000002','TXN-B13-LEGACY-CARD','recharge','recharge_card',50,25,75,'system');

-- ===========================================================================
-- Unfunded historical cards remain evidence for manual review, not new allocations.
-- ===========================================================================
INSERT INTO promotion.voucher_batches
 (id,tenant_id,kind,name,effect,total_count,issued_count,valid_from,valid_until)
VALUES ('00000000-0000-4000-8000-000000000120','00000000-0000-4000-8000-000000000002',
 'recharge_card','B13 legacy cards','{"face_value_cents":5000,"bonus_cents":0}',3,3,'2026-01-01','2030-01-01');
INSERT INTO promotion.vouchers (id,batch_id,code,status,used_count,assigned_user_id) VALUES
 ('00000000-0000-4000-8000-000000000121','00000000-0000-4000-8000-000000000120','B13-OLD-ISSUED','issued',0,'00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000122','00000000-0000-4000-8000-000000000120','B13-OLD-REDEEMED','redeemed',1,'00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000123','00000000-0000-4000-8000-000000000120','B13-OLD-REVOKED','revoked',0,'00000000-0000-4000-8000-000000000001');
INSERT INTO promotion.voucher_redemptions
 (id,redemption_no,voucher_id,tenant_id,workspace_id,user_id,kind,effect_snapshot,transaction_id)
VALUES ('00000000-0000-4000-8000-000000000124','VR-B13-LEGACY',
 '00000000-0000-4000-8000-000000000122','00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001',
 'recharge_card','{"face_value_cents":5000,"bonus_cents":0}','00000000-0000-4000-8000-000000000131');

-- ===========================================================================
-- Cash collection does not change the wallet balance or imply a historical deposit.
-- ===========================================================================
INSERT INTO billing.invoices
 (id,tenant_id,bill_no,bill_type,bill_status,bill_cycle,cycle_start_date,cycle_end_date,
  total_amount,payable_amount,paid_amount,created_by_type)
VALUES ('00000000-0000-4000-8000-000000000140','00000000-0000-4000-8000-000000000100',
 'INV-B13-CASH','one_off','paid','202611','2026-11-01','2026-12-01',100,100,100,'customer');
INSERT INTO billing.transactions
 (id,tenant_id,bill_id,transaction_no,trade_type,source_method,amount,balance_before,balance_after,actor_type)
VALUES ('00000000-0000-4000-8000-000000000141','00000000-0000-4000-8000-000000000100',
 '00000000-0000-4000-8000-000000000140','TXN-B13-CASH','recharge','offline',100,0,0,'system');
INSERT INTO billing.payments
 (id,tenant_id,bill_id,transaction_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status,paid_at)
VALUES ('00000000-0000-4000-8000-000000000142','00000000-0000-4000-8000-000000000100',
 '00000000-0000-4000-8000-000000000140','00000000-0000-4000-8000-000000000141',
 'PAY-B13-CASH','offline',100,100,'paid','2026-11-19T00:00:00Z');

-- ===========================================================================
-- An anonymized legacy wallet payment remains non-cash evidence after upgrade.
-- ===========================================================================
INSERT INTO tenancy.tenants (id,name,type,owner_user_id) VALUES
 ('00000000-0000-4000-8000-000000100150','S05 legacy wallet','organization','00000000-0000-4000-8000-000000000001');
INSERT INTO billing.credits (id,tenant_id,balance,total_granted,total_consumed,version) VALUES
 ('00000000-0000-4000-8000-000000100151','00000000-0000-4000-8000-000000100150',532.62,533.62,1,2);
INSERT INTO billing.invoices
 (id,tenant_id,bill_no,bill_type,bill_status,bill_cycle,cycle_start_date,cycle_end_date,
  total_amount,payable_amount,paid_amount,created_by_type)
VALUES ('00000000-0000-4000-8000-000000100152','00000000-0000-4000-8000-000000100150',
 'INV-S05-BALANCE','one_off','paid','202611','2026-11-01','2026-12-01',1,1,1,'customer');
INSERT INTO billing.transactions
 (id,tenant_id,bill_id,transaction_no,trade_type,amount,balance_before,balance_after,actor_type)
VALUES
 ('00000000-0000-4000-8000-000000100153','00000000-0000-4000-8000-000000100150',NULL,
  'TXN-S05-LEGACY-GRANT','grant',533.62,0,533.62,'customer'),
 ('00000000-0000-4000-8000-000000100154','00000000-0000-4000-8000-000000100150',
  '00000000-0000-4000-8000-000000100152','TXN-S05-LEGACY-CONSUME','consume',-1,533.62,532.62,'customer');
INSERT INTO billing.payments
 (id,tenant_id,bill_id,transaction_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status,paid_at)
VALUES ('00000000-0000-4000-8000-000000100155','00000000-0000-4000-8000-000000100150',
 '00000000-0000-4000-8000-000000100152','00000000-0000-4000-8000-000000100154',
 'PAY-S05-BALANCE','balance',1,1,'paid','2026-11-11T16:49:05Z');
