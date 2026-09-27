-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-19-product-maintenance-windows.sql
-- 产品级维护窗口：窗口挂产品、产品在窗口进行中「升级维护中」
--
-- ── owner 2026-09-27 裁定 ──
-- 产品级的升级 / 维护 / 迁移：**无论是否订阅**，产品进入「当前不可用」——已订阅的给时间
-- 补偿（下一步做批量暂停 / 恢复），未订阅的**暂时不能订阅**。针对单个租户的暂停是个例，
-- 机制不变。这些都是非正常暂停，不改变正常订阅流程里的判定（停售、在途订单、档位比较）。
--
-- ── 数据放哪 ──
-- 维护窗口本来就有（admin.maintenance_windows，opera 声明 / 开始 / 完成 / 取消），缺的是
-- 「哪些产品」与「产品现在是不是在维护中」：
--   · 绑定（计划）  admin.maintenance_window_products (window_id, product_id)   本迁移新建
--   · 占用（运行态）product.products.maintenance_window_id / maintenance_until  本迁移新加两列
-- 两者分开是有意的：两个 scheduled 窗口计划同一个产品合法，但同一时刻只能有一个窗口
-- **真的**占着它——占用在产品行上判（start 撞上 → 409）。读者（官网 / console 的 BFF）
-- 只看产品行那两列：window_id 非空 = 升级维护中，maintenance_until = 预计恢复；不需要
-- 任何 BFF 去读 admin schema。两列只由 opera-bff 在窗口状态转移时写。
--
-- ── 对应 DDL ──
--   40_product.sql（两列 + chk_products_maintenance_pair + 部分索引）
--   80_admin.sql（maintenance_window_products）
--   90_cross_schema_fk.sql（product_id → product.products，ON DELETE CASCADE：产品硬删时
--     绑定随之消失；不级联的话删产品会撞裸 23503）
--   98_column_locks.sql（products 的 GRANT UPDATE 加两列；新表全是主键列，只 REVOKE）
--
-- ── 权限 ──
-- 28d 在迁移之后重放 98（列级锁会跟上），但**不重放 97**。新表的表级 SELECT / INSERT /
-- DELETE 靠 97 的 ALTER DEFAULT PRIVILEGES——那条只对「执行它的那个角色所创建的对象」
-- 生效，这个前提不该靠猜，所以照 2026-11-14-product-seats 的先例**显式补授**：角色清单不
-- 手写，照 admin.maintenance_windows 现有的表级授权面逐项反推（谁能读窗口就能读绑定）。
-- 列级锁本迁移自己也锁一遍（同 product-seats 那份头注写的坑：第一次建表那一轮，98 是在
-- 本迁移之后才跑的）；活库上 products 的 GRANT 会滞后于 98 文件，所以两列的 GRANT 也在
-- 这里重放一遍，语句与 98 逐字一致。
--
-- 重复执行安全：ADD COLUMN IF NOT EXISTS / CREATE … IF NOT EXISTS / duplicate_object 吞掉 /
-- REVOKE + GRANT 天然幂等。第二遍 0 变化。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 产品行：占用两列 + 成对约束 + 部分索引（对应 40_product.sql）────────────
ALTER TABLE product.products ADD COLUMN IF NOT EXISTS maintenance_window_id uuid;
ALTER TABLE product.products ADD COLUMN IF NOT EXISTS maintenance_until     timestamptz;

COMMENT ON COLUMN product.products.maintenance_window_id IS
  '进行中的维护窗口 id（admin.maintenance_windows；跨 schema 不建 FK）。非空 = 产品升级维护中。只由 opera-bff 在窗口状态转移时写。';
