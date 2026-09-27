-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-17-checklist-stages.sql
-- 接入检查按环节拆开：每个环节的项在该环节就能全部确认——能实测的实测，测不到的人工
--
-- ── owner 2026-09-27 裁定（原话）──
-- 「按照设计的每个步骤拆开，全部转绿可以下一步。不能自动的先手动确认，在下一个环节
--  可以自动确认。完全不能自动的保留手动确认。但必须在该环节能够全部确认，不是猜测。
--  不留红执行下一步。」
--
-- ── 四个环节 ──
--   ① 登记与配置（我方）      catalog_registered + 登录客户端 / 模型授权 / 能力授权 / Webhook 登记（后四项实测不落库）
--   ② 对方接入 · 上线前确认   c1_identity（实测）+ 四项人工确认（本迁移新增，gate='launch'）
--                             → 全绿才「确认上线」
--   ③ 发布套餐（admin）        plan_published（实测，gate='stable'，本迁移新增）
--   ④ 测试租户验证 → 转正式版  tenant_subscribed（实测，新增）+ c1_s2s / c2_entitlement / c3_metering（实测）
--                             → 全绿才允许 release_stage → stable
--
-- 环节②的前三项与环节④的三项是同一件事的两个时点：上线前平台观测不到（要先有订阅才
-- 发得出），只能按对方回报人工确认；套餐发布、测试租户订阅之后，同一件事由真实使用自动
-- 点亮。回调接收端的验签 / 幂等平台永远看不见，只在②人工确认一次。
--
-- 重复执行安全：INSERT … ON CONFLICT DO NOTHING；UPDATE 带 IS DISTINCT FROM。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO product.launch_checklist_items
  (item_code, item_name, item_name_key, description, description_key, is_required, owner, gate, sort) VALUES
  ('c1_s2s_declared', '对方已实现 S2S 换票', 'catalog.product.checklist.c1_s2s_declared.name',
   'Product side confirms the outbound S2S token-exchange client is implemented (manual, pre-launch; verified live by c1_s2s before stable).', 'catalog.product.checklist.c1_s2s_declared.desc', true, 'opera', 'launch', 41),
  ('c2_entitlement_declared', '对方已实现权益拉取与门控', 'catalog.product.checklist.c2_entitlement_declared.name',
   'Product side confirms entitlement fetch, cache invalidation and gating are implemented (manual, pre-launch; verified live by c2_entitlement before stable).', 'catalog.product.checklist.c2_entitlement_declared.desc', true, 'opera', 'launch', 42),
  ('c3_metering_declared', '对方已实现用量上报', 'catalog.product.checklist.c3_metering_declared.name',
   'Product side confirms usage reporting via POST /usage/consume is implemented (manual, pre-launch; verified live by c3_metering before stable).', 'catalog.product.checklist.c3_metering_declared.desc', true, 'opera', 'launch', 43),
  ('webhook_receiver_declared', '对方回调接收端就绪', 'catalog.product.checklist.webhook_receiver_declared.name',
   'Product side confirms the webhook receiver at /api/webhooks/vxture verifies the HMAC signature, is idempotent by delivery id and rejects stale seq (manual; never platform-observable).', 'catalog.product.checklist.webhook_receiver_declared.desc', true, 'opera', 'launch', 44),
  ('plan_published', '套餐已发布', 'catalog.product.checklist.plan_published.name',
   'A published plan version whose components include this product exists (auto; read from product.plan_versions).', 'catalog.product.checklist.plan_published.desc', true, 'opera', 'stable', 46),
  ('tenant_subscribed', '测试租户已订阅', 'catalog.product.checklist.tenant_subscribed.name',
   'An active or trialing subscription covering this product exists (auto; read from metering.subscriptions via plan_components).', 'catalog.product.checklist.tenant_subscribed.desc', true, 'opera', 'stable', 47)
ON CONFLICT (item_code) DO NOTHING;

-- 三项对方发起型检查排到套餐 / 订阅两项之后：它们就是靠那两项才发得出。
UPDATE product.launch_checklist_items SET sort = 48
 WHERE item_code = 'c1_s2s' AND sort IS DISTINCT FROM 48;

COMMIT;

-- ── 审计：每个环节的项集是判据 ────────────────────────────────────────────
DO $$
DECLARE launch_items text; stable_items text; bad int;
BEGIN
  SELECT string_agg(item_code, ',' ORDER BY sort) INTO launch_items
    FROM product.launch_checklist_items WHERE gate = 'launch' AND is_required;
  SELECT string_agg(item_code, ',' ORDER BY sort) INTO stable_items
    FROM product.launch_checklist_items WHERE gate = 'stable' AND is_required;

  -- 环节①②：上线门 = 我方两项 + 对方四项人工确认，六项一个不能少
  SELECT count(*) INTO bad FROM product.launch_checklist_items
   WHERE gate = 'launch' AND is_required
     AND item_code IN ('catalog_registered','c1_identity','c1_s2s_declared','c2_entitlement_declared','c3_metering_declared','webhook_receiver_declared');
  IF bad <> 6 THEN
    RAISE EXCEPTION '[checklist-stages] 上线门应含六项，实为 %：%', bad, launch_items;
  END IF;
  -- 环节③④：转正式版门 = 套餐已发布 + 测试租户已订阅 + 对方三项，五项一个不能少
  SELECT count(*) INTO bad FROM product.launch_checklist_items
   WHERE gate = 'stable' AND is_required
     AND item_code IN ('plan_published','tenant_subscribed','c1_s2s','c2_entitlement','c3_metering');
  IF bad <> 5 THEN
    RAISE EXCEPTION '[checklist-stages] 转正式版门应含五项，实为 %：%', bad, stable_items;
  END IF;
  -- 对方发起型的实测三项不得回到上线门上（环）
  SELECT count(*) INTO bad FROM product.launch_checklist_items
   WHERE gate = 'launch' AND item_code IN ('c1_s2s','c2_entitlement','c3_metering');
  IF bad <> 0 THEN
    RAISE EXCEPTION '[checklist-stages] 上线门仍含对方发起型实测检查（% 项）—— 环没断', bad;
  END IF;

  RAISE NOTICE '[checklist-stages] OK —— launch 门：%；stable 门：%', launch_items, stable_items;
END $$;
