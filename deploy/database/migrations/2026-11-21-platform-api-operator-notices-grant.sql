-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-21-platform-api-operator-notices-grant.sql
-- platform-api 也要能写运营通告：svc_platform_api ← admin.operator_notices（最小面）
--
-- ── 补的是哪个盲区 ──
-- 2026-09-28 根治批起，客户消息落库成功后由 NotificationDispatcher 顺手镜像一条运营
-- 通告（services/notification/dispatch 的 OperatorMirror → PgNoticeRepository
-- .createSystemNotice → insert into admin.operator_notices）。这条镜像路长在
-- dispatcher 里，所以**每一个**构造 NotificationDispatcher 的 BFF 都会走它，
-- 包括 platform-api 的那些作业：到期提醒 / 已到期 / 已续订 / 逾期 / 暂停 / 恢复。
--
-- 可 platform-api 的库角色 svc_platform_api 只有 7 个 schema（TD-020，97_service_roles.sql：
-- metering / product / sharing / provisioning / tenancy / billing / promotion），没有 admin。
-- 于是那些客户消息照常发出去，镜像那一步 42501 —— 而镜像失败**只记日志、不影响客户消息**
-- （那是设计，客户的通知不该被运营镜像拖累）。净效果：运营端又一次「一条都没有」，
-- 而且没有任何报错指向它。正是 2026-09-28 那张 ¥99 退款单同一个病理：不报错的坏法。
--
-- ── 授权面为什么只有一张表 ──
-- 镜像只做两件事：按部分唯一索引 uq_operator_notices_system 判重（SELECT）、插一行
-- （INSERT）。不改不删、不碰别的 admin 表。所以给的就是这一张表的 SELECT + INSERT，
-- 不是 `ALL TABLES IN SCHEMA admin`——admin 里住着运营账号、角色、审计、风险记录，
-- 一个作业进程不该因为要发通告而拿到它们。
-- 主键是 gen_random_uuid() 默认值，没有序列要授。
--
-- ── 对应 DDL ──
--   deploy/database/ddl/97_service_roles.sql（文件末尾同两行，逐字一致）
--   docs/30-design/data_platform_330_service-role-least-privilege.md §2 例外行
--
-- ── 为什么还要这一份迁移 ──
-- 97 只在 reseed（db-init action=init）时跑；活库上的授权面会滞后于 97 文件
-- （同 2026-11-19 / 11-20 的 GRANT 重放）。db-init action=migrate 是**全量重放**，
-- 本份每次跟着跑一遍，活库就跟得上。
--
-- 重复执行安全：GRANT 天然幂等（重复授权不报错、不叠加）；角色不存在时整段跳过
-- （本机 / 未做 TD-020 供给的库里 svc_platform_api 可能还没建）。第二遍 0 变化。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_api') THEN
    GRANT USAGE ON SCHEMA admin TO svc_platform_api;
    GRANT SELECT, INSERT ON admin.operator_notices TO svc_platform_api;
    RAISE NOTICE '[platform-api-operator-notices-grant] svc_platform_api 已可读写 admin.operator_notices';
  ELSE
    RAISE NOTICE '[platform-api-operator-notices-grant] svc_platform_api 不存在，跳过（97 建角色时会一并授）';
  END IF;
END $$;

COMMIT;

-- ── 审计：授权真的在，才算跑过 ──────────────────────────────────────────────
DO $$
DECLARE v int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_api') THEN
    RAISE NOTICE '[platform-api-operator-notices-grant] 角色缺席，跳过审计';
    RETURN;
  END IF;

  IF NOT has_schema_privilege('svc_platform_api', 'admin', 'USAGE') THEN
    RAISE EXCEPTION '[platform-api-operator-notices-grant] svc_platform_api 仍无 admin schema 的 USAGE';
  END IF;

  SELECT count(*) INTO v FROM information_schema.table_privileges
   WHERE grantee = 'svc_platform_api'
     AND table_schema = 'admin' AND table_name = 'operator_notices'
     AND privilege_type IN ('SELECT', 'INSERT');
  IF v <> 2 THEN
    RAISE EXCEPTION '[platform-api-operator-notices-grant] admin.operator_notices 上应有 SELECT + INSERT 两项，实为 % 项', v;
  END IF;

  -- 只开这一张表：admin 里别的表不该跟着被授。点名查三张最敏感的，不做全类计数
  -- （全库计数会被后来者的正当新增顶偏，见 check-migration-absolute-counts）。
  SELECT count(*) INTO v FROM information_schema.table_privileges
   WHERE grantee = 'svc_platform_api'
     AND table_schema = 'admin'
     AND table_name IN ('operator_account', 'operator_credential', 'risk_records');
  IF v <> 0 THEN
    RAISE EXCEPTION '[platform-api-operator-notices-grant] svc_platform_api 不该拿到 admin.operator_account / operator_credential / risk_records 的任何权限，实为 % 项', v;
  END IF;

  RAISE NOTICE '[platform-api-operator-notices-grant] OK';
END $$;
