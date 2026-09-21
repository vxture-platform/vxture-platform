-- ═══════════════════════════════════════════════════════════════════════════
-- 运营菜单权限节点的显示名，追上页面实际叫什么（owner 2026-09-21）。
--
-- ── 为什么要一条迁移 ──
-- `admin.operator_permission` 的 menu 层 upsert 刻意**不更新 perm_name**
-- （seed-catalog.mjs 的 on conflict 只覆盖 parent_id / route_path / perm_type /
-- sort，注释写着「不覆盖运营改过的显示名/描述」）。所以改 seed 只对新建库生效，
-- 存量库要靠这条。
--
-- ── 漂了什么 ──
-- 权限树是 arche「权限配置」页直接画的 `perm_name`（没有 i18n 中转），而侧栏
-- 画的是 `messages/*.json` 的词条。页面陆续改名时只改了词条，权限树留在原地：
--
--   admin.menu.tenant_profile        租户信息        → 租户管理
--   admin.menu.account_system        账号体系        → 账号管理
--   admin.menu.product_capability    产品能力        → 产品目录
--   admin.menu.plan_version          套餐版本        → 产品套餐
--   admin.menu.model_gateway         模型计价与策略  → 模型计价策略
--
-- 对上的判据是 **route**（seed 的 `route` ↔ navigation.ts 的 `href`），不是名字
-- 相似——名字正是这里对不上的那样东西。
--
-- ── 为什么按旧值限定 ──
-- seed 不覆盖 perm_name 是为了保住运营自己改过的名字。这条迁移沿用同一条尊重：
-- `and perm_name = '<旧值>'`，只动还停在陈旧默认值上的行。有人改过就不碰。
-- 副作用：本迁移幂等——第二次跑一行都匹配不到。
--
-- 重复执行安全。不改结构，不需要 GRANT（沿用 98_column_locks 已授的列）。
-- ═══════════════════════════════════════════════════════════════════════════

update admin.operator_permission
set perm_name = '租户管理', updated_at = now()
where perm_code = 'admin.menu.tenant_profile' and perm_name = '租户信息';

update admin.operator_permission
set perm_name = '账号管理', updated_at = now()
where perm_code = 'admin.menu.account_system' and perm_name = '账号体系';

update admin.operator_permission
set perm_name = '产品目录', updated_at = now()
where perm_code = 'admin.menu.product_capability' and perm_name = '产品能力';

update admin.operator_permission
set perm_name = '产品套餐', updated_at = now()
where perm_code = 'admin.menu.plan_version' and perm_name = '套餐版本';

update admin.operator_permission
set perm_name = '模型计价策略', updated_at = now()
where perm_code = 'admin.menu.model_gateway' and perm_name = '模型计价与策略';

-- opera 的模型授权：2026-09-17 owner 已把它从「路由授权」改名「模型授权」，
-- navigation.ts 的注释甚至写明了「seed 的菜单表按 route 对齐」——然后没改 seed。
-- 由 lint:operator-menu-names 于 2026-09-21 扫出。
update admin.operator_permission
set perm_name = '模型授权', updated_at = now()
where perm_code = 'opera.menu.model_grant' and perm_name = '路由授权';
