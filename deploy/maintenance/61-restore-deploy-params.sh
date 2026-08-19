#!/usr/bin/env bash
# deploy/maintenance/61-restore-deploy-params.sh
# 恢复首次部署需要人工导入或配置的运行参数。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-07
#
# 运行：sudo CONFIRM_RESTORE=yes bash maintenance/61-restore-deploy-params.sh
# 来源：$HOME/vxture-backup/deploy-params/
# 幂等：重复运行会先备份目标文件，再覆盖恢复。
set -euo pipefail

OWNER_USER="${SUDO_USER:-$(id -un)}"
OWNER_HOME="$(getent passwd "$OWNER_USER" | cut -d: -f6)"
BACKUP_ROOT="${BACKUP_ROOT:-$OWNER_HOME/vxture-backup}"
BACKUP_DIR="${BACKUP_DIR:-$BACKUP_ROOT/deploy-params}"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
NGINX_DIR="${NGINX_DIR:-/srv/vxture/data/nginx}"
SNAPSHOT_DIR="/srv/vxture/backups/deploy-params-restore/$(date +%Y%m%d-%H%M%S)"
MISSING=0

if [ "$(id -u)" -ne 0 ]; then
  echo "错误：请使用 sudo CONFIRM_RESTORE=yes bash maintenance/61-restore-deploy-params.sh 运行"
  exit 1
fi

if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "错误：恢复运行参数会覆盖 runtime env、secrets 和 Nginx 配置，必须显式确认。" >&2
  echo "请确认后运行：sudo CONFIRM_RESTORE=yes bash maintenance/61-restore-deploy-params.sh" >&2
  exit 1
fi

backup_target_if_exists() {
  local target="$1"
  local relative="${target#/}"

  if [ -e "$target" ]; then
    mkdir -p "$SNAPSHOT_DIR/$(dirname "$relative")"
    cp -a "$target" "$SNAPSHOT_DIR/$relative"
    echo "[SAVE] $target"
  fi
}

restore_required() {
  local source="$1"
  local target="$2"

  if [ ! -e "$source" ]; then
    echo "[MISS] $source"
    MISSING=1
    return
  fi

  backup_target_if_exists "$target"
  mkdir -p "$(dirname "$target")"
  if [ -d "$source" ]; then
    mkdir -p "$target"
    cp -a "$source/." "$target/"
  else
    cp -a "$source" "$target"
  fi
  echo "[OK] $target"
}

restore_optional() {
  local source="$1"
  local target="$2"

  if [ ! -e "$source" ]; then
    echo "[SKIP] $source"
    return
  fi

  backup_target_if_exists "$target"
  mkdir -p "$(dirname "$target")"
  if [ -d "$source" ]; then
    mkdir -p "$target"
    cp -a "$source/." "$target/"
  else
    cp -a "$source" "$target"
  fi
  echo "[OK] $target"
}

echo "=== Restore deploy parameters ==="
echo "Owner user: $OWNER_USER"
echo "Backup directory: $BACKUP_DIR"
echo "Runtime directory: $RUNTIME_DIR"
echo "Nginx directory: $NGINX_DIR"
echo ""

if [ ! -d "$BACKUP_DIR" ]; then
  echo "错误：找不到备份目录：$BACKUP_DIR"
  exit 1
fi

echo "==> Platform env files"
restore_optional "$BACKUP_DIR/runtime/.env" "$RUNTIME_DIR/.env"
restore_required "$BACKUP_DIR/runtime/.env.auth-bff" "$RUNTIME_DIR/.env.auth-bff"
restore_required "$BACKUP_DIR/runtime/.env.gateway-bff" "$RUNTIME_DIR/.env.gateway-bff"
restore_required "$BACKUP_DIR/runtime/.env.website-bff" "$RUNTIME_DIR/.env.website-bff"
restore_required "$BACKUP_DIR/runtime/.env.console-bff" "$RUNTIME_DIR/.env.console-bff"
restore_required "$BACKUP_DIR/runtime/.env.admin-bff" "$RUNTIME_DIR/.env.admin-bff"

echo ""
echo "==> Platform secret files"
restore_required "$BACKUP_DIR/runtime/secrets/platform.env" "$RUNTIME_DIR/secrets/platform.env"
restore_required "$BACKUP_DIR/runtime/secrets/platform-mail.env" "$RUNTIME_DIR/secrets/platform-mail.env"
restore_required "$BACKUP_DIR/runtime/secrets/rds-owner.env" "$RUNTIME_DIR/secrets/rds-owner.env"
restore_required "$BACKUP_DIR/runtime/secrets/rds-pw-platform_svc" "$RUNTIME_DIR/secrets/rds-pw-platform_svc"
restore_required "$BACKUP_DIR/runtime/secrets/rds-pw-reporting_ro" "$RUNTIME_DIR/secrets/rds-pw-reporting_ro"
restore_required "$BACKUP_DIR/runtime/secrets/tair-pw-default" "$RUNTIME_DIR/secrets/tair-pw-default"

echo ""
echo "==> Nginx certificate and config"
restore_required "$BACKUP_DIR/nginx/ssl/live/vxture.com" "$NGINX_DIR/ssl/live/vxture.com"
restore_optional "$BACKUP_DIR/nginx/conf/nginx.conf" "$NGINX_DIR/conf/nginx.conf"
restore_optional "$BACKUP_DIR/nginx/conf/conf.d" "$NGINX_DIR/conf/conf.d"
restore_optional "$BACKUP_DIR/nginx/conf/snippets" "$NGINX_DIR/conf/snippets"
restore_optional "$BACKUP_DIR/nginx/conf/sites-enabled/vxture.com.conf" "$NGINX_DIR/conf/sites-enabled/vxture.com.conf"
restore_optional "$BACKUP_DIR/nginx/conf/sites-enabled/console.vxture.com.conf" "$NGINX_DIR/conf/sites-enabled/console.vxture.com.conf"
# admin.conf is 20-sync-nginx-config.sh's rendered output; a fresh sync run
# regenerates it from ADMIN_BASE_URL, so restoring it is a convenience, not
# the source of truth.
restore_optional "$BACKUP_DIR/nginx/conf/sites-enabled/admin.conf" "$NGINX_DIR/conf/sites-enabled/admin.conf"
restore_optional "$BACKUP_DIR/nginx/conf/sites-enabled/api.vxture.com.conf" "$NGINX_DIR/conf/sites-enabled/api.vxture.com.conf"
restore_optional "$BACKUP_DIR/nginx/compose.yml" "$NGINX_DIR/compose.yml"

echo ""
echo "==> 修正权限"
chmod 600 "$RUNTIME_DIR"/.env* 2>/dev/null || true
chmod 600 "$RUNTIME_DIR"/secrets/* 2>/dev/null || true
chmod 600 "$NGINX_DIR/ssl/live/vxture.com/privkey.pem" 2>/dev/null || true
chown -R "$OWNER_USER:$OWNER_USER" "$RUNTIME_DIR" "$NGINX_DIR" /srv/vxture/backups 2>/dev/null || true

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "错误：存在必需备份缺失，请补齐后重试。目标已有文件已保存在：$SNAPSHOT_DIR"
  exit 1
fi

echo ""
echo "=== Done ==="
echo "Restored from: $BACKUP_DIR"
echo "Previous target snapshot: $SNAPSHOT_DIR"
