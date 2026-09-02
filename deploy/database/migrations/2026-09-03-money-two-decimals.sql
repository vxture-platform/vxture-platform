-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 资金类列有且只有两位小数：标价 / 单价从 numeric(18,6) 收口到 numeric(12,2)
--
-- 依据：owner 2026-09-03。「所有资金类，有且只有两位小数，不能显示时四舍五入，存储却很长
-- 小数。」此前 §3.2 把"标价类"单独放到 numeric(18,6)（product.plan_prices.price、
-- billing.invoice_items.unit_price），金额类已是 numeric(12,2)；官网 / 控制台按分展示，
-- 库里却可能存着 166.583333 之类的尾巴——展示值与存储值不是同一个数。本迁移把两列
-- 的 scale 收到 2，之后任何写入都由 PG 按列定义落到分（写侧同时在 admin-bff 校验
-- 最多两位小数，拒绝而不是静默舍入）。
--
-- 影响：ALTER TYPE 对已有值按 PG numeric 规则四舍五入到分；迁移前先把会被改动的行
-- 数打成 NOTICE 便于对账（生产预期为 0——录入都走 admin 表单，表单已按 2dp 提交）。
-- 两表均在 §7 版本冻结触发器覆盖范围内，但触发器只拦 UPDATE/DELETE，不拦 ALTER TYPE。
-- 列级锁（98）只涉及列权限，类型变更不影响既有 GRANT。
--
-- 幂等：ALTER TYPE 到同一类型可重复执行。
-- 之后 db-init action=migrate 的 28c 会把 vx_ddl_baseline 重签到含本次 40/52 改动的 DDL。
--
-- 用法（生产，以 owner 身份）：
--   CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
--   或 psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <本文件>
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 对账：会被四舍五入改动的行。
DO $$
DECLARE
  n_prices bigint;
  n_items  bigint;
BEGIN
  SELECT count(*) INTO n_prices FROM product.plan_prices      WHERE price      <> round(price, 2);
  SELECT count(*) INTO n_items  FROM billing.invoice_items    WHERE unit_price <> round(unit_price, 2);
  RAISE NOTICE '[money-two-decimals] rows to be rounded: plan_prices=%, invoice_items=%', n_prices, n_items;
END $$;

ALTER TABLE product.plan_prices
  ALTER COLUMN price TYPE numeric(12,2);

ALTER TABLE billing.invoice_items
  ALTER COLUMN unit_price TYPE numeric(12,2);

-- 断言：两列 scale 均为 2。
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(table_schema || '.' || table_name || '.' || column_name || '=' ||
                    coalesce(numeric_precision::text, '?') || ',' || coalesce(numeric_scale::text, '?'),
                    ', ')
    INTO bad
    FROM information_schema.columns
   WHERE (table_schema, table_name, column_name) IN (
           ('product', 'plan_prices', 'price'),
           ('billing', 'invoice_items', 'unit_price')
         )
     AND (numeric_precision IS DISTINCT FROM 12 OR numeric_scale IS DISTINCT FROM 2);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '[money-two-decimals] columns not numeric(12,2): %', bad;
  END IF;
  RAISE NOTICE '[money-two-decimals] plan_prices.price and invoice_items.unit_price are numeric(12,2)';
END $$;

COMMIT;
