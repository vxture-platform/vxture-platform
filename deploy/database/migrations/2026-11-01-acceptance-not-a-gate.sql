-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-01-acceptance-not-a-gate.sql
-- `acceptance` 卸下「门」的角色，保留为运行健康的一项观测
--
-- ── 它为什么不能再当门 ──
-- `acceptance` 要的端到端链路需要活跃订阅，订阅需要已发布的版本，而发布正卡在它
-- 自己身上——环在这里闭合。这一批用**接入认证**把环断开：认证订阅指向未发布的草稿
-- 版本、不经过订单流，平台在沙箱里把整条链跑一遍并落一条 `certification_runs`。
--
-- 所以发布门从「数这个产品身上的检查项」改成「读那条认证结论」。同一件事留两处推导
-- 就会分叉：认证说通过、检查项说没有，两边都言之凿凿而谁也不报错。
--
-- ── 为什么是「不再必填」而不是删掉这一行 ──
-- 与 2026-10-29 退役的 `verification_policy` / `pricing_set` 不同：那两项**没有任何
-- 人能勾上**，留着就是假装在把关；而 `acceptance` 是一条**真的在跑**的自动检查，
-- opera 的复验页会照常测它、照常写回结果。它失去的只是「卡住发布」这个角色。
--
-- 按设计，它此后属于**运行健康**：回答「这个产品最近还在正常跑吗」，而不是
-- 「能不能发布」。后者由认证回答，前者不该挡任何动作。
--
-- 落法是把 `is_required` 置 false：发布门那条查询按 `is_required AND gate='publish'`
-- 取待办项，所以这一改之后 gate='publish' 的必填项为空，旧判据自然退场；而 opera 的
-- 检查单读的是 `owner='opera'`，不看 is_required，所以那一项在抽屉里照常显示、照常
-- 被自动写回——**看得见、测得着、不挡路**，正是要的形状。
--
-- 不动 `gate` 列：把它改成 'launch' 会让它去卡上线门，而上线门证的是「对方接通了」，
-- 不是「整条链跑通了」——那是一次真正的加严，不是本迁移的意图。
--
-- 幂等：点名 UPDATE + 末尾断言。可重复执行。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE product.launch_checklist_items
   SET is_required = false
 WHERE item_code = 'acceptance'
   AND is_required;

COMMIT;

DO $$
DECLARE
  n_required_publish int;
  acc_exists         int;
  acc_required       boolean;
  acc_owner          text;
BEGIN
  SELECT count(*), bool_or(is_required), min(owner)
    INTO acc_exists, acc_required, acc_owner
    FROM product.launch_checklist_items
   WHERE item_code = 'acceptance';

  /*
   * ⚠ 2026-11-03 放宽：`acceptance` 已由 2026-11-03-acceptance-off-the-checklist.sql
   * **彻底退役**（检查照跑，结果改到「运行健康」里呈现，不再占检查单一行）。
   *
   * 28d 是全量重放且按文件名排序，本文件排在那一份前面——原来那条「这一项必须还在」
   * 的断言会在第二轮重放时当场炸：上一轮已经把它删了。所以这里改成**存在才校验**。
   *
   * 这不是把断言放水：本迁移要保证的是「它不再必填」，而「它根本不在了」比
   * 「它在且不必填」更强地满足这一点。断言要守的是性质，不是那一行的存在。
   */
  IF acc_exists = 1 THEN
    IF acc_required THEN
      RAISE EXCEPTION '[acceptance-not-a-gate] acceptance 仍然是必填项';
    END IF;
    IF acc_owner IS DISTINCT FROM 'opera' THEN
      RAISE EXCEPTION '[acceptance-not-a-gate] acceptance 的归属被改成了 %', acc_owner;
    END IF;
  END IF;

  /* 旧判据退场的直接证据：gate='publish' 的必填项归零。
     发布门此后读的是 product.certification_runs，与这张表无关。 */
  SELECT count(*) INTO n_required_publish
    FROM product.launch_checklist_items
   WHERE is_required AND gate = 'publish';
  IF n_required_publish <> 0 THEN
    RAISE EXCEPTION
      '[acceptance-not-a-gate] gate=publish 还剩 % 项必填 —— 旧判据没退干净，发布门会同时被两套判据卡着',
      n_required_publish;
  END IF;

  RAISE NOTICE '[acceptance-not-a-gate] acceptance 不再必填（或已退役）✓；gate=publish 必填项已归零 ✓';
END $$;
