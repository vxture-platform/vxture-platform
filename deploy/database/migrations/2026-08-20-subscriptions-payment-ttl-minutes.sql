-- [product_330 P2-e] 旧列 metering.subscriptions.order_no 已删（2026-09-06）；本文件只在旧列仍在时重放，否则整体跳过（psql \if）。
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'metering' AND table_name = 'subscriptions' AND column_name = 'order_no') AS has_legacy_order_no \gset
\if :has_legacy_order_no

-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — metering.subscriptions 加 payment_ttl_minutes（按租户类型的付款时效）
--
-- 依据：docs/30-design/product_321_order-payment-and-settlement.md P4 修订
-- （2026-08-20）：付款 TTL 按租户类型定格——个人 30 分钟、组织 2880 分钟（48 小时），
-- 下单时由 console-bff 依 req.tenant.tenantType 计算并写入本列。P4 原有语义不变：
-- 锚点仍是 GREATEST(created_at, 最近 payment_rejected 历史)，驳回自动重锚、申报冻结
-- 时钟；本列只替换公式里的"全局 env TTL"为"每单 TTL"。
--
-- 不在 50-release-resequencing.md 的 R 序列内——独立小步前向迁移，与应用发布的
-- 顺序约束：**须在携带本特性的应用版本之前执行**（旧代码不读不写本列，无感）。
-- 回滚：不需要。列可空、无默认值，读取端对 NULL 回退 env ORDER_PAYMENT_TTL_MINUTES，
-- 存量行为逐字不变。
--
-- 幂等：整份可重跑。列用 IF NOT EXISTS；约束用 DO 块按 pg_constraint 判重。
--
-- 用法（生产，以 owner 身份）：
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <本文件>
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① 列（与 50_metering.sql 的定义逐字一致） ───────────────────────────────

ALTER TABLE metering.subscriptions
  ADD COLUMN IF NOT EXISTS payment_ttl_minutes int;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'metering.subscriptions'::regclass
      AND conname = 'chk_subscriptions_payment_ttl'
  ) THEN
    ALTER TABLE metering.subscriptions
      ADD CONSTRAINT chk_subscriptions_payment_ttl
      CHECK (payment_ttl_minutes IS NULL OR payment_ttl_minutes >= 1);
  END IF;
END $$;

-- ── ② 列锁同步（98_column_locks.sql 的对应一条） ────────────────────────────
--
-- 漏了不会报错，只会写不进去——platform_svc 对未授权列的写入被拒。
-- INSERT 权限是表级的不受影响；这里只补 UPDATE 白名单（与 98 生成规则一致：
-- 本列非锚点列）。

REVOKE UPDATE ON metering.subscriptions FROM platform_svc;
GRANT UPDATE (tenant_id, workspace_id, plan_version_id, subscription_kind, cycle_unit, cycle_count, start_at, end_at, trial_end_at, had_trial_at, status, auto_renew, activation_method, next_renewal_at, renewal_source, payment_mandate_id, payment_ttl_minutes, pay_amount, currency, created_by_type, created_by_id, updated_at, deleted_at) ON metering.subscriptions TO platform_svc;

COMMIT;

-- ── 核对（执行后跑一遍，不要只看"没报错"）─────────────────────────────────
--
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema='metering' AND table_name='subscriptions'
--      AND column_name='payment_ttl_minutes';
--   -- 期望 1 行 integer
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid='metering.subscriptions'::regclass
--      AND conname='chk_subscriptions_payment_ttl';
--   -- 期望 1 行

\endif
