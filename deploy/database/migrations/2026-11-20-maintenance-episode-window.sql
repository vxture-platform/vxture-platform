-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-20-maintenance-episode-window.sql
-- 产品级维护窗口（PR B）：暂停 episode 记下「是哪一个窗口批量开的」
--
-- ── owner 2026-09-27 裁定 ──
-- 窗口进行中，该产品所有已订阅租户给时间补偿（暂停期间不计入有效期），恢复后结算；个例暂停
-- 机制不变。前置 PR A（2026-11-19）已把 product.products.maintenance_window_id / maintenance_until
-- 交给 opera-bff 在窗口 start / complete / cancel 时打标 / 清标。
--
-- ── 机制 ──
-- 批量暂停 / 恢复不在 opera-bff 的事务里做，由 platform-api 的 subscription-renewal 作业每 tick
-- 对账（第 7 趟 sweepProductMaintenance）：
--   进窗口  产品打着窗口 + 订阅在服务中 + 没有未闭合 episode → CAS 到 suspended，开一条
--           reason=platform_ops / extends_term=true / actor_type=system 的 episode，**带窗口 id**
--   出窗口  未闭合 episode 带窗口 id、而产品上已不再打着同一个窗口 id → 恢复、闭合、结算顺延
--   顺延    窗口 maintenance_until 变了 → 同窗口未闭合 episode 的 expected_resume_at 跟着改
-- 三条判据都要回答「这条 episode 是不是那个窗口开的」，所以窗口 id 得落在 episode 上：
-- 运营对单条订阅手工做的暂停（本列 NULL）不受本趟影响。
--
-- ── 数据 ──
--   metering.subscription_suspensions.maintenance_window_id uuid NULL
--     裸值→admin.maintenance_windows（跨 schema 不建 FK，边界#2，同 products 上那一列）。
--   部分索引 WHERE resumed_at IS NULL AND maintenance_window_id IS NOT NULL（出窗口 / 顺延同步的捞法）。
--   列级锁：本列**不是**锚点（与 expected_resume_at 同类，估计 / 归属可改），进 GRANT UPDATE 清单；
--   守卫 lint:column-locks 与 98 严格比对，98 同步改。actor_type 的 CHECK 已含 system（§0.1）。
--
-- ── 对应 DDL ──
--   50_metering.sql（列 + 部分索引）
--   98_column_locks.sql（subscription_suspensions 的 GRANT UPDATE 加一列）
--
-- ── 权限 ──
-- 28d 在迁移之后重放 98（列级锁会跟上），但活库上的 GRANT 会滞后于 98 文件，所以这一列的
-- GRANT 在这里也重放一遍，语句与 98 逐字一致（同 2026-11-19 的做法）。
--
-- 重复执行安全：ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / REVOKE + GRANT 天然幂等。
-- 第二遍 0 变化。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── episode 行：窗口归属列 + 部分索引（对应 50_metering.sql）────────────────
ALTER TABLE metering.subscription_suspensions ADD COLUMN IF NOT EXISTS maintenance_window_id uuid;

COMMENT ON COLUMN metering.subscription_suspensions.maintenance_window_id IS
  '产品级维护窗口批量开的 episode 记窗口 id（admin.maintenance_windows；跨 schema 不建 FK）。NULL = 个例暂停。platform-api 作业按它对账进 / 出窗口与顺延同步。';

CREATE INDEX IF NOT EXISTS idx_subscription_suspensions_maintenance_open
  ON metering.subscription_suspensions (maintenance_window_id)
  WHERE resumed_at IS NULL AND maintenance_window_id IS NOT NULL;

-- ── 列级锁：本迁移自己先锁一次（语句与 98_column_locks.sql 逐字一致）──────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    REVOKE UPDATE ON metering.subscription_suspensions FROM platform_svc;
    GRANT UPDATE (reason_note, expected_resume_at, resumed_at, granted_seconds, maintenance_window_id, updated_at) ON metering.subscription_suspensions TO platform_svc;
  END IF;
END $$;

COMMIT;

-- ── 审计：结构与授权都在，才算跑过 ──────────────────────────────────────────
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema = 'metering' AND table_name = 'subscription_suspensions'
     AND column_name = 'maintenance_window_id';
  IF v <> 1 THEN
    RAISE EXCEPTION '[maintenance-episode-window] subscription_suspensions.maintenance_window_id 缺失';
  END IF;

  IF to_regclass('metering.idx_subscription_suspensions_maintenance_open') IS NULL THEN
    RAISE EXCEPTION '[maintenance-episode-window] idx_subscription_suspensions_maintenance_open 未建';
  END IF;

  -- 列级锁：platform_svc 能 UPDATE 这一列（作业改 expected_resume_at 时同一条语句不碰它，但
  -- 归属可改是本列的设计，GRANT 必须在）。
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    SELECT count(*) INTO v FROM information_schema.column_privileges
     WHERE grantee = 'platform_svc' AND privilege_type = 'UPDATE'
       AND table_schema = 'metering' AND table_name = 'subscription_suspensions'
       AND column_name = 'maintenance_window_id';
    IF v <> 1 THEN
      RAISE EXCEPTION '[maintenance-episode-window] platform_svc 应能 UPDATE subscription_suspensions.maintenance_window_id，实为 % 列', v;
    END IF;
  END IF;

  RAISE NOTICE '[maintenance-episode-window] OK';
END $$;
