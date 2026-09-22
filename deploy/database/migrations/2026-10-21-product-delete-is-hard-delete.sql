-- ═══════════════════════════════════════════════════════════════════════════
-- 产品删除改「真删」，并清掉存量软删行（owner 2026-09-22 裁定，与套餐那条同形）。
--
-- ── 裁定 ──
--   删除     无客户足迹 → 整行删掉，product_code 随之释放
--   归档/退役 status='deprecated' → 行留着、码占着（这是对的，不动）
-- 中间那个「软删」态被撤了。
--
-- ── 为什么必须撤 ──
-- `uq_products_product_code` 是普通唯一约束，不排除软删行；而**全仓没有任何恢复
-- 路径**（找不到把 deleted_at 清回 null 的代码）。所以那里的「软删」不是可恢复，
-- 是个消耗掉码位的墓碑：删过一次，那个产品码再也用不回来。
--
-- ── 判据与代码同源，且比套餐那条宽得多 ──
-- 25 张表无级联引用 products。应用侧 `readCustomerFootprint` 这次补齐到覆盖全部
-- 「客户足迹」类（订阅/订单/用量与五张汇总/权益/共享授权/被别人当搭售件引用），
-- 其余「运营侧配置」由删除事务显式清理。本迁移照同一套判据筛选。
--
-- ── 故意不删的那些 ──
-- 判据不过的软删行一行不动：那是按新模型本就该走退役的行。只把剩余数量报出来。
--
-- 不写「全库共 N 个」这类断言（migrate 是全量重放）。重复执行安全。
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  freed int;
  kept  int;
BEGIN
  CREATE TEMP TABLE _purgeable_products ON COMMIT DROP AS
  SELECT p.id, p.product_code
    FROM product.products p
   WHERE p.deleted_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM metering.usage_events            WHERE product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM metering.usage_gauges            WHERE product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM metering.usage_summary_hours     WHERE product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM metering.usage_summary_days      WHERE product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM metering.usage_summary_weeks     WHERE product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM metering.usage_summary_months    WHERE product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM metering.usage_summary_years     WHERE product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM billing.invoice_items            WHERE product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM billing.orders                   WHERE product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM provisioning.provisionings       WHERE product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM metering.entitlement_caches      WHERE product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM metering.quota_pools             WHERE product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM metering.subscriptions           WHERE product_id = p.id)
     -- sharing.grants 经**两个**列引用产品，没有 product_id 这一列
     AND NOT EXISTS (SELECT 1 FROM sharing.grants
                      WHERE resource_product_id = p.id OR grantee_product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM metering.subscription_entitlement_overrides WHERE product_id = p.id)
     -- 被别的产品的套餐当搭售件引用 → 删掉会把人家的套餐掏空
     AND NOT EXISTS (SELECT 1 FROM product.plan_components
                      WHERE product_id = p.id AND component_role = 'bundled');

  SELECT count(*) INTO freed FROM _purgeable_products;

  -- 本产品作 primary 的套餐随它一起走（删 plans 级联 versions/components/prices）
  DELETE FROM product.plans
   WHERE id IN (
     SELECT pv.plan_id
       FROM product.plan_versions pv
       JOIN product.plan_components pc ON pc.plan_version_id = pv.id
      WHERE pc.component_role = 'primary'
        AND pc.product_id IN (SELECT id FROM _purgeable_products)
   );

  -- 运营侧配置与弱引用：随产品消失才合理，显式清掉（不改 DDL 外键）
  DELETE FROM appoidc.oidc_clients            WHERE product_id IN (SELECT id FROM _purgeable_products);
  DELETE FROM kyc.verification_policies       WHERE product_id IN (SELECT id FROM _purgeable_products);
  DELETE FROM product.solution_products       WHERE product_id IN (SELECT id FROM _purgeable_products);
  DELETE FROM metering.resource_sharing_policies WHERE product_id IN (SELECT id FROM _purgeable_products);
  DELETE FROM provisioning.webhook_deliveries WHERE product_id IN (SELECT id FROM _purgeable_products);
  DELETE FROM account.user_product_favorites  WHERE product_id IN (SELECT id FROM _purgeable_products);
  DELETE FROM support.product_reviews         WHERE product_id IN (SELECT id FROM _purgeable_products);
  DELETE FROM sharing.visible_set_current     WHERE product_id IN (SELECT id FROM _purgeable_products);
  DELETE FROM sharing.visible_set_refresh     WHERE product_id IN (SELECT id FROM _purgeable_products);

  DELETE FROM product.products
   WHERE id IN (SELECT id FROM _purgeable_products);

  SELECT count(*) INTO kept
    FROM product.products
   WHERE deleted_at IS NOT NULL;

  RAISE NOTICE '[product-hard-delete] 放开产品码 % 个；仍保留的软删行 % 个（有足迹，按新模型应走退役）',
    freed, kept;
END $$;
