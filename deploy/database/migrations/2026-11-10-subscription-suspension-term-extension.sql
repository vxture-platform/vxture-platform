-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 暂停顺延（步骤三）：记住暂停前的续费意愿
--
-- 【为什么只加一列】
-- 上一步（2026-11-09）立了 episode 表与原因轴，顺不顺延已经定得下来。顺延本身的计算
-- 全在应用层与既有列上（`granted_seconds` 结算、`subscriptions.end_at` 顺延、配额
-- `period_anchor` 顺延），唯一在库里缺的是**暂停前 auto_renew 的值**。
--
-- 暂停会把 `auto_renew` 关掉——冻结期间不该自动续上一期。恢复时要还原它，而「还原成
-- 什么」只有暂停那一刻知道：无脑置 true 会给一条本来就关着自动续费的订阅悄悄打开它，
-- 下个周期客户账上就多一笔。这个错既不报错也不显眼，只有对账时对不上。
--
-- 存量 episode（上一步到本步之间开的那些）本列为 NULL ⇒ 恢复时**不动** auto_renew。
-- 那是「按设计没有」，不是缺一个值：那几条 episode 开的时候没人记下暂停前是什么，
-- 猜一个比不动更糟。
--
-- 【为什么是锚点列】
-- 出生即定：它记的是暂停那一刻的事实。改它等于替客户改了续费意愿。故进
-- `column-locks.shared.mjs` 的 `EXTRA_ANCHOR`，98 不授权它，`check-anchor-writes`
-- 反过来盯住应用代码别 UPDATE 它。
--
-- 幂等：ADD COLUMN IF NOT EXISTS；列锁按 98 的统一规则重放（GRANT 清单不变——新列不在
-- 里面正是重点）。跑第二遍全部跳过。迁移每次 deploy 全量重放。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE metering.subscription_suspensions
  ADD COLUMN IF NOT EXISTS auto_renew_before boolean;

-- 列锁重放：REVOKE 掉整表 UPDATE 再只放开收尾四列。新列**有意不在**清单里。
REVOKE UPDATE ON metering.subscription_suspensions FROM platform_svc;
GRANT UPDATE (reason_note, resumed_at, granted_seconds, updated_at)
  ON metering.subscription_suspensions TO platform_svc;

COMMIT;

-- ── 审计：列在、且**不可** UPDATE（锚点列的判据是「没被授权」，不是「存在」）─────
DO $$
DECLARE has_col boolean; n int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'metering' AND table_name = 'subscription_suspensions'
       AND column_name = 'auto_renew_before'
  ) INTO has_col;
  IF NOT has_col THEN
    RAISE EXCEPTION '[suspension-term-extension] auto_renew_before 列不在';
  END IF;

  SELECT count(*) INTO n FROM information_schema.column_privileges
   WHERE table_schema = 'metering' AND table_name = 'subscription_suspensions'
     AND grantee = 'platform_svc' AND privilege_type = 'UPDATE'
     AND column_name = 'auto_renew_before';
  IF n <> 0 THEN
    RAISE EXCEPTION '[suspension-term-extension] auto_renew_before 竟可 UPDATE —— 它是锚点列';
  END IF;

  -- 收尾四列仍要可写：重放 REVOKE 时打错一个列名，症状是恢复订阅整条 42501 回滚。
  SELECT count(*) INTO n FROM information_schema.column_privileges
   WHERE table_schema = 'metering' AND table_name = 'subscription_suspensions'
     AND grantee = 'platform_svc' AND privilege_type = 'UPDATE'
     AND column_name IN ('reason_note', 'resumed_at', 'granted_seconds', 'updated_at');
  IF n <> 4 THEN
    RAISE EXCEPTION '[suspension-term-extension] 收尾列可写的只有 % 列（应为 4）', n;
  END IF;

  RAISE NOTICE '[suspension-term-extension] OK —— auto_renew_before 就位且已锁，收尾四列可写';
END $$;
