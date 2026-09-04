-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — console 批 7:把 `tenant.model.read` 授予租户所有者
--
-- 依据:docs/70-workplan/61-console-module-inventory.md 批 7(/atlas 模型接入整改)。
-- 背景:批 0a 把 `/atlas` 的 URL 直达用能力码封死,并**故意不授予任何角色**——那时
-- 页面还读着已退役的「模型授权」轴(tenant↔model),不适合对客户开放。批 7 把授权表
-- 换成产品权益(tenant↔product,#129 指明的正确来源),页面可以开放了。
--
-- 只授 owner:模型接入是所有者关心的事;manager 及以下看配额与用量即可,那两处走
-- `tenant.quota.read`(本批把 /api/atlas/quotas 从 model.read 降到 quota.read——
-- 外壳的用量卡每页都调它,此前对所有人 403、被吞成「不可用」)。
--
-- 幂等:整份可重跑(on conflict do nothing)。与 seed-catalog.mjs 的 ROLE_PERMS 同源。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO access.role_permissions (role_id, permission_id, is_system, created_by, created_at)
SELECT r.id, p.id, true, '00000000-0000-4000-a000-000000000010', now()
  FROM access.roles r
  JOIN access.permissions p ON p.perm_code = 'tenant.model.read'
 WHERE r.scope = 'tenant' AND r.role_code = 'owner'
ON CONFLICT DO NOTHING;

-- 后置断言:owner 现在持有该码,且只有 owner 持有。
DO $$
DECLARE v_owner int; v_others int;
BEGIN
  SELECT count(*) INTO v_owner
    FROM access.role_permissions rp
    JOIN access.roles r       ON r.id = rp.role_id
    JOIN access.permissions p ON p.id = rp.permission_id
   WHERE p.perm_code = 'tenant.model.read'
     AND r.scope = 'tenant' AND r.role_code = 'owner';
  IF v_owner <> 1 THEN
    RAISE EXCEPTION '[grant-owner-model-read] owner 未持有 tenant.model.read(命中 % 行)', v_owner;
  END IF;

  SELECT count(*) INTO v_others
    FROM access.role_permissions rp
    JOIN access.roles r       ON r.id = rp.role_id
    JOIN access.permissions p ON p.id = rp.permission_id
   WHERE p.perm_code = 'tenant.model.read'
     AND NOT (r.scope = 'tenant' AND r.role_code = 'owner');
  IF v_others > 0 THEN
    RAISE EXCEPTION '[grant-owner-model-read] 非 owner 角色持有了 tenant.model.read(% 行)', v_others;
  END IF;

  RAISE NOTICE '[grant-owner-model-read] tenant.model.read 已授予 owner,且仅 owner';
END $$;

COMMIT;
