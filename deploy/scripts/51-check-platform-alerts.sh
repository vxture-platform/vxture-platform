#!/usr/bin/env bash
# deploy/scripts/51-check-platform-alerts.sh
# 平台常态告警检查。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-05
#
# 运行：bash 51-check-platform-alerts.sh
# 约束：只读检查；不修改文件、不重启服务、不输出 secret 内容。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# 统一变量入口：compose 里的 ${VX_*} 在调用方进程环境求值，tailnet 地址既不能
# 空默认（会绑定全网卡）也不能缺值即炸（排障脚本正是最需要能跑的时候）。
. "$COMPOSE_DIR/scripts/lib/compose-env.sh"
load_compose_env
COMPOSE_FILE="$COMPOSE_DIR/compose.platform.yml"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
NGINX_COMPOSE_FILE="/srv/vxture/data/nginx/compose.yml"

BASELINE_UBUNTU_VERSION="26.04"
BASELINE_NODE_MAJOR="24"
BASELINE_PNPM_VERSION="10.30.3"
BASELINE_DOCKER_VERSION="29.5.0"
BASELINE_COMPOSE_VERSION="5.1.0"
BASELINE_NGINX_IMAGE="nginx:1.29-alpine"
BASELINE_POSTGRES_IMAGE="postgres:18-alpine"
BASELINE_REDIS_IMAGE="redis:8-alpine"

HIGH_COUNT=0
MEDIUM_COUNT=0
LOW_COUNT=0

high() {
  HIGH_COUNT=$((HIGH_COUNT + 1))
  printf '[HIGH] %s\n' "$1"
}

medium() {
  MEDIUM_COUNT=$((MEDIUM_COUNT + 1))
  printf '[MEDIUM] %s\n' "$1"
}

low() {
  LOW_COUNT=$((LOW_COUNT + 1))
  printf '[LOW] %s\n' "$1"
}

ok() {
  printf '[OK] %s\n' "$1"
}

version_ge() {
  local current="$1"
  local required="$2"
  [ "$(printf '%s\n%s\n' "$required" "$current" | sort -V | head -n 1)" = "$required" ]
}

command_version() {
  local command_name="$1"
  local version_pattern="$2"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    return 1
  fi

  "$command_name" --version 2>/dev/null | head -n 1 | sed -E "$version_pattern"
}

compose_version() {
  local version

  version="$(docker compose version --short 2>/dev/null || true)"
  if [ -n "$version" ]; then
    printf '%s\n' "$version" | sed -E 's/^v//' | grep -Eo '^[0-9]+(\.[0-9]+)*'
    return
  fi

  docker compose version 2>/dev/null | grep -Eo 'v?[0-9]+(\.[0-9]+)+' | head -n 1 | sed -E 's/^v//'
}

check_required_file() {
  local file="$1"
  if [ -f "$file" ] && [ -s "$file" ]; then
    ok "文件存在：$file"
  else
    high "缺少或为空：$file"
  fi
}

check_forbidden_keys() {
  local file="$1"
  local pattern="$2"
  local hits

  [ -f "$file" ] || return 0
  hits="$(awk -F= -v pattern="$pattern" '
    /^[[:space:]]*[A-Z0-9_]+=/ {
      key = $1
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key ~ pattern) print key
    }
  ' "$file" | sort -u | paste -sd, -)"

  if [ -n "$hits" ]; then
    high "$file 存在残留变量：$hits"
  else
    ok "$file 无残留变量"
  fi
}

check_os() {
  if [ ! -f /etc/os-release ]; then
    high "无法读取 /etc/os-release"
    return
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  if [ "${ID:-}" != "ubuntu" ]; then
    high "OS 不是 Ubuntu：${PRETTY_NAME:-unknown}"
    return
  fi

  if [ "${VERSION_ID:-}" = "$BASELINE_UBUNTU_VERSION" ]; then
    ok "Ubuntu 版本符合基线：${VERSION_ID}"
  else
    high "Ubuntu 版本不符合基线：当前 ${VERSION_ID:-unknown}，要求 $BASELINE_UBUNTU_VERSION"
  fi
}

