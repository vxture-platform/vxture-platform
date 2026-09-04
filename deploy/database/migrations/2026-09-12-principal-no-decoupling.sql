-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 主体可视码 v3「人租同号」→ v4「三号解耦」(owner 2026-09-05 定案)
--
-- 依据:docs/30-design/data_identity_200_schema.md §11(本迁移同步改写该节)。
-- 动因:v3 把归属关系烧进号里(个人租户号 = owner 的 user_no;空间号 = 租户号×1000
--       + 三位序号),这与架构铁律二「可视码永不做关联键」相悖,并派生出三处债:
--       个人转组织必须换号、空间号必须跟着改(要一个 SECURITY DEFINER 触发器绕列锁)、
--       每租户空间数被三位序号卡死 999。v4 三个号各自独立取号、互不推导,
--       归属只走 uuid 外键。号形:10 位 = 类别位(1=用户/2=租户/3=工作空间)
--       + 随机 8 位 + Luhn 校验位。
--
-- 六件事:① 装 public 取号/校验函数 ② 装三张表的分配器与 BEFORE INSERT 触发器
--         ③ 退役 v3 的换发/跟随触发器与共享序列 ④ 存量重编号(旧号备份进 public
--         .vx_principal_no_backup_v3,并同步修正 `_{user_no}` / `deleted_{user_no}`
--         形状的登录句柄)⑤ 退役 tenants.workspace_counter(999 上限随之解除)
--         ⑥ 三张表加类别位 + Luhn 的 CHECK。
--
-- 幂等:整份可重跑。重编号只挑「按 v4 校验不通过」的行,已是 v4 的行不再动;
--       新号 10 位、旧号 12/15 位,值域不重叠,重编号期间不可能与旧号撞号。
-- 前置:本迁移改 account.users / tenancy.tenants / tenancy.workspaces 的锚点列,
--       须以库 owner 身份执行(db-init 即是)。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① 取号与校验(与 ddl/00_schemas.sql 同源)────────────────────────────────────

CREATE OR REPLACE FUNCTION public.luhn_check_digit(p_digits text) RETURNS int
  LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  v_sum int := 0;
  v_i   int;
  v_d   int;
  v_dbl boolean := true;   -- 自右向左,紧邻校验位的那位起加倍
BEGIN
  FOR v_i IN REVERSE length(p_digits)..1 LOOP
    v_d := substr(p_digits, v_i, 1)::int;
    IF v_dbl THEN
      v_d := v_d * 2;
      IF v_d > 9 THEN v_d := v_d - 9; END IF;
    END IF;
    v_sum := v_sum + v_d;
    v_dbl := NOT v_dbl;
  END LOOP;
  RETURN (10 - (v_sum % 10)) % 10;
END;
$$;

CREATE OR REPLACE FUNCTION public.principal_no_valid(p_no bigint, p_class int) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  v_text text;
BEGIN
  IF p_no < p_class::bigint * 1000000000
     OR p_no >= (p_class::bigint + 1) * 1000000000 THEN
    RETURN false;
  END IF;
  v_text := p_no::text;   -- 区间保证首位非 0,恒 10 位
  RETURN substr(v_text, 10, 1)::int = public.luhn_check_digit(substr(v_text, 1, 9));
END;
$$;

CREATE OR REPLACE FUNCTION public.new_principal_no(p_class int) RETURNS bigint
  LANGUAGE plpgsql VOLATILE STRICT AS $$
DECLARE
  v_body text;
BEGIN
  IF p_class NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION '主体码类别位只能是 1(用户)/2(租户)/3(工作空间),收到 %', p_class;
  END IF;
  v_body := p_class::text || lpad(floor(random() * 100000000)::bigint::text, 8, '0');
  RETURN (v_body || public.luhn_check_digit(v_body)::text)::bigint;
END;
$$;

-- ② 分配器 + BEFORE INSERT 触发器(与 ddl/95_triggers.sql 同源)────────────────

CREATE OR REPLACE FUNCTION account.alloc_user_no() RETURNS bigint
  LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_no  bigint;
  v_try int := 0;
BEGIN
  LOOP
    v_no := public.new_principal_no(1);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM account.users WHERE user_no = v_no);
    v_try := v_try + 1;
    IF v_try >= 20 THEN
      RAISE EXCEPTION 'user_no 分配失败:连续 % 次撞号(号段将满?)', v_try;
    END IF;
  END LOOP;
  RETURN v_no;
END;
$$;

CREATE OR REPLACE FUNCTION tenancy.alloc_tenant_no() RETURNS bigint
  LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_no  bigint;
  v_try int := 0;
BEGIN
  LOOP
    v_no := public.new_principal_no(2);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenancy.tenants WHERE tenant_no = v_no);
    v_try := v_try + 1;
    IF v_try >= 20 THEN
      RAISE EXCEPTION 'tenant_no 分配失败:连续 % 次撞号(号段将满?)', v_try;
    END IF;
  END LOOP;
  RETURN v_no;
