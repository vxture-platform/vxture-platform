#!/usr/bin/env bash
# deploy/maintenance/62-reset-platform-database.sh
# 受保护地重置平台 PostgreSQL 数据目录。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-07
#
# 运行：sudo CONFIRM_RESET=yes bash maintenance/62-reset-platform-database.sh
# 用途：仅用于新服务器首装失败、当前 PostgreSQL 数据无需保留时重建数据库。
set -euo pipefail

OWNER_USER="${SUDO_USER:-$(id -un)}"
COMPOSE_DIR="${COMPOSE_DIR:-/srv/vxture/deploy}"
# 统一变量入口：compose 里的 ${VX_*} 在调用方进程环境求值，tailnet 地址既不能
# 空默认（会绑定全网卡）也不能缺值即炸（排障脚本正是最需要能跑的时候）。
. "$COMPOSE_DIR/scripts/lib/compose-env.sh"
load_compose_env
COMPOSE_FILE="$COMPOSE_DIR/compose.platform.yml"
DATA_DIR="${DATA_DIR:-/srv/vxture/data/platform-pg}"
BACKUP_ROOT="${BACKUP_ROOT:-/srv/vxture/backups/platform-pg-reset}"
SNAPSHOT_DIR="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)"
POSTGRES_DATA_UID="${POSTGRES_DATA_UID:-70}"
POSTGRES_DATA_GID="${POSTGRES_DATA_GID:-70}"

if [ "$(id -u)" -ne 0 ]; then
  echo "错误：请使用 sudo CONFIRM_RESET=yes bash maintenance/62-reset-platform-database.sh 运行" >&2
  exit 1
fi

if [ "${CONFIRM_RESET:-}" != "yes" ]; then
  echo "错误：本脚本会停止平台容器并重置 PostgreSQL 数据目录。" >&2
  echo "确认新服务器当前数据无需保留后，使用：" >&2
  echo "  sudo CONFIRM_RESET=yes bash maintenance/62-reset-platform-database.sh" >&2
  exit 1
fi

case "$DATA_DIR" in
  /srv/vxture/data/platform-pg) ;;
  *)
    echo "错误：DATA_DIR 不在允许范围内：$DATA_DIR" >&2
    exit 1
    ;;
esac

if [ -L "$DATA_DIR" ]; then
  echo "错误：拒绝处理符号链接目录：$DATA_DIR" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "错误：缺少 compose 文件：$COMPOSE_FILE" >&2
  exit 1
fi

echo "=== Reset PostgreSQL data ==="
echo "Owner user: $OWNER_USER"
echo "Compose file: $COMPOSE_FILE"
echo "Data directory: $DATA_DIR"
echo "PostgreSQL data owner: $POSTGRES_DATA_UID:$POSTGRES_DATA_GID"
echo "Snapshot directory: $SNAPSHOT_DIR"
echo ""

cd "$COMPOSE_DIR"
echo "==> 停止平台容器"
docker compose -f "$COMPOSE_FILE" stop || true
docker compose -f "$COMPOSE_FILE" rm -f postgres || true

echo ""
echo "==> 归档旧 PostgreSQL 数据目录"
mkdir -p "$SNAPSHOT_DIR"
if [ -d "$DATA_DIR" ] && [ "$(find "$DATA_DIR" -mindepth 1 -maxdepth 1 | wc -l)" -gt 0 ]; then
  mv "$DATA_DIR" "$SNAPSHOT_DIR/platform-pg"
  echo "[SAVE] $SNAPSHOT_DIR/platform-pg"
elif [ -d "$DATA_DIR" ]; then
  rmdir "$DATA_DIR"
  echo "[OK] 已移除空目录：$DATA_DIR"
else
  echo "[SKIP] 数据目录不存在：$DATA_DIR"
fi

echo ""
echo "==> 重建空 PostgreSQL 数据目录"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"
chown "$POSTGRES_DATA_UID:$POSTGRES_DATA_GID" "$DATA_DIR"
chown "$OWNER_USER:$OWNER_USER" "$BACKUP_ROOT" "$SNAPSHOT_DIR" 2>/dev/null || true

echo ""
echo "=== Done ==="
echo "旧数据目录已归档到：$SNAPSHOT_DIR"
echo "新 PostgreSQL 数据目录 owner：$POSTGRES_DATA_UID:$POSTGRES_DATA_GID"
echo "下一步：按首次部署链路执行 CONFIRM_FIRST_DEPLOY=yes bash scripts/24-first-deploy-platform.sh"
