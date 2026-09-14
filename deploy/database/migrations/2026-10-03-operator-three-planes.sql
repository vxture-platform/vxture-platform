-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 运营权限拆成三个平台：admin（运营）/ opera（运维）/ arche（治理）
--
-- 依据：owner 2026-09-14「三个平面，包括 bff，必须严格隔离，不能有互相引用的代码，
-- 可以重复但不能耦合」「三个根需要统一」。
--
-- 此前的树有两个根：`admin.workspace.tenant_ops`（运营业务域）与
-- `admin.workspace.platform`（平台自治域，三平面拆分后实际是 arche 的页面）。opera
-- 没有根，它检查的码挂在 admin 的页面下；另有几个码被两个平台同时检查
-- （capability:runos.read、notification:log.read、model:*.manage 经 admin 的旧桥），
-- 在一处授权就顺带打开另一个平台的门。
--
-- 本迁移之后：
--   · 三个根同形：admin.plane / opera.plane / arche.plane，节点码 {plane}.menu.*；
--   · 一个码只属于一个平台，判据是码的域（seed-catalog.mjs OPERATOR_PLANE_DOMAINS）：
--       admin  tenant user commerce promotion product content support pricing
--       opera  model capability integration ops
--       arche  operator audit compliance risk config
--   · 被两个平台检查的能力拆成两个码；原持有者两边都拿到，没有人因此失去访问；
--   · 每个角色按「持有子节点必持有祖先」闭包补齐，平台根码由此自动授予——
--     三个 BFF 以根码作为进入本平台的门；
--   · 平台角色的 created_by 一律指向真实的 systemadmin 账号，列改 NOT NULL。
--
-- 幂等：整份可重跑。与 seed-catalog.mjs 同源，守卫 lint:operator-planes 核对。
-- 顺序：先 migrate 再 deploy（新镜像按新码校验，旧库上会全员 403）。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. 锚点：systemadmin（seed 的 SYS），系统预置行的 created_by / updated_by ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin.operator_account WHERE username = 'systemadmin') THEN
    RAISE EXCEPTION '[three-planes] 找不到 systemadmin 锚点账号';
  END IF;
END $$;

-- ── 1. 两个旧根原地改码（id 不变，已有授权随行）──────────────────────────────
UPDATE admin.operator_permission
   SET perm_code = 'admin.plane', perm_name = '运营平台', description = '运营平台',
       icon = 'buildings', sort = 10, updated_at = now()
 WHERE perm_code = 'admin.workspace.tenant_ops';

UPDATE admin.operator_permission
   SET perm_code = 'arche.plane', perm_name = '治理平台', description = '治理平台',
       icon = 'shield-check', sort = 30, updated_at = now()
 WHERE perm_code = 'admin.workspace.platform';

-- ── 2. 原「平台自治域」的节点改成 arche 的码与 arche 的真实路由 ─────────────────
--    旧 route_path 还是 admin 时代的 /platform-admins、/admin-roles、/platform。
UPDATE admin.operator_permission p
   SET perm_code = v.new_code, perm_name = v.name, description = v.name,
       route_path = v.route, sort = v.sort, updated_at = now()
  FROM (VALUES
    ('admin.menu.platform_overview',   'arche.menu.overview',           '治理总览', '/',                  10),
    ('admin.menu.identity_access',     'arche.menu.identity_access',    '身份权限', NULL,                 20),
    ('admin.menu.platform_admin',      'arche.menu.platform_admin',     '平台用户', '/admins',            10),
    ('admin.menu.platform_role',       'arche.menu.platform_role',      '平台角色', '/roles',             20),
    ('admin.menu.permission_policy',   'arche.menu.permission_policy',  '权限策略', '/permissions',       30),
    ('admin.menu.security_audit',      'arche.menu.security_audit',     '安全审计', NULL,                 30),
    ('admin.menu.audit_log',           'arche.menu.audit_log',          '审计日志', '/audit-logs',        10),
    ('admin.menu.risk_record',         'arche.menu.risk_record',        '风险记录', '/risk-records',      20),
    ('admin.menu.compliance_event',    'arche.menu.compliance_event',   '合规事件', '/compliance-events', 30),
    ('admin.menu.system_setting',      'arche.menu.system_config',      '系统配置', NULL,                 40),
    ('admin.menu.system_parameter',    'arche.menu.system_parameter',   '参数配置', '/system-parameters', 10),
    ('admin.menu.feature_toggle',      'arche.menu.feature_toggle',     '开关控制', '/feature-toggles',   20),
    ('admin.menu.notification_center', 'arche.menu.notification_audit', '通知审计', NULL,                 50),
    ('admin.menu.notification_log',    'arche.menu.notification_log',   '发送记录', '/notification-logs', 10)
  ) AS v(old_code, new_code, name, route, sort)
 WHERE p.perm_code = v.old_code;

