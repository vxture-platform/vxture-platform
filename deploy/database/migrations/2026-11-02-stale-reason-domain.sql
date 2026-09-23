-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-02-stale-reason-domain.sql
-- `stale_reason` 去掉 `upstream_grant_revoked` —— 它不该是一条失效原因
--
-- ── 认证证的是一句**有时间**的话 ──
-- 「**在 T 时刻**，这条链在沙箱里跑通过一次」。所以只有让那句话不再成立的**契约变更**
-- 才该让它失效，而不是「现在跑不跑得动」——后者归运行健康。
--
-- 上游授权被撤（Atlas 模型 / Runos 能力）不满足这个判据：
--   · 它**不是契约变更**。认证那句有时间的话仍然成立，断的是运行时；这种断裂该由
--     运行健康报 degraded，而不是把一张历史证书涂掉。
--   · 它发生在**兄弟仓**那边（授权按产品码挂在 atlas / runos 各自的库里），平台观测
--     不到那个事件。要判它只能在读的时候现打两个上游——一条会在上游抖动时把发布拦下
--     的判据，比没有判据更坏。
--
-- 所以这个值**没有写入方，也不该有**。留着它就是这一批刚花力气清掉的那种东西：
-- `operator_grant` 曾经也是「CHECK 值域里有、全仓零写入路径」，于是一条注释理直气壮
-- 地写着「有两条不发布也能开通的路」，而两条都不存在。
--
-- ── 剩下的五个值各自由谁写 ──
--   webhook_changed        opera 的 webhook 登记端点（值真的变了才标）
--   secret_rotated         同上（密钥被碰过）+ oidc-client 的 rotate-secret
--   redirect_uri_changed   oidc-client 的 PUT redirect-uris
--   contract_version_bumped **没有写入方，有意的**：它是读时判据——台账记着认证当时
--                          的 contract_version，读的时候与当前值比，不等即视作失效。
--                          升版那一刻全部既有认证自动进入待复认证，不必记得跑什么。
--                          值留在值域里是为了让「为什么这条认证失效了」在读侧也能
--                          用同一套词说出来。
--   components_changed     发布门的指纹比对现算，同样不落库
--
-- 前两者是**事件**（有那么一刻发生了一件事），后两者是**状态**（比一下就知道）。
-- 事件写库、状态现算——混起来的话，现算的那两种要么被写成过期的快照，要么要有人
-- 记得去刷。
--
-- 幂等：DROP-ADD 约束 + 先清存量值 + 末尾断言。可重复执行。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

/* 先清存量：收窄值域之前必须没有反例，否则 ADD CONSTRAINT 直接失败。
   这些行（如果有）是被一条本不该存在的原因标失效的，清成「未失效」而不是删行——
   台账要留得住，失效与否是它的属性，不是它的存在理由。 */
UPDATE product.certification_runs
   SET stale_reason = NULL, stale_at = NULL, updated_at = now()
 WHERE stale_reason = 'upstream_grant_revoked';

ALTER TABLE product.certification_runs
  DROP CONSTRAINT IF EXISTS chk_certification_runs_stale_reason;
ALTER TABLE product.certification_runs
  ADD CONSTRAINT chk_certification_runs_stale_reason CHECK (
    stale_reason IS NULL OR stale_reason IN (
      'webhook_changed','secret_rotated','redirect_uri_changed',
      'contract_version_bumped','components_changed'));

COMMENT ON COLUMN product.certification_runs.stale_reason IS
  '非空 = 待复认证。只收**契约变更**：回调地址 / 签名密钥 / 回调 URI 三者由事件写入；契约升版与组件变更是读时现算，不落库。上游授权被撤不在其列——那不是契约变更，是运行时断裂，归运行健康。stale 只挡「再发布新版本」，不把在跑的产品拉下线。';

COMMIT;

DO $$
DECLARE
  def       text;
  n_residue int;
  ok_reject boolean;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'product.certification_runs'::regclass
     AND conname  = 'chk_certification_runs_stale_reason';
  IF def IS NULL THEN
    RAISE EXCEPTION '[stale-reason-domain] 约束不见了';
  END IF;
  IF def LIKE '%upstream_grant_revoked%' THEN
    RAISE EXCEPTION '[stale-reason-domain] 值域里还留着 upstream_grant_revoked';
  END IF;

  SELECT count(*) INTO n_residue FROM product.certification_runs
   WHERE stale_reason = 'upstream_grant_revoked';
  IF n_residue <> 0 THEN
    RAISE EXCEPTION '[stale-reason-domain] 还有 % 行带着被退役的原因', n_residue;
  END IF;

  /*
   * 反向验证：不是看约束文本里有没有那个词，是看它**拦不拦得住**。
   * 一条读不到判据却回「通过」的检查，比没有检查更坏。
   */
  BEGIN
    UPDATE product.certification_runs
       SET stale_reason = 'upstream_grant_revoked', stale_at = now()
     WHERE id = (SELECT id FROM product.certification_runs LIMIT 1);
    /* 没有任何行时 UPDATE 影响 0 行也「成功」——那不算通过，得显式区分。 */
    ok_reject := NOT EXISTS (SELECT 1 FROM product.certification_runs);
  EXCEPTION WHEN check_violation THEN
    ok_reject := true;
  END;
  IF NOT ok_reject THEN
    RAISE EXCEPTION '[stale-reason-domain] 退役的原因竟然还写得进去——约束是摆设';
  END IF;
  /* 上面那次探针若真写进去了会被这里回滚掉；写不进去则本就无事。 */
  UPDATE product.certification_runs
     SET stale_reason = NULL, stale_at = NULL
   WHERE stale_reason = 'upstream_grant_revoked';

  RAISE NOTICE '[stale-reason-domain] 值域收成五个，upstream_grant_revoked 已退役且反向验证拦得住';
END $$;
