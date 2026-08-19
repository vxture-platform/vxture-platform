#!/usr/bin/env bash
# deploy/scripts/21-prepare-platform-database.sh
# 检查平台数据库（阿里云 RDS PostgreSQL）连通与登录能力。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-07
#
# 2026-08-19 RDS 切换：本地 vx-platform-pg 容器退役，库在阿里云 RDS（内网 endpoint，
# DATABASE_URL 在 secrets/platform.env）。本脚本不再管理容器生命周期，只做
# runtime env 审计 + DATABASE_URL 登录验证。库的建立/重置见 28-apply-platform-ddl.sh。
#
# 运行：bash 21-prepare-platform-database.sh
# 幂等：只读检查，不执行迁移或 seed。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"

check_file() {
  if [ ! -f "$1" ]; then
    echo "错误：缺少 $1" >&2
    exit 1
  fi
}

echo "==> [DB 1/2] 前置检查 + runtime env 审计"
check_file "$RUNTIME_DIR/secrets/platform.env"
check_file "$COMPOSE_DIR/guardrails/39-audit-env.mjs"
env VX_ENV_AUDIT_STRICT_RUNTIME=1 VX_WORKER_DIR="$COMPOSE_DIR" VX_RUNTIME_DIR="$RUNTIME_DIR" \
  node "$COMPOSE_DIR/guardrails/39-audit-env.mjs"

echo "==> [DB 2/2] 验证 DATABASE_URL 可登录（RDS）"
if ! docker run --rm \
  --env-file "$RUNTIME_DIR/secrets/platform.env" \
  postgres:18-alpine \
  sh -lc 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select 1" >/dev/null'; then
  echo "错误：DATABASE_URL 无法登录 RDS。" >&2
  echo "请检查 secrets/platform.env 的 DATABASE_URL、RDS 白名单是否放行本机内网 IP、账号密码是否与 RDS 侧一致。" >&2
  exit 1
fi

echo "=== Platform database check ready ==="
