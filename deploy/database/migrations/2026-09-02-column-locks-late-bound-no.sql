-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 列级锁放行"晚绑定 `_no`"列（98_column_locks.sql 规则②' 例外）
--
-- 依据：owner 2026-09-02 生产实测。admin 确认收款事务对 billing.invoices 的 UPDATE
-- 里列了 transaction_no（`_no` 锚点列，platform_svc 无 UPDATE 权限）→ 42501 整条回滚，
-- 界面 Internal server error。开发库以 owner 连库，列锁对 owner 无效，从没炸过。
--
-- 处置分两半：
--   · invoices.transaction_no：**不放行**。流水↔账单的关联在 transactions.bill_id，
--     写侧改为不回写、读侧派生（同一提交的代码改动），列保持锚点。
--   · 同类但真需要 UPDATE 写一次的单号——发票快递单号 / 电子发票号（寄出/开具时才有值）、
--     网关单号（回调时才有值）——列入 LATE_BOUND_WRITABLE 例外，本迁移把它们 GRANT 给
--     platform_svc。清单权威在 scripts/guardrails/column-locks.shared.mjs，98 与本文件
--     与之一致。
--
-- 幂等：GRANT 可重复执行。只加权限，不收回任何既有授权。
-- 之后 db-init action=migrate 的 28c 会把 vx_ddl_baseline 重签到含本次 98 改动的 DDL。
--
-- 用法（生产，以 owner 身份）：
--   CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
--   或 psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <本文件>
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT UPDATE (invoice_electronic_no, express_no)
  ON billing.invoice_receipts TO platform_svc;

GRANT UPDATE (channel_order_no, channel_transaction_no)
  ON billing.payments TO platform_svc;

-- 开票抬头的纳税人识别号是客户可编辑的资料字段（不是系统签发的码），`_no` 后缀撞上
-- 规则②的形状判据；改抬头的 UPDATE 同样会 42501（守卫 check-anchor-writes 扫出）。
GRANT UPDATE (tax_no)
  ON billing.billing_addresses TO platform_svc;

-- 断言：五列对 platform_svc 均可 UPDATE。
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c, ', ' ORDER BY c)
    INTO missing
    FROM unnest(ARRAY[
      'billing.invoice_receipts.invoice_electronic_no',
      'billing.invoice_receipts.express_no',
      'billing.payments.channel_order_no',
      'billing.payments.channel_transaction_no',
      'billing.billing_addresses.tax_no'
    ]) AS c
   WHERE NOT has_column_privilege(
     'platform_svc',
     split_part(c, '.', 1) || '.' || split_part(c, '.', 2),
     split_part(c, '.', 3),
     'UPDATE'
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '[column-locks-late-bound] still not writable by platform_svc: %', missing;
  END IF;
  RAISE NOTICE '[column-locks-late-bound] 5 writable _no exception columns confirmed for platform_svc';
END $$;

COMMIT;
