-- ═══════════════════════════════════════════════════════════════════════════
-- 租户级防滥用闸：成员数与工作区数各一个上限（owner 2026-09-22 裁定）。
--
-- ── 定位：这是安全闸，不是卖点 ──
-- owner：「当前简单处理，设定一个比较高的上限，防止恶意爆仓就行」。
-- 所以它**不走产品订阅、不进 quota_pools、不进套餐 limits、不上官网订阅页**——
-- 那些是「卖多少」的机制，而这是「最多能撑多少」的机制。两者混在一起，就会出现
-- 「退订某产品之后已经加进来的人怎么办」这种无解局面。
--
-- ── 为什么只有租户一层，没有工作区成员上限 ──
-- `fk_workspace_memberships_tenant_member` 强制工作区成员必须先是租户成员：
--     FOREIGN KEY (tenant_id, user_id) REFERENCES tenancy.tenant_memberships(tenant_id, user_id)
-- 于是恒有「任一工作区成员数 ≤ 租户去重成员数 ≤ 租户上限」。**中间那步是数据库
-- 保证的**，再设一个工作区成员上限拦不到任何租户上限拦不住的东西。
--
-- ── 工作区数量为什么也要堵 ──
-- 建工作区**不需要对方有账号**，比加成员容易得多（加成员要对方接受邀请）。
-- 而 `tenancy.workspaces` 上现存零个 CHECK——旧的 999 上限退役后没有替代。
--
-- ── 落点：平台默认 + 可选的单租户覆盖 ──
-- 默认值进 `admin.settings`（已有同形先例：commerce/refund.window_hours=int/24），
-- 单租户覆盖是**可空列**，NULL = 随平台默认。这样存量零迁移：不用给每个租户填数，
-- 将来某个大客户要更高，运营改那一行即可。
--
-- 数值（owner 2026-09-22）：成员 500；工作区 200（比成员少一个量级——工作区是更重
-- 的对象，真实客户极少超过）。两者都高到正常客户碰不到、低到脚本刷入当场拦住。
--
-- 本迁移只建落点与默认值，**不加 CHECK 约束**：判据要落在应用层的写入那一刻，
-- 才能回 409 并说明「已达上限 N」；DB 约束只会抛一个没有上下文的错。
--
-- 重复执行安全（IF NOT EXISTS / ON CONFLICT DO NOTHING）。
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE tenancy.tenants
  ADD COLUMN IF NOT EXISTS member_limit    int,
  ADD COLUMN IF NOT EXISTS workspace_limit int;

COMMENT ON COLUMN tenancy.tenants.member_limit IS
  '租户成员数上限（防滥用闸，非售卖配额）。NULL = 随 admin.settings 的 tenancy/tenant.member_limit。';
COMMENT ON COLUMN tenancy.tenants.workspace_limit IS
  '租户工作区数上限（防滥用闸，非售卖配额）。NULL = 随 admin.settings 的 tenancy/tenant.workspace_limit。';

INSERT INTO admin.settings
  (config_group, config_key, value_type, config_value, description, description_key,
   created_by, created_at, updated_at)
SELECT 'tenancy', v.k, 'int', v.val, v.desc_en,
       'catalog.ops.setting.' || v.k || '.desc',
       a.id, now(), now()
  FROM (VALUES
    ('tenant.member_limit',    '500',
     'Default cap on members per tenant. Abuse guard, not a sold quota; per-tenant override lives on tenancy.tenants.member_limit.'),
    ('tenant.workspace_limit', '200',
     'Default cap on workspaces per tenant. Abuse guard, not a sold quota; per-tenant override lives on tenancy.tenants.workspace_limit.')
  ) AS v(k, val, desc_en)
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') a
ON CONFLICT (config_key) DO NOTHING;

-- ── 98 列锁：活库的 GRANT 不会因为改了 98 文件就跟着变 ──────────────────────
-- 两列是运营可改的（单租户覆盖），必须显式进 UPDATE 白名单，否则生产上一改就
-- 42501 整条回滚。本机实测：加完列之后活库 GRANT 里确实没有这两列——静态守卫
-- lint:column-locks 比的是源码清单，看不见这个差。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    REVOKE UPDATE ON tenancy.tenants FROM platform_svc;
    GRANT UPDATE (name, display_name, type, owner_user_id, status,
                  verification_status, verification_type,
                  member_limit, workspace_limit, updated_at, deleted_at)
      ON tenancy.tenants TO platform_svc;
  END IF;
END $$;

DO $$
DECLARE n int; cols int; granted int;
BEGIN
  SELECT count(*) INTO n FROM admin.settings
   WHERE config_group = 'tenancy'
     AND config_key IN ('tenant.member_limit', 'tenant.workspace_limit');
  SELECT count(*) INTO cols FROM information_schema.columns
   WHERE table_schema = 'tenancy' AND table_name = 'tenants'
     AND column_name IN ('member_limit', 'workspace_limit');
  /* 断言也要问活库的 GRANT，不只问列在不在——本次就是靠这一问才发现 98 文件改了、
     活库没改。没有 platform_svc 的环境（本机部分库）不计，视作 2。 */
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN 2
              ELSE (SELECT count(*) FROM information_schema.column_privileges
                     WHERE grantee = 'platform_svc' AND table_schema = 'tenancy'
                       AND table_name = 'tenants' AND privilege_type = 'UPDATE'
                       AND column_name IN ('member_limit', 'workspace_limit')) END
    INTO granted;

  IF n <> 2 OR cols <> 2 OR granted <> 2 THEN
    RAISE EXCEPTION '[tenant-abuse-caps] 落点不全：settings % 条（应 2）、覆盖列 % 个（应 2）、可改授权 % 个（应 2）', n, cols, granted;
  END IF;
  RAISE NOTICE '[tenant-abuse-caps] 就位：平台默认 2 条 + 单租户覆盖列 2 个（NULL = 随默认）+ 两列已进 UPDATE 白名单';
END $$;