-- ── 3. 「模型计价与策略」（/atlas）早已在 admin 侧栏的「模型技能」下，树跟上 ────
UPDATE admin.operator_permission c
   SET parent_id = p.id, perm_name = '模型计价与策略', description = '模型计价与策略',
       sort = 10, updated_at = now()
  FROM admin.operator_permission p
 WHERE p.perm_code = 'admin.menu.model_skill'
   AND c.perm_code = 'admin.menu.model_gateway';

UPDATE admin.operator_permission
   SET sort = 20, perm_name = '能力目录', description = '能力目录', updated_at = now()
 WHERE perm_code = 'admin.menu.skill_market';

-- ── 4. arche 新页面 + opera 整棵树 ─────────────────────────────────────────────
--    **每层一条 INSERT。** 同一条语句里的子查询看不见本语句刚插入的行（快照），
--    合成一条的话第 2、3 层的 parent_id 全是 NULL。
CREATE TEMP TABLE _plane_nodes ON COMMIT DROP AS
SELECT * FROM (VALUES
    (1, 'opera.plane',                      '运维平台',   NULL,                              NULL,                      'server', 20),
    (2, 'opera.menu.overview',              '总览',       'opera.plane',                     '/',                       NULL,     10),
    (2, 'opera.menu.model_management',      '模型管理',   'opera.plane',                     NULL,                      NULL,     20),
    (2, 'opera.menu.capability_management', '能力管理',   'opera.plane',                     NULL,                      NULL,     30),
    (2, 'opera.menu.product_management',    '产品管理',   'opera.plane',                     NULL,                      NULL,     40),
    (2, 'opera.menu.runtime_monitor',       '运行监控',   'opera.plane',                     NULL,                      NULL,     50),
    (2, 'opera.menu.security_audit',        '安全审计',   'opera.plane',                     NULL,                      NULL,     60),
    (2, 'opera.menu.system_setting',        '系统配置',   'opera.plane',                     '/settings',               NULL,     70),
    (3, 'opera.menu.model_service',         '模型服务',   'opera.menu.model_management',     '/model/services',         NULL,     10),
    (3, 'opera.menu.model_route',           '模型路由',   'opera.menu.model_management',     '/model/routes',           NULL,     20),
    (3, 'opera.menu.model_grant',           '路由授权',   'opera.menu.model_management',     '/model/grants',           NULL,     30),
    (3, 'opera.menu.model_key',             '调用密钥',   'opera.menu.model_management',     '/model/keys',             NULL,     40),
    (3, 'opera.menu.model_metering',        '用量计量',   'opera.menu.model_management',     '/model/metering',         NULL,     50),
    (3, 'opera.menu.capability_registry',   '能力注册',   'opera.menu.capability_management','/capability/registry',    NULL,     10),
    (3, 'opera.menu.capability_credential', '凭证托管',   'opera.menu.capability_management','/capability/credentials', NULL,     20),
    (3, 'opera.menu.capability_grant',      '能力授权',   'opera.menu.capability_management','/capability/grants',      NULL,     30),
    (3, 'opera.menu.capability_metering',   '用量计量',   'opera.menu.capability_management','/capability/metering',    NULL,     40),
    (3, 'opera.menu.product_catalog',       '产品目录',   'opera.menu.product_management',   '/product/catalog',        NULL,     10),
    (3, 'opera.menu.product_client',        '接入凭据',   'opera.menu.product_management',   '/product/clients',        NULL,     20),
    (3, 'opera.menu.product_entitlement',   '权益配置',   'opera.menu.product_management',   '/product/entitlements',   NULL,     30),
    (3, 'opera.menu.ops_health',            '服务状态',   'opera.menu.runtime_monitor',      '/ops/health',             NULL,     10),
    (3, 'opera.menu.ops_metric',            '运行指标',   'opera.menu.runtime_monitor',      '/ops/metrics',            NULL,     20),
    (3, 'opera.menu.ops_log',               '调用日志',   'opera.menu.runtime_monitor',      '/ops/logs',               NULL,     30),
    (3, 'opera.menu.ops_job',               '任务调度',   'opera.menu.runtime_monitor',      '/ops/jobs',               NULL,     40),
    (3, 'opera.menu.ops_maintenance',       '维护窗口',   'opera.menu.runtime_monitor',      '/ops/maintenance',        NULL,     50),
    (3, 'opera.menu.audit_change',          '变更审计',   'opera.menu.security_audit',       '/audit/changes',          NULL,     10),
    (3, 'arche.menu.sign_in_session',       '登录与会话', 'arche.menu.identity_access',      '/sessions',               NULL,     40)
) AS v(depth, code, name, parent, route, icon, sort);