END;
$$;

CREATE OR REPLACE FUNCTION tenancy.alloc_workspace_no() RETURNS bigint
  LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_no  bigint;
  v_try int := 0;
BEGIN
  LOOP
    v_no := public.new_principal_no(3);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenancy.workspaces WHERE workspace_no = v_no);
    v_try := v_try + 1;
    IF v_try >= 20 THEN
      RAISE EXCEPTION 'workspace_no 分配失败:连续 % 次撞号(号段将满?)', v_try;
    END IF;
  END LOOP;
  RETURN v_no;
END;
$$;

CREATE OR REPLACE FUNCTION account.assign_user_no() RETURNS trigger AS $$
BEGIN
  IF NEW.user_no IS NULL THEN NEW.user_no := account.alloc_user_no(); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_assign_no ON account.users;
CREATE TRIGGER trg_users_assign_no
  BEFORE INSERT ON account.users
  FOR EACH ROW EXECUTE FUNCTION account.assign_user_no();

CREATE OR REPLACE FUNCTION tenancy.assign_tenant_no() RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_no IS NULL THEN NEW.tenant_no := tenancy.alloc_tenant_no(); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_assign_no ON tenancy.tenants;
CREATE TRIGGER trg_tenants_assign_no
  BEFORE INSERT ON tenancy.tenants
  FOR EACH ROW EXECUTE FUNCTION tenancy.assign_tenant_no();

CREATE OR REPLACE FUNCTION tenancy.assign_workspace_no() RETURNS trigger AS $$
BEGIN
  IF NEW.workspace_no IS NULL THEN NEW.workspace_no := tenancy.alloc_workspace_no(); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workspaces_assign_no ON tenancy.workspaces;
CREATE TRIGGER trg_workspaces_assign_no
  BEFORE INSERT ON tenancy.workspaces
  FOR EACH ROW EXECUTE FUNCTION tenancy.assign_workspace_no();

-- ③ 退役 v3 的换发 / 跟随触发器与列默认值 ────────────────────────────────────

DROP TRIGGER  IF EXISTS trg_tenants_reissue_no_on_conversion ON tenancy.tenants;
DROP TRIGGER  IF EXISTS trg_tenants_reprefix_ws              ON tenancy.tenants;
DROP FUNCTION IF EXISTS tenancy.reissue_tenant_no_on_conversion();
DROP FUNCTION IF EXISTS tenancy.reprefix_workspace_nos();

-- 旧列默认值走共享序列,先摘掉才能退役序列。
ALTER TABLE account.users ALTER COLUMN user_no DROP DEFAULT;

-- ④ 存量重编号(只挑不符合 v4 的行;旧号备份可查)──────────────────────────────

CREATE TABLE IF NOT EXISTS public.vx_principal_no_backup_v3 (
  entity      varchar(16)  NOT NULL,     -- user / tenant / workspace
  row_id      uuid         NOT NULL,
  old_no      bigint       NOT NULL,
  new_no      bigint       NOT NULL,
  migrated_at timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pk_vx_principal_no_backup_v3 PRIMARY KEY (entity, row_id)
);
COMMENT ON TABLE public.vx_principal_no_backup_v3 IS
  'v3→v4 主体码重编号的旧号快照(2026-09-12 迁移)。确认无对外遗留引用后可整表删除。';

DO $$
DECLARE
  r     RECORD;
  v_new bigint;
  v_cnt int := 0;
BEGIN
  FOR r IN SELECT id, user_no, account FROM account.users
            WHERE NOT public.principal_no_valid(user_no, 1)
            ORDER BY created_at
  LOOP
    v_new := account.alloc_user_no();
    INSERT INTO public.vx_principal_no_backup_v3 (entity, row_id, old_no, new_no)
      VALUES ('user', r.id, r.user_no, v_new)
      ON CONFLICT (entity, row_id) DO UPDATE SET new_no = excluded.new_no, migrated_at = now();
    -- 登录句柄默认形状是 `_{user_no}`;已清扫账号是 `deleted_{user_no}`。二者随号同步,
    -- 用户自定义过的句柄一律不动。
    UPDATE account.users
       SET user_no = v_new,
           account = CASE
             WHEN r.account = '_'        || r.user_no::text THEN '_'        || v_new::text
             WHEN r.account = 'deleted_' || r.user_no::text THEN 'deleted_' || v_new::text
             ELSE r.account
           END,
           updated_at = now()
     WHERE id = r.id;
    v_cnt := v_cnt + 1;
  END LOOP;
  RAISE NOTICE '[principal-no-v4] users 重编号 % 行', v_cnt;
END $$;

DO $$
DECLARE
  r     RECORD;
  v_new bigint;
  v_cnt int := 0;
