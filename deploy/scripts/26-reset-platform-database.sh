#!/usr/bin/env bash
# deploy/scripts/26-reset-platform-database.sh
# 平台库重置（破坏性）：RDS 库清空重建 = 28 --reset（DROP 18 schema + 全量重建）+ 29 seed。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-07
#
# 2026-08-19 RDS 切换：不再 drop/recreate 本地容器库（旧路径经 docker exec vx-platform-pg
# + 22/23 prisma 遗留链）。现路径 = 停应用容器释放连接 → 28 --reset → 29 seed → 重启应用。
# DDL 连接经 secrets/rds-owner.env（owner），应用运行时凭据不变。
#
# 运行：CONFIRM_RESET_DB=yes bash scripts/26-reset-platform-database.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"

# 连库的应用容器：drop 前停以释放连接，结束后 docker start 重启（同一镜像）。
APP_CONTAINERS="${APP_CONTAINERS:-vx-platform-auth-bff vx-platform-console-bff vx-platform-website-bff vx-platform-admin-bff vx-platform-api}"

if [ "${CONFIRM_RESET_DB:-}" != "yes" ]; then
  echo "错误：库重置是破坏性操作，需要显式确认。" >&2
  echo "请确认后运行：CONFIRM_RESET_DB=yes bash scripts/26-reset-platform-database.sh" >&2
  exit 1
fi

echo "=== Vxture Platform DB RESET (破坏性,RDS) ==="
echo "  ⚠️ 即将 DROP 全部平台 schema 并重建 + 重新 seed,所有业务数据丢失。"

echo ""
echo "==> [1/4] 停应用容器（释放连接）：$APP_CONTAINERS"
# shellcheck disable=SC2086
docker stop $APP_CONTAINERS || true

echo ""
echo "==> [2/4] 28 --reset：DROP 18 schema + DDL 全量重建"
env CONFIRM_RESET=yes bash "$SCRIPT_DIR/28-apply-platform-ddl.sh"

echo ""
echo "==> [3/4] 29 seed（catalog + sample）"
env CONFIRM_SEED=yes bash "$SCRIPT_DIR/29-seed-platform-ddl.sh"

echo ""
echo "==> [4/4] 重启应用容器"
# shellcheck disable=SC2086
docker start $APP_CONTAINERS || true

echo "=== DB reset done。建议随后跑 30-verify-platform-baseline.sh 复核基线 ==="
