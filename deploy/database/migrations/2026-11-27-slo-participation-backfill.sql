-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-27-slo-participation-backfill.sql
-- 让 slo_participation 从「没人读的声明」变成真开关之前，先把存量对齐
--
-- ── 为什么 ──
-- owner 2026-09-30 裁定两件事：① opera 要能登记 back_channel_logout_uri；
-- ② 让 IdP **真的读** slo_participation。在此之前它只出现在 DDL、列锁 GRANT、
-- 恢复脚本与迁移里——**全仓没有任何应用代码读它**，auth-bff 的
-- sendBackChannelLogouts 只看 back_channel_logout_uri 非空。
--
-- ② 单独上线会**静默打断全站后端通道登出**。实测本机 dev 库：13 个客户端
-- 全部 slo_participation='none'，其中 **11 个 back_channel_logout_uri 非空**
-- （admin / arche / atlas / console / opera / runos / website / arda / karda /
-- umbra / vxtpl）。也就是说今天确实在收登出通知的那 11 个，在加上判据的那一刻
-- 会一起停，而两侧都不会报错。生产同形：seed 从来只写 URI、不写这一列，
-- 走的是列 DEFAULT 'none'。
--
-- 所以顺序是硬的：**先跑这一份，再部署读它的代码**。反过来就是一次没人会发现的回归。
--
-- ── 做什么 ──
-- 把「URI 非空但 participation 仍是 none」的行补成 'back_channel'——即
-- **把「它今天确实在收」这个事实写进那一列**，不改变任何客户端的实际行为。
-- URI 为空的行不动：ruyin / ruyin-beta 是公共客户端（RFC 8252），回调是 loopback，
-- 本来就没有 back-channel 端点，seed 也刻意不给它们派一个。
--
-- ── 重复执行安全 ──
-- 谓词自带幂等（第二遍命中 0 行）。DDL 的 chk_oidc_clients_bclo_uri
-- （slo_participation <> 'back_channel' OR back_channel_logout_uri IS NOT NULL）
-- 在本份之后仍然成立——我们只动 URI 非空的行，不可能造出违反它的组合。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  total_n    integer;
  with_uri_n integer;
  updated_n  integer;
  stale_n    integer;
BEGIN
  SELECT count(*) INTO total_n FROM appoidc.oidc_clients;
  SELECT count(*) INTO with_uri_n
    FROM appoidc.oidc_clients
   WHERE back_channel_logout_uri IS NOT NULL;

  WITH upd AS (
    UPDATE appoidc.oidc_clients
       SET slo_participation = 'back_channel',
           updated_at        = now()
     WHERE back_channel_logout_uri IS NOT NULL
       AND slo_participation = 'none'
    RETURNING 1
  )
  SELECT count(*) INTO updated_n FROM upd;

  RAISE NOTICE '[slo-participation-backfill] 客户端 % 个，其中带 back-channel 端点 % 个，本次补齐 % 条',
    total_n, with_uri_n, updated_n;

  -- ── 审计段：跑完之后不该再有「在收却标着 none」的行 ──
  -- 读不到就抛，不当成"通过"：这一份存在的唯一理由就是消除这个集合。
  SELECT count(*) INTO stale_n
    FROM appoidc.oidc_clients
   WHERE back_channel_logout_uri IS NOT NULL
     AND slo_participation = 'none';
  IF stale_n > 0 THEN
    RAISE EXCEPTION
      '[slo-participation-backfill] 仍有 % 行 URI 非空却 participation=none —— 补齐没生效，中止',
      stale_n;
  END IF;

  -- 反向也核一遍：不该有 back_channel 却没 URI 的行（那是 CHECK 该拦住的，
  -- 这里只是确认 CHECK 真的在）。
  SELECT count(*) INTO stale_n
    FROM appoidc.oidc_clients
   WHERE slo_participation = 'back_channel'
     AND back_channel_logout_uri IS NULL;
  IF stale_n > 0 THEN
    RAISE EXCEPTION
      '[slo-participation-backfill] 有 % 行 back_channel 却无 URI —— chk_oidc_clients_bclo_uri 没在生效',
      stale_n;
  END IF;
END $$;

COMMIT;