DO $$
DECLARE d int;
BEGIN
  FOR d IN 1..3 LOOP
    INSERT INTO admin.operator_permission
      (perm_code, perm_type, perm_name, perm_name_key, parent_id, route_path, icon,
       is_system, description, description_key, sort, created_by, updated_by, created_at, updated_at)
    SELECT v.code, 'menu', v.name, 'ops.' || v.code,
           (SELECT id FROM admin.operator_permission WHERE perm_code = v.parent),
           v.route, v.icon, true, v.name, 'ops.' || v.code || '.desc', v.sort,
           s.id, s.id, now(), now()
      FROM _plane_nodes v
     CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
     WHERE v.depth = d
    ON CONFLICT (perm_code) DO UPDATE SET
      parent_id  = excluded.parent_id,
      route_path = excluded.route_path,
      perm_type  = excluded.perm_type,
      sort       = excluded.sort,
      updated_at = now();
  END LOOP;
END $$;

-- ── 5. 两个无页面的旧节点：先断言无子节点，再删授权与节点 ─────────────────────
--    admin.menu.system_setting_general（/settings，arche 从未有过真页面，只有占位）
--    admin.menu.platform_resource（第 3 步把唯一的子节点 /atlas 移走后为空）
--    它们挂着的 release:maintenance.* 与 platform:setting.* 在第 8 步改挂，这里先移开。
UPDATE admin.operator_permission c
   SET parent_id = NULL, updated_at = now()
  FROM admin.operator_permission p
 WHERE c.parent_id = p.id
   AND p.perm_code IN ('admin.menu.system_setting_general', 'admin.menu.platform_resource')
   AND c.perm_type = 'api';

DO $$
DECLARE v_children int;
BEGIN
  SELECT count(*) INTO v_children
    FROM admin.operator_permission c
    JOIN admin.operator_permission p ON p.id = c.parent_id
   WHERE p.perm_code IN ('admin.menu.system_setting_general', 'admin.menu.platform_resource');
  IF v_children > 0 THEN
    RAISE EXCEPTION '[three-planes] 待删节点下仍有 % 个子节点', v_children;
  END IF;
END $$;

DELETE FROM admin.operator_role_permission
 WHERE permission_id IN (SELECT id FROM admin.operator_permission
                          WHERE perm_code IN ('admin.menu.system_setting_general', 'admin.menu.platform_resource'));
DELETE FROM admin.operator_permission
 WHERE perm_code IN ('admin.menu.system_setting_general', 'admin.menu.platform_resource');

