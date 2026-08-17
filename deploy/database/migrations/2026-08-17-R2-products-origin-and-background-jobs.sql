-- ═══════════════════════════════════════════════════════════════════════════
-- R2 前向迁移 — product.products 加来源轴 + 建 provisioning.background_jobs
--
-- 依据：docs/70-workplan/50-release-resequencing.md 的 R2。生产（v0.20.19）与 main 的
-- DDL 差距**逐条比对后只有这两项，且都是加法**，所以这不是一次重建，是一次几十行的
-- 前向迁移，零停机。其余四项（perm_name 64→128 ×2、subscriptions CHECK 加 expiring、
-- voucher_redemptions.redemption_no）生产早就有了——那几处 DDL 改动是在追平现实。
--
-- **必须在 R3 之前执行**：R3 的应用代码会读这两处。
-- **回滚**：不需要。加的列有默认值、加的表没人读，旧代码对它们无感。
--
-- 幂等：整份可重跑。列用 IF NOT EXISTS；约束没有 IF NOT EXISTS 语法，用 DO 块按
-- pg_constraint 判重（不是 EXCEPTION 兜底——兜底会把"约束名撞了但定义不同"也吞掉）。
--
-- 用法（生产，以 owner 身份）：
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <本文件>
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① product.products 的来源轴 ────────────────────────────────────────────
--
-- 与 40_product.sql 的定义逐字一致。`DEFAULT 'self'` 让存量 6 行自动回填成"自建"，
-- 这正是它们的实际含义——生产上这张表今天只有自建产品。

ALTER TABLE product.products
  ADD COLUMN IF NOT EXISTS origin varchar(16) NOT NULL DEFAULT 'self';

ALTER TABLE product.products
  ADD COLUMN IF NOT EXISTS origin_provider varchar(128);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'product.products'::regclass AND conname = 'chk_products_origin'
  ) THEN
    ALTER TABLE product.products
      ADD CONSTRAINT chk_products_origin
      CHECK (origin IN ('self','third_party','other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'product.products'::regclass
      AND conname = 'chk_products_origin_provider'
  ) THEN
    -- origin='self' 时留空；third_party 时必填（公司/团队名，不是 product_code）。
    ALTER TABLE product.products
      ADD CONSTRAINT chk_products_origin_provider
      CHECK (origin <> 'third_party' OR origin_provider IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_origin ON product.products (origin);

-- ── ② provisioning.background_jobs ─────────────────────────────────────────
--
-- 后台任务心跳。platform-api 四个 @Interval 作业（provisioning-dispatch /
-- sharing-expiry / trial-expiry / order-payment-expiry）各占一行、每 tick 原地
-- UPSERT——不是逐 tick 追加的执行日志：最短 10s 一跳，日志化一天就是数万条噪音行。
--
-- 落在 provisioning 而非语义更贴的 admin：宿主 platform-api 没有 admin schema 的库
-- 权限（97_service_roles.sql），边界不为一张表破例。
-- job_name 是自然主键（进程内常量，不经用户输入）。

CREATE TABLE IF NOT EXISTS provisioning.background_jobs (
    job_name              varchar(64)   PRIMARY KEY,
    status                varchar(16)   NOT NULL DEFAULT 'idle',
    interval_ms           int,
    last_started_at       timestamptz,
    last_finished_at      timestamptz,
    last_duration_ms      int,
    last_items_processed  int,
    last_error            varchar(1024),
    run_count             bigint        NOT NULL DEFAULT 0,
    failure_count         bigint        NOT NULL DEFAULT 0,
    updated_at            timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_background_jobs_status CHECK (status IN ('idle','running','success','failed')),
    CONSTRAINT chk_background_jobs_run_count CHECK (run_count >= 0),
    CONSTRAINT chk_background_jobs_failure_count CHECK (failure_count >= 0)
);

-- ── ③ 权限：新表的 GRANT，以及两处列锁同步 ─────────────────────────────────
--
-- `GRANT ... ON ALL TABLES IN SCHEMA`（97_service_roles.sql）只对**执行那一刻已存在**
-- 的表生效，新建表靠的是同文件里的 ALTER DEFAULT PRIVILEGES。这里显式再授一次：
-- 默认权限只对"设置它的那个角色所建的表"生效，而这份迁移是不是由同一角色执行，
-- 取决于当时用的连接——不确定的事就写死，代价是一行冗余。

GRANT SELECT, INSERT, UPDATE, DELETE ON provisioning.background_jobs TO platform_svc;

-- 列锁（98_column_locks.sql 的对应两条）。漏了不会报错，只会**写不进去**——
-- platform_svc 对未授权列的 UPDATE 被拒，新列会一直停在默认值。

REVOKE UPDATE ON product.products FROM platform_svc;
GRANT UPDATE (product_code, product_type, category_id, product_name, product_nick, description, capability_keys, tags, standalone_subscribable, icon_url, sort, config, release_version, build_number, released_at, status, updated_by, description_key, is_customer_visible, is_workforce_visible, origin, origin_provider, updated_at, deleted_at) ON product.products TO platform_svc;

REVOKE UPDATE ON provisioning.background_jobs FROM platform_svc;
GRANT UPDATE (status, interval_ms, last_started_at, last_finished_at, last_duration_ms, last_items_processed, last_error, run_count, failure_count, updated_at) ON provisioning.background_jobs TO platform_svc;

COMMIT;

-- ── 核对（执行后跑一遍，不要只看"没报错"）─────────────────────────────────
--
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_schema='product' AND table_name='products'
--      AND column_name IN ('origin','origin_provider');
--   -- 期望 2 行，origin 的 default 是 'self'::character varying
--
--   SELECT origin, count(*) FROM product.products GROUP BY origin;
--   -- 期望 self | 6
--
--   SELECT to_regclass('provisioning.background_jobs');
--   -- 期望非 NULL
