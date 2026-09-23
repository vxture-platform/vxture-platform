-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-03-acceptance-off-the-checklist.sql
-- `acceptance` 退出上架检查单 —— 检查照跑，结果改到「运行健康」里呈现
--
-- ── 为什么「标成可选」不够 ──
-- 2026-11-01 把它的 `is_required` 置了 false，门是不卡了，但它仍然留在检查单上：
-- opera 的检查单按 `owner='opera'` 取项、**不看 is_required**，所以抽屉里还是有它，
-- 只是多了一个「可选」徽标。
--
-- owner 2026-09-23 走查：「几个环节的认证还混淆在一个页面」。确实——那一屏同时装着
-- 三类东西：上线门的判据、我方配置就绪度、以及这一项（现在属于运行健康）。一个运营
-- 看到一排「通过 / 未通过」，分不清哪几条是「不办就上不了线」、哪几条只是「告诉你
-- 现在跑得怎么样」。「可选」两个字说明不了后者。
--
-- ── 判据：检查单是「上线前要办的事」的清单 ──
-- 一个**不办也能上线**的项，不该在那张单子上。这与 2026-11-01 的判断不冲突：那次说
-- 「它是一条真的在跑的自动检查，不该退役」——检查确实照跑，退的是**它在这张表上的
-- 席位**，不是那条检查本身。结果改由运行健康呈现：三态 healthy / degraded / unknown，
-- 没有「未通过」这个说法。
--
-- 这一条很要紧：对一个刚上线、还没有客户的产品，端到端链路当然是空的。检查单把它画成
-- 红色「未通过」，等于**把「没人用」说成了「坏了」**，而运营看到红色的第一反应是去修
-- 一个根本没坏的东西。
--
-- ── 三张表，三个问题，从此不重叠 ──
--   product.launch_checklist_items   上线门：还差哪几件才能上线
--   product.certification_runs       发布门：这条链在沙箱里证过没有
--   （运行健康，派生不落表）          跑起来之后：最近还正常吗
--
-- ── 删除顺序 ──
-- 照 2026-10-09-checklist-data-plane-retire.sql：`product_launch_statuses.item_code`
-- 有 FK 指向字典表，先清存量状态行、再删字典行。
--
-- 存量状态行删掉不可惜：它记的是「某一刻这个产品的五段痕迹齐不齐」，而那件事此后由
-- 运行健康**现算**——留着一份几个月前的快照，只会让人以为那是现在的状态。
--
-- 幂等：无条件 DELETE + 末尾断言。可重复执行。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DELETE FROM product.product_launch_statuses WHERE item_code = 'acceptance';
DELETE FROM product.launch_checklist_items  WHERE item_code = 'acceptance';

COMMIT;

DO $$
DECLARE
  n_item     int;
  n_status   int;
  n_launch   int;
  n_publish  int;
  codes      text;
BEGIN
  SELECT count(*) INTO n_item   FROM product.launch_checklist_items  WHERE item_code = 'acceptance';
  SELECT count(*) INTO n_status FROM product.product_launch_statuses WHERE item_code = 'acceptance';
  /* 断言的是**删干净了**，不是「DELETE 跑过了」：影响 0 行也成功，只有回头数一次
     才分得清「本来就没有」与「没删掉」。 */
  IF n_item <> 0 OR n_status <> 0 THEN
    RAISE EXCEPTION '[acceptance-off-checklist] 没退干净：字典行 %，存量状态行 %', n_item, n_status;
  END IF;

  /* 退役之后这张表只剩一个问题：「还差哪几件才能上线」。
     所以 gate='publish' 必须一项不剩——留一项就意味着这张表又在回答两个问题。 */
  SELECT count(*) INTO n_publish FROM product.launch_checklist_items WHERE gate = 'publish';
  IF n_publish <> 0 THEN
    SELECT string_agg(item_code, '、' ORDER BY sort) INTO codes
      FROM product.launch_checklist_items WHERE gate = 'publish';
    RAISE EXCEPTION
      '[acceptance-off-checklist] 检查单里还留着 % 个 gate=publish 的项（%）—— 发布门已改读 certification_runs，这张表不该再回答发布的问题',
      n_publish, codes;
  END IF;

  /* 上线门那几项必须还在：本迁移动的是发布/运行那一侧，不该误伤上线门。
     数下界而不是精确值——将来新增技术检查项是常态（DDL 原话「新增检查项 = INSERT 一行」）。 */
  SELECT count(*) INTO n_launch FROM product.launch_checklist_items
   WHERE gate = 'launch' AND is_required;
  IF n_launch < 5 THEN
    SELECT coalesce(string_agg(item_code, '、' ORDER BY sort), '(无)') INTO codes
      FROM product.launch_checklist_items WHERE gate = 'launch' AND is_required;
    RAISE EXCEPTION
      '[acceptance-off-checklist] 上线门只剩 % 项必填（%）—— 少于 5 项说明误伤了上线门',
      n_launch, codes;
  END IF;

  SELECT string_agg(item_code, '、' ORDER BY sort) INTO codes
    FROM product.launch_checklist_items;
  RAISE NOTICE '[acceptance-off-checklist] acceptance 已退出检查单；检查单此后只答「还差哪几件才能上线」，现存 %', codes;
END $$;
