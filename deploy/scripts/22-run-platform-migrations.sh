#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# ⚠️ SUPERSEDED（2026-07-04）：`prisma db push` 机制已弃。平台库结构单一权威 =
#    deploy/database/ddl/。新 apply（psql，clean-baseline）：
#      CONFIRM_RESET=yes DATABASE_URL=...            deploy/database/ddl/apply.sh --reset
#      (modelruntime 库已随 Atlas 拆仓迁出,2026-08-18)
#    见 data_platform_320 §6。本脚本保留至任务4部署侧改造完成前，**勿再调用**。
# ════════════════════════════════════════════════════════════════════════════
# deploy/scripts/22-run-platform-migrations.sh
# 手动执行平台数据库 Prisma migration。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-07
#
# 运行：CONFIRM_MIGRATE=yes bash scripts/22-run-platform-migrations.sh
# 平台 schema 策略 = clean baseline via `prisma db push`（schema.prisma 即权威，
# 手动维护、无迁移历史）。三步：①00-bootstrap.sql 建 Prisma 不管理的序列
# ②db push 物化全 schema ③10-deferred-ddl.sql 建触发器/GIN/CHECK（§17）。
# 三步均幂等；仅在数据可弃/reset 后调用（26 会先 drop+recreate 空库）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATABASE_PRISMA_DIR="$COMPOSE_DIR/database/prisma"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
DB_TOOL_CACHE_DIR="${DB_TOOL_CACHE_DIR:-$RUNTIME_DIR/.db-tools/prisma-6.0.0-pg-8.20.0}"
DB_TOOL_INSTALL_TIMEOUT_SECONDS="${DB_TOOL_INSTALL_TIMEOUT_SECONDS:-600}"
MIGRATION_TIMEOUT_SECONDS="${MIGRATION_TIMEOUT_SECONDS:-900}"

check_file() {
  if [ ! -f "$1" ]; then
    echo "错误：缺少 $1" >&2
    exit 1
  fi
}

echo "=== Vxture Platform Database Migration ==="

if [ "${CONFIRM_MIGRATE:-}" != "yes" ]; then
  echo "错误：数据库 migration 只允许首次部署或明确维护窗口手动执行。" >&2
  echo "请确认后运行：CONFIRM_MIGRATE=yes bash scripts/22-run-platform-migrations.sh" >&2
  exit 1
fi

check_file "$DATABASE_PRISMA_DIR/schema.prisma"
check_file "$RUNTIME_DIR/secrets/platform.env"

if [ "${SKIP_DB_CHECK:-0}" != "1" ]; then
  bash "$SCRIPT_DIR/21-prepare-platform-database.sh"
fi

mkdir -p "$DB_TOOL_CACHE_DIR"
chmod 700 "$DB_TOOL_CACHE_DIR" 2>/dev/null || true

echo "==> 应用平台 schema（db push baseline + bootstrap + 非-Prisma DDL）"
docker run --rm \
  --network vxture-prod \
  --env-file "$RUNTIME_DIR/secrets/platform.env" \
  --env DB_TOOL_INSTALL_TIMEOUT_SECONDS="$DB_TOOL_INSTALL_TIMEOUT_SECONDS" \
  --env MIGRATION_TIMEOUT_SECONDS="$MIGRATION_TIMEOUT_SECONDS" \
  -v "$DATABASE_PRISMA_DIR:/db/prisma:ro" \
  -v "$DB_TOOL_CACHE_DIR:/tmp/vxture-db" \
  node:24-alpine \
  sh -lc '
    set -e
    apk add --no-cache openssl >/dev/null
    if [ ! -x /tmp/vxture-db/node_modules/.bin/prisma ]; then
      timeout "$DB_TOOL_INSTALL_TIMEOUT_SECONDS" npm install --prefix /tmp/vxture-db prisma@6.0.0 pg@8.20.0 >/dev/null
    fi
    export PATH="/tmp/vxture-db/node_modules/.bin:$PATH"
    export NODE_PATH="/tmp/vxture-db/node_modules"
    echo "==> [1/3] bootstrap：Prisma 不管理的序列（identity.user_no_seq，幂等）"
    timeout "$MIGRATION_TIMEOUT_SECONDS" prisma db execute --file /db/prisma/00-bootstrap.sql --schema /db/prisma/schema.prisma
    echo "==> [2/3] prisma db push：物化 schema.prisma 全 schema（干净 baseline，无迁移历史）"
    timeout "$MIGRATION_TIMEOUT_SECONDS" prisma db push --schema /db/prisma/schema.prisma --skip-generate --accept-data-loss
    echo "==> [3/3] 非-Prisma DDL：触发器/GIN/CHECK（§17，幂等）"
    timeout "$MIGRATION_TIMEOUT_SECONDS" prisma db execute --file /db/prisma/10-deferred-ddl.sql --schema /db/prisma/schema.prisma
  '

echo "=== Platform database migration done ==="
