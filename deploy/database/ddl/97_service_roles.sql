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

-- ── svc_platform_api 的一处跨域例外：admin.operator_notices（运营镜像）──────────
-- 2026-09-28 根治批起，客户消息落库后由 NotificationDispatcher 顺手镜像一条运营通告
-- （services/notification/dispatch 的 OperatorMirror → PgNoticeRepository.createSystemNotice
-- → insert into admin.operator_notices）。这条镜像路**在每一个 BFF 里都会走**，包括
-- platform-api 的到期 / 续订 / 逾期 / 暂停 / 恢复那些作业——而上面的 7 schema 授权面里
-- 没有 admin，那些客户消息会照常发出去、镜像那一步静默失败（写失败只记日志，不影响
-- 客户消息）。结果就是运营端又一次「一条都没有」，而且不报错。
--
-- 只开这一张表（不是整个 admin schema 的 ALL TABLES）：镜像只 INSERT，去重要 SELECT
-- （ON CONFLICT 的部分唯一索引），别的 admin 表一律不给。
GRANT USAGE ON SCHEMA admin TO svc_platform_api;
GRANT SELECT, INSERT ON admin.operator_notices TO svc_platform_api;

-- ── svc_platform_api 的读面例外：运营侧信号巡检（OperatorSignalSweepJob，2026-09-28）──
-- 第二批「做全做多」加了两条巡检（bff/platform-api/src/jobs/operator-signal-sweep.job.ts）：
-- 业务事件 11 类各一条 SQL，运营动作扫 support.audit_logs 的白名单动作码，逐行写一条
-- 运营通告。Postgres 对语句里**出现过**的每一个关系查权限（哪一支返不返回行都一样），
-- 所以下面这几张表少一张，整段巡检就是 42501 —— 运营端又一次「一条都没有」。
--
-- 为什么不是给 account / kyc / support 三个 schema 的 ALL TABLES：那会顺带把凭据
-- （credential 虽是另一 schema，但 account 里还有头像字节、三方绑定）、工单正文附件、
-- 通知投递账本、收件箱全给进去。巡检只读下面七张，逐表授权、且只给 SELECT
-- （它一行也不改这些表——写只写 admin.operator_notices）。也不给
-- ALTER DEFAULT PRIVILEGES：将来新增的表不会跟着漏进来。
--
-- support.audit_logs 是按 created_at 分区的（96_partitions.sql）。分区表经父表访问时
-- 权限查在**父表**上，所以这一行就够，不必逐分区授——新分区自动可读。
--
-- 有意不授的两张（不是漏了）：
--   · admin.risk_records —— 2026-11-21 那份 grant 迁移的审计段把它与 operator_account /
--     operator_credential 一起**显式断言为 0 项权限**，授了会让那份已合并迁移在下一次
--     全量重放时抛 EXCEPTION。租户风险标记的运营可见性因此走审计巡检的
--     governance.risk.*（人在治理台按出来的动作有审计行），不直接扫那张表。
--   · admin.operator_account —— 同上。代价是审计通告的正文说不出运营者真名，回落成
--     按 actor_console 分的角色称谓（见 audit-event-signals.ts 头注）。两条都要 owner
--     先放宽那句断言才能改，不在实施侧自决。
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

-- ── svc_platform_api 的写面例外：客户通知的投递（批 5，2026-09-28）─────────
-- 这一条今天**没有运行时效果**：5 个服务容器仍由
-- deploy/scripts/32-provision-service-db-roles.sh 生成的 platform-app.env 统一走
-- platform_svc，那个角色在 2026-09-08-inbox-messages.sql 里已经有完整权限。
-- 写在这里是为了拦下**按服务分角色切换的那一天**：到时 svc_platform_api
-- 接上去而 support 不在它的 schema 数组里，platform-api 里所有客户通知会统一撑 42501——
-- 而派送器是失败隔离的（每个收件人各自 try/catch），所以那会是**静默全没**，
-- 不是报错。本批把这条路上的通知从 5 条加到 9 条，陷阱只会更大。
--
-- 只给这两张、只给读写不给 DELETE；也不给 ALTER DEFAULT PRIVILEGES（同上面那段的理由）。
-- SELECT 是必需的：去重靠 uq_inbox_messages_dedupe 的 on conflict，而投递账本要回读重试次数。
-- 注意：本文件是 apply 路径的权威，**不会被 migrate 重放到存量库**；
-- 切角色那一次需要另写一份迁移把这两行灌进活库（跟 98 列锁同一个毛病）。
GRANT SELECT, INSERT, UPDATE ON support.inbox_messages TO svc_platform_api;
GRANT SELECT, INSERT, UPDATE ON support.notification_logs TO svc_platform_api;
