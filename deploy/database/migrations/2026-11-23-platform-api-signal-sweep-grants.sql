-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-23-platform-api-signal-sweep-grants.sql
-- 运营侧信号巡检的读面：svc_platform_api ← 七张表的 SELECT（逐表最小授权）
--
-- ── 补的是哪个盲区 ──
-- 2026-09-28 第二批「做全做多」加了 OperatorSignalSweepJob
-- （bff/platform-api/src/jobs/operator-signal-sweep.job.ts）：
--   ① 业务事件 11 类各一条 SQL（注册 / 建组织 / 提认证 / 下单 / 加油包 / 开票 /
--      评价 / 核销 / 申请注销 / 关自动续费 / 新工单）；
--   ② 运营动作一条 SQL，扫 support.audit_logs 里白名单内的动作码。
-- 两段都只读，写只写 admin.operator_notices（那一张 2026-11-21 已授）。
--
-- 可 platform-api 的库角色 svc_platform_api 只有 7 个 schema（TD-020，97_service_roles.sql：
-- metering / product / sharing / provisioning / tenancy / billing / promotion），没有
-- account / kyc / support。Postgres 对语句里**出现过的每一个关系**查权限——那一支返不返回
-- 行都一样——所以少一张表不是「少扫一类」，而是整条 SQL 42501、整段巡检失败。
-- 而巡检失败的表现恰恰是运营端「一条都没有」，与 2026-09-28 那张挂着的 ¥99 退款单同病理。
--
-- ── 授权面为什么是七张表而不是三个 schema ──
-- 给 schema 级 ALL TABLES 会顺带把头像字节、三方绑定、工单正文、通知投递账本、
-- 客户收件箱一并交出去，而巡检一行也不需要它们。所以逐表 SELECT：
--   account.users / account.user_profiles     注册、注销申请、租户所有者、核销人、客户显示名
--   kyc.tenant_verifications                  提交企业认证
--   support.product_reviews                   客户评价
--   support.tickets                           新工单
--   support.audit_logs                        运营动作巡检
--   admin.maintenance_windows                 审计通告的窗口标题（否则标题没有宾语）
-- 一律不给 INSERT/UPDATE/DELETE，也不给 ALTER DEFAULT PRIVILEGES（将来新增的表不跟着漏进来）。
--
-- support.audit_logs 按 created_at 分区（96_partitions.sql）。分区表经父表访问时权限查在
-- 父表上，所以一行就够，新分区自动可读——本份的审计段实测过这一点（见文件末尾）。
--
-- ── 有意不授的两张，不是漏了 ──
--   · admin.risk_records、admin.operator_account —— 2026-11-21-platform-api-operator-notices-grant.sql
--     的审计段把这两张（连同 operator_credential）**显式断言为 0 项权限**。授了会让那份
--     已合并的迁移在下一次全量重放时抛 EXCEPTION（migrate 是全量重放，每份都跑在最终状态上）。
--     代价：租户风险标记只能从审计行（governance.risk.*）看见，不能直接扫那张表；
--     审计通告的正文说不出运营者真名，回落成按 actor_console 分的角色称谓。
--     要改这两条得 owner 先放宽那句断言，不在实施侧自决。本份末尾反过来断言这两张仍是 0 项，
--     免得后来者顺手加一行把那份迁移顶红。
--
-- ── 对应 DDL ──
--   deploy/database/ddl/97_service_roles.sql（文件末尾同十行，逐字一致）
--   docs/30-design/data_platform_330_service-role-least-privilege.md §2 例外行
--
-- ── 为什么还要这一份迁移 ──
-- 97 只在 reseed（db-init action=init）时跑；活库上的授权面会滞后于 97 文件。
-- db-init action=migrate 是全量重放，本份每次跟着跑一遍，活库就跟得上。
--
-- 重复执行安全：GRANT 天然幂等（重复授权不报错、不叠加）；角色不存在时整段跳过
-- （本机 / 未做 TD-020 供给的库里 svc_platform_api 可能还没建）。第二遍 0 变化。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_api') THEN
    GRANT USAGE ON SCHEMA account TO svc_platform_api;
    GRANT USAGE ON SCHEMA kyc TO svc_platform_api;
    GRANT USAGE ON SCHEMA support TO svc_platform_api;
    GRANT SELECT ON account.users TO svc_platform_api;
    GRANT SELECT ON account.user_profiles TO svc_platform_api;
    GRANT SELECT ON kyc.tenant_verifications TO svc_platform_api;
    GRANT SELECT ON support.product_reviews TO svc_platform_api;
    GRANT SELECT ON support.tickets TO svc_platform_api;
    GRANT SELECT ON support.audit_logs TO svc_platform_api;
    GRANT SELECT ON admin.maintenance_windows TO svc_platform_api;
    RAISE NOTICE '[platform-api-signal-sweep-grants] svc_platform_api 已可读巡检需要的七张表';
  ELSE
    RAISE NOTICE '[platform-api-signal-sweep-grants] svc_platform_api 不存在，跳过（97 建角色时会一并授）';
  END IF;