BEGIN
  FOR r IN SELECT id, tenant_no FROM tenancy.tenants
            WHERE NOT public.principal_no_valid(tenant_no, 2)
            ORDER BY created_at
  LOOP
    v_new := tenancy.alloc_tenant_no();
    INSERT INTO public.vx_principal_no_backup_v3 (entity, row_id, old_no, new_no)
      VALUES ('tenant', r.id, r.tenant_no, v_new)
      ON CONFLICT (entity, row_id) DO UPDATE SET new_no = excluded.new_no, migrated_at = now();
    UPDATE tenancy.tenants SET tenant_no = v_new, updated_at = now() WHERE id = r.id;
    v_cnt := v_cnt + 1;
  END LOOP;
  RAISE NOTICE '[principal-no-v4] tenants 重编号 % 行', v_cnt;
END $$;

DO $$
DECLARE
  r     RECORD;
  v_new bigint;
  v_cnt int := 0;
BEGIN
  FOR r IN SELECT id, workspace_no FROM tenancy.workspaces
            WHERE NOT public.principal_no_valid(workspace_no, 3)
            ORDER BY created_at
  LOOP
    v_new := tenancy.alloc_workspace_no();
    INSERT INTO public.vx_principal_no_backup_v3 (entity, row_id, old_no, new_no)
      VALUES ('workspace', r.id, r.workspace_no, v_new)
      ON CONFLICT (entity, row_id) DO UPDATE SET new_no = excluded.new_no, migrated_at = now();
    UPDATE tenancy.workspaces SET workspace_no = v_new, updated_at = now() WHERE id = r.id;
    v_cnt := v_cnt + 1;
  END LOOP;
  RAISE NOTICE '[principal-no-v4] workspaces 重编号 % 行', v_cnt;
END $$;

-- ⑤ 退役 workspace_counter(999 上限随之解除)+ 同步列锁白名单 ─────────────────

ALTER TABLE tenancy.tenants DROP COLUMN IF EXISTS workspace_counter;  -- 连带 chk_tenants_workspace_counter
GRANT UPDATE (name, type, owner_user_id, status, verification_status, verification_type, updated_at, deleted_at) ON tenancy.tenants TO platform_svc;

-- ⑥ 类别位 + Luhn 的 CHECK(重编号之后才加,保证一次通过)────────────────────

ALTER TABLE account.users        DROP CONSTRAINT IF EXISTS chk_users_user_no;
ALTER TABLE account.users        ADD  CONSTRAINT chk_users_user_no
  CHECK (public.principal_no_valid(user_no, 1));

ALTER TABLE tenancy.tenants      DROP CONSTRAINT IF EXISTS chk_tenants_tenant_no;
ALTER TABLE tenancy.tenants      ADD  CONSTRAINT chk_tenants_tenant_no
  CHECK (public.principal_no_valid(tenant_no, 2));

ALTER TABLE tenancy.workspaces   DROP CONSTRAINT IF EXISTS chk_workspaces_workspace_no;
ALTER TABLE tenancy.workspaces   ADD  CONSTRAINT chk_workspaces_workspace_no
  CHECK (public.principal_no_valid(workspace_no, 3));

-- 序列退役(此时已无任何默认值 / 触发器引用它)。
DROP SEQUENCE IF EXISTS account.principal_no_seq;

-- 后置断言:三张表全部合规,且不再有「个人租户号 = owner 的 user_no」这类推导巧合。
DO $$
DECLARE v_bad bigint;
BEGIN
  SELECT count(*) INTO v_bad FROM account.users      WHERE NOT public.principal_no_valid(user_no, 1);
  IF v_bad > 0 THEN RAISE EXCEPTION '[principal-no-v4] users 仍有 % 行不合规', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM tenancy.tenants    WHERE NOT public.principal_no_valid(tenant_no, 2);
  IF v_bad > 0 THEN RAISE EXCEPTION '[principal-no-v4] tenants 仍有 % 行不合规', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM tenancy.workspaces WHERE NOT public.principal_no_valid(workspace_no, 3);
  IF v_bad > 0 THEN RAISE EXCEPTION '[principal-no-v4] workspaces 仍有 % 行不合规', v_bad; END IF;

  SELECT count(*) INTO v_bad
    FROM tenancy.tenants t JOIN account.users u ON u.id = t.owner_user_id
   WHERE t.tenant_no = u.user_no;
  IF v_bad > 0 THEN RAISE EXCEPTION '[principal-no-v4] 仍有 % 个租户号等于其所有者的 user_no', v_bad; END IF;

  SELECT count(*) INTO v_bad
    FROM tenancy.workspaces w JOIN tenancy.tenants t ON t.id = w.tenant_id
   WHERE w.workspace_no / 1000 = t.tenant_no;
  IF v_bad > 0 THEN RAISE EXCEPTION '[principal-no-v4] 仍有 % 个空间号由租户号推导', v_bad; END IF;

  RAISE NOTICE '[principal-no-v4] 后置断言全部通过';
END $$;

COMMIT;