check_tool_versions() {
  local node_version
  if command -v node >/dev/null 2>&1; then
    node_version="$(node --version | sed -E 's/^v//')"
    if [ "${node_version%%.*}" = "$BASELINE_NODE_MAJOR" ]; then
      ok "Node.js 主版本符合基线：$node_version"
    else
      high "Node.js 主版本不符合基线：当前 $node_version，要求 ${BASELINE_NODE_MAJOR}.x"
    fi
  else
    high "Node.js 未安装"
  fi

  local pnpm_version
  if command -v pnpm >/dev/null 2>&1; then
    pnpm_version="$(pnpm --version)"
    if [ "$pnpm_version" = "$BASELINE_PNPM_VERSION" ]; then
      ok "pnpm 版本符合基线：$pnpm_version"
    else
      high "pnpm 版本不符合基线：当前 $pnpm_version，要求 $BASELINE_PNPM_VERSION"
    fi
  else
    high "pnpm 未安装"
  fi

  local docker_version
  docker_version="$(command_version docker 's/.*version ([0-9.]+).*/\1/' || true)"
  if [ -n "$docker_version" ] && version_ge "$docker_version" "$BASELINE_DOCKER_VERSION"; then
    ok "Docker 版本符合基线：$docker_version"
  else
    high "Docker 版本不符合基线：当前 ${docker_version:-missing}，至少 $BASELINE_DOCKER_VERSION"
  fi

  local detected_compose_version
  detected_compose_version="$(compose_version || true)"
  if [ -n "$detected_compose_version" ] && version_ge "$detected_compose_version" "$BASELINE_COMPOSE_VERSION"; then
    ok "Docker Compose 版本符合基线：$detected_compose_version"
  else
    high "Docker Compose 版本不符合基线：当前 ${detected_compose_version:-missing}，至少 $BASELINE_COMPOSE_VERSION"
  fi
}

check_runtime_files() {
  check_required_file "$RUNTIME_DIR/.env.auth-bff"
  check_required_file "$RUNTIME_DIR/.env.website-bff"
  check_required_file "$RUNTIME_DIR/.env.console-bff"
  check_required_file "$RUNTIME_DIR/.env.admin-bff"
  check_required_file "$RUNTIME_DIR/.env.gateway-bff"
  check_required_file "$RUNTIME_DIR/secrets/platform.env"
  check_required_file "$RUNTIME_DIR/secrets/platform-mail.env"
  check_required_file "$RUNTIME_DIR/secrets/pg-password"
  check_required_file "$RUNTIME_DIR/secrets/redis-password"
  check_required_file "/srv/vxture/data/nginx/ssl/live/vxture.com/fullchain.pem"
  check_required_file "/srv/vxture/data/nginx/ssl/live/vxture.com/privkey.pem"
}

check_env_residue() {
  check_forbidden_keys "$RUNTIME_DIR/.env" '^(REDIS_PASSWORD)$'
  check_forbidden_keys "$RUNTIME_DIR/.env.auth-bff" '^(CF_TURNSTILE_ADMIN_|SMTP_)'
  check_forbidden_keys "$RUNTIME_DIR/.env.website-bff" '^(CF_TURNSTILE_|DINGTALK_|FEISHU_|SMTP_)'
  check_forbidden_keys "$RUNTIME_DIR/.env.console-bff" '^(SMTP_)'
  check_forbidden_keys "$RUNTIME_DIR/.env.admin-bff" '^(SMTP_)'
  check_forbidden_keys "$RUNTIME_DIR/secrets/platform.env" '^(REDIS_PASSWORD|SMTP_)'
}

