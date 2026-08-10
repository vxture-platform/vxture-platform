#!/usr/bin/env bash
# deploy/scripts/29-seed-platform-ddl.sh
# 手动 seed 平台库（新 18-schema DDL 的 seed，deploy/database/seed/），取代旧 23。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-07-04
#
# 运行：CONFIRM_SEED=yes bash scripts/29-seed-platform-ddl.sh
# 幂等：seed 全部 ON CONFLICT 保护；常规发布不自动调用。
#
# 范围：seed.mjs = catalog(①) + sample(②)；SEED_SAMPLE=false 只 catalog（seed-catalog.mjs）。
# 样例用户密码不在仓库，经 SAMPLE_USER_PASSWORD_HASH（.env.auth-bff 运行时 secret，随 SSO_ENV_ARGS
# 投影，2026-07-13 补丁——此前遗漏在投影列表里，设了也传不进 seed 容器）注入；未设该 secret 时
# seed-sample 自动跳过样例用户。SSO 凭证 + confidential RP client secret hash
# （OIDC_CLIENT_SECRET_HASH_*）+ portal/issuer base URL 同样从 .env.auth-bff 投影，投影列表同旧 23。
# appoidc 业务互通数据（真实 secret / signing_key）不由 seed 造，走 28b-restore-appoidc.sh（§6）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATABASE_SEED_DIR="$COMPOSE_DIR/database/seed"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
DB_TOOL_CACHE_DIR="${DB_TOOL_CACHE_DIR:-$RUNTIME_DIR/.db-tools/pg-8.20.0}"
DB_TOOL_INSTALL_TIMEOUT_SECONDS="${DB_TOOL_INSTALL_TIMEOUT_SECONDS:-600}"
SEED_TIMEOUT_SECONDS="${SEED_TIMEOUT_SECONDS:-900}"

# Seed scope: default catalog + sample. seed-sample self-skips the user when
# SAMPLE_USER_PASSWORD_HASH is absent, so seed.mjs is production-safe by default.
# Set SEED_SAMPLE=false for catalog-only (runs seed-catalog.mjs directly).
SEED_SAMPLE="${SEED_SAMPLE:-true}"
if [ "$SEED_SAMPLE" = "true" ] || [ "$SEED_SAMPLE" = "1" ]; then
  SEED_ENTRY="seed.mjs" # catalog + sample
else
  SEED_ENTRY="seed-catalog.mjs" # catalog only
fi

check_file() {
  if [ ! -f "$1" ]; then
    echo "错误：缺少 $1" >&2
    exit 1
  fi
}

if [ "${CONFIRM_SEED:-}" != "yes" ]; then
  echo "错误：seed 只允许首次部署或明确补种时手动执行。" >&2
  echo "请确认后运行：CONFIRM_SEED=yes bash scripts/29-seed-platform-ddl.sh" >&2
  exit 1
fi

echo "=== Vxture Platform Database Seed — DDL (scope: $SEED_ENTRY) ==="
check_file "$DATABASE_SEED_DIR/$SEED_ENTRY"
check_file "$RUNTIME_DIR/secrets/platform.env"

mkdir -p "$DB_TOOL_CACHE_DIR"
chmod 700 "$DB_TOOL_CACHE_DIR" 2>/dev/null || true

