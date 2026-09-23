-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-30-certification-runs.sql
-- 批 2 · 接入认证台账 —— 切断「发布要验收 / 验收要订阅 / 订阅要已发布」那个环
--
-- 本迁移只建表，不改任何现有行为。写入方（认证编排）与消费方（发布门）在同一批
-- 的后续改动里。
--
-- ── 这个环今天是闭合的 ──
--   plan_version.publish → 要 gate='publish' 的 acceptance 满足
--     → acceptance = 登录+开通+权益+用量+回调 五段落在同一工作区
--       → 开通与回调只由活跃订阅触发
--         → 订阅唯一入口 order.service.ts 的 createSubscription（全仓仅一个调用者）
--           → console createOrder 查价要求 plan.current_version_id = pv.id
--             → 那个指针**只有 publish 会设**
--
-- 代码里曾注释说「有 operator_grant 与邀请订阅两条不发布也能开通的路」，两条都不
-- 成立：`operator_grant` 只是 50_metering.sql 的 CHECK 值域里一个值加 seed 演示
-- 数据，**全仓零写入路径**；邀请订阅解锁的是 `plans.is_public`，改变「谁能买」，
-- 不改变「已不已发布」。
--
-- 断点只需要一条**新的入边**：认证订阅指向未发布的草稿版本，不经过订单流。
-- 本表是那条边落地之后的结论存放处。
--
-- ── 为什么是台账，不是 products 上的一列 ──
-- 认证是「后果」，status 是「意图」。合成一个字段之后，一次复验失败就要把一个正在
-- 跑的产品改回草稿。且「谁在什么时候、对哪个契约版本、在哪个沙箱里认的」要答得
-- 出来——那是台账才有的形状。
--
-- ── 它挂在产品上，不挂在套餐上 ──
-- 「换个宿主它变吗」：换个套餐不变，换个产品才变。所以发第二个套餐不必重认一遍。
--
-- ── 四条 CHECK 各守什么 ──
--   verdict        三态封闭值域
--   stale_reason   与失效触发点一一对应；加一种原因要同时改这里和那个触发点
--   certified_at   结论与时刻**互为充要**——它是发布门唯一的判据，不能有两个读法
--   stale_pair     原因与时刻同生同灭
--
-- ── 列级锁：本表的锚点是 id / product_id / created_at ──
-- `97_service_roles.sql` 对 19 个 schema 整库 GRANT 并带 ALTER DEFAULT PRIVILEGES，
-- **新表天然就是可写的**——所以「不授权就等于保护」不成立（我第一版的断言正是这么
-- 写的，真库上当场红）。真正的保护在 98 的列级 REVOKE/GRANT：把锚点列排除在
-- UPDATE 白名单之外。
-- `created_at` 就是这一次跑动的开始时刻——不另设 started_at，同一个事实只留一份。
-- `product_id` 进锚点是本表特有的：一条认证台账**换个产品就不是同一件事**，改它
-- 等于把 A 产品的认证结论挪给 B，而发布门只读结论不看来历。
--
-- 幂等：CREATE TABLE / INDEX IF NOT EXISTS + 约束 DROP-ADD + 末尾断言。可重复执行。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS product.certification_runs (
    id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id            uuid         NOT NULL REFERENCES product.products(id) ON DELETE CASCADE,
    contract_version      varchar(32)  NOT NULL,
    sandbox_workspace_id  uuid         NOT NULL,
    plan_version_id       uuid,
    component_fingerprint varchar(64),
    segments              jsonb        NOT NULL DEFAULT '{}'::jsonb,
    verdict               varchar(16)  NOT NULL DEFAULT 'running',
    stale_reason          varchar(64),
    certified_at          timestamptz,
    stale_at              timestamptz,
    run_by                uuid,
    created_at            timestamptz  NOT NULL DEFAULT now(),
    updated_at            timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE product.certification_runs IS
  '接入认证台账：一次认证跑动的结论。挂在产品上不挂在套餐上（换个套餐它不变）；观测按 sandbox_workspace_id 收口，别的租户的流量不计入。';
COMMENT ON COLUMN product.certification_runs.sandbox_workspace_id IS
  '认证沙箱工作区（裸值→tenancy.workspaces，不建 FK：沙箱清理后台账仍要留得住）。认证的观测那一半按它收口——不收口的话 A 客户的真实使用会把 B 产品的认证喂绿。';
COMMENT ON COLUMN product.certification_runs.component_fingerprint IS
  '认证时刻 plan_components 的指纹。草稿在发布前仍可改，发布门比对指纹，对不上要求重认。用指纹而不是时间戳，因为「改了又改回来」不该判成失效。';
COMMENT ON COLUMN product.certification_runs.stale_reason IS
  '非空 = 待复认证。stale 只挡「再发布新版本」，不把在跑的产品拉下线；也不按时间自动过期——认证回答「能不能工作」，不回答「有没有人在用」。';

ALTER TABLE product.certification_runs DROP CONSTRAINT IF EXISTS chk_certification_runs_verdict;
ALTER TABLE product.certification_runs
  ADD CONSTRAINT chk_certification_runs_verdict CHECK (verdict IN ('running','certified','failed'));

ALTER TABLE product.certification_runs DROP CONSTRAINT IF EXISTS chk_certification_runs_stale_reason;
ALTER TABLE product.certification_runs
  ADD CONSTRAINT chk_certification_runs_stale_reason CHECK (
    stale_reason IS NULL OR stale_reason IN (
      'webhook_changed','secret_rotated','redirect_uri_changed',
      'upstream_grant_revoked','contract_version_bumped','components_changed'));

ALTER TABLE product.certification_runs DROP CONSTRAINT IF EXISTS chk_certification_runs_certified_at;
ALTER TABLE product.certification_runs
  ADD CONSTRAINT chk_certification_runs_certified_at CHECK (
    (verdict = 'certified') = (certified_at IS NOT NULL));

ALTER TABLE product.certification_runs DROP CONSTRAINT IF EXISTS chk_certification_runs_stale_pair;
ALTER TABLE product.certification_runs
  ADD CONSTRAINT chk_certification_runs_stale_pair CHECK (
    (stale_reason IS NULL) = (stale_at IS NULL));

CREATE INDEX IF NOT EXISTS idx_certification_runs_product
  ON product.certification_runs (product_id);
CREATE INDEX IF NOT EXISTS idx_certification_runs_workspace
  ON product.certification_runs (sandbox_workspace_id);
CREATE INDEX IF NOT EXISTS idx_certification_runs_effective
  ON product.certification_runs (product_id, certified_at DESC)
  WHERE verdict = 'certified' AND stale_reason IS NULL;

-- ── 列级锁：本迁移自己先锁一次 ─────────────────────────────────────────────
-- 28d 的顺序是「先重放 migrations/，再重放 98_column_locks.sql」，而新表在
-- CREATE 的那一刻就因 97 的 ALTER DEFAULT PRIVILEGES 拿到了全列 UPDATE。
-- 只写进 98 的话，**本轮 migrate 里这张表是不设防的**，下一轮才锁上——而末尾那条
-- 断言正是在本轮跑的，第一版就是这么红的。照 2026-10-25-tenant-abuse-caps 的先例，
-- 这里自己锁一遍；98 之后重放同样的语句，两边逐字一致。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    REVOKE UPDATE ON product.certification_runs FROM platform_svc;
    GRANT UPDATE (contract_version, sandbox_workspace_id, plan_version_id,
                  component_fingerprint, segments, verdict, stale_reason,
                  certified_at, stale_at, run_by, updated_at)
      ON product.certification_runs TO platform_svc;
  END IF;
END $$;

COMMIT;

DO $$
DECLARE
  n_cols   int;
  n_chk    int;
  n_idx    int;
  n_grant  int;
  ok_pair  boolean;
BEGIN
  SELECT count(*) INTO n_cols FROM information_schema.columns
   WHERE table_schema='product' AND table_name='certification_runs';
  SELECT count(*) INTO n_chk FROM pg_constraint
   WHERE conrelid='product.certification_runs'::regclass AND contype='c';
  SELECT count(*) INTO n_idx FROM pg_indexes
   WHERE schemaname='product' AND tablename='certification_runs';

  IF n_cols <> 14 OR n_chk < 4 OR n_idx < 4 THEN
    RAISE EXCEPTION '[certification-runs] 建表不全：列 %（应 14）、CHECK %（应 ≥4）、索引 %（应 ≥4，含主键）',
      n_cols, n_chk, n_idx;
  END IF;

  /*
   * 反向验证那条「互为充要」的约束——不是看它在不在，是看它**拦不拦得住**。
   * 一条读不到判据却回「通过」的检查，比没有检查更坏；这里显式造一个反例。
   */
  BEGIN
    INSERT INTO product.certification_runs
      (product_id, contract_version, sandbox_workspace_id, verdict, certified_at)
    SELECT id, 'probe', gen_random_uuid(), 'certified', NULL
      FROM product.products LIMIT 1;
    ok_pair := false;   -- 插进去了 = 约束没拦住
  EXCEPTION WHEN check_violation THEN
    ok_pair := true;
  END;
  IF NOT ok_pair THEN
    RAISE EXCEPTION '[certification-runs] certified 却没有 certified_at 竟然写得进去——那条约束是摆设';
  END IF;

  /*
   * 锚点列不可写。98_column_locks.sql 在迁移之后重放，所以它上一轮的结果在这里
   * 看得见——谁把 product_id 放回 UPDATE 白名单，下一次 migrate 就红。
   * 没有 platform_svc 的环境（本机部分库）视作已锁。
   */
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='platform_svc') THEN 0
              ELSE (SELECT count(*) FROM information_schema.column_privileges
                     WHERE grantee='platform_svc' AND table_schema='product'
                       AND table_name='certification_runs' AND privilege_type='UPDATE'
                       AND column_name IN ('id','product_id','created_at')) END
    INTO n_grant;
  IF n_grant <> 0 THEN
    RAISE EXCEPTION
      '[certification-runs] 锚点列仍可 UPDATE（% 列）—— 98 的列级 GRANT 没把它们排除掉', n_grant;
  END IF;

  RAISE NOTICE '[certification-runs] 建表就位：14 列 / % 条 CHECK / % 个索引；「certified 必有时刻」已反向验证拦得住；锚点列已锁',
    n_chk, n_idx;
END $$;
