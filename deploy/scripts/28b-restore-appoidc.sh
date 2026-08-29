#!/usr/bin/env bash
# deploy/scripts/28b-restore-appoidc.sh
# appoidc 业务互通数据的跨-reset 备份 + 恢复（data_platform_320 §6）。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-07-04
#
# 唯一需跨 reset 存活的数据 = 旧 iam.oidc_client（RP 注册，如 ruyin）+ iam.signing_key（RS256 JWKS）。
# 其余 reset 丢弃。用法（两段；capture 必须在 28-apply --reset 丢数据【之前】）：
#   bash scripts/28b-restore-appoidc.sh capture
#       reset 前（只读）：仅当活库还存在旧 "iam" schema（pre-cutover 库）时，pg_dump iam 两表到
#       host 临时文件；已是新库 / 无 iam → 优雅跳过（无备份）。
#   bash scripts/28b-restore-appoidc.sh restore
#       reset + seed 后：把备份载入临时 iam schema → §6 UPSERT 变换迁入 appoidc.oidc_clients（真实
#       secret 覆盖 seed 占位）+ 直拷 appoidc.signing_keys → DROP SCHEMA iam CASCADE。
#       无备份（capture 跳过 / 已是新库 / 重跑）→ 优雅跳过（保留 seed 占位 oidc_clients）。
#
# 容器 = postgres:18-alpine（自带 psql/pg_dump）；网络 vxture-prod；DATABASE_URL 来自运行时 secret
# /srv/vxture/runtime/secrets/platform.env（--env-file 注入）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
# DDL/运维连接:优先 RDS owner 连接串;无则回退 platform.env(2026-08-19 RDS 切换)。
PLATFORM_ENV="$RUNTIME_DIR/secrets/rds-owner.env"
[ -f "$PLATFORM_ENV" ] || PLATFORM_ENV="$RUNTIME_DIR/secrets/platform.env"
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"
# 备份落 host（reset/apply/seed 皆不触碰此目录）；restore 读固定名 appoidc_seed.sql。
DUMP_DIR="${APPOIDC_DUMP_DIR:-$RUNTIME_DIR/.db-tools/appoidc-restore}"
DUMP_FILE="$DUMP_DIR/appoidc_seed.sql"

check_file() {
  if [ ! -f "$1" ]; then
    echo "错误：缺少 $1" >&2
    exit 1
  fi
}

capture() {
  check_file "$PLATFORM_ENV"
  mkdir -p "$DUMP_DIR"
  chmod 700 "$DUMP_DIR" 2>/dev/null || true
  echo "=== appoidc capture（reset 前，只读）==="

  # 活库是否还存在旧 "iam" schema（只有 pre-cutover 库才有）。
  local sqltmp
  sqltmp="$(mktemp -d)"
  printf "select count(*) from information_schema.schemata where schema_name = 'iam';\n" \
    > "$sqltmp/check-iam.sql"
  local iam_count
  iam_count="$(docker run --rm \
    --network vxture-prod \
    --env-file "$PLATFORM_ENV" \
    -v "$sqltmp:/sql:ro" \
    "$PG_IMAGE" \
    sh -lc 'psql "$DATABASE_URL" -tAqf /sql/check-iam.sql' 2>/dev/null | tr -cd '0-9' || true)"
  rm -rf "$sqltmp"

  if [ "$iam_count" != "1" ]; then
    echo "  [skip] 活库无旧 iam schema（已是新库 / 无历史 / 库不可达）——不备份。"
    echo "         reset 后 seed 占位 oidc_clients 即最终态。"
    return 0
  fi

  echo "  [ok] 活库存在旧 iam schema → pg_dump iam.oidc_client + iam.signing_key"
  local ts
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  docker run --rm \
    --network vxture-prod \
    --env-file "$PLATFORM_ENV" \
    "$PG_IMAGE" \
    sh -lc 'pg_dump "$DATABASE_URL" -Fp -t iam.oidc_client -t iam.signing_key' \
    > "$DUMP_FILE.partial"
  mv "$DUMP_FILE.partial" "$DUMP_FILE"
  cp "$DUMP_FILE" "$DUMP_DIR/appoidc_seed_$ts.sql" # 审计副本

  # 轻校验：备份须引用 iam.oidc_client（否则大概率取错内容）。
  if ! grep -q 'iam\.oidc_client' "$DUMP_FILE"; then
    echo "  [warn] 备份未见 iam.oidc_client 引用，请人工核对：$DUMP_FILE" >&2
  fi
  echo "  [ok] 备份完成：$DUMP_FILE（审计副本 appoidc_seed_$ts.sql）"
}

