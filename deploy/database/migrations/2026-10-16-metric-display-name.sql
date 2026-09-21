-- ═══════════════════════════════════════════════════════════════════════════
-- 计量项的中文名与说明（owner 2026-09-21）。
--
-- ── 为什么要加列 ──
-- `product.product_metrics` 与 `product.platform_metrics` 都只有 `metric_key`
-- （`dataset.max` / `service.api.call` 这样的点分码），**没有名称列、没有说明列**。
-- admin-bff 的投影里 `metricName: metric.metric_key`——「名称」就是代码本身，所以
-- 产品详情页的「计量名称 | 计量代码」两列会显示同一个字符串两遍。
--
-- owner：「注意计量名称需要中文，更加易懂和明确。」
--
-- ── 两张表都加 ──
-- platform_metrics 是 L0 平台级共享指标（跨产品复用、产品不得重定义），比产品私有
-- 的那些更该有个说得清的名字。
--
-- ── 可空，不给默认值 ──
-- 没填就回落显示 `metric_key`（界面侧），**不自动生成**：平台替产品命名必然错
-- （`varda.enabled` 该叫「Varda 开关」还是「智能体启用」，只有产品自己知道）。
-- 存量 19 条（产品 13 + 平台 6）人工补录，录入面在运维台的产品接入页。
--
-- ── 98 列锁必须同步 ──
-- 两张表都在 `98_column_locks.sql` 里被 REVOKE 过 UPDATE、再按列 GRANT。新列不进
-- GRANT 名单的话，生产上 platform_svc 写它会 42501 整条回滚——而静态守卫只比源码
-- 清单、看不见活库的 GRANT 滞后（见 feedback 列级锁那条的第二形态）。所以这里把
-- GRANT 重新发一遍，包含新列。
--
-- 重复执行安全（IF NOT EXISTS + 幂等 GRANT）。
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE product.product_metrics
  ADD COLUMN IF NOT EXISTS display_name varchar(128);
ALTER TABLE product.product_metrics
  ADD COLUMN IF NOT EXISTS description  varchar(256);

ALTER TABLE product.platform_metrics
  ADD COLUMN IF NOT EXISTS display_name varchar(128);
ALTER TABLE product.platform_metrics
  ADD COLUMN IF NOT EXISTS description  varchar(256);

-- 列锁：重发 GRANT，把两个新列纳入可写名单（与 98_column_locks.sql 保持一致）。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    REVOKE UPDATE ON product.product_metrics FROM platform_svc;
    GRANT UPDATE (product_id, metric_key, merge_strategy, consume_mode,
                  metric_unit, reset_period, display_name, description)
      ON product.product_metrics TO platform_svc;

    REVOKE UPDATE ON product.platform_metrics FROM platform_svc;
    GRANT UPDATE (kind, consume_mode, metric_unit, reset_period, status,
                  display_name, description)
      ON product.platform_metrics TO platform_svc;
  END IF;
END
$$;
