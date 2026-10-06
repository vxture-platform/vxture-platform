-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 积分换算配置 + 换算能力码（ADR-014 PR3a）
--
-- 依据：owner 2026-10-06 四点裁定 + 三项参数裁定——不同模型配不同成本、用不同换算比例、
-- 让毛利基本趋同；换算功能放 admin、可设置、预置推荐参数（锚价 ¥0.20/credit、目标毛利 70%）。
--
-- 本迁移给存量库建一张配置表 + 两个能力码（与 50_metering.sql §6e / seed-catalog.mjs 同形）：
--   · metering.credit_pricing_config  单例一行：锚价（micro-CNY/credit）+ 目标毛利（bps），可调
--   · pricing:credit_rate.read / .manage  换算面的读/管能力（与 pricing:price_rule.* 并列的第三资源）
-- 以及默认一行（¥0.20 / 70%）、新表 GRANT、能力码授给原本能管定价的角色、挂到模型计价菜单。
-- **不改任何既有表、不动任何既有数据。**
--
-- 新库不跑迁移（DDL + seed 直建），表与能力码都已在 50_metering.sql / seed-catalog.mjs 里；
-- 本迁移只服务存量库。
--
-- 幂等：整份可重跑（IF NOT EXISTS / on conflict / where 幂等）。
-- 顺序：**先 migrate 再 deploy**（admin 换算面读/写这张表与这两个码；表/码不在就 500/403）。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. 锚点：缺一个就抛，不要静默建一半 ───────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('metering.token_credit_rates') IS NULL THEN
    RAISE EXCEPTION '[credit-pricing] metering.token_credit_rates 不在 —— 先 apply 50_metering.sql / 2026-10-04-token-usage-ingest.sql';
  END IF;
  IF to_regclass('admin.operator_permission') IS NULL THEN
    RAISE EXCEPTION '[credit-pricing] admin.operator_permission 不在 —— 先 apply admin DDL';
  END IF;
END $$;

-- ── 1. 配置表（单例一行；与 token_credit_rates 的不可改行相反，这张可调）──────────
CREATE TABLE IF NOT EXISTS metering.credit_pricing_config (
    singleton                   boolean       NOT NULL DEFAULT true,
    anchor_micro_cny_per_credit bigint        NOT NULL,
    target_margin_bps           integer       NOT NULL,
    updated_by                  uuid,
    updated_at                  timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (singleton),
    CONSTRAINT chk_credit_pricing_config_singleton CHECK (singleton),
    CONSTRAINT chk_credit_pricing_config_anchor CHECK (anchor_micro_cny_per_credit > 0),
    CONSTRAINT chk_credit_pricing_config_margin CHECK (target_margin_bps >= 0 AND target_margin_bps < 10000)
);

-- ── 2. GRANT：新表要显式授（ALTER DEFAULT PRIVILEGES 只管建表时刻之后由该角色建的表）──
--   列锁与 98_column_locks.sql 同形：singleton（单例 PK）不可改，其余四列可改。
GRANT SELECT, INSERT, DELETE ON metering.credit_pricing_config TO platform_svc;
REVOKE UPDATE ON metering.credit_pricing_config FROM platform_svc;
GRANT UPDATE (anchor_micro_cny_per_credit, target_margin_bps, updated_by, updated_at) ON metering.credit_pricing_config TO platform_svc;
GRANT SELECT ON metering.credit_pricing_config TO reporting_ro;

-- ── 3. 默认一行：锚价 ¥0.20/credit（200000 micro-CNY）+ 目标毛利 70%（7000 bps）──────
INSERT INTO metering.credit_pricing_config (singleton, anchor_micro_cny_per_credit, target_margin_bps)
VALUES (true, 200000, 7000)
ON CONFLICT (singleton) DO NOTHING;

-- ── 4. 能力码：pricing:credit_rate.read / .manage（与 seed-catalog.mjs 的 name/description 一致）──
INSERT INTO admin.operator_permission
  (perm_code, perm_type, perm_name, perm_name_key, is_system, description, description_key,
   requires_step_up, created_by, updated_by, created_at, updated_at)
SELECT v.code, 'api', v.name, 'ops.perm.' || replace(v.code, ':', '.'), true, v.description,
       'ops.perm.' || replace(v.code, ':', '.') || '.desc', false, s.id, s.id, now(), now()
  FROM (VALUES
    ('pricing:credit_rate.read',   'View credit conversion',
       'View token→credit rates, the derived margin-equalizing rates and realized margin'),
    ('pricing:credit_rate.manage', 'Manage credit conversion',
       'Set the credit anchor and target margin, and apply derived token→credit rates')
  ) AS v(code, name, description)
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
ON CONFLICT (perm_code) DO NOTHING;

-- ── 5. 授给原本就能管定价的角色（grantee 判据 = 已持有 pricing:price_rule.create 的角色）──
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT DISTINCT rp.role_id, n.id, r.is_system, s.id, now()
  FROM (VALUES
    ('pricing:credit_rate.read',   'pricing:price_rule.create'),
    ('pricing:credit_rate.manage', 'pricing:price_rule.create')
  ) AS g(new_code, via_code)
  JOIN admin.operator_permission via ON via.perm_code = g.via_code
  JOIN admin.operator_role_permission rp ON rp.permission_id = via.id
  JOIN admin.operator_role r ON r.id = rp.role_id
  JOIN admin.operator_permission n ON n.perm_code = g.new_code
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 6. 挂到「模型计价策略」菜单节点（与 price_rule / policy 同一页）────────────────
UPDATE admin.operator_permission c
   SET parent_id = p.id, updated_at = now()
  FROM (VALUES
    ('pricing:credit_rate.read',   'admin.menu.model_gateway'),
    ('pricing:credit_rate.manage', 'admin.menu.model_gateway')
  ) AS m(code, menu)
  JOIN admin.operator_permission p ON p.perm_code = m.menu
 WHERE c.perm_code = m.code;

COMMIT;