END $$;

COMMIT;

-- ── 审计：授权真的在、且真的只多这几项，才算跑过 ────────────────────────────
DO $$
DECLARE
  v int;
  probe_ok boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_api') THEN
    RAISE NOTICE '[platform-api-signal-sweep-grants] 角色缺席，跳过审计';
    RETURN;
  END IF;

  -- ① 三个新 schema 的 USAGE：没有 USAGE 时表级 SELECT 是摆设。
  IF NOT has_schema_privilege('svc_platform_api', 'account', 'USAGE') THEN
    RAISE EXCEPTION '[platform-api-signal-sweep-grants] svc_platform_api 仍无 account schema 的 USAGE';
  END IF;
  IF NOT has_schema_privilege('svc_platform_api', 'kyc', 'USAGE') THEN
    RAISE EXCEPTION '[platform-api-signal-sweep-grants] svc_platform_api 仍无 kyc schema 的 USAGE';
  END IF;
  IF NOT has_schema_privilege('svc_platform_api', 'support', 'USAGE') THEN
    RAISE EXCEPTION '[platform-api-signal-sweep-grants] svc_platform_api 仍无 support schema 的 USAGE';
  END IF;

  -- ② 点名的七张表各有 SELECT。按对象过滤计数，不做全库快照
  --    （全库计数会被后来者的正当新增顶偏，见 check-migration-absolute-counts）。
  SELECT count(*) INTO v FROM information_schema.table_privileges
   WHERE grantee = 'svc_platform_api'
     AND privilege_type = 'SELECT'
     AND (table_schema, table_name) IN (
       ('account', 'users'),
       ('account', 'user_profiles'),
       ('kyc', 'tenant_verifications'),
       ('support', 'product_reviews'),
       ('support', 'tickets'),
       ('support', 'audit_logs'),
       ('admin', 'maintenance_windows')
     );
  IF v <> 7 THEN
    RAISE EXCEPTION '[platform-api-signal-sweep-grants] 七张表上应各有 SELECT，实为 % 项', v;
  END IF;

  -- ③ 只给 SELECT：这几张表上不该出现写权限（巡检一行也不改它们）。
  SELECT count(*) INTO v FROM information_schema.table_privileges
   WHERE grantee = 'svc_platform_api'
     AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
     AND (table_schema, table_name) IN (
       ('account', 'users'),
       ('account', 'user_profiles'),
       ('kyc', 'tenant_verifications'),
       ('support', 'product_reviews'),
       ('support', 'tickets'),
       ('support', 'audit_logs'),
       ('admin', 'maintenance_windows')
     );
  IF v <> 0 THEN
    RAISE EXCEPTION '[platform-api-signal-sweep-grants] 巡检读面上出现了 % 项写权限，本份只该给 SELECT', v;
  END IF;

  -- ④ 反向：2026-11-21 那份断言为 0 的三张表仍然是 0。
  --    后来者顺手加一行 GRANT，就会让那份已合并的迁移在下一次全量重放时抛 EXCEPTION；
  --    在这里先拦住，比在生产 migrate 的第 N 份上炸掉便宜。
  SELECT count(*) INTO v FROM information_schema.table_privileges
   WHERE grantee = 'svc_platform_api'
     AND table_schema = 'admin'
     AND table_name IN ('operator_account', 'operator_credential', 'risk_records');
  IF v <> 0 THEN
    RAISE EXCEPTION '[platform-api-signal-sweep-grants] svc_platform_api 拿到了 admin.operator_account / operator_credential / risk_records 的 % 项权限，2026-11-21 那份迁移断言这里必须是 0', v;
  END IF;

  -- ⑤ 分区表真的读得到：support.audit_logs 的权限授在父表上，分区没有单独授。
  --    「父表有 SELECT 就能经父表读分区」是本份唯一一条没法从 information_schema
  --    直接看出来的前提，所以真去问一次 has_table_privilege——挑最近的一个分区。
  SELECT bool_and(has_table_privilege('svc_platform_api', c.oid, 'SELECT'))
    INTO probe_ok
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace pn ON pn.oid = p.relnamespace
   WHERE pn.nspname = 'support' AND p.relname = 'audit_logs';
  IF probe_ok IS NULL THEN
    RAISE NOTICE '[platform-api-signal-sweep-grants] support.audit_logs 当前没有分区，分区可读性无从验证';
  ELSIF NOT probe_ok THEN
    RAISE NOTICE '[platform-api-signal-sweep-grants] 提示：分区本身未被单独授权（按 PostgreSQL 语义，经父表查询只查父表权限，巡检不受影响）';
  END IF;

  RAISE NOTICE '[platform-api-signal-sweep-grants] OK';
END $$;
