-- ═══════════════════════════════════════════════════════════════════════════
-- seed 前置自检（只读，零副作用）—— 预判 23-seed-platform-database.sh 会不会抛
--
-- seed 结尾有一条全量授权不变式（data_admin_200 §4.4）：
--   count(super_admin 的授权) === count(整张 admin.operator_permission)
-- 不成立就抛，而那时菜单树已经写进去了 —— 维护窗口停在半完成状态。
--
-- 为什么不是"陈旧行"的问题：seed 从不删行，且每次按 OP_ALL 全量重授，
-- 所以旧版本留下的行会连着它的授权一起留着，两边计数同增，不变式不破。
-- 真正会破的只有一种：**某一行没有 super_admin 授权** ——
-- 运行时新建的行，或运营在界面上摘掉过一条授权。①就是在找这个。
--
-- 用法（worker-01）：psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <本文件>
-- ═══════════════════════════════════════════════════════════════════════════
\pset tuples_only on
\pset format unaligned

SELECT '① 缺 super_admin 授权的行（>0 即 seed 必抛）: '
       || coalesce(string_agg(p.perm_code, ', '), '无')
  FROM admin.operator_permission p
 WHERE NOT EXISTS (
   SELECT 1 FROM admin.operator_role_permission rp
     JOIN admin.operator_role r ON r.id = rp.role_id
    WHERE rp.permission_id = p.id AND r.role_code = 'super_admin');

SELECT '② permTotal = ' || count(*) || '（seed 前应为 59，seed 后应为 113）'
  FROM admin.operator_permission;

SELECT '③ super_admin 授权 = ' || count(*) || '（应恒等于 ②）'
  FROM admin.operator_role_permission rp
  JOIN admin.operator_role r ON r.id = rp.role_id
 WHERE r.role_code = 'super_admin';

SELECT '④ menu 层行数 = ' || count(*) || '（seed 前应为 0，seed 后应为 54）'
  FROM admin.operator_permission WHERE perm_type = 'menu';
