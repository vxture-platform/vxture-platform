-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 上架检查项加两根正交轴：owner（谁拥有）/ gate（卡哪道门）
--
-- owner 2026-09-17：产品上线流程有一处**循环自锁**——`acceptance`（端到端验收）要求
-- 走通 login → provision → gate → consume → invalidate，而 provision 需要客户订阅、
-- 订阅需要 console 可见、console 过滤 `status='active'`，而 active 的前置正包括
-- acceptance。环在这里闭合。
--
-- ── 为什么加两列而不是挪一项 ──
--
-- 只把 acceptance 换个位置是补丁：表达「这一项卡哪道门」的地方根本不存在
-- （字典表只有 `is_required` 一个布尔），下一个「必须上线后才能验」的检查项进来，
-- 同样的环会重新长出来。
--
-- 归属与门是**两根不同的轴**，此前被揉成一个字面量集合
-- （`ADMIN_OWNED_ITEM_CODES`，opera-bff）。那段注释自己写着：「真正的归属轴该是
-- 表上的一列……到那天把这个集合连同 isOperaChecklistItem 一起删掉」。这一份就是那天。
--
--   owner = opera | admin    谁拥有这一项（消费方/勾选方）
--   gate  = launch | publish 卡哪一道门
--
-- ── 本迁移只加列与回填，**不改任何行为** ──
--
-- 上线门槛此刻仍按 `ADMIN_OWNED_ITEM_CODES` 反向排除来算（opera-bff 未改）。
-- 回填后的 `owner` 与那个集合逐项等价，所以这一份上线后行为不变、可安全回滚。
-- 把闸门切到按 `gate` 过滤、并给 `developing → beta` 装发布门，是后续 PR 的事。
--
-- ── 回填依据（九项，sort 序）──
--
--   10 verification_policy  admin  publish  商业前置，本就不该卡技术上线
--   20 pricing_set          admin  publish  同上
--   30 catalog_registered   opera  launch   登记即满足，无前置
--   40 c1_identity          opera  launch   对方 RP 实现；draft 下即可完成
--   45 c1_s2s               opera  launch   换票作为调用方，draft 下即可完成
--   50 c3_metering          opera  launch   对方上报，draft 下即可完成
--   60 c2_entitlement       opera  launch   对方拉权益，draft 下即可完成
--   70 data_plane           opera  launch   对方库里的 schema，与我方状态无关
--   80 acceptance           opera  publish  ← 唯一自锁项：它要的链路在
--                                             `active + developing` 下本来就走得通
--
-- 默认值取 `opera` / `launch`：新增技术检查项是常态（DDL 原话「新增检查项 =
-- INSERT 一行，不改表结构」），让它默认卡上线门、归 opera，与现状一致。
--
-- ── 列级锁 ──
-- 两列都不是锚点（非 PK、非 `_no`、非 created_*），按规则属可写列，已同步进
-- `98_column_locks.sql` 的 GRANT 白名单。28d 每次重放该文件，无需在此写 GRANT。
--
-- 幂等：ADD COLUMN IF NOT EXISTS + 按 item_code 点名回填 + 末尾断言。可重复执行。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE product.launch_checklist_items
  ADD COLUMN IF NOT EXISTS owner varchar(16) NOT NULL DEFAULT 'opera';

ALTER TABLE product.launch_checklist_items
  ADD COLUMN IF NOT EXISTS gate  varchar(16) NOT NULL DEFAULT 'launch';

COMMENT ON COLUMN product.launch_checklist_items.owner IS
  '谁拥有这一项：opera（技术接入）/ admin（商业前置）。取代 opera-bff 的 ADMIN_OWNED_ITEM_CODES 字面量。';

COMMENT ON COLUMN product.launch_checklist_items.gate IS
  '卡哪一道门：launch = draft→active（技术可用）/ publish = developing→beta（对客发布）。acceptance 归 publish——它要的端到端链路在 active+developing 下本来就走得通，卡在 launch 会形成循环自锁。';

ALTER TABLE product.launch_checklist_items
  DROP CONSTRAINT IF EXISTS chk_launch_checklist_items_owner;
ALTER TABLE product.launch_checklist_items
  ADD CONSTRAINT chk_launch_checklist_items_owner CHECK (owner IN ('opera','admin'));

ALTER TABLE product.launch_checklist_items
  DROP CONSTRAINT IF EXISTS chk_launch_checklist_items_gate;
ALTER TABLE product.launch_checklist_items
  ADD CONSTRAINT chk_launch_checklist_items_gate CHECK (gate IN ('launch','publish'));

-- ── 回填：按 item_code 点名，不靠顺序、不靠通配 ────────────────────────────
UPDATE product.launch_checklist_items i
   SET owner = v.owner, gate = v.gate
  FROM (VALUES
    ('verification_policy', 'admin', 'publish'),
    ('pricing_set',         'admin', 'publish'),
    ('catalog_registered',  'opera', 'launch'),
    ('c1_identity',         'opera', 'launch'),
    ('c1_s2s',              'opera', 'launch'),
    ('c3_metering',         'opera', 'launch'),
    ('c2_entitlement',      'opera', 'launch'),
    ('data_plane',          'opera', 'launch'),
    ('acceptance',          'opera', 'publish')
  ) AS v(code, owner, gate)
 WHERE i.item_code = v.code
   AND (i.owner IS DISTINCT FROM v.owner OR i.gate IS DISTINCT FROM v.gate);

DO $$
DECLARE bad text; n_other bigint;
BEGIN
  /*
   * 断言形式是「**存在反例即抛**」，不是「数够不够」。
   *
   * 数个数是一张**全库快照**：将来有人把 pricing_set 调成 gate='launch'，或者字典
   * 表被扩了一项，这条断言会在一次与它无关的迁移重放里突然炸掉——而错的是断言，
   * 不是那次改动（lint:migration-counts 守的正是这个，它把我第一版拦下来了）。
   *
   * 反例断言只问本迁移点名的那九行「有没有跟期望不一致的」，与表里还有多少行无关。
   */
  SELECT string_agg(i.item_code || '(' || i.owner || '/' || i.gate || ')', '、' ORDER BY i.sort)
    INTO bad
    FROM product.launch_checklist_items i
    JOIN (VALUES
      ('verification_policy', 'admin', 'publish'),
      ('pricing_set',         'admin', 'publish'),
      ('catalog_registered',  'opera', 'launch'),
      ('c1_identity',         'opera', 'launch'),
      ('c1_s2s',              'opera', 'launch'),
      ('c3_metering',         'opera', 'launch'),
      ('c2_entitlement',      'opera', 'launch'),
      ('data_plane',          'opera', 'launch'),
      ('acceptance',          'opera', 'publish')
    ) AS v(code, owner, gate) ON v.code = i.item_code
   WHERE i.owner IS DISTINCT FROM v.owner
      OR i.gate  IS DISTINCT FROM v.gate;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '[checklist-gate] 回填后仍与期望不符：%', bad;
  END IF;

  -- 本迁移点名之外的行只报不拦：新增检查项按默认 opera/launch 落地，是刻意的行为。
  SELECT count(*) INTO n_other
    FROM product.launch_checklist_items
   WHERE item_code NOT IN ('verification_policy','pricing_set','catalog_registered',
                           'c1_identity','c1_s2s','c3_metering','c2_entitlement',
                           'data_plane','acceptance');
  RAISE NOTICE '[checklist-gate] 回填完成，九项逐条相符；未点名的检查项 % 项（按默认 opera/launch）', n_other;
END $$;

COMMIT;
