#!/usr/bin/env bash
# deploy/scripts/21-prepare-platform-database.sh
# 检查平台数据库运行状态和登录能力。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-07
#
# 运行：bash 21-prepare-platform-database.sh
# 幂等：只启动 PostgreSQL、等待健康并验证 DATABASE_URL 可登录，不执行迁移或 seed。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# 统一变量入口：compose 里的 ${VX_*} 在调用方进程环境求值，tailnet 地址既不能
# 空默认（会绑定全网卡）也不能缺值即炸（排障脚本正是最需要能跑的时候）。
. "$COMPOSE_DIR/scripts/lib/compose-env.sh"
load_compose_env
COMPOSE_FILE="$COMPOSE_DIR/compose.platform.yml"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
POSTGRES_DATA_DIR="${POSTGRES_DATA_DIR:-/srv/vxture/data/platform-pg}"
POSTGRES_DATA_OWNER="${POSTGRES_DATA_OWNER:-70:70}"

IMAGE_REGISTRY="${VX_IMAGE_REGISTRY:-ghcr.io}"
IMAGE_NAMESPACE="${VX_IMAGE_NAMESPACE:-vxture}"
IMAGE_TAG="${VX_IMAGE_TAG:-latest}"

check_file() {
  if [ ! -f "$1" ]; then
    echo "错误：缺少 $1" >&2
    exit 1
  fi
}

echo "==> [DB 1/4] 前置检查"
check_file "$COMPOSE_FILE"
check_file "$RUNTIME_DIR/secrets/platform.env"
check_file "$RUNTIME_DIR/secrets/pg-password"
check_file "$COMPOSE_DIR/guardrails/39-audit-env.mjs"

if [ ! -d "$POSTGRES_DATA_DIR" ]; then
  echo "错误：PostgreSQL 数据目录不存在：$POSTGRES_DATA_DIR" >&2
  echo "请在服务器手动执行：sudo CONFIRM_RESET=yes bash maintenance/62-reset-platform-database.sh" >&2
  exit 1
fi

actual_owner="$(stat -c '%u:%g' "$POSTGRES_DATA_DIR" 2>/dev/null || true)"
if [ "$actual_owner" != "$POSTGRES_DATA_OWNER" ]; then
  echo "错误：PostgreSQL 数据目录 owner 不符合容器运行要求：$POSTGRES_DATA_DIR = $actual_owner，期望 $POSTGRES_DATA_OWNER" >&2
  echo "请在服务器手动执行：sudo CONFIRM_RESET=yes bash maintenance/62-reset-platform-database.sh" >&2
  echo "该脚本会归档旧 PostgreSQL 数据目录并重建正确权限的新目录。" >&2
  exit 1
fi

echo "  runtime env 审计:"
env VX_ENV_AUDIT_STRICT_RUNTIME=1 VX_WORKER_DIR="$COMPOSE_DIR" VX_RUNTIME_DIR="$RUNTIME_DIR" \
  node "$COMPOSE_DIR/guardrails/39-audit-env.mjs"

echo "==> [DB 2/4] 确保 PostgreSQL 已启动"
cd "$COMPOSE_DIR"
VX_IMAGE_REGISTRY="$IMAGE_REGISTRY" VX_IMAGE_NAMESPACE="$IMAGE_NAMESPACE" VX_IMAGE_TAG="$IMAGE_TAG" \
  docker compose -f "$COMPOSE_FILE" up -d postgres

echo "==> [DB 3/4] 等待 PostgreSQL 健康"
for i in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' vx-platform-pg 2>/dev/null || true)"
  if [ "$status" = "healthy" ]; then
    echo "PostgreSQL healthy"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "错误：PostgreSQL 未在预期时间内变为 healthy" >&2
    docker logs vx-platform-pg --tail 80 >&2 || true
    exit 1
  fi
  sleep 2
done

echo "==> [DB 4/4] 验证 DATABASE_URL 可登录 PostgreSQL"
if ! docker run --rm \
  --network vxture-prod \
  --env-file "$RUNTIME_DIR/secrets/platform.env" \
  postgres:18-alpine \
  sh -lc 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select 1" >/dev/null'; then
  echo "错误：DATABASE_URL 无法登录 vx-platform-pg。" >&2
  echo "请检查 DATABASE_URL 密码、secrets/pg-password 与已初始化 PostgreSQL 数据目录是否一致。" >&2
  echo "新服务器且无需保留当前 PostgreSQL 数据时，可按文档使用 maintenance/62-reset-platform-database.sh 后重新部署。" >&2
  exit 1
fi

echo "=== Platform database check ready ==="
