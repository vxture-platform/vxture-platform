-- ═══════════════════════════════════════════════════════════════════════════
-- 计量项命名搬到「键」上（owner 2026-09-22：「更高维度的统一，产品要复用」）。
--
-- ── 上一次落点落错了 ──
-- 2026-10-16 把 `display_name` / `description` 直接加在 `product_metrics` 与
-- `platform_metrics` 两张表上，等于让中文名成了「(产品, 键)」的属性。而
-- `member.max`、`retention.days` 这类通用键每接一个产品就会被再命名一遍，同一个键
-- 在不同产品下各有各的叫法——正是 owner 说的没统一。
--
-- 中文名是**键的属性**。所以新建 `product.metric_catalog`（key → 中文名/说明），
-- 两张表都按 metric_key 读它，删掉那两列。
--
-- ── 为什么不是把通用键上提到 platform_metrics ──
-- `platform_metrics` 的语义是「有成本的共享池」（现存六条全是 ai.credit /
-- compute.* / storage.bytes / *gress.bytes 这类资源）。把 member.max、
-- varda.enabled 这些零成本项塞进去，与 owner「配额只给有成本的」那条裁定打架。
-- 命名是纯展示，另起一张轻表不与那条裁定冲突。
--
-- ── 数据 ──
-- 先把两张表里已有的值搬进新表（生产实测一条都没填过，这一步是为了不假设）；
-- 冲突时保留先到的——两张表的键值域不相交（trg_product_metrics_no_platform_shadow
-- 保证），正常不会撞。搬完再删列。
--
-- 不设 FK：本表是**可选**的命名补充，没有对应行时界面回落显示 metric_key 本身，
-- 不阻塞。平台不替产品命名，所以没有默认值、没有自动生成。
--
-- 98 列锁：新表进 GRANT（display_name/description 要能改）；两张旧表的 GRANT
-- 重发、去掉已删的两列。
--
-- 重复执行安全（IF NOT EXISTS / IF EXISTS / ON CONFLICT DO NOTHING）。
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product.metric_catalog (
    metric_key   varchar(64)  PRIMARY KEY,
    display_name varchar(128) NOT NULL,
    description  varchar(256),
    created_by   uuid,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_by   uuid,
    updated_at   timestamptz  NOT NULL DEFAULT now()
);

-- 搬存量（两张表各一次；列可能已被本迁移的前一次执行删掉，故先判存在）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'product' AND table_name = 'product_metrics'
                AND column_name = 'display_name') THEN
    EXECUTE $q$
      INSERT INTO product.metric_catalog (metric_key, display_name, description)
      SELECT DISTINCT ON (metric_key) metric_key, display_name, description
        FROM product.product_metrics
       WHERE display_name IS NOT NULL AND btrim(display_name) <> ''
       ORDER BY metric_key, created_at
      ON CONFLICT (metric_key) DO NOTHING
    $q$;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'product' AND table_name = 'platform_metrics'
                AND column_name = 'display_name') THEN
    EXECUTE $q$
      INSERT INTO product.metric_catalog (metric_key, display_name, description)
      SELECT metric_key, display_name, description
        FROM product.platform_metrics
       WHERE display_name IS NOT NULL AND btrim(display_name) <> ''
      ON CONFLICT (metric_key) DO NOTHING
    $q$;
  END IF;
END $$;

ALTER TABLE product.product_metrics  DROP COLUMN IF EXISTS display_name;
ALTER TABLE product.product_metrics  DROP COLUMN IF EXISTS description;
ALTER TABLE product.platform_metrics DROP COLUMN IF EXISTS display_name;
ALTER TABLE product.platform_metrics DROP COLUMN IF EXISTS description;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    GRANT SELECT, INSERT, DELETE ON product.metric_catalog TO platform_svc;
    REVOKE UPDATE ON product.metric_catalog FROM platform_svc;
    GRANT UPDATE (display_name, description, updated_by, updated_at)
      ON product.metric_catalog TO platform_svc;

    REVOKE UPDATE ON product.product_metrics FROM platform_svc;
    GRANT UPDATE (product_id, metric_key, merge_strategy, consume_mode,
                  metric_unit, reset_period)
      ON product.product_metrics TO platform_svc;

    REVOKE UPDATE ON product.platform_metrics FROM platform_svc;
    GRANT UPDATE (kind, consume_mode, metric_unit, reset_period, status)
      ON product.platform_metrics TO platform_svc;
  END IF;
END $$;

DO $$
DECLARE named int; total int;
BEGIN
  SELECT count(*) INTO named FROM product.metric_catalog;
  SELECT count(*) INTO total FROM (
    SELECT metric_key FROM product.product_metrics
    UNION
    SELECT metric_key FROM product.platform_metrics
  ) k;
  RAISE NOTICE '[metric-catalog] 已命名 % 个键 / 在用键共 % 个（未命名的界面回落显示 metric_key，录入面在运维台）',
    named, total;
END $$;
