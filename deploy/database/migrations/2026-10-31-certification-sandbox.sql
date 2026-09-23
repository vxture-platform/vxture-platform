-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-31-certification-sandbox.sql
-- 批 2 · 认证沙箱的两件家具：不可登录的锚点账号 + 认证租户
--
-- 这两样是平台自己的固定装置（同 admin.operator_accounts 里的 systemadmin），
-- 不是运营建出来的数据，所以进迁移与 seed 两处，而不是等运行时去造。
-- **每产品一个工作区**不在这里——那是认证编排按需建的，建了才有意义。
--
-- ── 为什么必须有一个锚点账号 ──
-- `tenancy.tenants.owner_user_id` 是 NOT NULL，指向 `account.users`。而
-- `systemadmin` 是 `admin.operator_accounts` 的行（system_builtin、disabled、无凭据），
-- **不在那张表里**，顶不上这个位置。
--
-- 挂到某个具体运营者的 user 上则更糟：那个人离职或停用之后，认证租户就成了孤儿，
-- 而认证台账要能长期答「这个产品当时在哪个沙箱里认的」。
--
-- 所以建一个平台持有的 `account.users` 行：`status='disabled'`、**不配任何凭据**，
-- 登录路径无从走通。它只是一个所有权指针。
--
-- ── 哨兵值而不是编造一个手机号 ──
-- `account.users.phone` 是 NOT NULL + UNIQUE，且**没有格式 CHECK**。编一个看起来
-- 像真号的值（+8613000000000）迟早会和某个真人撞上，那时冲突发生在 UNIQUE 上、
-- 报错离现场很远。这里用一望而知的哨兵串；`normalizePhoneNumber` 解析不出来时
-- 返回 null（不抛），所以显示面拿到的是「未设置」而不是异常——已核过实现。
--
-- ── 锚点账号不进租户成员表 ──
-- `tenant_memberships` 要 `role_id`（→access.roles），而锚点根本不参与任何事：
-- 它不登录、不操作、不占席位。真正要参与的是**沙箱测试用户**（给产品方用的那个），
-- 它是后续由运营在该租户下正常拉进来的成员，走的是和客户完全一样的路径。
--
-- ── 认证租户的形态是 organization ──
-- `personal` 有一条「每人至多一个个人租户」的部分唯一索引，用它会和锚点账号自己的
-- 个人租户抢位置。而形态与用途是两根轴：一个认证租户**仍然是 organization 形态**，
-- 变的是它为什么存在——那由 `purpose` answer，不由 `type`。
--
-- 幂等：固定 UUID + ON CONFLICT DO NOTHING + 末尾断言。可重复执行。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① 锚点账号（不可登录）
INSERT INTO account.users
  (id, account, email, phone, phone_verified_at, status, source, created_at, updated_at)
VALUES
  ('00000000-0000-4000-a000-0000000000c1',
   'sys.certification.anchor',
   NULL,
   'sys.certification.anchor',   -- 哨兵：不是手机号，也不打算是
   now(),
   'disabled',
   'system',
   now(), now())
ON CONFLICT (id) DO NOTHING;

-- ② 认证租户
INSERT INTO tenancy.tenants
  (id, name, display_name, type, purpose, owner_user_id, status, created_at, updated_at)
VALUES
  ('00000000-0000-4000-a000-0000000000c2',
   '接入认证沙箱',
   '接入认证沙箱',
   'organization',
   'certification',
   '00000000-0000-4000-a000-0000000000c1',
   'active',
   now(), now())
ON CONFLICT (id) DO NOTHING;

COMMIT;

DO $$
DECLARE
  u_status  text;
  u_cred    int;
  t_purpose text;
  t_type    text;
  n_other   int;
BEGIN
  SELECT status INTO u_status FROM account.users
   WHERE id = '00000000-0000-4000-a000-0000000000c1';
  IF u_status IS DISTINCT FROM 'disabled' THEN
    RAISE EXCEPTION '[certification-sandbox] 锚点账号不存在或不是 disabled（实为 %）',
      coalesce(u_status, 'NULL');
  END IF;

  /*
   * 「不可登录」不是靠 status 一个字段，是靠**没有凭据**。这里断言的是后者——
   * 只看 status 的话，谁把它改回 active 就悄悄多出一个能登录的账号。
   */
  SELECT count(*) INTO u_cred FROM credential.user_credentials
   WHERE user_id = '00000000-0000-4000-a000-0000000000c1';
  IF u_cred <> 0 THEN
    RAISE EXCEPTION '[certification-sandbox] 锚点账号被配了凭据（% 条）—— 它本不该能登录', u_cred;
  END IF;

  SELECT purpose, type INTO t_purpose, t_type FROM tenancy.tenants
   WHERE id = '00000000-0000-4000-a000-0000000000c2';
  IF t_purpose IS DISTINCT FROM 'certification' OR t_type IS DISTINCT FROM 'organization' THEN
    RAISE EXCEPTION '[certification-sandbox] 认证租户的轴不对：purpose=% type=%',
      coalesce(t_purpose, 'NULL'), coalesce(t_type, 'NULL');
  END IF;

  /*
   * 反例断言：认证租户**有且只有一个**。多出第二个就意味着有两套沙箱，
   * 而认证台账按 workspace 收口、workspace 挂在租户下——两套沙箱会让
   * 「这条认证是在哪儿跑的」出现两个答案。不数全库总数，只数这一类。
   */
  SELECT count(*) INTO n_other FROM tenancy.tenants
   WHERE purpose = 'certification' AND deleted_at IS NULL;
  IF n_other <> 1 THEN
    RAISE EXCEPTION '[certification-sandbox] 认证租户有 % 个（应恰好 1）', n_other;
  END IF;

  RAISE NOTICE '[certification-sandbox] 锚点账号 disabled 且无凭据 ✓；认证租户 organization/certification ✓；全库认证租户恰好 1 个 ✓';
END $$;
