-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 暂停的「预计恢复时间」（选填）
--
-- 【为什么】
-- owner 2026-09-26：客户看到的暂停态要友好，详情弹窗要能倒计时。倒计时需要一个终点，
-- 而库里此前只有 `paused_at` 与 `subscription.max_suspend_days`（60 天）。
--
-- **拿 60 天当倒计时终点是错的**：那是内部处置阈值（到点平台原因强制恢复、客户违规终止），
-- 不是对客户的承诺。把它显示出去，客户会读成「最晚那天就好了」——平台从没这么说过。
--
-- 所以给这一次暂停加一个**运营填的**预计恢复时间：填了就倒计时，没填就只显示已暂停了
-- 多久。数字有人负责，不是系统编的。
--
-- 【为什么它可改，而 reason / extends_term 不可改】
-- 那两个是「已经发生的事实」，改它们等于改写历史（一次违规暂停被改成平台运维，客户凭空
-- 得到那些天）。而本列是个**估计**：维护拖长了运营就该能改它。一个改不了的估计比没有
-- 更糟——客户盯着一个早就过期的倒计时。故本列进 98 的 GRANT UPDATE 白名单。
--
-- 不加 CHECK 约束它必须晚于 paused_at：运营填错了时间是个可改的估计，不是该让整条暂停
-- 动作回滚的事。过点之后界面落回「已暂停 N 天」，不翻负数。
--
-- 幂等：ADD COLUMN IF NOT EXISTS；列锁按 98 的统一规则重放。跑第二遍全部跳过。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE metering.subscription_suspensions
  ADD COLUMN IF NOT EXISTS expected_resume_at timestamptz;

-- 列锁重放：新列**在**白名单里（它是可改的估计），锚点列仍然锁死。
REVOKE UPDATE ON metering.subscription_suspensions FROM platform_svc;
GRANT UPDATE (reason_note, expected_resume_at, resumed_at, granted_seconds, updated_at)
  ON metering.subscription_suspensions TO platform_svc;

COMMIT;

-- ── 审计 ────────────────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  -- 列在，且**可** UPDATE（与 auto_renew_before 那条迁移相反，判据也相反）
  SELECT count(*) INTO n FROM information_schema.column_privileges
   WHERE table_schema = 'metering' AND table_name = 'subscription_suspensions'
     AND grantee = 'platform_svc' AND privilege_type = 'UPDATE'
     AND column_name = 'expected_resume_at';
  IF n <> 1 THEN
    RAISE EXCEPTION '[expected-resume-at] expected_resume_at 不可 UPDATE —— 它是可改的估计，不是锚点';
  END IF;

  -- 锚点列没被这次重放放开（REVOKE/GRANT 打错一个列名就会在这里现形）
  SELECT count(*) INTO n FROM information_schema.column_privileges
   WHERE table_schema = 'metering' AND table_name = 'subscription_suspensions'
     AND grantee = 'platform_svc' AND privilege_type = 'UPDATE'
     AND column_name IN ('id','subscription_id','tenant_id','reason','extends_term',
                         'paused_at','actor_type','actor_id','created_at','auto_renew_before');
  IF n <> 0 THEN
    RAISE EXCEPTION '[expected-resume-at] 锚点列被放开了（% 列）', n;
  END IF;

  -- 可改列应当正好五列
  SELECT count(*) INTO n FROM information_schema.column_privileges
   WHERE table_schema = 'metering' AND table_name = 'subscription_suspensions'
     AND grantee = 'platform_svc' AND privilege_type = 'UPDATE';
  IF n <> 5 THEN
    RAISE EXCEPTION '[expected-resume-at] 可改列有 % 列（应为 5）', n;
  END IF;

  RAISE NOTICE '[expected-resume-at] OK —— 预计恢复时间就位且可改，锚点列仍锁死';
END $$;
