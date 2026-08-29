-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — appoidc.oidc_clients 加 client_kind，把「产品接入凭据必须挂在已登记
-- 产品上」从代码约定升成数据库不变式
--
-- 依据：docs/20-specs/000-platform/opera/40-product-registry.md（2026-08-30，owner
-- 口径：产品目录是产品的唯一登记入口，其余业务面只读 product.products）。
--
-- 为什么要这一列：此前「平台级客户端」的定义是 product_id IS NULL——一个缺席当
-- 事实。seed 曾为五个尚无产品定义的规划产品（ontos/raven/anlan/forge/xuanzhen）
-- 建了 OIDC 客户端，它们与 website/console 在库里长得一模一样，于是运行监控只能
-- 靠一份硬编码豁免名单把它们当产品显示，token-exchange 则对它们一律 invalid_client。
-- client_kind 让「归谁」成为显式列，chk_oidc_clients_kind_product 把它与 product_id
-- 绑死，这类行从此写不进去。
--
-- 对存量行的处置（②）：那五个客户端**删除**，不是补产品行。产品目录是唯一入口，
-- 它们的产品定义完成之日，由运营者在「产品管理 · 产品目录」登记、再在「接入凭据」
-- 签发新客户端；迁移替它们预建目录行等于绕过入口。nocus 是已退役客户端
-- （seed 早已置 inactive），同批删除。删除前 RAISE NOTICE 逐条报出，事后可查。
--
-- 幂等：整份可重跑。列用 IF NOT EXISTS；约束按 pg_constraint 判重；数据语句自带
-- 幂等条件。
--
-- **顺序**：本迁移必须先于新版 seed-catalog.mjs 执行——新 seed 直接写 client_kind
-- 列，列不存在会报错（有意：宁可停下，不做静默兼容）。
--
-- 用法（生产，以 owner 身份）：
--   CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
--   或 psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <本文件>
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① 加列（与 22_appoidc.sql 逐字一致） ─────────────────────────────────────

ALTER TABLE appoidc.oidc_clients
  ADD COLUMN IF NOT EXISTS client_kind varchar(16) NOT NULL DEFAULT 'product';

-- ── ② 存量数据归类 ──────────────────────────────────────────────────────────
--
-- 平台自有门户：四个平台 RP 本来就是 product_id NULL 的正当持有者。
UPDATE appoidc.oidc_clients
   SET client_kind = 'platform', updated_at = now()
 WHERE client_id IN ('website', 'console', 'admin', 'opera')
   AND product_id IS NULL
   AND client_kind <> 'platform';

-- 产品客户端的 product_id 若从未回填（取决于该库当年跑 seed 的先后：旧 seed 把
-- 回填放在客户端与产品都建好之后，早于那一版建的库可能留着 NULL），这里按旧 seed
-- 同一条 T1 规则补上——client_id 去掉 -beta/-canary 后缀 = product_code。只补
-- 能对上目录行的；对不上的不猜，留给下面的删除与断言。
UPDATE appoidc.oidc_clients c
   SET product_id = p.id, updated_at = now()
  FROM product.products p
 WHERE c.product_id IS NULL
   AND c.client_kind = 'product'
   AND p.deleted_at IS NULL
   AND c.client_id IN (p.product_code, p.product_code || '-beta', p.product_code || '-canary');

-- 孤儿客户端：seed 曾建、从未有过产品行的五个规划产品 + 已退役的 nocus。
-- oidc_consents 对 client_id 有 ON DELETE CASCADE，随行清掉。
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT client_id, status, redirect_uris
      FROM appoidc.oidc_clients
     WHERE client_id IN ('ontos', 'raven', 'anlan', 'forge', 'xuanzhen', 'nocus')
       AND product_id IS NULL
  LOOP
    RAISE NOTICE '[oidc-client-kind] deleting orphan client % (status=%, redirect_uris=%)',
      r.client_id, r.status, r.redirect_uris;
  END LOOP;

  DELETE FROM appoidc.oidc_clients
   WHERE client_id IN ('ontos', 'raven', 'anlan', 'forge', 'xuanzhen', 'nocus')
     AND product_id IS NULL;
END $$;

-- ── ③ 断言：不得再有「产品级却无产品」的行 ──────────────────────────────────
--
-- 上面两步只处理已知的行；库里若还有别的 product_id NULL 且不是平台门户的客户端，
-- 这里停下并报出，而不是被下一步的 CHECK 以一句 "violates check constraint" 打断。
DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(client_id, ', ' ORDER BY client_id)
    INTO offenders
    FROM appoidc.oidc_clients
   WHERE client_kind = 'product' AND product_id IS NULL;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION '[oidc-client-kind] product-kind clients without product_id: %. '
      'Either register the product in the catalog and link it, or mark the row platform-kind / delete it.',
      offenders;
  END IF;
END $$;

-- ── ④ 约束（与 22_appoidc.sql 逐字一致） ─────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE appoidc.oidc_clients
    ADD CONSTRAINT chk_oidc_clients_client_kind CHECK (client_kind IN ('platform','product'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE appoidc.oidc_clients
    ADD CONSTRAINT chk_oidc_clients_kind_product
      CHECK ((client_kind = 'platform') = (product_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ⑤ 列锁同步（98_column_locks.sql 的对应两条） ─────────────────────────────
--
-- 漏了不会报错，只会写不进去——platform_svc 对未授权列的 UPDATE 被拒。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    REVOKE UPDATE ON appoidc.oidc_clients FROM platform_svc;
    GRANT UPDATE (client_id, client_secret_hash, realm, product_id, client_kind, release_channel, name, display_name, logo_url, redirect_uris, post_logout_redirect_uris, allowed_scopes, access_token_ttl, refresh_token_ttl, pkce_required, slo_participation, back_channel_logout_uri, status, updated_at) ON appoidc.oidc_clients TO platform_svc;
  END IF;
END $$;

COMMIT;
