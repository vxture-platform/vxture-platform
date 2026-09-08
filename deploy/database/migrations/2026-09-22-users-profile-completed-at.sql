-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 注册补齐完成时刻(owner 2026-09-08:注册要有完整流程与终点)
--
-- 症状:从子域应用发起注册,手机验证通过就直接回跳应用了,没有补齐信息、也没有
-- 「注册完成」的提示;过一阵再开 console 又被弹去补齐。根因在 auth-bff 的
-- completeLoginWithPhone —— 它拿到了 { user, isNew } 却只解构 user,把 isNew 丢掉,
-- 新老用户走同一个出口。而唯一真正跑着的补齐门在 console 外壳里,判据是
-- 「用户名还长得像建号时发的默认值 `_{user_no}`」。
--
-- 那个判据是**推断**不是事实:分不清「完成过」「跳过了」「从没问过」,统计不出漏斗,
-- 将来任何一处改了用户名它就悄悄失效。这一列把事实记下来,门读事实。
--
--   account.users.profile_completed_at timestamptz  -- NULL = 尚未完成注册补齐
--
-- 回填:存量账号一律视为已完成(取 created_at)。**不把老用户挡在门外**——补齐现在
-- 要求邮箱必填,拿它去拦存量用户等于让一批人下次登录被卡住,那是产品裁定不是迁移
-- 该顺手做的事。只有回填之后新建的账号才会走新流程。
--
-- 表在 98 列锁之下:同时补 platform_svc 的列级 GRANT(DDL 已同步)。
-- 幂等:整份可重跑。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE account.users
  ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz;

COMMENT ON COLUMN account.users.profile_completed_at IS
  '注册补齐完成时刻;NULL = 尚未完成(登录后会被 IdP 引到补齐页)。回填时存量账号取 created_at。';

GRANT UPDATE (profile_completed_at) ON account.users TO platform_svc;

-- 回填只跑一次:仅填 NULL 的行,重跑不会把后来新建、确实没完成的账号误标成已完成
-- ——因为那些行是在本次回填之后创建的,而下面这条只认 created_at 早于本次执行的行。
UPDATE account.users
   SET profile_completed_at = created_at
 WHERE profile_completed_at IS NULL
   AND created_at < now();

DO $$
DECLARE v int; unfilled int;
BEGIN
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema = 'account' AND table_name = 'users'
     AND column_name = 'profile_completed_at';
  IF v <> 1 THEN
    RAISE EXCEPTION '迁移未落地:account.users.profile_completed_at 不存在';
  END IF;

  SELECT count(*) INTO unfilled FROM account.users WHERE profile_completed_at IS NULL;
  IF unfilled > 0 THEN
    RAISE EXCEPTION '回填不完整:仍有 % 行 profile_completed_at 为空', unfilled;
  END IF;

  -- GRANT 是活库上的事实,静态文件核不出来(列锁漂移的老教训):直接问 catalog。
  SELECT count(*) INTO v FROM information_schema.column_privileges
   WHERE table_schema = 'account' AND table_name = 'users'
     AND column_name = 'profile_completed_at'
     AND grantee = 'platform_svc' AND privilege_type = 'UPDATE';
  IF v < 1 THEN
    RAISE EXCEPTION 'platform_svc 缺 profile_completed_at 的 UPDATE 列权限';
  END IF;
END $$;

COMMIT;
