-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-16-regate-theirs-to-stable.sql
-- 三项「对方」检查改卡「转正式版」—— 每一道门只验那一阶段验得了的事
--
-- ── owner 2026-09-27 裁定（原话）──
-- 「不再出现“带缺陷上线”。每个阶段完成应该和可行的验证就是通过，该下一步验证的推进到
--  下一阶段。该上线-发布套餐-真人订阅验证的，就让发布套餐上线，让真正租户（测试用途）
--  首先验证。」
--
-- ── 为什么原来的门序是环 ──
-- c1_s2s / c2_entitlement / c3_metering 都是「对方发起过调用」的平台侧痕迹。2026-10-07
-- 把它们放在 gate='launch' 的理由是「draft 下即可完成，不需要客户/订阅/套餐」——对
-- 用 service 模式换票的产品**不成立**：平台换票的覆盖门（token-exchange.service
-- resolveServiceContext）要求调用方产品在该工作空间已有订阅或开通，否则 invalid_target。
-- tenderforge 2026-09-22/24 的日志就是这样：换不到票 → 读不了权益 → 报不了用量 →
-- 三项永远红 → 上不了线 → 发不了套餐 → 没人能订阅 → 换不到票。
-- 2026-10-30 的接入认证把发布门改读 certification_runs，而认证又要求 status=active，
-- 环只是换了个地方闭上。
--
-- ── 新门序 ──
--   上线（draft/developing → active）   只验我方配置 + 登录接入：catalog_registered, c1_identity
--   发布套餐（publishPlanVersion）        不再读 certification_runs；保留档位占位、发布冻结
--   测试租户订阅                            真实流程；三项由平台观测点亮
--   转正式版（release_stage → stable）    三项全绿才允许（admin-bff 409 RELEASE_STAGE_VERIFY_PENDING）
--
-- 沙箱「接入认证」随之退役为可选工具：测试租户走真实订阅就是认证。certification_runs
-- 表与既有行保留（历史台账），只是不再是任何门的判据。
--
-- 重复执行安全：UPDATE 带 IS DISTINCT FROM；CHECK 用 DROP/ADD。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE product.launch_checklist_items
  DROP CONSTRAINT IF EXISTS chk_launch_checklist_items_gate;
ALTER TABLE product.launch_checklist_items
  ADD CONSTRAINT chk_launch_checklist_items_gate CHECK (gate IN ('launch','publish','stable'));

COMMENT ON COLUMN product.launch_checklist_items.gate IS
  '卡哪一道门：launch=上线（draft/developing→active）/ publish=发布套餐（当前无项）/ stable=转正式版（release_stage→stable）。对方发起型检查一律 stable：产品拿到订阅前换不到票，卡上线门就是环（owner 2026-09-27）。';

UPDATE product.launch_checklist_items
   SET gate = 'stable'
 WHERE item_code IN ('c1_s2s','c2_entitlement','c3_metering')
   AND gate IS DISTINCT FROM 'stable';

COMMIT;

-- ── 审计：每道门的项集是判据，不是快照 ──────────────────────────────────────
DO $$
DECLARE launch_items text; stable_items text; bad int;
BEGIN
  SELECT string_agg(item_code, ',' ORDER BY sort) INTO launch_items
    FROM product.launch_checklist_items WHERE gate = 'launch' AND is_required;
  SELECT string_agg(item_code, ',' ORDER BY sort) INTO stable_items
    FROM product.launch_checklist_items WHERE gate = 'stable' AND is_required;

  -- 上线门不得再含任何「对方发起型」项：那三项就是环的三条边
  SELECT count(*) INTO bad FROM product.launch_checklist_items
   WHERE gate = 'launch' AND item_code IN ('c1_s2s','c2_entitlement','c3_metering');
  IF bad <> 0 THEN
    RAISE EXCEPTION '[regate] 上线门仍含对方发起型检查（% 项）—— 环没断', bad;
  END IF;
  -- 三项必须都在 stable 门上（缺一项 = 转正式版的判据少一条边）
  SELECT count(*) INTO bad FROM product.launch_checklist_items
   WHERE gate = 'stable' AND item_code IN ('c1_s2s','c2_entitlement','c3_metering');
  IF bad <> 3 THEN
    RAISE EXCEPTION '[regate] stable 门应含三项对方检查，实为 %', bad;
  END IF;
  -- 上线门必须还留着我方两项：不能把门拆空
  SELECT count(*) INTO bad FROM product.launch_checklist_items
   WHERE gate = 'launch' AND is_required AND item_code IN ('catalog_registered','c1_identity');
  IF bad <> 2 THEN
    RAISE EXCEPTION '[regate] 上线门应含 catalog_registered + c1_identity，实为 %', bad;
  END IF;

  RAISE NOTICE '[regate] OK —— launch 门：%；stable 门：%', launch_items, stable_items;
END $$;
