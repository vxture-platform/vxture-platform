-- ═══════════════════════════════════════════════════════════════════════════
-- R4 前向迁移 — 审计发起面 + 提权标记 + oidc 客户端状态词表统一
--
-- 依据：docs/70-workplan/50-release-resequencing.md 的 R4。**必须在 R4 镜像之前执行。**
-- 反了会怎样：新镜像的每一次写都要往 support.audit_logs 插一行带 actor_console 的记录，
-- 列不存在则 insert 失败；而审计写在业务写的同一个事务里，**所以业务写会跟着回滚**。
-- 表现是「所有写操作都失败」，不是「审计少了几行」。
--
-- 与 R2 不同，本份**不是纯加法**：第三项要改约束并改数据。
--
-- 幂等：整份可重跑。
--
-- 用法（生产，以 owner 身份）：
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <本文件>
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① support.audit_logs.actor_console（加列）────────────────────────────────
--
-- product_251 X-3：这一笔是从哪个管理面发起的。取值是令牌里的 `act.sub`——铸造这次
-- 换票的工作台 RP，不是从别处推导出来的。NULL = 非控制台发起。

ALTER TABLE support.audit_logs
  ADD COLUMN IF NOT EXISTS actor_console varchar(32);

-- ── ② admin.operator_permission.requires_step_up（加列）──────────────────────
--
-- 提权由这一列判定，由工作台在**动作发生的那一刻**执行；不再靠令牌上的 `amr` 追认
-- （那是拿会话级属性顶替操作级属性，见 auth-bff 停铸 amr 那一笔）。
-- 默认 false：存量权限一律不要求提权，要哪些提权是后续逐条开的运营决定，不是迁移的事。

ALTER TABLE admin.operator_permission
  ADD COLUMN IF NOT EXISTS requires_step_up boolean NOT NULL DEFAULT false;

-- ── ③ appoidc.oidc_clients 的状态词表：disabled → inactive ───────────────────
--
-- B-3：同一个词在全平台只有一个含义。`disabled` 是这张表独有的第三种说法。
--
-- **这一项要改约束 + 改数据**，顺序不能反：CHECK 还在的时候 UPDATE 会被它拒掉。
-- 卸 CHECK → UPDATE → 建新 CHECK，三步在同一个事务里，中途失败整体回滚。
--
-- 为什么可以在旧镜像还在跑的时候做（2026-08-17 实测确认）：
-- 生产在跑的 `PgOidcClientRepository` 三处过滤全是 `status = 'active'`，**不是**
-- `status <> 'disabled'`。所以那两行从 `disabled` 变成 `inactive` 之后仍然不等于
-- 'active'，**不会被误当成启用**。若当初写的是后者，这一步就会在旧镜像窗口里
-- 把两个已停用的 OIDC 客户端悄悄放开——那是个安全洞，不是排版问题。

ALTER TABLE appoidc.oidc_clients
  DROP CONSTRAINT IF EXISTS chk_oidc_clients_status;

UPDATE appoidc.oidc_clients
   SET status = 'inactive', updated_at = now()
 WHERE status = 'disabled';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'appoidc.oidc_clients'::regclass
      AND conname = 'chk_oidc_clients_status'
  ) THEN
    ALTER TABLE appoidc.oidc_clients
      ADD CONSTRAINT chk_oidc_clients_status
      CHECK (status IN ('active','inactive'));
  END IF;
END $$;

-- ── ④ 列锁同步（98_column_locks.sql 的对应三条）─────────────────────────────
--
-- 漏列不报错，只会**写不进去**：platform_svc 对未授权列的 UPDATE 被拒，新列一直停在
-- 默认值。actor_console 尤其要紧——它是 INSERT 写的，但列锁按统一规则仍要授。

REVOKE UPDATE ON support.audit_logs FROM platform_svc;
GRANT UPDATE (actor_type, actor_id, actor_console, tenant_id, action, result, resource_type, resource_id, error_code, before, after, request_id, duration_ms, ip_address, user_agent) ON support.audit_logs TO platform_svc;

REVOKE UPDATE ON admin.operator_permission FROM platform_svc;
GRANT UPDATE (parent_id, perm_code, perm_name, perm_name_key, perm_type, route_path, component, icon, category, description, is_active, is_system, sort, updated_by, description_key, is_customer_visible, is_workforce_visible, requires_step_up, updated_at) ON admin.operator_permission TO platform_svc;

COMMIT;

-- ── 核对（执行后跑一遍，不要只看"没报错"）─────────────────────────────────
--
--   SELECT column_name FROM information_schema.columns
--    WHERE (table_schema,table_name,column_name) IN
--          (('support','audit_logs','actor_console'),
--           ('admin','operator_permission','requires_step_up'));
--   -- 期望 2 行
--
--   SELECT status, count(*) FROM appoidc.oidc_clients GROUP BY status;
--   -- 期望只有 active / inactive 两种，不再有 disabled（迁移前：active 16、disabled 2）
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='appoidc.oidc_clients'::regclass AND conname='chk_oidc_clients_status';
--   -- 期望 CHECK (status IN ('active','inactive'))
