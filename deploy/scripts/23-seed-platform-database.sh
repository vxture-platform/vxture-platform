#!/usr/bin/env bash
# deploy/scripts/23-seed-platform-database.sh
# 手动执行平台初始 seed。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-07
#
# 运行：CONFIRM_SEED=yes bash scripts/23-seed-platform-database.sh
# 幂等：seed 使用 ON CONFLICT 保护；常规发布不自动调用。
#
# Seed 范围（D-AF，2026-06-22 修订）：默认 catalog + 样例用户（zhangsan）。
# 现已生产安全——样例用户密码不在仓库，经 SAMPLE_USER_PASSWORD_HASH（运行时 secret）
# 注入；未设该 secret 时 seed-sample 自动跳过样例用户。设 SEED_SAMPLE=false 可只种 catalog。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATABASE_PRISMA_DIR="$COMPOSE_DIR/database/prisma"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
DB_TOOL_CACHE_DIR="${DB_TOOL_CACHE_DIR:-$RUNTIME_DIR/.db-tools/prisma-6.0.0-pg-8.20.0}"
DB_TOOL_INSTALL_TIMEOUT_SECONDS="${DB_TOOL_INSTALL_TIMEOUT_SECONDS:-600}"
SEED_TIMEOUT_SECONDS="${SEED_TIMEOUT_SECONDS:-900}"

# Seed scope (D-AF, revised 2026-06-22): default catalog + sample user. Now
# production-safe — the sample user's password is never in the repo; it is
# injected via SAMPLE_USER_PASSWORD_HASH (runtime secret) and seed-sample skips
# the user when that secret is absent. Set SEED_SAMPLE=false for catalog-only.
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
  echo "请确认后运行：CONFIRM_SEED=yes bash scripts/23-seed-platform-database.sh" >&2
  exit 1
fi

echo "=== Vxture Platform Database Seed (scope: $SEED_ENTRY) ==="
check_file "$DATABASE_PRISMA_DIR/$SEED_ENTRY"
check_file "$RUNTIME_DIR/secrets/platform.env"

if [ "${SKIP_DB_CHECK:-0}" != "1" ]; then
  bash "$SCRIPT_DIR/21-prepare-platform-database.sh"
fi

mkdir -p "$DB_TOOL_CACHE_DIR"
chmod 700 "$DB_TOOL_CACHE_DIR" 2>/dev/null || true

# 从 host 的 .env.auth-bff 投影给 seed 容器：
#  - SSO provider 密钥（9 个，--env KEY 无值，凭证不进 args 防 ps/inspect 泄露）；
#  - confidential RP 客户端密钥 hash（OIDC_CLIENT_SECRET_HASH_*，含远程 RP ruyin），seed-catalog
#    写入 iam.oidc_client.client_secret_hash；缺它们 → hash 落 NULL → IdP 的
#    authenticateClient 返回 null → RP 换 token 报 401 invalid_client。由
#    27-provision-client-secrets.sh 写入（单引号包裹，下面 `. source` 不会展开 '$'）。
#  - portal/issuer base URL（4 个），供 seed.mjs 拼 oidc_client 的 redirect_uris
#    (`${*_BASE_URL}/auth/callback`) 与 post_logout (`${ACCOUNTS_BASE_URL}/logout`)。
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
  for k in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI \
           DINGTALK_APP_KEY DINGTALK_APP_SECRET DINGTALK_REDIRECT_URI \
           FEISHU_APP_ID FEISHU_APP_SECRET FEISHU_REDIRECT_URI \
           OIDC_CLIENT_SECRET_HASH_WEBSITE OIDC_CLIENT_SECRET_HASH_CONSOLE OIDC_CLIENT_SECRET_HASH_ADMIN \
           OIDC_CLIENT_SECRET_HASH_OPERA \
           OIDC_CLIENT_SECRET_HASH_RUYIN OIDC_CLIENT_SECRET_HASH_ARDA OIDC_CLIENT_SECRET_HASH_ARDA_BETA \
           OIDC_CLIENT_SECRET_HASH_KARDA OIDC_CLIENT_SECRET_HASH_KARDA_BETA \
           OIDC_CLIENT_SECRET_HASH_ATLAS OIDC_CLIENT_SECRET_HASH_ONTOS OIDC_CLIENT_SECRET_HASH_RAVEN \
           OIDC_CLIENT_SECRET_HASH_ANLAN OIDC_CLIENT_SECRET_HASH_FORGE OIDC_CLIENT_SECRET_HASH_XUANZHEN \
           OPERATOR_SUPERADMIN_PASSWORD_HASH \
           OPERATOR_SUPERADMIN_EMAIL OPERATOR_SUPERADMIN_PHONE \
           WEBSITE_BASE_URL CONSOLE_BASE_URL ADMIN_BASE_URL OPERA_BASE_URL RUYIN_BASE_URL ACCOUNTS_BASE_URL \
           RUNOS_BASE_URL NOCUS_BASE_URL ATLAS_BASE_URL ONTOS_BASE_URL RAVEN_BASE_URL \
           ANLAN_BASE_URL FORGE_BASE_URL XUANZHEN_BASE_URL ARDA_BASE_URL KARDA_BASE_URL \
           RUNOS_BETA_BASE_URL NOCUS_BETA_BASE_URL ATLAS_BETA_BASE_URL ONTOS_BETA_BASE_URL RAVEN_BETA_BASE_URL \
           ANLAN_BETA_BASE_URL FORGE_BETA_BASE_URL XUANZHEN_BETA_BASE_URL ARDA_BETA_BASE_URL KARDA_BETA_BASE_URL; do
    if [ -n "${!k:-}" ]; then
      SSO_ENV_ARGS+=(--env "$k")
    fi
  done
  echo "==> seed 环境投影：${#SSO_ENV_ARGS[@]} 项（SSO 凭证 + base URL，来自 $AUTH_ENV_FILE）"
else
  echo "==> 未找到 $AUTH_ENV_FILE，SSO 与 oidc_client redirect 将落默认（localhost）"
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
  -v "$DATABASE_PRISMA_DIR:/db/prisma:ro" \
  -v "$DB_TOOL_CACHE_DIR:/tmp/vxture-db" \
  node:24-alpine \
  sh -lc '
    set -e
    if [ ! -d /tmp/vxture-db/node_modules/pg ]; then
      timeout "$DB_TOOL_INSTALL_TIMEOUT_SECONDS" npm install --prefix /tmp/vxture-db pg@8.20.0 >/dev/null
    fi
    export NODE_PATH="/tmp/vxture-db/node_modules"
    timeout "$SEED_TIMEOUT_SECONDS" node "/db/prisma/$SEED_ENTRY"
  '

echo "=== Platform database seed done ==="
