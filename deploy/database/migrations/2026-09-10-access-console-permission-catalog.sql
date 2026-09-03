-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — console 权限配置体系(批 0a):access.permissions 灌成控制台菜单树,
-- 补读侧码与商业面细分码,五个租户角色按矩阵授权
--
-- 依据:docs/30-design/identity/070-tenant-console-permission-catalog.md、
-- data_identity_200_schema.md §6.4(2026-09-04 修订)。
--
-- seed(seed-catalog.mjs)对新库写同样的内容;存量库靠本迁移。内容与 seed 的
-- TENANT_MENU_TREE / PERMISSIONS / ROLE_PERMS 一致,由 check-tenant-permission-catalog
-- 守卫比对 seed 与 @vxture/core-utils;本文件与 seed 的一致性在本地按「新库 seed」
-- 与「旧库 + 本迁移」两条路径灌库后逐行 diff 验过(见 PR 说明)。
--
-- 幂等:整份可重跑(insert 全部 on conflict;update 幂等)。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① 操作码(新增 7 条;既有 9 条 do nothing,不覆盖显示名)。
INSERT INTO access.permissions
  (perm_code, perm_type, perm_name, perm_name_key, category, description, description_key, is_system, created_by, created_at, updated_at)
VALUES
  ('tenant.member.read',    'api', 'View tenant members',                              'access.perm.tenant.member.read',    'member',  'View tenant members',                              'access.perm.tenant.member.read.desc',    true, '00000000-0000-4000-a000-000000000010', now(), now()),
  ('tenant.billing.read',   'api', 'View subscriptions, orders and bills',             'access.perm.tenant.billing.read',   'billing', 'View subscriptions, orders and bills',             'access.perm.tenant.billing.read.desc',   true, '00000000-0000-4000-a000-000000000010', now(), now()),
  ('tenant.payment.manage', 'api', 'Declare payments and buy add-on packs',            'access.perm.tenant.payment.manage', 'billing', 'Declare payments and buy add-on packs',            'access.perm.tenant.payment.manage.desc', true, '00000000-0000-4000-a000-000000000010', now(), now()),
  ('tenant.invoice.manage', 'api', 'Request invoices and manage billing addresses',    'access.perm.tenant.invoice.manage', 'billing', 'Request invoices and manage billing addresses',    'access.perm.tenant.invoice.manage.desc', true, '00000000-0000-4000-a000-000000000010', now(), now()),
  ('tenant.quota.read',     'api', 'View quotas and usage',                            'access.perm.tenant.quota.read',     'quota',   'View quotas and usage',                            'access.perm.tenant.quota.read.desc',     true, '00000000-0000-4000-a000-000000000010', now(), now()),
  ('tenant.audit.read',     'api', 'View the tenant audit log',                        'access.perm.tenant.audit.read',     'audit',   'View the tenant audit log',                        'access.perm.tenant.audit.read.desc',     true, '00000000-0000-4000-a000-000000000010', now(), now()),
  ('tenant.model.read',     'api', 'View model access for the tenant',                 'access.perm.tenant.model.read',     'model',   'View model access for the tenant',                 'access.perm.tenant.model.read.desc',     true, '00000000-0000-4000-a000-000000000010', now(), now())
ON CONFLICT (perm_code) DO NOTHING;

-- ② 菜单树(L1 板块 → L2 页面)。结构列 do update(树是平台持有的结构),perm_name 不覆盖。
-- L1 板块
INSERT INTO access.permissions (perm_code, perm_type, perm_name, perm_name_key, parent_id, route_path, icon, is_system, description, description_key, sort, created_by, updated_by, created_at, updated_at)
VALUES
  ('tenant.menu.workspace',            'menu', '工作空间',   'access.menu.workspace',            NULL, NULL, 'squares-four',     true, '工作空间',   'access.menu.workspace.desc',            10, '00000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000010', now(), now()),
  ('tenant.menu.account_tenant',       'menu', '账户与租户', 'access.menu.account_tenant',       NULL, NULL, 'building-library', true, '账户与租户', 'access.menu.account_tenant.desc',       20, '00000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000010', now(), now()),
  ('tenant.menu.members_permissions',  'menu', '成员与权限', 'access.menu.members_permissions',  NULL, NULL, 'users',            true, '成员与权限', 'access.menu.members_permissions.desc',  30, '00000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000010', now(), now()),
  ('tenant.menu.subscription_billing', 'menu', '订阅与计费', 'access.menu.subscription_billing', NULL, NULL, 'chart-bar',        true, '订阅与计费', 'access.menu.subscription_billing.desc', 40, '00000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000010', now(), now()),
  ('tenant.menu.advanced_settings',    'menu', '高级设置',   'access.menu.advanced_settings',    NULL, NULL, 'settings',         true, '高级设置',   'access.menu.advanced_settings.desc',    50, '00000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000010', now(), now()),
  ('tenant.menu.platform',             'menu', '平台能力',   'access.menu.platform',             NULL, NULL, 'database',         true, '平台能力',   'access.menu.platform.desc',             60, '00000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000010', now(), now())
