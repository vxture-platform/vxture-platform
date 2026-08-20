-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 用量配额线基础（owner 裁定 2026-08-20）：
--   ① metering.quota_pools：product_id 可空（NULL = WS 级池）+ pool_source 值域
--      扩 'ws_base'/'addon_purchase' + 配套 CHECK 重写（product_220 §4.4 目标态：
--      存储归 workspace，底量/加油包不属任何产品）；
--   ② metering.usage_events：加 end_user_id（终端用户归因，裸 UUID 边界#2 不建
--      FK；NULL = 未归集用户容错桶）+ 部分索引 + 列锁同步；
--   ③ 共享策略回填：存量活跃 ai.credit 贡献产品全部写入
--      metering.resource_sharing_policies（默认共享 = 策略行；引擎安全默认
--      「空 = 全保留」不动，租户后期可删行退出——product_220 §4.3）。
-- 不在 50-release-resequencing.md 的 R 序列内——独立小步前向迁移。
-- 与应用发布的顺序约束：**须在携带本特性的应用版本之前执行**（旧代码不写
-- end_user_id / 不建 WS 级池，对新列新值域无感；新代码写 end_user_id 需列已在）。
-- ws_base 池本体不在此回填——platform-api 的 ws-base-pool sweep Job 上线后
-- 60 秒内自愈补齐全部存量 workspace（幂等，含新增 workspace）。
-- 回滚：不需要。列可空无默认值；值域扩展纯增；策略行可按 created_by_type='system'
--   且本迁移时间窗删除。
-- 幂等：整份可重跑。列用 IF NOT EXISTS；约束用 DO 块按 pg_constraint 判重；
--   策略回填 ON CONFLICT DO NOTHING。
-- 用法（生产，以 owner 身份）：
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <本文件>
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① quota_pools：WS 级池支持（与 50_metering.sql 的定义逐字一致）────────────
ALTER TABLE metering.quota_pools ALTER COLUMN product_id DROP NOT NULL;

DO $$
BEGIN
  -- pool_source 值域扩展（drop+add：CHECK 无法原地改）
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'metering.quota_pools'::regclass
      AND conname = 'chk_quota_pools_pool_source'
      AND pg_get_constraintdef(oid) NOT LIKE '%ws_base%'
  ) THEN
    ALTER TABLE metering.quota_pools DROP CONSTRAINT chk_quota_pools_pool_source;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'metering.quota_pools'::regclass
      AND conname = 'chk_quota_pools_pool_source'
  ) THEN
    ALTER TABLE metering.quota_pools ADD CONSTRAINT chk_quota_pools_pool_source
      CHECK (pool_source IN ('subscription','manual_override','ws_base','addon_purchase'));
  END IF;

  -- source_sub 重写：仅 subscription 型强制挂 subscription_id
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'metering.quota_pools'::regclass
      AND conname = 'chk_quota_pools_source_sub'
      AND pg_get_constraintdef(oid) LIKE '%manual_override%'
  ) THEN
    ALTER TABLE metering.quota_pools DROP CONSTRAINT chk_quota_pools_source_sub;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'metering.quota_pools'::regclass
      AND conname = 'chk_quota_pools_source_sub'
  ) THEN
    ALTER TABLE metering.quota_pools ADD CONSTRAINT chk_quota_pools_source_sub
      CHECK (pool_source <> 'subscription' OR subscription_id IS NOT NULL);
  END IF;

  -- 仅 WS 级来源允许无产品归属
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'metering.quota_pools'::regclass
      AND conname = 'chk_quota_pools_ws_level'
  ) THEN
    ALTER TABLE metering.quota_pools ADD CONSTRAINT chk_quota_pools_ws_level
      CHECK (product_id IS NOT NULL OR pool_source IN ('ws_base','addon_purchase'));
  END IF;
END $$;

-- ── ② usage_events：终端用户归因列（分区父表加列，子分区自动继承）────────────
ALTER TABLE metering.usage_events
  ADD COLUMN IF NOT EXISTS end_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_usage_events_end_user
  ON metering.usage_events (workspace_id, end_user_id)
  WHERE end_user_id IS NOT NULL;

-- 列锁同步（98_column_locks.sql 的对应一条；INSERT 是表级权限不受影响）
REVOKE UPDATE ON metering.usage_events FROM platform_svc;
GRANT UPDATE (workspace_id, product_id, metric_key, total_amount, requested_amount, idempotency_key, request_id, end_user_id) ON metering.usage_events TO platform_svc;

-- ── ③ 共享策略回填：存量活跃 ai.credit 贡献产品默认参与共享──────────────────
-- 与 materializeQuotaPools 的增量写入同构（新订阅由代码路径覆盖，此处只补存量）。
INSERT INTO metering.resource_sharing_policies
  (workspace_id, tenant_id, metric_key, product_id, created_by_type, created_at)
SELECT DISTINCT qp.workspace_id, w.tenant_id, 'ai.credit', qp.product_id, 'system', now()
  FROM metering.quota_pools qp
  JOIN tenancy.workspaces w ON w.id = qp.workspace_id
 WHERE qp.metric_key = 'ai.credit'
   AND qp.status = 'active'
   AND qp.product_id IS NOT NULL
   AND qp.subscription_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM metering.subscriptions ts
                WHERE ts.id = qp.subscription_id
                  AND ts.status IN ('active','trialing')
                  AND ts.deleted_at IS NULL)
ON CONFLICT (workspace_id, metric_key, product_id) DO NOTHING;

COMMIT;

-- ── 核对（执行后跑一遍，不要只看"没报错"）─────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='metering' AND table_name='usage_events' AND column_name='end_user_id';
--   -- 期望 1 行
--   SELECT is_nullable FROM information_schema.columns
--    WHERE table_schema='metering' AND table_name='quota_pools' AND column_name='product_id';
--   -- 期望 YES
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='metering.quota_pools'::regclass AND conname='chk_quota_pools_pool_source';
--   -- 期望含 ws_base 与 addon_purchase
--   SELECT count(*) FROM metering.resource_sharing_policies WHERE metric_key='ai.credit';
--   -- 期望 ≥ 活跃 ai.credit 贡献 (workspace, product) 组合数
