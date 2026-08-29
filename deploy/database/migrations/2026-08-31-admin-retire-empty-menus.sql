-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 退役 admin 四个上线前仍为空的菜单节点及其无处可达的操作码
--
-- 依据：docs/20-specs/000-platform/admin/40-menu.md 1.2.0（owner 2026-08-30 裁定）。
-- 四个菜单：密钥管理 /platform-secrets、审批中心 /approval-center（两者读的
-- admin.governance_record 从未建表，页面永远为空）、字典管理 /data-dictionaries、
-- 通知渠道 /notification-channels（占位页）。挂在「密钥管理」下的两个操作码
-- security:signing_key.manage / security:oidc_client.manage 在 admin 里没有任何路由
-- 检查，一并退役。
--
-- seed（seed-catalog.mjs）只是不再写入这些行；存量库靠本迁移删。删除顺序按 FK：
-- 角色绑定 → 操作码（子行，parent_id 指向菜单）→ 菜单行。若某个待删菜单下还挂着
-- 本清单之外的操作码，停下报出——那是本迁移不知道的东西，不该被顺手删掉。
--
-- 幂等：整份可重跑（数据语句自带条件）。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  retired_menus  text[] := ARRAY['admin.menu.secret_store', 'admin.menu.approval_flow',
                                 'admin.menu.data_dictionary', 'admin.menu.notification_channel'];
  retired_apis   text[] := ARRAY['security:signing_key.manage', 'security:oidc_client.manage'];
  unexpected     text;
  n_bind int; n_api int; n_menu int;
BEGIN
  -- ① 待删菜单下若还有清单之外的子行，停下。
  SELECT string_agg(c.perm_code, ', ' ORDER BY c.perm_code)
    INTO unexpected
    FROM admin.operator_permission c
    JOIN admin.operator_permission p ON p.id = c.parent_id
   WHERE p.perm_code = ANY(retired_menus)
     AND NOT (c.perm_code = ANY(retired_apis));
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION '[admin-retire-empty-menus] unexpected children under retired menus: %', unexpected;
  END IF;

  -- ② 角色绑定。
  DELETE FROM admin.operator_role_permission rp
   USING admin.operator_permission p
   WHERE rp.permission_id = p.id
     AND (p.perm_code = ANY(retired_menus) OR p.perm_code = ANY(retired_apis));
  GET DIAGNOSTICS n_bind = ROW_COUNT;

  -- ③ 操作码（子行）。
  DELETE FROM admin.operator_permission WHERE perm_code = ANY(retired_apis);
  GET DIAGNOSTICS n_api = ROW_COUNT;

  -- ④ 菜单行。
  DELETE FROM admin.operator_permission WHERE perm_code = ANY(retired_menus);
  GET DIAGNOSTICS n_menu = ROW_COUNT;

  RAISE NOTICE '[admin-retire-empty-menus] removed % role bindings, % api codes, % menu nodes',
    n_bind, n_api, n_menu;
END $$;

COMMIT;
