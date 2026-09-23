-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-05-atlas-runos-oidc-callbacks.sql
-- atlas / runos 的回调登记补齐 —— 登出回跳，以及它们自己文档里那个从不存在的 beta 客户端
--
-- ── 两件事，都是「平台没按对方声明的值登记」 ──────────────────────────────
--
-- ① 登出回跳没登记。
--    vxture-atlas/.env.example  OIDC_POST_LOGOUT_REDIRECT_URI=https://atlas.vxture.com/
--    vxture-runos/.env.example  OIDC_POST_LOGOUT_REDIRECT_URI=https://runos.vxture.com/
--    而平台这两个客户端的 post_logout_redirect_uris 里只有账户中心那一条。没登记的
--    回跳地址会被 IdP 拒掉 —— 用户登出后停在账户中心、回不到产品，两侧都不报错。
--    全平台十三个客户端里**只有这两个**缺自己的 origin（arda / karda / umbra /
--    vxtpl / website / admin / opera / arche 都有），所以这不是某种有意的例外。
--
-- ② `atlas-beta` / `runos-beta` 这两个客户端根本不存在。
--    两个仓的 .env.example 都写着「BETA OVERRIDES: OIDC_CLIENT_ID=atlas-beta」，
--    而平台的 seed 用一个已退役的 `appUris()` 把 beta 的回调**追加进 stable 客户端**
--    的白名单，从没建过独立客户端。于是**按对方自己的文档部署一个 beta，token 端点
--    回的是 invalid_client** —— 与 platform#205（硬编码客户端名单漏了 runos）同形。
--    它同时踩了接入通则的第三个坑：一个客户端带两个环境，而 back_channel_logout_uri
--    是单值的，beta 的后台登出会打在 prod 上或者干脆收不到。
--
-- ── 为什么这份迁移只加不减 ────────────────────────────────────────────────
-- 正确的终局是 stable 客户端只留 stable 那一条回调。但我排除不掉「线上真有一个 beta
-- 按 client_id=atlas 跑着」——那是它自己文档之外的配法，可我没有能区分这件事的数据
-- （refresh_tokens 记 client_id，不记 redirect_uri）。剪掉白名单里那条，如果真有，
-- 就是当场把一个在跑的登录打断。
--
-- 所以这一版**只建 beta 客户端、只补登出回跳**，stable 的白名单原样留着（多一条已
-- 登记的地址是更大的白名单，不是故障）。剪枝留作后续：先确认没有 beta 在用 stable
-- 的 client_id，再做。seed 那边已经是终局形状，新库直接就是对的。
--
-- ── beta 地址从哪来 ───────────────────────────────────────────────────────
-- 不从环境变量来——迁移是 psql 跑的，没有应用的 env。**数据自己带着答案**：stable
-- 客户端的 redirect_uris 第二条就是 seed 当年追加进去的 beta 回调。没有第二条就说明
-- 这个环境没配 beta，那就什么都不建。
--
-- ── 新客户端的密钥 ────────────────────────────────────────────────────────
-- client_secret_hash 留空，由 deploy/scripts/27-provision-client-secrets.sh 补——
-- 它按 appoidc.oidc_clients **整表枚举**、不看 kind（当年硬编码名单漏了 runos 才改成
-- 派生的）。所以顺序是 migrate → provision-secrets → deploy，缺中间那步的话新客户端
-- 拿不到 secret，token 端点会回 invalid_client。
--
-- 幂等：全部 on conflict do nothing / 数组去重后再写。可重复执行。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① 登出回跳：把客户端自己的 origin 补进白名单 ──────────────────────────
-- origin 从 stable 回调地址推：`https://atlas.vxture.com/auth/callback` → `https://atlas.vxture.com/`。
-- 推而不是写死：本机 / beta / 生产三套地址不一样，写死等于把一个环境的值灌进另外两个。
UPDATE appoidc.oidc_clients c
   SET post_logout_redirect_uris =
         c.post_logout_redirect_uris || ARRAY[origin.url],
       updated_at = now()
  FROM (
    SELECT id,
           regexp_replace(redirect_uris[1], '^(https?://[^/]+).*$', '\1/') AS url
      FROM appoidc.oidc_clients
     WHERE client_id IN ('atlas', 'runos')
  ) AS origin
 WHERE c.id = origin.id
   AND origin.url <> c.redirect_uris[1]          -- 正则没匹配上就不写（原样返回）
   AND NOT (origin.url = ANY(c.post_logout_redirect_uris));