-- ── 6. 操作码改名：域即平台（id 不变，授权随行；新码已存在则跳过）───────────────
CREATE TEMP TABLE _code_renames ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('tenant:risk.read',            'risk:record.read',            'View risk records'),
    ('tenant:risk.manage',          'risk:record.manage',          'Manage risk records'),
    ('platform:setting.read',       'config:parameter.read',       'View platform parameters (sensitive masked)'),
    ('platform:setting.manage',     'config:parameter.manage',     'Manage platform parameters'),
    ('release:feature_flag.read',   'config:feature_flag.read',    'View feature flags'),
    ('release:feature_flag.manage', 'config:feature_flag.manage',  'Manage feature flags'),
    ('notification:log.read',       'audit:notification_log.read', 'View notification delivery logs'),
    ('audit:read',                  'audit:log.read',              'View audit logs'),
    ('release:maintenance.read',    'ops:maintenance.read',        'View maintenance windows'),
    ('release:maintenance.manage',  'ops:maintenance.manage',      'Manage maintenance windows'),
    ('platform:product.read',       'integration:product.read',    'View the product registry'),
    ('platform:product.manage',     'integration:product.manage',  'Register / edit products, manage OIDC clients'),
    ('model:price_rule.create',     'pricing:price_rule.create',   'Create model price rule'),
    ('model:price_rule.update',     'pricing:price_rule.update',   'Update model price rule (expiresAt only)'),
    ('model:price_rule.activate',   'pricing:price_rule.activate', 'Activate model price rule'),
    ('model:price_rule.deactivate', 'pricing:price_rule.deactivate','Deactivate model price rule'),
    ('model:price_rule.delete',     'pricing:price_rule.delete',   'Soft-delete model price rule'),
    ('model:policy.create',         'pricing:policy.create',       'Create model policy'),
    ('model:policy.update',         'pricing:policy.update',       'Update model policy (high-risk)'),
    ('model:policy.activate',       'pricing:policy.activate',     'Activate model policy'),
    ('model:policy.deactivate',     'pricing:policy.deactivate',   'Deactivate model policy'),
    ('model:policy.delete',         'pricing:policy.delete',       'Soft-delete model policy')
  ) AS v(old_code, new_code, name);

--    重放自愈：migrate 是全量重放，更早的迁移（2026-10-02 atlas 细码）重放时看不见改名，
--    只看得见「码不在」，会把旧码连同 super_admin 授权插回来——v0.26.162 的 db-init 实测
--    因此在下面「旧码一个不剩」处失败。新码已存在时，旧码只是重放的副产物：先删它的授权，
--    再删它本身；新码与新码的授权原样保留。
DELETE FROM admin.operator_role_permission rp
 USING admin.operator_permission p, _code_renames v
 WHERE rp.permission_id = p.id
   AND p.perm_code = v.old_code
   AND EXISTS (SELECT 1 FROM admin.operator_permission x WHERE x.perm_code = v.new_code);

DELETE FROM admin.operator_permission p
 USING _code_renames v
 WHERE p.perm_code = v.old_code
   AND EXISTS (SELECT 1 FROM admin.operator_permission x WHERE x.perm_code = v.new_code);

UPDATE admin.operator_permission p
   SET perm_code = v.new_code, perm_name = v.name, description = v.name, updated_at = now()
  FROM _code_renames v
 WHERE p.perm_code = v.old_code
   AND NOT EXISTS (SELECT 1 FROM admin.operator_permission x WHERE x.perm_code = v.new_code);

-- ── 7. 新操作码：原先被两个平台共用、或根本没有码的能力 ────────────────────────
INSERT INTO admin.operator_permission
  (perm_code, perm_type, perm_name, perm_name_key, is_system, description, description_key,
   requires_step_up, created_by, updated_by, created_at, updated_at)
SELECT v.code, 'api', v.name, 'ops.perm.' || replace(v.code, ':', '.'), true, v.description,
       'ops.perm.' || replace(v.code, ':', '.') || '.desc', false, s.id, s.id, now(), now()
  FROM (VALUES
    ('product:capability.read',       'View the capability catalog',                 'View the capability catalog'),
    ('pricing:model.read',            'View models for pricing',                     'View providers, models, quotas and usage summaries behind price rules and policies'),
    ('content:notification_log.read', 'View recent notification deliveries',         'View recent notification deliveries'),
    ('ops:job.read',                  'View background job status',                  'View background job status'),
    ('ops:change.read',               'View the opera change trail',                 'View the opera change trail'),
    ('operator:session.read',         'View operator sign-in attempts and sessions', 'View operator sign-in attempts and sessions')
  ) AS v(code, name, description)
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
ON CONFLICT (perm_code) DO NOTHING;

