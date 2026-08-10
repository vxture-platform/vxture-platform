#!/usr/bin/env bash
# deploy/scripts/25-provision-signing-key.sh
# 手动执行 IdP RS256 签名密钥 provision（首次部署，migrate 之后）。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-15
#
# 运行：CONFIRM_PROVISION_KEY=yes bash scripts/25-provision-signing-key.sh
# 幂等：provision-signing-key.mjs 已有 active key 时跳过（不轮换；--force 才轮换）。
#
# D-AG：本阶段把公钥写入 appoidc.signing_keys 并打印 OIDC_ACTIVE_KID + 私钥（base64
# PKCS8）。私钥不落盘——请手动粘贴到 secrets/platform-identity.env，再继续部署。
# 若该 secret 仍为占位（CHANGEME/空），本脚本打印密钥后以非零退出，提示先粘贴再重跑
# （首发聚合脚本幂等，可整体重跑）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATABASE_PRISMA_DIR="$COMPOSE_DIR/database/prisma"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
DB_TOOL_CACHE_DIR="${DB_TOOL_CACHE_DIR:-$RUNTIME_DIR/.db-tools/prisma-6.0.0-pg-8.20.0}"
DB_TOOL_INSTALL_TIMEOUT_SECONDS="${DB_TOOL_INSTALL_TIMEOUT_SECONDS:-600}"
PROVISION_TIMEOUT_SECONDS="${PROVISION_TIMEOUT_SECONDS:-300}"
IDENTITY_ENV_FILE="${IDENTITY_ENV_FILE:-$RUNTIME_DIR/secrets/platform-identity.env}"

check_file() {
  if [ ! -f "$1" ]; then
    echo "错误：缺少 $1" >&2
    exit 1
  fi
}

if [ "${CONFIRM_PROVISION_KEY:-}" != "yes" ]; then
  echo "错误：签名密钥 provision 只允许首次部署或密钥轮换时手动执行。" >&2
  echo "请确认后运行：CONFIRM_PROVISION_KEY=yes bash scripts/25-provision-signing-key.sh" >&2
  exit 1
fi

echo "=== Vxture IdP Signing Key Provision ==="
check_file "$DATABASE_PRISMA_DIR/provision-signing-key.mjs"
check_file "$RUNTIME_DIR/secrets/platform.env"

if [ "${SKIP_DB_CHECK:-0}" != "1" ]; then
  bash "$SCRIPT_DIR/21-prepare-platform-database.sh"
fi

mkdir -p "$DB_TOOL_CACHE_DIR"
chmod 700 "$DB_TOOL_CACHE_DIR" 2>/dev/null || true

echo "==> 执行 provision-signing-key.mjs（公钥入 appoidc.signing_keys，私钥打印）"
docker run --rm \
  --network vxture-prod \
  --env-file "$RUNTIME_DIR/secrets/platform.env" \
  --env DB_TOOL_INSTALL_TIMEOUT_SECONDS="$DB_TOOL_INSTALL_TIMEOUT_SECONDS" \
  --env PROVISION_TIMEOUT_SECONDS="$PROVISION_TIMEOUT_SECONDS" \
  -v "$DATABASE_PRISMA_DIR:/db/prisma:ro" \
  -v "$DB_TOOL_CACHE_DIR:/tmp/vxture-db" \
  node:24-alpine \
  sh -lc '
    set -e
    if [ ! -d /tmp/vxture-db/node_modules/pg ]; then
      timeout "$DB_TOOL_INSTALL_TIMEOUT_SECONDS" npm install --prefix /tmp/vxture-db pg@8.20.0 >/dev/null
    fi
    export NODE_PATH="/tmp/vxture-db/node_modules"
    timeout "$PROVISION_TIMEOUT_SECONDS" node /db/prisma/provision-signing-key.mjs
  '

# Gate：私钥必须已粘贴到 identity secret 才能继续部署（auth-bff boot 依赖它）。
KEY_VAL=""
if [ -f "$IDENTITY_ENV_FILE" ]; then
  KEY_VAL="$(grep -E '^OIDC_SIGNING_PRIVATE_KEY=' "$IDENTITY_ENV_FILE" | head -1 | cut -d= -f2-)"
fi
if [ -z "$KEY_VAL" ] || [ "$KEY_VAL" = "CHANGEME" ]; then
  echo "" >&2
  echo "!! 签名密钥尚未写入 $IDENTITY_ENV_FILE。" >&2
  echo "!! 请把上面打印的 OIDC_ACTIVE_KID 与 OIDC_SIGNING_PRIVATE_KEY 粘贴进该文件，" >&2
  echo "!! 然后重跑首发（24-first-deploy 幂等，可整体重跑）。" >&2
  exit 1
fi

echo "=== Signing key provisioned and present in secret env ==="