check_compose_images() {
  if grep -R --exclude='51-check-platform-alerts.sh' -nE 'node:22|NODE_VERSION=22|node-version: "22"' \
    "$COMPOSE_DIR" >/dev/null 2>&1; then
    high "部署资产仍包含 Node 22 历史基线"
  else
    ok "部署资产未发现 Node 22 历史基线"
  fi

  if grep -q "image: ${BASELINE_NGINX_IMAGE}" "$COMPOSE_DIR/compose.nginx.yml"; then
    ok "Nginx 镜像符合基线：$BASELINE_NGINX_IMAGE"
  else
    high "Nginx 镜像不符合基线，要求 $BASELINE_NGINX_IMAGE"
  fi

  if grep -q "image: ${BASELINE_POSTGRES_IMAGE}" "$COMPOSE_FILE"; then
    ok "PostgreSQL 镜像符合基线：$BASELINE_POSTGRES_IMAGE"
  else
    high "PostgreSQL 镜像不符合基线，要求 $BASELINE_POSTGRES_IMAGE"
  fi

  if grep -q "image: ${BASELINE_REDIS_IMAGE}" "$COMPOSE_FILE"; then
    ok "Redis 镜像符合基线：$BASELINE_REDIS_IMAGE"
  else
    high "Redis 镜像不符合基线，要求 $BASELINE_REDIS_IMAGE"
  fi
}

check_docker_runtime() {
  if docker info >/dev/null 2>&1; then
    ok "Docker daemon 可用"
  else
    high "Docker daemon 不可用"
    return
  fi

  if docker network inspect vxture-prod >/dev/null 2>&1; then
    ok "Docker network vxture-prod 存在"
  else
    high "Docker network vxture-prod 缺失"
  fi

  if docker compose -f "$COMPOSE_FILE" config --quiet >/dev/null 2>&1; then
    ok "平台 Compose 配置有效"
  else
    high "平台 Compose 配置无效"
  fi
}

check_container_health() {
  local name
  for name in \
    vx-platform-pg vx-platform-redis vx-platform-auth-bff vx-platform-website-bff \
    vx-platform-console-bff vx-platform-admin-bff vx-platform-gateway-bff \
    vx-platform-api vx-platform-website vx-platform-console vx-platform-admin \
    vx-platform-accounts; do
    if ! docker inspect "$name" >/dev/null 2>&1; then
      high "容器缺失：$name"
      continue
    fi

    local status
    local health
    status="$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || true)"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || true)"
    if [ "$status" = "running" ] && { [ "$health" = "healthy" ] || [ "$health" = "none" ]; }; then
      ok "容器运行正常：$name ($health)"
    else
      high "容器状态异常：$name status=$status health=$health"
    fi
  done
}

check_nginx_and_tls() {
  if docker inspect vxture-nginx >/dev/null 2>&1; then
    if docker exec vxture-nginx nginx -t >/dev/null 2>&1; then
      ok "Nginx 配置测试通过"
    else
      high "Nginx 配置测试失败"
    fi
  else
    high "Nginx 容器缺失：vxture-nginx"
  fi

  local cert="/srv/vxture/data/nginx/ssl/live/vxture.com/fullchain.pem"
  if [ -f "$cert" ]; then
    if openssl x509 -checkend 2592000 -noout -in "$cert" >/dev/null 2>&1; then
      ok "vxture.com 证书有效期超过 30 天"
    else
      high "vxture.com 证书将在 30 天内过期或不可读"
    fi
  fi
}

check_firewall() {
  local ufw_output
  ufw_output="$(ufw status 2>/dev/null || true)"
  if [ -z "$ufw_output" ]; then
    low "无法读取 UFW 状态"
    return
  fi

  local legacy_ports
  legacy_ports="$(printf '%s\n' "$ufw_output" | grep -E '(^|[[:space:]])(5433|8080|8443)/tcp' || true)"
  if [ -n "$legacy_ports" ]; then
    high "UFW 仍开放历史业务端口：5433/8080/8443"
  else
    ok "UFW 未发现历史业务端口"
  fi
}

