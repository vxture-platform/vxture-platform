-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-26-platform-api-ticket-comments-grant.sql
-- 运营侧信号巡检多一类「客户回复工单」：svc_platform_api ← support.ticket_comments 的 SELECT
--
-- ── 补的是哪个缺口 ──
-- 客户侧工单（2026-09-29）让入站方向第一次真的有东西进来：客户能自己提单、能回复。
-- 出站（我们 → 客户）这一批做全了，入站（客户 → 我们）**一条运营信号都没有**：
-- 客户回一句话不产生客户通知 ⇒ 没有运营镜像 ⇒ admin.operator_notices 没有行；
-- 而 ops-todos 的 `ticket` 那一档只看 status，本来就在列表里，不换档也不换严重度
-- ——屏幕上什么都不变。`support.ticket_comments` 还在 ops-todos 的禁用关系清单上，
-- 那条算法按设计不读流水，所以「未读回复」这个概念全仓不存在。
--
-- 于是巡检加第 12 类 `ticket.customer_replied`（business-event-signals.ts）：
-- 扫客户自己发的言，一条回复一条运营通告（去重键带回复时刻，所以回三句是三条）。
--
-- ── 为什么必须有这一份 ──
-- Postgres 对语句里**出现过的每一个关系**查权限，那一支返不返回行都一样。少这一行
-- 不是「少扫一类」，而是这一类整条 SQL 42501。巡检把每类的失败各自 catch 并汇总成
-- 一段失败（心跳记 failed，在 opera「任务调度」里显红），所以它不会静默——但运营端
-- 看到的仍然是「客户回复一条通告都没有」，正是这一批要治的那个病。
--
-- 97_service_roles.sql 只在 reseed（db-init action=init）时跑，活库的授权面会滞后于
-- 97 文件；migrate 是全量重放，本份每次跟着跑一遍，活库就跟得上。
-- （同一个毛病见 2026-11-23 那份的头注；两处逐字一致。）
--
-- ── 只 SELECT，且只这一张 ──
-- 通告正文**一个字也不引评论文本**：只用工单标题、单号、状态与租户。内部备注不可能
-- 被那条 SQL 取到（谓词只认客户发言那一个词），但更稳的做法是连客户自己的话也不引
-- ——运营通告是「有事发生了，去看」，不是内容转投。
-- 不给 INSERT/UPDATE/DELETE：这张表是 append-only（BEFORE UPDATE 触发器封死），
-- 而巡检一行也不改它。也不给 ALTER DEFAULT PRIVILEGES（将来新增的表不跟着漏进来）。
--
-- ── 与前两份的关系（别顶红已合并的迁移）──
-- 2026-11-23 的审计段按**点名七张表**计数（不是全库快照），本份加的是第八张表，
-- 所以那个 7 不动；它的「这七张表上写权限必须为 0」也与本份无关。
-- 2026-11-21 断言 admin.operator_account / operator_credential / risk_records 仍为 0 项
-- ——本份不碰它们，末尾照样反向断言一次，免得后来者顺手加一行把那份顶红。
--
-- 重复执行安全：GRANT 天然幂等；角色不存在时整段跳过。第二遍 0 变化。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_api') THEN
    -- support 的 USAGE 由 2026-11-23 那份授过；重复授权幂等，写在这里是为了让本份
    -- 单独跑也成立（不假设前一份已经跑过——migrate 是按文件名顺序重放，但人也会单跑）。
    GRANT USAGE ON SCHEMA support TO svc_platform_api;
    GRANT SELECT ON support.ticket_comments TO svc_platform_api;
    RAISE NOTICE '[platform-api-ticket-comments-grant] svc_platform_api 已可读 support.ticket_comments';
  ELSE
    RAISE NOTICE '[platform-api-ticket-comments-grant] svc_platform_api 不存在，跳过（97 建角色时会一并授）';
  END IF;
END $$;

COMMIT;

-- ── 审计：授权真的在、且真的只多这一项 ──────────────────────────────────────
DO $$
DECLARE v int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_api') THEN
    RAISE NOTICE '[platform-api-ticket-comments-grant] 角色缺席，跳过审计';
    RETURN;
  END IF;

  -- ① schema USAGE：没有 USAGE 时表级 SELECT 是摆设。
  IF NOT has_schema_privilege('svc_platform_api', 'support', 'USAGE') THEN
    RAISE EXCEPTION '[platform-api-ticket-comments-grant] svc_platform_api 仍无 support schema 的 USAGE';
  END IF;

  -- ② 这一张表上有 SELECT。按对象过滤，不做全库快照。
  SELECT count(*) INTO v FROM information_schema.table_privileges
   WHERE grantee = 'svc_platform_api'
     AND privilege_type = 'SELECT'
     AND table_schema = 'support' AND table_name = 'ticket_comments';
  IF v <> 1 THEN
    RAISE EXCEPTION '[platform-api-ticket-comments-grant] support.ticket_comments 上应有 SELECT，实为 % 项', v;
  END IF;

  -- ③ 不该有写权限：表是 append-only，巡检只读。
  SELECT count(*) INTO v FROM information_schema.table_privileges
   WHERE grantee = 'svc_platform_api'
     AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
     AND table_schema = 'support' AND table_name = 'ticket_comments';
  IF v <> 0 THEN
    RAISE EXCEPTION '[platform-api-ticket-comments-grant] support.ticket_comments 上出现了 % 项写权限，本份只该给 SELECT', v;
  END IF;

  -- ④ 反向：2026-11-21 断言为 0 的三张表仍然是 0。
  SELECT count(*) INTO v FROM information_schema.table_privileges
   WHERE grantee = 'svc_platform_api'
     AND table_schema = 'admin'
     AND table_name IN ('operator_account', 'operator_credential', 'risk_records');
  IF v <> 0 THEN
    RAISE EXCEPTION '[platform-api-ticket-comments-grant] svc_platform_api 拿到了 admin.operator_account / operator_credential / risk_records 的 % 项权限，2026-11-21 那份迁移断言这里必须是 0', v;
  END IF;

  RAISE NOTICE '[platform-api-ticket-comments-grant] OK';
END $$;