COMMENT ON COLUMN product.products.maintenance_until IS
  '该窗口的计划结束时间（窗口 end_at，运营顺延时同步改）= 预计恢复时间。与 maintenance_window_id 同空同非空。';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_products_maintenance_pair'
       AND conrelid = 'product.products'::regclass
  ) THEN
    ALTER TABLE product.products ADD CONSTRAINT chk_products_maintenance_pair CHECK ((maintenance_window_id IS NULL) = (maintenance_until IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_maintenance_window
  ON product.products (maintenance_window_id) WHERE maintenance_window_id IS NOT NULL;

-- ── 绑定表（对应 80_admin.sql）────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin.maintenance_window_products (
    window_id   uuid NOT NULL REFERENCES admin.maintenance_windows(id) ON DELETE CASCADE,
    product_id  uuid NOT NULL,
    PRIMARY KEY (window_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_maintenance_window_products_product
  ON admin.maintenance_window_products (product_id);

-- ── 跨 schema 外键（对应 90_cross_schema_fk.sql）──────────────────────────────
DO $$ BEGIN
  ALTER TABLE admin.maintenance_window_products ADD CONSTRAINT fk_maintenance_window_products_product
    FOREIGN KEY (product_id) REFERENCES product.products(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 表级授权：照 admin.maintenance_windows 的授权面逐项反推，不手写角色清单 ────
-- 逐个权限分别照抄：platform_svc 的 UPDATE 面由 98 管（表级 REVOKE + 按列 GRANT），它在
-- maintenance_windows 上**没有**表级 UPDATE，逐项照抄自动把它排除在外。
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'admin' AND table_name = 'maintenance_windows'
       AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
       AND grantee <> current_user AND grantee <> 'PUBLIC'
  LOOP
    EXECUTE format('GRANT %s ON admin.maintenance_window_products TO %I', r.privilege_type, r.grantee);
  END LOOP;
END $$;

-- ── 列级锁：本迁移自己先锁一次（语句与 98_column_locks.sql 逐字一致）──────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    REVOKE UPDATE ON admin.maintenance_window_products FROM platform_svc;
    REVOKE UPDATE ON product.products FROM platform_svc;
    GRANT UPDATE (product_code, product_type, layer, category_id, product_name, product_nick, description, capability_keys, tags, standalone_subscribable, icon_url, sort, config, release_version, build_number, released_at, status, updated_by, description_key, is_customer_visible, is_workforce_visible, origin, origin_provider, integration_mode, release_stage, marketing, launch_override_at, launch_override_by, launch_override_pending, maintenance_window_id, maintenance_until, updated_at, deleted_at) ON product.products TO platform_svc;
  END IF;
END $$;

COMMIT;

-- ── 审计：结构与授权都在，才算跑过 ──────────────────────────────────────────
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema = 'product' AND table_name = 'products'
     AND column_name IN ('maintenance_window_id', 'maintenance_until');
  IF v <> 2 THEN
    RAISE EXCEPTION '[product-maintenance-windows] products 应有两列 maintenance_*，实为 %', v;
  END IF;

  SELECT count(*) INTO v FROM pg_constraint
   WHERE conname = 'chk_products_maintenance_pair' AND conrelid = 'product.products'::regclass;
  IF v <> 1 THEN
    RAISE EXCEPTION '[product-maintenance-windows] chk_products_maintenance_pair 缺失';
  END IF;

  IF to_regclass('admin.maintenance_window_products') IS NULL THEN
    RAISE EXCEPTION '[product-maintenance-windows] admin.maintenance_window_products 未建';
  END IF;

  SELECT count(*) INTO v FROM pg_constraint
   WHERE conname = 'fk_maintenance_window_products_product'
     AND conrelid = 'admin.maintenance_window_products'::regclass;
  IF v <> 1 THEN
    RAISE EXCEPTION '[product-maintenance-windows] fk_maintenance_window_products_product 缺失';
  END IF;

  -- 列级锁：platform_svc 在 products 两列上有 UPDATE、在绑定表上没有表级 UPDATE。
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    SELECT count(*) INTO v FROM information_schema.column_privileges
     WHERE grantee = 'platform_svc' AND privilege_type = 'UPDATE'
       AND table_schema = 'product' AND table_name = 'products'
       AND column_name IN ('maintenance_window_id', 'maintenance_until');
    IF v <> 2 THEN
      RAISE EXCEPTION '[product-maintenance-windows] platform_svc 应能 UPDATE products 的两列 maintenance_*，实为 % 列', v;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
       WHERE grantee = 'platform_svc' AND privilege_type = 'UPDATE'
         AND table_schema = 'admin' AND table_name = 'maintenance_window_products'
    ) THEN
      RAISE EXCEPTION '[product-maintenance-windows] platform_svc 不该有 maintenance_window_products 的表级 UPDATE（全列为主键）';
    END IF;
  END IF;

  RAISE NOTICE '[product-maintenance-windows] OK';
END $$;
