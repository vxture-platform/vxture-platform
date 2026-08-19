#!/usr/bin/env bash
# deploy/scripts/50-backup-runtime-env.sh
# 备份真实运行 env、secret 文件和 Nginx 配置快照。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-02
#
# 运行：bash 50-backup-runtime-env.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
BACKUP_ROOT="${BACKUP_ROOT:-/srv/vxture/backups/runtime-env}"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

umask 077
mkdir -p "$BACKUP_DIR/runtime/secrets"
mkdir -p "$BACKUP_DIR/nginx"

copy_if_exists() {
  local source="$1"
  local target="$2"

  if [ -e "$source" ]; then
    mkdir -p "$(dirname "$target")"
    cp -a "$source" "$target"
    echo "  [OK] $source"
  else
    echo "  [MISS] $source"
  fi
}

echo "=== Vxture Runtime Env Backup ==="
echo "Backup directory: $BACKUP_DIR"
echo ""

echo "==> Runtime env files"
copy_if_exists "$RUNTIME_DIR/.env" "$BACKUP_DIR/runtime/.env"

for file in "$RUNTIME_DIR"/.env.*; do
  [ -e "$file" ] || continue
  case "$file" in
    *.example) continue ;;
  esac
  copy_if_exists "$file" "$BACKUP_DIR/runtime/$(basename "$file")"
done
echo ""

echo "==> Secret files"
copy_if_exists "$RUNTIME_DIR/secrets/platform.env" "$BACKUP_DIR/runtime/secrets/platform.env"
copy_if_exists "$RUNTIME_DIR/secrets/platform-mail.env" "$BACKUP_DIR/runtime/secrets/platform-mail.env"
copy_if_exists "$RUNTIME_DIR/secrets/platform-sms.env" "$BACKUP_DIR/runtime/secrets/platform-sms.env"
copy_if_exists "$RUNTIME_DIR/secrets/platform-identity.env" "$BACKUP_DIR/runtime/secrets/platform-identity.env"
copy_if_exists "$RUNTIME_DIR/secrets/rds-owner.env" "$BACKUP_DIR/runtime/secrets/rds-owner.env"
copy_if_exists "$RUNTIME_DIR/secrets/rds-pw-platform_svc" "$BACKUP_DIR/runtime/secrets/rds-pw-platform_svc"
copy_if_exists "$RUNTIME_DIR/secrets/rds-pw-reporting_ro" "$BACKUP_DIR/runtime/secrets/rds-pw-reporting_ro"
copy_if_exists "$RUNTIME_DIR/secrets/tair-pw-default" "$BACKUP_DIR/runtime/secrets/tair-pw-default"
copy_if_exists "$RUNTIME_DIR/secrets/redis-password" "$BACKUP_DIR/runtime/secrets/redis-password"
echo ""

echo "==> Nginx config"
copy_if_exists "/srv/vxture/data/nginx/conf" "$BACKUP_DIR/nginx/conf"
copy_if_exists "/srv/vxture/data/nginx/compose.yml" "$BACKUP_DIR/nginx/compose.yml"
echo ""

chmod -R go-rwx "$BACKUP_DIR"

echo "=== Backup complete ==="
echo "Saved to: $BACKUP_DIR"