ON CONFLICT (perm_code) DO UPDATE SET
  parent_id = excluded.parent_id, route_path = excluded.route_path, perm_type = excluded.perm_type,
  icon = excluded.icon, sort = excluded.sort, updated_at = now();

-- L2 页面(parent 经子查询解析,L1 已在)。
INSERT INTO access.permissions (perm_code, perm_type, perm_name, perm_name_key, parent_id, route_path, icon, is_system, description, description_key, sort, created_by, updated_by, created_at, updated_at)
SELECT v.code, 'menu', v.name, 'access.menu.' || substr(v.code, length('tenant.menu.') + 1),
       p.id, v.route, v.icon, true, v.name, 'access.menu.' || substr(v.code, length('tenant.menu.') + 1) || '.desc',
       v.sort, '00000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000010', now(), now()
FROM (VALUES
  ('tenant.menu.overview',        '数据总览', '/',                'home',             'tenant.menu.workspace',            10),
  ('tenant.menu.todos',           '待办事项', '/todos',           'calendar',         'tenant.menu.workspace',            20),
  ('tenant.menu.profile',         '个人信息', '/profile',         'user',             'tenant.menu.account_tenant',       10),
  ('tenant.menu.personal_tenant', '租户信息', '/personal-tenant', 'buildings',        'tenant.menu.account_tenant',       20),
  ('tenant.menu.organization',    '组织信息', '/organization',    'building-library', 'tenant.menu.account_tenant',       30),
  ('tenant.menu.members',         '成员管理', '/members',         'users',            'tenant.menu.members_permissions',  10),
  ('tenant.menu.roles',           '角色管理', '/roles',           'shield-check',     'tenant.menu.members_permissions',  20),
  ('tenant.menu.invitations',     '邀请记录', '/invitations',     'mail',             'tenant.menu.members_permissions',  30),
  ('tenant.menu.subscription',    '产品订阅', '/subscription',    'chart-bar',        'tenant.menu.subscription_billing', 10),
  ('tenant.menu.billing',         '账单管理', '/billing',         'calendar',         'tenant.menu.subscription_billing', 20),
  ('tenant.menu.vouchers',        '我的卡券', '/vouchers',        'ticket',           'tenant.menu.subscription_billing', 30),
  ('tenant.menu.quotas',          '配额管理', '/quotas',          'database',         'tenant.menu.subscription_billing', 40),
  ('tenant.menu.usage',           '用量分析', '/usage',           'chart-line',       'tenant.menu.subscription_billing', 50),
  ('tenant.menu.settings',        '系统设置', '/settings',        'settings',         'tenant.menu.advanced_settings',    10),
  ('tenant.menu.inbox',           '站内消息', '/inbox',           'bell',             'tenant.menu.advanced_settings',    20),
  ('tenant.menu.notifications',   '通知提醒', '/notifications',   'mail',             'tenant.menu.advanced_settings',    30),
  ('tenant.menu.audit_logs',      '审计日志', '/audit-logs',      'clipboard',        'tenant.menu.advanced_settings',    40),
  ('tenant.menu.security',        '安全设置', '/security',        'shield-check',     'tenant.menu.advanced_settings',    50),
  ('tenant.menu.atlas',           '模型接入', '/atlas',           'database',         'tenant.menu.platform',             10)
) AS v(code, name, route, icon, parent_code, sort)
JOIN access.permissions p ON p.perm_code = v.parent_code
ON CONFLICT (perm_code) DO UPDATE SET
  parent_id = excluded.parent_id, route_path = excluded.route_path, perm_type = excluded.perm_type,
  icon = excluded.icon, sort = excluded.sort, updated_at = now();

