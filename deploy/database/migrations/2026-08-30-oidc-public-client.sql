-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — appoidc.oidc_clients 加 token_endpoint_auth_method，支持 RFC 8252
-- 原生应用（公共客户端）在 token 端点凭 PKCE 而非 secret 认证
--
-- 背景：此前 IdP token 端点对所有 grant 强制校验 client_secret（authenticateClient
-- 对 client_secret_hash IS NULL 一律返回 null → 401 invalid_client），authorize 的
-- redirect_uri 走精确白名单。桌面产品（如影 ruyin）是原生应用：二进制装不下 secret，
-- 回调是 loopback（http://127.0.0.1:{port}/oauth/callback，端口不可预留），二者都无法
-- 满足。本迁移把「公共客户端」从缺席（client_secret_hash NULL 当事实）升成显式列。
--
-- 为什么加列而不是靠 client_secret_hash IS NULL 推断：与 client_kind（2026-08-30）
-- 同一判断——归类要写成显式事实，不靠一个可空列去猜。一个公共客户端在 token 端点的
-- 认证方式是协议属性，理应可查、可断言、可被约束绑死。
--
-- 硬不变式（chk_oidc_clients_public_pkce）：auth_method='none' 即强制 PKCE 且无
-- secret。写不出「公共却带 secret」或「公共却不强制 PKCE」的行。
--
-- 列锁同步：token_endpoint_auth_method 已并入 98_column_locks.sql 的 platform_svc
-- 授权列表（权威、部署 DDL 步重放）。本迁移只加列与约束，不重复维护列锁。
--
-- 幂等：整份可重跑。列用 IF NOT EXISTS；约束按 pg_constraint 判重。
--
-- 顺序：本迁移必须先于新版 seed-catalog.mjs 执行——新 seed 把 ruyin 写成
-- token_endpoint_auth_method='none'，列不存在会报错（有意：宁可停下，不静默兼容）。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE appoidc.oidc_clients
  ADD COLUMN IF NOT EXISTS token_endpoint_auth_method varchar(24) NOT NULL DEFAULT 'client_secret_basic';

DO $$ BEGIN
  ALTER TABLE appoidc.oidc_clients
    ADD CONSTRAINT chk_oidc_clients_token_auth
      CHECK (token_endpoint_auth_method IN ('client_secret_basic','none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE appoidc.oidc_clients
    ADD CONSTRAINT chk_oidc_clients_public_pkce
      CHECK (token_endpoint_auth_method <> 'none' OR (pkce_required AND client_secret_hash IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
