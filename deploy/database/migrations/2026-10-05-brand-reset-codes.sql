-- 主体标识重置码（owner 2026-09-16）
--
-- 违规图片处置：运营在详情页把租户 logo / 用户头像重置回平台默认。重置 = **删
-- tenancy.tenant_logos / account.user_avatars 的行**，回落到 DS 统一提供的默认图
-- （12.12.0 起随包发出的 assets/icons/tenant-default.png 与 avatar-default.png），
-- 不写任何默认字节——「有行 = 用户传的，无行 = 默认」这个判据因此天然成立，追责用得上。
--
-- 两个码都标 requires_step_up：删掉的原图不留存，不可撤回。seed 侧同步加进
-- STEP_UP_REQUIRED（那段 on conflict 会强制回写该列，两处必须一致）。
--
-- 授权（owner 指定三角色）：admin / operation 显式授；super_admin 由 §4.4 的全量
-- 授权段覆盖（CROSS JOIN 整张表），本迁移末尾照既有形态重跑一次。
--
-- 幂等：迁移每次 deploy 全量重放（28d-apply-migrations.sh 按文件名排序全跑）。

-- ── 1. 两个新操作码 ──────────────────────────────────────────────────────────
INSERT INTO admin.operator_permission
  (perm_code, perm_type, perm_name, perm_name_key, is_system, description, description_key,
   requires_step_up, created_by, updated_by, created_at, updated_at)
SELECT v.code, 'api', v.name, 'ops.perm.' || replace(v.code, ':', '.'), true, v.description,
       'ops.perm.' || replace(v.code, ':', '.') || '.desc', true, s.id, s.id, now(), now()
  FROM (VALUES
    ('tenant:brand.reset', 'Reset tenant logo',
     'Reset tenant logo to the platform default (content moderation; high-risk)'),
    ('user:avatar.reset',  'Reset user avatar',
     'Reset user avatar to the platform default (content moderation; high-risk)')
  ) AS v(code, name, description)
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
ON CONFLICT (perm_code) DO UPDATE SET
  -- requires_step_up 是平台持有的策略，与 seed 同语义：重放必须回到目录声明的值。
  requires_step_up = excluded.requires_step_up,
  updated_at       = now();

-- ── 2. 把操作码挂到所属页面（菜单树是平台持有的结构）────────────────────────
UPDATE admin.operator_permission p
   SET parent_id = m.id, updated_at = now()
  FROM (VALUES
    ('tenant:brand.reset', 'admin.menu.tenant_profile'),
    ('user:avatar.reset',  'admin.menu.account_system')
  ) AS v(code, menu)
  JOIN admin.operator_permission m ON m.perm_code = v.menu
 WHERE p.perm_code = v.code
   AND (p.parent_id IS DISTINCT FROM m.id);

-- ── 3. 授给 administrator / operator ────────────────────────────────────────
-- 2026-09-22：这两个角色的码改了（admin → administrator、operation → operator）。
-- 本行按码字面量筛，而 migrate 是**全量重放**——只写新码的话，重放到这一步时旧库
-- 里还没改名，两条都匹配不上；只写旧码的话，新库（seed 直接用新码）同样匹配不上。
-- 两套都接受是唯一对两种重放次序都成立的写法。ON CONFLICT 已保证不会重复授。
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT r.id, p.id, true, s.id, now()
  FROM admin.operator_role r
  JOIN admin.operator_permission p
    ON p.perm_code IN ('tenant:brand.reset', 'user:avatar.reset')
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE r.role_code IN ('admin', 'administrator', 'operation', 'operator')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 4. super_admin 全量授权（data_admin_200 §4.4，无代码旁路）────────────────
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT r.id, p.id, true, s.id, now()
  FROM admin.operator_role r
 CROSS JOIN admin.operator_permission p
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE r.role_code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