-- ── ② beta 客户端：从 stable 白名单里那条 beta 回调建出来 ─────────────────
-- 只在 stable 客户端确实有第二条回调时建。列出的字段照抄 stable 行，**除了**
-- client_id / name / display_name / release_channel / 两个地址数组 —— 抄而不是重填，
-- 免得 scopes、TTL、PKCE、认证方式在两个渠道之间漂。
INSERT INTO appoidc.oidc_clients (
  id, client_id, realm, product_id, client_kind, release_channel,
  name, display_name, logo_url,
  redirect_uris, post_logout_redirect_uris, allowed_scopes,
  access_token_ttl, refresh_token_ttl, pkce_required,
  token_endpoint_auth_method, slo_participation, status, created_at, updated_at
)
SELECT gen_random_uuid(),
       s.client_id || '-beta',
       s.realm, s.product_id, s.client_kind, 'beta',
       s.name || ' Beta',
       coalesce(s.display_name, s.name) || '（Beta）',
       s.logo_url,
       ARRAY[s.redirect_uris[2]],
       ARRAY[regexp_replace(s.redirect_uris[2], '^(https?://[^/]+).*$', '\1/')]
         || ARRAY(SELECT u FROM unnest(s.post_logout_redirect_uris) AS u
                   WHERE u NOT LIKE regexp_replace(s.redirect_uris[1], '^(https?://[^/]+).*$', '\1') || '%'),
       s.allowed_scopes,
       s.access_token_ttl, s.refresh_token_ttl, s.pkce_required,
       s.token_endpoint_auth_method, s.slo_participation, s.status, now(), now()
  FROM appoidc.oidc_clients s
 WHERE s.client_id IN ('atlas', 'runos')
   AND array_length(s.redirect_uris, 1) >= 2
   AND s.redirect_uris[2] ~ '^https?://'
ON CONFLICT (client_id) DO NOTHING;

COMMIT;

DO $$
DECLARE
  r          record;
  n_missing  int := 0;
  n_beta     int;
  detail     text;
BEGIN
  /* 断言的是「每个客户端的白名单里有它自己的 origin」，不是「加了两行」——
     加了几行取决于跑之前是什么状态，而那不是这份迁移要保证的事。 */
  FOR r IN
    SELECT client_id,
           regexp_replace(redirect_uris[1], '^(https?://[^/]+).*$', '\1/') AS origin,
           post_logout_redirect_uris AS plu
      FROM appoidc.oidc_clients
     WHERE client_id IN ('atlas', 'runos')
  LOOP
    IF NOT (r.origin = ANY(r.plu)) THEN
      n_missing := n_missing + 1;
      RAISE WARNING '[atlas-runos-callbacks] % 的登出回跳白名单里没有 %', r.client_id, r.origin;
    END IF;
  END LOOP;
  IF n_missing <> 0 THEN
    RAISE EXCEPTION '[atlas-runos-callbacks] % 个客户端的登出回跳仍未登记', n_missing;
  END IF;

  /* beta 客户端：建了几个取决于这个环境配没配 beta 地址，所以这里不断言个数，
     断言的是**「stable 有第二条回调 ⇒ 对应的 beta 客户端在」**这条蕴含关系。
     只数总数的不变式对「一个建了一个没建」是瞎的。 */
  SELECT count(*) INTO n_beta
    FROM appoidc.oidc_clients s
   WHERE s.client_id IN ('atlas', 'runos')
     AND array_length(s.redirect_uris, 1) >= 2
     AND s.redirect_uris[2] ~ '^https?://'
     AND NOT EXISTS (
       SELECT 1 FROM appoidc.oidc_clients b
        WHERE b.client_id = s.client_id || '-beta');
  IF n_beta <> 0 THEN
    RAISE EXCEPTION '[atlas-runos-callbacks] % 个客户端配了 beta 回调却没有对应的 -beta 客户端', n_beta;
  END IF;

  /* 建出来的 beta 客户端必须满足归属不变式，否则下一次 seed 或运营台保存会撞
     chk_oidc_clients_kind_product。库上那条 CHECK 已经拦着了，这里再报一次是为了
     让失败发生在迁移里、带着说明，而不是几周后在某个保存按钮上。 */
  SELECT count(*) INTO n_beta
    FROM appoidc.oidc_clients
   WHERE client_id IN ('atlas-beta', 'runos-beta')
     AND ((client_kind = 'platform') <> (product_id IS NULL));
  IF n_beta <> 0 THEN
    RAISE EXCEPTION '[atlas-runos-callbacks] % 个 beta 客户端的 kind 与 product_id 不自洽', n_beta;
  END IF;

  SELECT coalesce(string_agg(client_id || '→' || array_to_string(post_logout_redirect_uris, '|'), '；' ORDER BY client_id), '(无)')
    INTO detail
    FROM appoidc.oidc_clients
   WHERE client_id IN ('atlas', 'runos', 'atlas-beta', 'runos-beta');
  RAISE NOTICE '[atlas-runos-callbacks] %', detail;
  RAISE NOTICE '[atlas-runos-callbacks] 下一步必须是 27-provision-client-secrets.sh —— 新建的 beta 客户端还没有 secret，直接 deploy 的话它们在 token 端点是 invalid_client';
END $$;
