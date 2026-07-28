#!/usr/bin/env bash
# deploy/scripts/26-reset-platform-database.sh
# 一次性「重置平台库 + 应用新 baseline + seed」编排（破坏性，仅数据可弃的环境）。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
#
# 重建是干净重写（新 baseline，无旧→新数据迁移）。当目标库是旧 schema 或需清空重来时用：
#   停应用容器 → 从 DATABASE_URL 解析库名+pg 超级用户 → drop+recreate 空库
#   → 21 检查 → 22 migrate(baseline) → 23 seed → 重启原有应用容器（docker start）。
#
# 刻意【不跑 25/30/40】：
#  - 25 provision 会在空库上生成「全新」签名密钥（非复用 env），且占位则 exit 1——而本机
#    platform-identity.env 已有有效密钥，auth-bff 用 env 私钥签名、/jwks 从 env 派生公钥，
#    DB signing_key 空不影响 OIDC。需要 DB 行/轮换时再单独跑 25。
#  - 30 deploy-stack 的 VX_IMAGE_TAG 默认 latest，手动跑会拉错镜像覆盖当前栈；这里只
#    docker start 重启「现有」容器（不换镜像、不 compose pull）。
#
# ⚠️ 会 DROP 整个应用库，所有数据丢失。只在测试/数据可弃环境用。常规发布用 31。
# 运行：CONFIRM_RESET_DB=yes bash scripts/26-reset-platform-database.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
PLATFORM_ENV="$RUNTIME_DIR/secrets/platform.env"
PG_CONTAINER="${PG_CONTAINER:-vx-platform-pg}"
# 连库的应用容器：drop 前停以释放连接，结束后 docker start 重启（同一镜像）。
APP_CONTAINERS="${APP_CONTAINERS:-vx-platform-auth-bff vx-platform-console-bff vx-platform-website-bff vx-platform-admin-bff}"

check_file() {
  if [ ! -f "$1" ]; then
    echo "错误：缺少 $1" >&2
    exit 1
  fi
}

if [ "${CONFIRM_RESET_DB:-}" != "yes" ]; then
  echo "错误：库重置是破坏性操作，需要显式确认。" >&2
  echo "请确认后运行：CONFIRM_RESET_DB=yes bash scripts/26-reset-platform-database.sh" >&2
  exit 1
fi

check_file "$PLATFORM_ENV"

DB_URL="$(grep -E '^DATABASE_URL=' "$PLATFORM_ENV" | head -1 | cut -d'=' -f2-)"
DB_NAME="$(printf '%s' "$DB_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
PG_SUPER="$(docker exec "$PG_CONTAINER" printenv POSTGRES_USER 2>/dev/null || true)"

if [ -z "$DB_NAME" ] || [ -z "$PG_SUPER" ]; then
  echo "错误：无法解析库名($DB_NAME)或 pg 超级用户($PG_SUPER)。" >&2
  exit 1
fi

cd "$COMPOSE_DIR"
echo "=== Vxture Platform DB RESET (破坏性) ==="
echo "  目标库 : $DB_NAME"
echo "  超级用户: $PG_SUPER"
echo "  ⚠️ 即将 DROP 该库，所有数据丢失。"

echo ""
echo "==> [1/5] 停应用容器（释放连接）：$APP_CONTAINERS"
# shellcheck disable=SC2086
docker stop $APP_CONTAINERS || true

echo ""
echo "==> [2/5] drop + recreate $DB_NAME（空库）"
docker exec "$PG_CONTAINER" psql -U "$PG_SUPER" -d template1 -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);" \
  -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$PG_SUPER\";"

echo ""
echo "==> [3/5] 21 检查平台数据库（含 env 审计）"
bash "$SCRIPT_DIR/21-prepare-platform-database.sh"

echo ""
echo "==> [4/5] 22 migrate(baseline) + 23 seed(catalog)"
env SKIP_DB_CHECK=1 CONFIRM_MIGRATE=yes bash "$SCRIPT_DIR/22-run-platform-migrations.sh"
env SKIP_DB_CHECK=1 CONFIRM_SEED=yes bash "$SCRIPT_DIR/23-seed-platform-database.sh"

echo ""
echo "==> [5/5] 重启应用容器（同一镜像）：$APP_CONTAINERS"
# shellcheck disable=SC2086
docker start $APP_CONTAINERS

echo ""
echo "=== DB reset + baseline + seed 完成 ==="
echo "OIDC 签名用 platform-identity.env 既有密钥（DB signing_key 空不影响）。"
echo "如需 DB signing_key 行/密钥轮换：CONFIRM_PROVISION_KEY=yes bash scripts/25-provision-signing-key.sh"
