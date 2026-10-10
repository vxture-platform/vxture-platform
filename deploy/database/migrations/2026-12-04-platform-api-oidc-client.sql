-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-12-04-platform-api-oidc-client.sql
-- platform-api 注册为 S2S-only 机密客户端（#562，模型服务健康监测 watchdog）
--
-- 为什么要这一行：平台侧的无人值守 watchdog 要读 Atlas 的 /s2s/health，需要一张
-- `health:atlas` 票。铸票走 token-exchange 的 health-reader grant，而 grant 的第一道
-- 校验是「调用方是一条 active 的 platform 级 oidc_clients 行」（见 auth-bff
-- token-exchange.service 的 exchangeHealthReader）。platform-api 此前只是 token
-- **接收方**（aud=vxture），从不是客户端，所以库里没有它的行——没有这行，token 端点
-- 回 invalid_client。seed-catalog.mjs 那边已是终局形状（新库直接就有）；这份迁移给存量库补。
--
-- 它不是 RP：无登录流、无回调、不参与 SLO。redirect_uris 为空数组，slo_participation
-- = none，back_channel_logout_uri 为 NULL。realm=customer，与 website/console/atlas 等
-- 平台级客户端同列。
--
-- 密钥：client_secret_hash 留 NULL，由 deploy/scripts/27-provision-client-secrets.sh
-- 补（它按整表枚举、不看 kind）。顺序必须是 migrate → provision-secrets → deploy，
-- 缺中间那步新客户端拿不到 secret，token 端点回 invalid_client（platform#205 同形）。
--
-- 幂等：on conflict (client_id) do nothing。可重复执行。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO appoidc.oidc_clients (
  client_id,
  name,
  display_name,
  realm,
  product_id,
  client_kind,
  release_channel,
  client_secret_hash,
  redirect_uris,
  post_logout_redirect_uris,
  back_channel_logout_uri,
  slo_participation,
  allowed_scopes,
  token_endpoint_auth_method,
  status
)
VALUES (
  'platform-api',
  'Vxture Platform API',
  'Vxture Platform API',
  'customer',
  NULL,
  'platform',
  'stable',
  NULL,
  '{}',
  '{}',
  NULL,
  'none',
  ARRAY['openid'],
  'client_secret_basic',
  'active'
)
ON CONFLICT (client_id) DO NOTHING;

COMMIT;
