-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-12-02-finance-pii-read.sql
--
-- finance 角色补 `user:pii.read`（退款转账线 PR-D2，owner 决策 3 建议采纳）。
--
-- ── 为什么 ──
-- 退款走银行转账之后，客户的收款账户（billing.refunds.recipient_*）落在退款单上，它是 PII：
-- admin-bff 按 `user:pii.read` 掩码（与申报人邮箱 / 手机同一道闸门、同一套掩码，
-- bff/admin-bff/src/lib/pii-mask.ts）。真正去银行转账的人必须看明文，而 finance 持
-- `commerce:payment.settle`（能发起转账）却不持 `user:pii.read`——能点按钮、看不见账号，
-- 门就成了墙。不另立新码：一道门、既有 step-up。
--
-- 码写在 deploy/database/seed/seed-catalog.mjs（finance 块），而 `db-init action=migrate`
-- 只重放迁移、不重放 seed——存量库靠这一份，全新库靠 seed，两条路落同一行。
--
-- 全部幂等：migrate 是全量重放。
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. 前置断言 ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin.operator_account WHERE username = 'systemadmin') THEN
    RAISE EXCEPTION '[finance-pii-read] 找不到 systemadmin 锚点账号';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin.operator_permission WHERE perm_code = 'user:pii.read') THEN
    RAISE EXCEPTION '[finance-pii-read] 找不到 user:pii.read（码由 seed 建，先跑 seed）';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin.operator_role WHERE role_code = 'finance') THEN
    RAISE EXCEPTION '[finance-pii-read] 找不到 finance 角色';
  END IF;
END $$;

-- ── 1. 授权 ──────────────────────────────────────────────────────────────────
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT r.id, p.id, true, s.id, now()
  FROM admin.operator_role r
  JOIN admin.operator_permission p ON p.perm_code = 'user:pii.read'
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE r.role_code = 'finance'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 2. 自检：finance 真的拿到了 ───────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM admin.operator_role_permission rp
    JOIN admin.operator_role r ON r.id = rp.role_id
    JOIN admin.operator_permission p ON p.id = rp.permission_id
   WHERE r.role_code = 'finance' AND p.perm_code = 'user:pii.read';
  IF n <> 1 THEN
    RAISE EXCEPTION '[finance-pii-read] finance × user:pii.read 期望 1 行，实测 %', n;
  END IF;
  RAISE NOTICE '[finance-pii-read] OK —— finance 可看客户收款账户明文';
END $$;