# 从 host 的 .env.auth-bff 投影给 seed 容器（列表与旧 23 一致）：
#  - SSO provider 密钥（凭证不进 args 防 ps/inspect 泄露，--env KEY 无值仅名）；
#  - confidential RP client secret hash（OIDC_CLIENT_SECRET_HASH_*，含远程 RP umbra），seed-catalog
#    写入 appoidc.oidc_clients.client_secret_hash；缺它们 → hash 落 NULL → IdP authenticateClient
#    返回 null → RP 换 token 报 401 invalid_client。由 27-provision-client-secrets.sh 写入。
#  - portal/issuer base URL，供 seed-catalog 拼 oidc_clients 的 redirect_uris 与 post_logout。
#    缺它们 → seed 落 localhost 默认 → IdP authorize 报 invalid_redirect_uri。
# .env.auth-bff 是这些值的权威源。
AUTH_ENV_FILE="${AUTH_ENV_FILE:-$RUNTIME_DIR/.env.auth-bff}"
SSO_ENV_ARGS=()
if [ -f "$AUTH_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$AUTH_ENV_FILE"
  set +a
  # accounts 面 base：优先显式 ACCOUNTS_BASE_URL，否则用 LOGIN_UI_BASE_URL（同一面）。
  : "${ACCOUNTS_BASE_URL:=${LOGIN_UI_BASE_URL:-}}"
  # Every OIDC_CLIENT_SECRET_HASH_* present in the file, discovered rather than
  # listed (2026-08-10, owner directive). The enumerated version silently dropped
  # whatever was not in it: OIDC_CLIENT_SECRET_HASH_RUNOS was missing, so even once
  # 27 minted the hash the seed container never received it and the DB row stayed
  # NULL — invalid_client on every runos token exchange, with nothing in any log
  # naming the cause (platform#205). A per-product list in a projection step fails
  # exactly when a new product is added, which is the only time it matters.
  HASH_KEYS="$(grep -oE '^OIDC_CLIENT_SECRET_HASH_[A-Z0-9_]+' "$AUTH_ENV_FILE" 2>/dev/null | sort -u || true)"
  for k in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI \
           DINGTALK_APP_KEY DINGTALK_APP_SECRET DINGTALK_REDIRECT_URI \
           FEISHU_APP_ID FEISHU_APP_SECRET FEISHU_REDIRECT_URI \
           $HASH_KEYS \
           OPERATOR_SUPERADMIN_PASSWORD_HASH \
           OPERATOR_SUPERADMIN_EMAIL OPERATOR_SUPERADMIN_PHONE \
           SAMPLE_USER_PASSWORD_HASH \
           WEBSITE_BASE_URL CONSOLE_BASE_URL ADMIN_BASE_URL OPERA_BASE_URL UMBRA_BASE_URL RUYIN_BASE_URL ACCOUNTS_BASE_URL \
           RUNOS_BASE_URL ATLAS_BASE_URL ONTOS_BASE_URL RAVEN_BASE_URL \
           ANLAN_BASE_URL FORGE_BASE_URL XUANZHEN_BASE_URL ARDA_BASE_URL ARDA_WEBHOOK_BASE_URL KARDA_BASE_URL KARDA_WEBHOOK_BASE_URL \
           RUYIN_BETA_BASE_URL RUNOS_BETA_BASE_URL ATLAS_BETA_BASE_URL ONTOS_BETA_BASE_URL RAVEN_BETA_BASE_URL \
           ANLAN_BETA_BASE_URL FORGE_BETA_BASE_URL XUANZHEN_BETA_BASE_URL ARDA_BETA_BASE_URL KARDA_BETA_BASE_URL; do
    if [ -n "${!k:-}" ]; then
      SSO_ENV_ARGS+=(--env "$k")
    fi
  done
  echo "==> seed 环境投影：${#SSO_ENV_ARGS[@]} 项（SSO 凭证 + base URL，来自 $AUTH_ENV_FILE）"
else
  echo "==> 未找到 $AUTH_ENV_FILE，SSO 与 oidc_clients redirect 将落默认（localhost）"
fi

# Production fail-closed gate (2026-07-21 security audit): the bootstrap
# superadmin default password (Admin@2026) is public in this repo, so a
# production DB must never be seeded with it. Provision a real Argon2id hash in
# .env.auth-bff (OPERATOR_SUPERADMIN_PASSWORD_HASH, single-quoted — the PHC
# string is $-expanded into garbage when sourced unquoted) first. When
# $AUTH_ENV_FILE is absent the environment (NODE_ENV) is unknowable → also fail
# closed. Non-production bootstrap stays reachable via the explicit escape
# hatch SEED_ALLOW_DEFAULT_SUPERADMIN=yes.
case "${OPERATOR_SUPERADMIN_PASSWORD_HASH:-}" in
  '$argon2'*) : ;; # valid override (sourced from the env file or ambient env)
  *)
    if [ "${SEED_ALLOW_DEFAULT_SUPERADMIN:-}" != "yes" ]; then
      if [ "${NODE_ENV:-}" = "production" ]; then
        echo "错误：NODE_ENV=production 但 OPERATOR_SUPERADMIN_PASSWORD_HASH 未设置有效 \$argon2 hash（值须单引号包裹）——拒绝以公开默认口令 seed 生产库。" >&2
        exit 1
      elif [ ! -f "$AUTH_ENV_FILE" ]; then
        echo "错误：$AUTH_ENV_FILE 不存在，无法判定 NODE_ENV——默认拒绝 seed。确属非生产 bootstrap 请以 SEED_ALLOW_DEFAULT_SUPERADMIN=yes 重跑。" >&2
        exit 1
      fi
    fi
    ;;
esac

echo "==> 执行平台初始 seed（$SEED_ENTRY）"
docker run --rm \
  --network vxture-prod \
  --env-file "$RUNTIME_DIR/secrets/platform.env" \
  --env DB_TOOL_INSTALL_TIMEOUT_SECONDS="$DB_TOOL_INSTALL_TIMEOUT_SECONDS" \
  --env SEED_TIMEOUT_SECONDS="$SEED_TIMEOUT_SECONDS" \
  --env SEED_ENTRY="$SEED_ENTRY" \
  ${SSO_ENV_ARGS[@]+"${SSO_ENV_ARGS[@]}"} \
  -v "$DATABASE_SEED_DIR:/db/seed:ro" \
  -v "$DB_TOOL_CACHE_DIR:/tmp/vxture-db" \
  node:24-alpine \
  sh -lc '
    set -e
    if [ ! -d /tmp/vxture-db/node_modules/pg ]; then
      timeout "$DB_TOOL_INSTALL_TIMEOUT_SECONDS" npm install --prefix /tmp/vxture-db pg@8.20.0 >/dev/null
    fi
    export NODE_PATH="/tmp/vxture-db/node_modules"
    timeout "$SEED_TIMEOUT_SECONDS" node "/db/seed/$SEED_ENTRY"
  '

echo "=== Platform database seed done (DDL) ==="