-- ── 7b. 新码授给原本就能做这件事的角色（不让任何人失去访问）──────────────────
--    grantee 判据 = 迁移前在对方平台上放行这件事的那个码。
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT DISTINCT rp.role_id, n.id, r.is_system, s.id, now()
  FROM (VALUES
    ('product:capability.read',       'capability:runos.read'),
    ('product:capability.read',       'capability:runos.manage'),
    ('pricing:model.read',            'model:model.manage'),
    ('pricing:model.read',            'model:provider.manage'),
    ('content:notification_log.read', 'audit:notification_log.read'),
    ('operator:session.read',         'operator:account.manage'),
    -- 任务调度与变更审计原先不设码，进得了 opera 的人都能读：给持有任一 opera 码的角色。
    ('ops:job.read',                  'model:provider.read'),
    ('ops:job.read',                  'model:model.read'),
    ('ops:job.read',                  'capability:runos.read'),
    ('ops:job.read',                  'integration:product.read'),
    ('ops:job.read',                  'ops:maintenance.read'),
    ('ops:change.read',               'model:provider.read'),
    ('ops:change.read',               'model:model.read'),
    ('ops:change.read',               'capability:runos.read'),
    ('ops:change.read',               'integration:product.read'),
    ('ops:change.read',               'ops:maintenance.read')
  ) AS g(new_code, via_code)
  JOIN admin.operator_permission via ON via.perm_code = g.via_code
  JOIN admin.operator_role_permission rp ON rp.permission_id = via.id
  JOIN admin.operator_role r ON r.id = rp.role_id
  JOIN admin.operator_permission n ON n.perm_code = g.new_code
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
ON CONFLICT (role_id, permission_id) DO NOTHING;

--    审计员是全域只读 + 审计：登录记录归它看。
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT r.id, n.id, true, s.id, now()
  FROM admin.operator_role r
  JOIN admin.operator_permission n ON n.perm_code = 'operator:session.read'
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE r.role_code = 'auditor'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 8. 操作码挂到它实际作用的页面 ─────────────────────────────────────────────
UPDATE admin.operator_permission c
   SET parent_id = p.id, updated_at = now()
  FROM (VALUES
    ('pricing:model.read',            'admin.menu.model_gateway'),
    ('pricing:price_rule.create',     'admin.menu.model_gateway'),
    ('pricing:price_rule.update',     'admin.menu.model_gateway'),
    ('pricing:price_rule.activate',   'admin.menu.model_gateway'),
    ('pricing:price_rule.deactivate', 'admin.menu.model_gateway'),
    ('pricing:price_rule.delete',     'admin.menu.model_gateway'),
    ('pricing:policy.create',         'admin.menu.model_gateway'),
    ('pricing:policy.update',         'admin.menu.model_gateway'),
    ('pricing:policy.activate',       'admin.menu.model_gateway'),
    ('pricing:policy.deactivate',     'admin.menu.model_gateway'),
    ('pricing:policy.delete',         'admin.menu.model_gateway'),
    ('product:capability.read',       'admin.menu.skill_market'),
    ('content:notification_log.read', 'admin.menu.notification_message'),
    ('model:provider.read',           'opera.menu.model_service'),
    ('model:provider.manage',         'opera.menu.model_service'),
    ('model:model.read',              'opera.menu.model_service'),
    ('model:model.manage',            'opera.menu.model_service'),
    ('capability:runos.read',         'opera.menu.capability_registry'),
    ('capability:runos.manage',       'opera.menu.capability_registry'),
    ('integration:product.read',      'opera.menu.product_catalog'),
    ('integration:product.manage',    'opera.menu.product_catalog'),
    ('ops:job.read',                  'opera.menu.ops_job'),
    ('ops:maintenance.read',          'opera.menu.ops_maintenance'),
    ('ops:maintenance.manage',        'opera.menu.ops_maintenance'),
    ('ops:change.read',               'opera.menu.audit_change'),
    ('operator:account.manage',       'arche.menu.platform_admin'),
    ('operator:role.manage',          'arche.menu.platform_role'),
    ('operator:session.read',         'arche.menu.sign_in_session'),
    ('audit:log.read',                'arche.menu.audit_log'),
    ('risk:record.read',              'arche.menu.risk_record'),
    ('risk:record.manage',            'arche.menu.risk_record'),
    ('compliance:event.read',         'arche.menu.compliance_event'),
    ('compliance:event.manage',       'arche.menu.compliance_event'),
    ('config:parameter.read',         'arche.menu.system_parameter'),
    ('config:parameter.manage',       'arche.menu.system_parameter'),
    ('config:feature_flag.read',      'arche.menu.feature_toggle'),
    ('config:feature_flag.manage',    'arche.menu.feature_toggle'),
    ('audit:notification_log.read',   'arche.menu.notification_log')
  ) AS v(perm_code, page_code)
  JOIN admin.operator_permission p ON p.perm_code = v.page_code
 WHERE c.perm_code = v.perm_code
   AND c.parent_id IS DISTINCT FROM p.id;