-- ③ 操作码挂到所属页面;树里没提到的(workspace.*)留在根上但 perm_type 归 api。
UPDATE access.permissions c
   SET parent_id = p.id, perm_type = 'api', updated_at = now()
  FROM (VALUES
    ('tenant.settings.manage',  'tenant.menu.organization'),
    ('tenant.member.read',      'tenant.menu.members'),
    ('tenant.member.manage',    'tenant.menu.members'),
    ('tenant.role.assign',      'tenant.menu.members'),
    ('tenant.billing.read',     'tenant.menu.subscription'),
    ('tenant.billing.manage',   'tenant.menu.subscription'),
    ('tenant.payment.manage',   'tenant.menu.subscription'),
    ('tenant.invoice.manage',   'tenant.menu.billing'),
    ('tenant.quota.read',       'tenant.menu.quotas'),
    ('tenant.workspace.manage', 'tenant.menu.settings'),
    ('tenant.delete',           'tenant.menu.settings'),
    ('tenant.audit.read',       'tenant.menu.audit_logs'),
    ('tenant.model.read',       'tenant.menu.atlas')
  ) AS v(code, menu_code)
  JOIN access.permissions p ON p.perm_code = v.menu_code
 WHERE c.perm_code = v.code
   AND (c.parent_id IS DISTINCT FROM p.id OR c.perm_type IS DISTINCT FROM 'api');

UPDATE access.permissions
   SET perm_type = 'api', updated_at = now()
 WHERE perm_type IS NULL AND perm_code NOT LIKE 'tenant.menu.%';

-- ④ 角色矩阵(tenant scope;只增不减,owner 不含 tenant.model.read——批 7 整改前不开放)。
INSERT INTO access.role_permissions (role_id, permission_id, is_system, created_by)
SELECT r.id, p.id, true, '00000000-0000-4000-a000-000000000010'
  FROM (VALUES
    ('owner',    'tenant.member.read'),
    ('owner',    'tenant.billing.read'),
    ('owner',    'tenant.payment.manage'),
    ('owner',    'tenant.invoice.manage'),
    ('owner',    'tenant.quota.read'),
    ('owner',    'tenant.audit.read'),
    ('manager',  'tenant.member.read'),
    ('manager',  'tenant.billing.read'),
    ('manager',  'tenant.quota.read'),
    ('manager',  'tenant.audit.read'),
    ('member',   'tenant.member.read'),
    ('member',   'tenant.quota.read'),
    ('readonly', 'tenant.member.read'),
    ('readonly', 'tenant.billing.read'),
    ('readonly', 'tenant.quota.read'),
    ('readonly', 'tenant.audit.read')
  ) AS v(role_code, perm_code)
  JOIN access.roles r ON r.scope = 'tenant' AND r.role_code = v.role_code
  JOIN access.permissions p ON p.perm_code = v.perm_code
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$
DECLARE
  n_menu int; n_api int; n_grants int; n_orphan int;
BEGIN
  SELECT count(*) INTO n_menu FROM access.permissions WHERE perm_type = 'menu';
  SELECT count(*) INTO n_api  FROM access.permissions WHERE perm_type = 'api' AND parent_id IS NOT NULL;
  SELECT count(*) INTO n_orphan FROM access.permissions WHERE perm_type = 'api' AND parent_id IS NULL;
  SELECT count(*) INTO n_grants FROM access.role_permissions rp JOIN access.roles r ON r.id = rp.role_id WHERE r.scope = 'tenant';
  IF n_menu <> 25 THEN
    RAISE EXCEPTION '[access-console-permission-catalog] expected 25 menu nodes, found %', n_menu;
  END IF;
  RAISE NOTICE '[access-console-permission-catalog] % menu nodes, % api codes parented, % api codes at root, % tenant-role grants',
    n_menu, n_api, n_orphan, n_grants;
END $$;

COMMIT;
