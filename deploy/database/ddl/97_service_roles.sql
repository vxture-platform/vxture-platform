-- ═══════════════════════════════════════════════════════════════════════════
-- 97_service_roles.sql — 非-owner 应用服务角色（TD-018，铁律八列级锁前置）
-- 权威依据：data_platform_100_architecture.md §2.2.4 铁律八 + §3.2.4 检测器 #4。
--
-- 背景：应用此前一律以 schema/表 owner `vxture` 连库——PostgreSQL 列级权限对
-- owner/superuser 无效，故锚点列（id/*_no/created_at/rank 等）的列级 REVOKE/GRANT
-- 若对 owner 写入即为无效摆设（见 98_column_locks.sql 头注）。本文件建立两个非-owner
-- 角色，供应用运行时连库使用（DDL/迁移仍以 owner `vxture` 执行，见 apply.sh）：
--
--   platform_svc — 全部 5 个平台服务进程（auth-bff/website-bff/console-bff/
--                  admin-bff RW 池/model-platform）共用的应用角色（TD-018 owner
--                  决策 2026-07-05：先建单一共享角色直接封死"owner 绕过列锁"这一
--                  核心缺口；按进程/域精细拆分服务角色是独立的最小权限隔离后续项，
--                  不与本轮列锁加固混做，避免把两类改动的风险叠在一次生产切换里）。
--   reporting_ro — admin-bff 报表只读池（REPORTING_RO_DATABASE_URL，TD-015）专用；
--                  此前该变量未配置时静默降级回 RW/owner 连接，本轮一并补上角色本体。
--
-- 幂等：CREATE ROLE 用 DO 块判存在性（PG 无原生 CREATE ROLE IF NOT EXISTS）；
--   GRANT 每次 apply 重新授权（--reset 会 DROP 重建 19 schema，角色本身不受影响，
--   但新建的 schema/表需要重新 GRANT）。
-- 密码管理：占位 REPLACE_ME_<role>，禁止提交真实密码；生产部署经 secrets 用
--   ALTER ROLE <role> PASSWORD '...' 单独设置（不进本文件、不进任何仓库文件）。
-- 生产切换（角色建成后）：把各服务 DATABASE_URL 从 vxture 切到 platform_svc、
--   REPORTING_RO_DATABASE_URL 切到 reporting_ro，属独立部署动作，本文件只建立
--   角色与权限，不隐含切换时机。
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'platform_svc') THEN
    CREATE ROLE platform_svc LOGIN PASSWORD 'REPLACE_ME_platform_svc';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reporting_ro') THEN
    CREATE ROLE reporting_ro LOGIN PASSWORD 'REPLACE_ME_reporting_ro';
  END IF;
END
$$;

-- ── GRANT: platform_svc（读写，全部 19 schema）─────────────────────────────
-- 权限面与今天的 owner 访问范围一致（今天本就是无限制 owner），本轮不做按服务/
-- 按 schema 的最小权限切分——见文件头注，切分是独立后续项。

GRANT USAGE ON SCHEMA
  account, identity, credential, kyc, tenancy, access, appoidc, session, loyalty,
  metering, billing, provisioning, promotion,
  product, safety, support, admin, sharing
  TO platform_svc;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA
  account, identity, credential, kyc, tenancy, access, appoidc, session, loyalty,
  metering, billing, provisioning, promotion,
  product, safety, support, admin, sharing
  TO platform_svc;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA
  account, identity, credential, kyc, tenancy, access, appoidc, session, loyalty,
  metering, billing, provisioning, promotion,
  product, safety, support, admin, sharing
  TO platform_svc;

ALTER DEFAULT PRIVILEGES IN SCHEMA
  account, identity, credential, kyc, tenancy, access, appoidc, session, loyalty,
  metering, billing, provisioning, promotion,
  product, safety, support, admin, sharing
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO platform_svc;

ALTER DEFAULT PRIVILEGES IN SCHEMA
  account, identity, credential, kyc, tenancy, access, appoidc, session, loyalty,
  metering, billing, provisioning, promotion,
  product, safety, support, admin, sharing
  GRANT USAGE, SELECT ON SEQUENCES TO platform_svc;

-- ── GRANT: reporting_ro（只读，全部 19 schema）──────────────────────────────

GRANT USAGE ON SCHEMA
  account, identity, credential, kyc, tenancy, access, appoidc, session, loyalty,
  metering, billing, provisioning, promotion,
  product, safety, support, admin, sharing
  TO reporting_ro;

GRANT SELECT ON ALL TABLES IN SCHEMA
  account, identity, credential, kyc, tenancy, access, appoidc, session, loyalty,
  metering, billing, provisioning, promotion,
  product, safety, support, admin, sharing
  TO reporting_ro;

ALTER DEFAULT PRIVILEGES IN SCHEMA
  account, identity, credential, kyc, tenancy, access, appoidc, session, loyalty,
  metering, billing, provisioning, promotion,
  product, safety, support, admin, sharing
  GRANT SELECT ON TABLES TO reporting_ro;

-- ═══════════════════════════════════════════════════════════════════════════
-- TD-020 — 按进程最小权限服务角色（收窄 platform_svc 的全库爆炸半径）
--
-- platform_svc（上）= 全 19 schema RW，等同 owner 访问范围。下列 6 个角色按各
-- 平台进程**运行时实际触达的 schema 集**授权（进程→schema 映射见
-- docs/design/data_platform_330_service-role-least-privilege.md）——凭据泄露的横向
-- 移动半径从"全库"收窄到该进程用得到的几个 schema。
--
-- 授权面选型（本轮）：**只授触达 schema、在其内给 RW**。不在本轮做 R-vs-RW 精调
--   （website-bff 等虽多为读，但 AccountModule/OrganizationModule 写能力在同池、
--   且 me/profile 确有 account 写路径；逐 schema 精确析出读写边界易错、切错即运行时
--   炸——精调留独立后续项）。`safety` schema 零进程访问，一律不授。
--
-- 生产切换（角色建成后，owner 分批）：把各进程 DATABASE_URL 从 platform_svc 逐个
--   切到对应 svc_* 角色，每次只动一个进程、验证后再下一个（用 33-recreate-service.sh
--   重建单服务）；全部切完后 platform_svc 可退役。本文件只建角色+授权，不切换。
-- 密码：占位 REPLACE_ME_<role>，生产经 32-provision-service-db-roles.sh 设真实值。
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'svc_auth_bff','svc_admin_bff','svc_console_bff',
    'svc_website_bff','svc_platform_api'
  ] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', r, 'REPLACE_ME_' || r);
    END IF;
  END LOOP;
END
$$;

-- 每角色：USAGE + SEL/INS/UPD/DEL + 序列 + 默认权限，仅在其触达 schema 集内。
-- 用 DO 块按 (role, schema[]) 表逐条 GRANT，避免 6×4 段重复样板。
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- auth-bff（13）：身份/会话/OIDC 签发 + 权益 claim 刷新 + 操作员内部面
      ('svc_auth_bff',    ARRAY['account','identity','credential','tenancy','access','appoidc','session','loyalty','metering','provisioning','product','support','admin']),
      -- admin-bff（12）：运营治理/账单/工单/租户/订阅/目录 + provisioning（段 2 激活
      -- enqueue，320 期缺口随 product_321 PR2 收口）
      ('svc_admin_bff',   ARRAY['admin','billing','kyc','metering','product','support','tenancy','access','account','promotion','session','provisioning']),
      -- console-bff（15）：租户工作台，账单/订阅/成员 + IamModule 带入 admin/support/appoidc
      -- + promotion（券结算，product_321）+ provisioning（cashDue=0 段 2 enqueue / free 即开）
      ('svc_console_bff', ARRAY['account','identity','credential','session','loyalty','tenancy','access','billing','metering','product','admin','support','appoidc','promotion','provisioning']),
      -- website-bff（7）：注册/登录/me，多为读，account 有 profile 写
      ('svc_website_bff', ARRAY['account','identity','credential','session','tenancy','access','loyalty']),
      -- platform-api（7）：C2/C3 产品面 + provisioning/sharing 作业
      -- + billing/promotion（product_321 超时/对账 sweep 谓词 + 券释放）
      -- + billing/promotion（product_321 超时/对账 sweep 谓词 + 券释放）
      ('svc_platform_api',ARRAY['metering','product','sharing','provisioning','tenancy','billing','promotion'])
      -- svc_model_platform 已随 Atlas 拆仓退役（2026-08-18）：model schema 不复存在。
    ) AS t(role_name, schemas)
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %s TO %I',
      array_to_string(spec.schemas, ', '), spec.role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %s TO %I',
      array_to_string(spec.schemas, ', '), spec.role_name);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %s TO %I',
      array_to_string(spec.schemas, ', '), spec.role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %s GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
      array_to_string(spec.schemas, ', '), spec.role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %s GRANT USAGE, SELECT ON SEQUENCES TO %I',
      array_to_string(spec.schemas, ', '), spec.role_name);
  END LOOP;
END
$$;