check_deploy_bundle() {
  check_required_file "$COMPOSE_DIR/compose.platform.yml"
  check_required_file "$COMPOSE_DIR/compose.nginx.yml"
  check_required_file "$COMPOSE_DIR/nginx/nginx.conf"
  check_required_file "$COMPOSE_DIR/scripts/12-generate-env-files.sh"
  check_required_file "$COMPOSE_DIR/scripts/13-prepare-runtime-env.sh"
  check_required_file "$COMPOSE_DIR/scripts/20-sync-nginx-config.sh"
  check_required_file "$COMPOSE_DIR/scripts/21-prepare-platform-database.sh"
  # DDL single-source-of-truth runners (data_platform_320); supersede 22-migrate / 23-seed.
  check_required_file "$COMPOSE_DIR/scripts/28-apply-platform-ddl.sh"
  check_required_file "$COMPOSE_DIR/scripts/29-seed-platform-ddl.sh"
  check_required_file "$COMPOSE_DIR/scripts/24-first-deploy-platform.sh"
  check_required_file "$COMPOSE_DIR/scripts/30-deploy-platform-stack.sh"
  check_required_file "$COMPOSE_DIR/scripts/31-regular-upgrade-platform.sh"
  check_required_file "$COMPOSE_DIR/scripts/40-verify-platform-runtime.sh"
  check_required_file "$COMPOSE_DIR/maintenance/62-reset-platform-database.sh"
}

check_backups() {
  local latest
  latest="$(find /srv/vxture/backups/runtime-env -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2- || true)"
  if [ -z "$latest" ]; then
    low "未发现 runtime-env 备份"
  else
    ok "最近 runtime-env 备份：$latest"
  fi
}

# Host memory headroom — worker-01 is ~1.6GB and has OOM-thrashed twice. Steady
# state leaves MemAvailable ~700MB; this is a steady-state drift check (weekly
# cron cadence), not a real-time OOM catch for deploy-time spikes.
check_host_memory() {
  local mem_avail_kb mem_avail_mb swap_total_kb swap_free_kb swap_free_mb
  mem_avail_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || true)"
  if [ -z "$mem_avail_kb" ]; then
    low "无法读取 /proc/meminfo MemAvailable"
    return
  fi
  mem_avail_mb=$((mem_avail_kb / 1024))
  if [ "$mem_avail_mb" -lt 150 ]; then
    high "可用内存偏低：MemAvailable=${mem_avail_mb}MB (<150MB，逼近 OOM)"
  elif [ "$mem_avail_mb" -lt 300 ]; then
    medium "可用内存吃紧：MemAvailable=${mem_avail_mb}MB (<300MB)"
  else
    ok "可用内存正常：MemAvailable=${mem_avail_mb}MB"
  fi

  swap_total_kb="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || true)"
  swap_free_kb="$(awk '/^SwapFree:/ {print $2}' /proc/meminfo 2>/dev/null || true)"
  if [ -n "$swap_total_kb" ] && [ "$swap_total_kb" -gt 0 ]; then
    swap_free_mb=$((swap_free_kb / 1024))
    if [ "$swap_free_mb" -lt 256 ]; then
      medium "swap 余量偏低：SwapFree=${swap_free_mb}MB (<256MB，重度换页)"
    else
      ok "swap 余量正常：SwapFree=${swap_free_mb}MB"
    fi
  else
    low "未启用 swap（建议 11-bootstrap-host.sh 配置 2G swapfile）"
  fi
}

echo "=== Vxture Platform Alerts ==="
check_os
check_tool_versions
check_runtime_files
check_env_residue
check_compose_images
check_docker_runtime
check_host_memory
check_container_health
check_nginx_and_tls
check_firewall
check_deploy_bundle
check_backups

echo "=== Summary: HIGH=$HIGH_COUNT MEDIUM=$MEDIUM_COUNT LOW=$LOW_COUNT ==="
if [ "$HIGH_COUNT" -gt 0 ]; then
  exit 1
fi
