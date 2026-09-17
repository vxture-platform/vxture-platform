-- 2026-10-09-checklist-data-plane-retire.sql
-- 退役上线检查项「数据面就绪」（data_plane）。
--
-- ══ 为什么退役，而不是想办法自动化 ══
-- owner 2026-09-17 问了一句「为什么要看产品的库」。查下来这一项的定义在**三处互相
-- 矛盾**，而定义不一致的检查不可能有判据：
--
--   · seed 说它是 'Agent-db provisioned per product_240 §2.4 template
--     (vx_provision/local_authz/local_usage schemas)'——产品**自己库里**的 schema 布局；
--   · `70-workplan/10-platform-support-tasks.md` §6#24 明写那份模板是「**非平台标准**」
--     「**平台仍不拥有产品 RBAC 表结构**」「**不是平台义务**」；
--   · 而 opera 的 `lifecycle.ts` 把它注解成「平台按模板 provision」，归在**我方**一侧。
--
-- 于是同一项，一处说是产品的库、一处说平台不拥有它、一处说平台来做。谁该动手都没定，
-- 更不必说怎么验。它能长期挂在上线门上，只因为它**从来只靠人工勾**——一条从不被真正
-- 检验的规则，比没有规则更坏（见《产品接入通则》十三个坑最后一条）。
--
-- 平台与产品的边界是通则写死的：产品不读平台库、不复制平台主数据；反过来平台也不管
-- 产品内部怎么建表。产品的接口义务由 c1_identity / c1_s2s / c2_entitlement /
-- c3_metering / acceptance 五项覆盖，**没有一件需要知道对方的 schema 长什么样**。
--
-- 不改写成「可观测的等价物」：能观测到的那件事（对方真的调通了 C2/C3）已经由
-- c2_entitlement / c3_metering 覆盖，再立一项就是同一事实的第二份推导。
--
-- ══ 删除顺序 ══
-- `product_launch_statuses.item_code` 有 FK 指向 `launch_checklist_items.item_code`，
-- 所以必须**先清存量状态行、再删字典行**。两步都无条件执行（幂等：migrate 是全量重放，
-- 第二次跑时两张表都已经没有这一项，DELETE 影响 0 行照样成功）。
--
-- 存量行删掉不可惜：它记的是「某位运营者曾勾过一项含义不明的检查」，保留它只会让
-- 将来的人以为那个勾有过判据。

BEGIN;

-- ① 先清每个产品身上的完成态（FK 子行）
DELETE FROM product.product_launch_statuses WHERE item_code = 'data_plane';

-- ② 再删字典行
DELETE FROM product.launch_checklist_items WHERE item_code = 'data_plane';

COMMIT;

DO $$
DECLARE
  n_item   int;
  n_status int;
BEGIN
  SELECT count(*) INTO n_item
    FROM product.launch_checklist_items WHERE item_code = 'data_plane';
  SELECT count(*) INTO n_status
    FROM product.product_launch_statuses WHERE item_code = 'data_plane';

  -- 断言的是**删干净了**，不是「删除语句跑过了」：DELETE 影响 0 行也成功，
  -- 只有回头数一次才分得清「本来就没有」与「没删掉」。
  IF n_item <> 0 OR n_status <> 0 THEN
    RAISE EXCEPTION
      '[checklist-data-plane-retire] 没退干净：字典行 %，存量状态行 %',
      n_item, n_status;
  END IF;

  RAISE NOTICE '[checklist-data-plane-retire] data_plane 已退役（字典行与存量状态行均为 0）';
END $$;
