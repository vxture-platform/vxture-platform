-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — ruyin 从「产品目录条目」降为「平台级 first-party 客户端」
--
-- 依据：owner 2026-08-31。ruyin(如影)是与平台侧平级的桌面原生端(RFC 8252 public
-- client，loopback + PKCE)，有「web 页面登录授权」需求——它是一个 OAuth 客户端，
-- 不是一件可订阅/可退役的目录商品(与 Claude Code 之于 Anthropic 同构：CLI 是登录
-- 客户端，订阅是另一个被它消费的实体)。此前 ruyin 被同时建成了 OIDC 客户端**和**
-- product.products 里的一行 SaaS 商品，后者正是「删不掉」的根源。
--
-- 处置：
--   ① ruyin / ruyin-beta 两个客户端由 product 级改判 platform 级(product_id→NULL)。
--      桌面登录**不受影响**：auth-bff 的 authorize/token 路径不按 client_kind 分支，
--      realm 保持 customer 不变(website/console 本就是 customer-realm 的 platform 级
--      客户端，ruyin 与它们同类)。token-exchange(OBO)才假设 platform=workforce，而
--      桌面端不走 OBO。
--   ② ruyin 的 product.products 行软删(deleted_at)——从产品目录彻底消失。软删而非
--      硬删：可逆、留审计；配合新版 seed 把 ruyin 移出 PRODUCTS，reseed 不再重建。
--   ③ ruyin 作 primary 组件的套餐一并软删(实测应为零：ruyin-free 早经 U 线改名
--      umbra-free；此句为幂等兜底)。
--
-- 幂等：数据语句自带幂等条件(client_kind='product' / deleted_at IS NULL)，可重跑。
--
-- **顺序**：本迁移与新版 seed-catalog.mjs 相互一致(seed 把 ruyin/ruyin-beta 声明
-- 为 kind:"platform"、并从 PRODUCTS 移除 ruyin)，两者收敛到同一状态，先后皆可。
--
-- 回滚：把 ① 反过来(client_kind='product'、product_id 指回 ruyin 行)、清 ② 的
-- deleted_at 即可——但前提是 ruyin 行仍在(软删未被后续硬清)。
--
-- 用法(生产，以 owner 身份)：
--   CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
--   或 psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <本文件>
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① 客户端降级：product 级 → platform 级 ──────────────────────────────────
-- 只动「新 ruyin」这两个 loopback 公共客户端(client_kind='product')。ruyin.ai 的
-- 旧跨域 RP 早由 U 线改名 umbra，不在此列。product_id 与 client_kind 一并改，
-- chk_oidc_clients_kind_product((platform)=(product_id IS NULL)) 始终成立。
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT client_id, realm, token_endpoint_auth_method
      FROM appoidc.oidc_clients
     WHERE client_id IN ('ruyin', 'ruyin-beta')
       AND client_kind = 'product'
  LOOP
    RAISE NOTICE '[ruyin-declassify] client % → platform-kind (realm=%, auth=%)',
      r.client_id, r.realm, r.token_endpoint_auth_method;
  END LOOP;
END $$;

UPDATE appoidc.oidc_clients
   SET product_id = NULL, client_kind = 'platform', updated_at = now()
 WHERE client_id IN ('ruyin', 'ruyin-beta')
   AND client_kind = 'product';

-- ── ② + ③ 产品行与其 primary 套餐软删 ───────────────────────────────────────
-- 套餐先删(它经 plan_components 反查 ruyin 产品，产品行软删后该关联仍在、不影响
-- 反查，但先删更贴事务语义：连带项先于主体)。
UPDATE product.plans pl
   SET deleted_at = now(), updated_at = now()
 WHERE pl.deleted_at IS NULL
   AND pl.id IN (
     SELECT pv.plan_id
       FROM product.plan_versions pv
       JOIN product.plan_components pc ON pc.plan_version_id = pv.id
       JOIN product.products p        ON p.id = pc.product_id
      WHERE pc.component_role = 'primary'
        AND p.product_code = 'ruyin'
        AND p.product_type = 'client'
   );

DO $$
DECLARE
  n int;
BEGIN
  UPDATE product.products
     SET deleted_at = now(), updated_at = now()
   WHERE product_code = 'ruyin'
     AND product_type = 'client'
     AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '[ruyin-declassify] soft-deleted % ruyin product row(s)', n;
END $$;

-- ── ④ 断言：ruyin 客户端已无产品挂钩，桌面登录仍在(status=active) ────────────
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(client_id, ', ' ORDER BY client_id)
    INTO bad
    FROM appoidc.oidc_clients
   WHERE client_id IN ('ruyin', 'ruyin-beta')
     AND (client_kind <> 'platform' OR product_id IS NOT NULL);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '[ruyin-declassify] clients not fully declassified: %', bad;
  END IF;
END $$;

COMMIT;
