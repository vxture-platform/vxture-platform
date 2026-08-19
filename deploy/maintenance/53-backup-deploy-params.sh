#!/usr/bin/env bash
# deploy/maintenance/53-backup-deploy-params.sh
# 备份首次部署需要人工导入或配置的运行参数。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-05
#
# 运行：bash maintenance/53-backup-deploy-params.sh
# 输出：$HOME/vxture-backup/deploy-params/
set -euo pipefail

OWNER_USER="${SUDO_USER:-$(id -un)}"
OWNER_HOME="$(getent passwd "$OWNER_USER" | cut -d: -f6)"
BACKUP_ROOT="${BACKUP_ROOT:-$OWNER_HOME/vxture-backup}"
BACKUP_DIR="$BACKUP_ROOT/deploy-params"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"

umask 077
mkdir -p "$BACKUP_DIR/runtime/secrets" "$BACKUP_DIR/nginx"

copy_if_exists() {
  local source="$1"
  local target="$2"

  if [ -e "$source" ]; then
    mkdir -p "$(dirname "$target")"
    cp -a "$source" "$target"
    echo "[OK] $source"
  else
    echo "[MISS] $source"
  fi
}

echo "=== Backup deploy parameters ==="
echo "Owner user: $OWNER_USER"
echo "Backup directory: $BACKUP_DIR"
echo ""

echo "==> Platform env files"
copy_if_exists "$RUNTIME_DIR/.env" "$BACKUP_DIR/runtime/.env"
for file in "$RUNTIME_DIR"/.env.*; do
  [ -e "$file" ] || continue
  case "$file" in
    *.example) continue ;;
  esac
  copy_if_exists "$file" "$BACKUP_DIR/runtime/$(basename "$file")"
done

echo ""
echo "==> Platform secret files"
copy_if_exists "$RUNTIME_DIR/secrets/platform.env" "$BACKUP_DIR/runtime/secrets/platform.env"
copy_if_exists "$RUNTIME_DIR/secrets/platform-mail.env" "$BACKUP_DIR/runtime/secrets/platform-mail.env"
copy_if_exists "$RUNTIME_DIR/secrets/rds-owner.env" "$BACKUP_DIR/runtime/secrets/rds-owner.env"
copy_if_exists "$RUNTIME_DIR/secrets/rds-pw-platform_svc" "$BACKUP_DIR/runtime/secrets/rds-pw-platform_svc"
copy_if_exists "$RUNTIME_DIR/secrets/rds-pw-reporting_ro" "$BACKUP_DIR/runtime/secrets/rds-pw-reporting_ro"
copy_if_exists "$RUNTIME_DIR/secrets/tair-pw-default" "$BACKUP_DIR/runtime/secrets/tair-pw-default"
copy_if_exists "$RUNTIME_DIR/secrets/redis-password" "$BACKUP_DIR/runtime/secrets/redis-password"

echo ""
echo "==> Nginx platform certificate and config"
copy_if_exists "/srv/vxture/data/nginx/ssl/live/vxture.com" "$BACKUP_DIR/nginx/ssl/live/vxture.com"
copy_if_exists "/srv/vxture/data/nginx/conf/nginx.conf" "$BACKUP_DIR/nginx/conf/nginx.conf"
copy_if_exists "/srv/vxture/data/nginx/conf/conf.d" "$BACKUP_DIR/nginx/conf/conf.d"
copy_if_exists "/srv/vxture/data/nginx/conf/snippets" "$BACKUP_DIR/nginx/conf/snippets"
copy_if_exists "/srv/vxture/data/nginx/conf/sites-enabled/vxture.com.conf" "$BACKUP_DIR/nginx/conf/sites-enabled/vxture.com.conf"
copy_if_exists "/srv/vxture/data/nginx/conf/sites-enabled/console.vxture.com.conf" "$BACKUP_DIR/nginx/conf/sites-enabled/console.vxture.com.conf"
# admin.conf is 20-sync-nginx-config.sh's rendered output (hardening: the
# real hostname is never a filename in the repo, same as opera.conf).
copy_if_exists "/srv/vxture/data/nginx/conf/sites-enabled/admin.conf" "$BACKUP_DIR/nginx/conf/sites-enabled/admin.conf"
copy_if_exists "/srv/vxture/data/nginx/conf/sites-enabled/api.vxture.com.conf" "$BACKUP_DIR/nginx/conf/sites-enabled/api.vxture.com.conf"
copy_if_exists "/srv/vxture/data/nginx/compose.yml" "$BACKUP_DIR/nginx/compose.yml"

echo ""
echo "=== Done ==="
sudo chown -R "$OWNER_USER:$OWNER_USER" "$BACKUP_ROOT" 2>/dev/null || true
echo "Saved to: $BACKUP_DIR"