restore() {
  check_file "$PLATFORM_ENV"
  echo "=== appoidc restore（reset + seed 后）==="

  if [ ! -f "$DUMP_FILE" ]; then
    echo "  [skip] 无 $DUMP_FILE（capture 跳过 / 已是新库 / 重跑）——保留 seed 占位 oidc_clients。"
    return 0
  fi

  # §6 ③ 迁移 SQL 写入 host 临时文件后挂载给容器（psql -f 处理内含的 \i 载入备份）。
  local sqltmp
  sqltmp="$(mktemp -d)"
  cat > "$sqltmp/restore-appoidc.sql" <<'SQL'
-- data_platform_320 §6 ③：临时 iam schema 载入备份 → UPSERT 变换迁入 appoidc → 清理临时 schema。
-- 起始 DROP+CREATE 保证幂等/robust（重跑或旧 iam 残留时得到干净临时 schema；数据源始终 = 备份 dump）。
DROP SCHEMA IF EXISTS iam CASCADE;
CREATE SCHEMA iam;
\i /backup/appoidc_seed.sql
-- ③b oidc_clients：is_enabled(bool)→status(enum active/inactive)；NOT NULL 数组列 COALESCE '{}'。
--    真实备份行 UPSERT 覆盖 seed 占位行（占位 secret 未设）；id 省略（占位行保留原 id）。
--    status 词表是 active/inactive（22_appoidc.sql chk_oidc_clients_status，product_251 B-3）——
--    旧写法 'disabled' 会撞 CHECK 让整次恢复失败。
--    client_kind（2026-08-30，40-product-registry §3）：备份里没有这一列，按归属推导——
--    四个平台门户 = platform；其余必须挂着 product_id 才是产品接入凭据。既不是平台门户
--    又没有 product_id 的备份行（历史孤儿：ontos/raven/anlan/forge/xuanzhen/nocus）**不迁入**，
--    因为新库的 chk_oidc_clients_kind_product 不接受它们；跳过的行在下面 RAISE NOTICE 列出。
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT client_id FROM iam.oidc_client
     WHERE product_id IS NULL AND client_id NOT IN ('website', 'console', 'admin', 'opera')
  LOOP
    RAISE NOTICE '[28b] skip orphan client % (no product_id, not a platform portal)', r.client_id;
  END LOOP;
END $$;
INSERT INTO appoidc.oidc_clients (
    client_id, client_secret_hash, realm, product_id, client_kind, release_channel,
    name, display_name, logo_url,
    redirect_uris, post_logout_redirect_uris, allowed_scopes,
    access_token_ttl, refresh_token_ttl, pkce_required,
    slo_participation, back_channel_logout_uri, status,
    created_at, updated_at)
SELECT client_id, client_secret_hash, realm, product_id,
       CASE WHEN product_id IS NULL THEN 'platform' ELSE 'product' END,   -- client_kind
       release_channel,
       name, display_name, logo_url,
       COALESCE(redirect_uris, '{}'), COALESCE(post_logout_redirect_uris, '{}'),
       COALESCE(allowed_scopes, '{}'),
       access_token_ttl, refresh_token_ttl, pkce_required,
       slo_participation, back_channel_logout_uri,
       CASE WHEN is_enabled THEN 'active' ELSE 'inactive' END,   -- is_enabled → status
       created_at, updated_at
  FROM iam.oidc_client
 WHERE product_id IS NOT NULL
    OR client_id IN ('website', 'console', 'admin', 'opera')
ON CONFLICT (client_id) DO UPDATE SET
    client_secret_hash        = EXCLUDED.client_secret_hash,
    realm                     = EXCLUDED.realm,
    product_id                = EXCLUDED.product_id,
    client_kind               = EXCLUDED.client_kind,
    release_channel           = EXCLUDED.release_channel,
    name                      = EXCLUDED.name,
    display_name              = EXCLUDED.display_name,
    logo_url                  = EXCLUDED.logo_url,
    redirect_uris             = EXCLUDED.redirect_uris,
    post_logout_redirect_uris = EXCLUDED.post_logout_redirect_uris,
    allowed_scopes            = EXCLUDED.allowed_scopes,
    access_token_ttl          = EXCLUDED.access_token_ttl,
    refresh_token_ttl         = EXCLUDED.refresh_token_ttl,
    pkce_required             = EXCLUDED.pkce_required,
    slo_participation         = EXCLUDED.slo_participation,
    back_channel_logout_uri   = EXCLUDED.back_channel_logout_uri,
    status                    = EXCLUDED.status,
    created_at                = EXCLUDED.created_at,
    updated_at                = EXCLUDED.updated_at;
-- ③c signing_keys：旧→新列同名，直拷；kid 主键。seed 默认不种 signing_keys（占位空表），
--    ON CONFLICT (kid) DO NOTHING 仅作兜底（私钥不在库=secret manager，不动）。
INSERT INTO appoidc.signing_keys (
    kid, algorithm, public_jwk, status, activated_at, retiring_at, retired_at, created_at)
SELECT kid, algorithm, public_jwk, status, activated_at, retiring_at, retired_at, created_at
  FROM iam.signing_key
ON CONFLICT (kid) DO NOTHING;
-- ③d 清理临时 schema（新库不得残留 iam）。
DROP SCHEMA iam CASCADE;
SQL

  echo "==> psql 迁移 appoidc（临时 iam 载入备份 + UPSERT + DROP iam）"
  docker run --rm \
    --network vxture-prod \
    --env-file "$PLATFORM_ENV" \
    -v "$DUMP_DIR:/backup:ro" \
    -v "$sqltmp:/sql:ro" \
    "$PG_IMAGE" \
    sh -lc 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /sql/restore-appoidc.sql'
  rm -rf "$sqltmp"
  # ── consume-once（2026-07-05 复盘）：restore 成功后归档 dump，防陈旧快照复活 ──
  # 事故：round-1 capture 的固定名 dump 一直留在 host，round-2/3/4 每次 reset 后
  # restore 都读到它并 UPSERT，把 fresh seed 的 allowed_scopes/时间戳整表覆盖回
  # 07-02 旧态（arda phone scope、arda-beta secret 反复被抹）。restore 的数据源
  # 只该被消费一次；审计副本（appoidc_seed_<ts>.sql）已另存，归档不丢信息。
  mv "$DUMP_FILE" "$DUMP_FILE.restored-$(date -u +%Y%m%dT%H%M%SZ)"
  echo "  [ok] dump 已归档（consume-once，防重复 restore 复活陈旧快照）。"
  echo "  [ok] appoidc 恢复完成（真实 secret 覆盖 seed 占位；signing_keys 迁移；临时 iam 已清理）。"
}

ACTION="${1:-}"
case "$ACTION" in
  capture) capture ;;
  restore) restore ;;
  *)
    echo "用法：bash scripts/28b-restore-appoidc.sh {capture|restore}" >&2
    echo "  capture  reset 前备份活库 iam 两表（仅当旧 iam schema 存在）" >&2
    echo "  restore  reset+seed 后迁移备份到 appoidc（无备份则跳过）" >&2
    exit 1
    ;;
esac