-- ── 9. i18n 键跟码走（改名后旧键指向已不存在的码）─────────────────────────────
UPDATE admin.operator_permission
   SET perm_name_key = 'ops.' || perm_code, description_key = 'ops.' || perm_code || '.desc'
 WHERE perm_type = 'menu'
   AND (perm_name_key IS DISTINCT FROM 'ops.' || perm_code
        OR description_key IS DISTINCT FROM 'ops.' || perm_code || '.desc');

UPDATE admin.operator_permission
   SET perm_name_key = 'ops.perm.' || replace(perm_code, ':', '.'),
       description_key = 'ops.perm.' || replace(perm_code, ':', '.') || '.desc'
 WHERE perm_type = 'api'
   AND (perm_name_key IS DISTINCT FROM 'ops.perm.' || replace(perm_code, ':', '.')
        OR description_key IS DISTINCT FROM 'ops.perm.' || replace(perm_code, ':', '.') || '.desc');

-- ── 10. 祖先闭包：持有子节点必持有它的全部祖先（含平台根码）──────────────────
--     平台根码就是进入平台的门；这一步让「能做某平台上任一件事的人进得了那个平台」
--     从同一份授权事实推出来，不另外手配。
WITH RECURSIVE anc AS (
  SELECT rp.role_id, p.parent_id AS id
    FROM admin.operator_role_permission rp
    JOIN admin.operator_permission p ON p.id = rp.permission_id
   WHERE p.parent_id IS NOT NULL
  UNION
  SELECT a.role_id, p.parent_id
    FROM anc a
    JOIN admin.operator_permission p ON p.id = a.id
   WHERE p.parent_id IS NOT NULL
)
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT DISTINCT a.role_id, a.id, r.is_system, s.id, now()
  FROM anc a
  JOIN admin.operator_role r ON r.id = a.role_id
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 11. super_admin 全量授权（data_admin_200 §4.4，无代码旁路）─────────────────
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT r.id, p.id, true, s.id, now()
  FROM admin.operator_role r
 CROSS JOIN admin.operator_permission p
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE r.role_code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 12. 平台角色的创建人：指向真实的 systemadmin，不再为空 ───────────────────
--     预置角色由 seed 写入时从未带 created_by，列表上因此显示「-」。
UPDATE admin.operator_role r
   SET created_by = s.id
  FROM (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE r.created_by IS NULL;

UPDATE admin.operator_role r
   SET updated_by = s.id
  FROM (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE r.updated_by IS NULL;

ALTER TABLE admin.operator_role ALTER COLUMN created_by SET NOT NULL;

-- ── 13. 后置断言（按本迁移职责，不做全库绝对计数）──────────────────────────
DO $$
DECLARE
  n_old int; n_roots int; n_orphan int; n_domain int; n_missing_anc int;
  n_total int; n_super int; n_creator int;
BEGIN
  -- ① 旧码一个不剩
  SELECT count(*) INTO n_old FROM admin.operator_permission
   WHERE perm_code LIKE 'admin.workspace.%'
      OR perm_code IN ('admin.menu.platform_overview', 'admin.menu.identity_access',
                       'admin.menu.platform_admin', 'admin.menu.platform_role',
                       'admin.menu.permission_policy', 'admin.menu.security_audit',
                       'admin.menu.audit_log', 'admin.menu.risk_record',
                       'admin.menu.compliance_event', 'admin.menu.system_setting',
                       'admin.menu.system_parameter', 'admin.menu.feature_toggle',
                       'admin.menu.notification_center', 'admin.menu.notification_log',
                       'admin.menu.system_setting_general', 'admin.menu.platform_resource')
      OR split_part(perm_code, ':', 1) IN ('platform', 'release', 'notification')
      OR perm_code IN ('audit:read', 'tenant:risk.read', 'tenant:risk.manage')
      OR perm_code LIKE 'model:price_rule.%' OR perm_code LIKE 'model:policy.%';
  IF n_old > 0 THEN RAISE EXCEPTION '[three-planes] 仍有 % 个旧码', n_old; END IF;

  -- ② 根恰好是三个平台码
  SELECT count(*) INTO n_roots FROM admin.operator_permission
   WHERE parent_id IS NULL AND perm_code NOT IN ('admin.plane', 'opera.plane', 'arche.plane');
  IF n_roots > 0 THEN RAISE EXCEPTION '[three-planes] 有 % 行不在三个平台根之下', n_roots; END IF;

  -- ③ 每个菜单节点的码前缀 = 它所在的平台根
  WITH RECURSIVE up AS (
    SELECT id, perm_code, perm_type, parent_id, perm_code AS cur FROM admin.operator_permission
    UNION ALL
    SELECT u.id, u.perm_code, u.perm_type, p.parent_id, p.perm_code
      FROM up u JOIN admin.operator_permission p ON p.id = u.parent_id
  )
  SELECT count(*) INTO n_orphan FROM up
   WHERE up.parent_id IS NULL AND up.perm_type = 'menu'
     AND split_part(up.perm_code, '.', 1) || '.plane' <> up.cur;
  IF n_orphan > 0 THEN RAISE EXCEPTION '[three-planes] % 个菜单节点挂在别的平台下', n_orphan; END IF;

  -- ④ 每个操作码的域属于它所在的平台
  WITH RECURSIVE up AS (
    SELECT id, perm_code, perm_type, parent_id, perm_code AS cur FROM admin.operator_permission
    UNION ALL
    SELECT u.id, u.perm_code, u.perm_type, p.parent_id, p.perm_code
      FROM up u JOIN admin.operator_permission p ON p.id = u.parent_id
  )
  SELECT count(*) INTO n_domain FROM up
   WHERE up.parent_id IS NULL AND up.perm_type = 'api'
     AND up.cur <> CASE
       WHEN split_part(up.perm_code, ':', 1) IN ('tenant','user','commerce','promotion','product','content','support','pricing') THEN 'admin.plane'
       WHEN split_part(up.perm_code, ':', 1) IN ('model','capability','integration','ops') THEN 'opera.plane'
       WHEN split_part(up.perm_code, ':', 1) IN ('operator','audit','compliance','risk','config') THEN 'arche.plane'
       ELSE '?' END;
  IF n_domain > 0 THEN RAISE EXCEPTION '[three-planes] % 个操作码的域与所在平台不符（或未挂到页面）', n_domain; END IF;

  -- ⑤ 没有角色持有子节点却缺祖先
  SELECT count(*) INTO n_missing_anc
    FROM admin.operator_role_permission rp
    JOIN admin.operator_permission p ON p.id = rp.permission_id
   WHERE p.parent_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM admin.operator_role_permission x
                      WHERE x.role_id = rp.role_id AND x.permission_id = p.parent_id);
  IF n_missing_anc > 0 THEN RAISE EXCEPTION '[three-planes] % 条授权缺祖先', n_missing_anc; END IF;

  -- ⑥ super_admin 全量
  SELECT count(*) INTO n_total FROM admin.operator_permission;
  SELECT count(*) INTO n_super FROM admin.operator_role_permission rp
    JOIN admin.operator_role r ON r.id = rp.role_id WHERE r.role_code = 'super_admin';
  IF n_super <> n_total THEN
    RAISE EXCEPTION '[three-planes] super_admin 授权 % ≠ 权限总数 %', n_super, n_total;
  END IF;

  -- ⑦ 角色创建人都能关联到真实账号
  SELECT count(*) INTO n_creator FROM admin.operator_role r
   WHERE NOT EXISTS (SELECT 1 FROM admin.operator_account a WHERE a.id = r.created_by);
  IF n_creator > 0 THEN RAISE EXCEPTION '[three-planes] % 个角色的创建人找不到账号', n_creator; END IF;
END $$;

COMMIT;
