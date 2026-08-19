#!/usr/bin/env bash
# deploy/scripts/30-deploy-platform-stack.sh
# 常规启动或更新平台栈。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-07
#
# 运行：bash 30-deploy-platform-stack.sh
# 用途：docker compose pull + up -d；不执行数据库 migration 或 seed。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$COMPOSE_DIR/compose.platform.yml"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"

# 变量加载器已抽到 lib/compose-env.sh —— 这里原有的 read_compose_env 是它的出处，
# 现在由所有 compose 调用方共用，避免各脚本各拿一份、tailnet 变量漏喂。
. "$COMPOSE_DIR/scripts/lib/compose-env.sh"
load_compose_env

IMAGE_REGISTRY="$VX_IMAGE_REGISTRY"
IMAGE_NAMESPACE="$VX_IMAGE_NAMESPACE"
IMAGE_TAG="$VX_IMAGE_TAG"

# ── 前置检查 ─────────────────────────────────────────────────────────────────

check_file() {
  if [ ! -f "$1" ]; then
    echo "  [缺失] $1"
    MISSING=1
  else
    echo "  [OK]   $1"
  fi
}

echo "==> [1/4] 前置检查"
MISSING=0

echo "  compose 文件:"
check_file "$COMPOSE_FILE"

echo "  环境变量文件:"
check_file "$RUNTIME_DIR/.env"
check_file "$RUNTIME_DIR/.env.auth-bff"
check_file "$RUNTIME_DIR/.env.gateway-bff"
check_file "$RUNTIME_DIR/.env.website-bff"
check_file "$RUNTIME_DIR/.env.console-bff"
check_file "$RUNTIME_DIR/.env.admin-bff"
check_file "$RUNTIME_DIR/.env.platform-api"

echo "  密钥文件:"
check_file "$RUNTIME_DIR/secrets/redis-password"
check_file "$RUNTIME_DIR/secrets/platform.env"
check_file "$RUNTIME_DIR/secrets/platform-mail.env"
check_file "$COMPOSE_DIR/guardrails/39-audit-env.mjs"

if [ "${MISSING:-0}" -eq 1 ]; then
  echo ""
  echo "错误：存在缺失文件，请先运行 13-prepare-runtime-env.sh 并补全真实 env 值后重试。"
  exit 1
fi

echo "  runtime env 审计:"
if ! command -v node >/dev/null 2>&1; then
  echo "  错误：env 审计依赖宿主机 node 运行 guardrails/39-audit-env.mjs。" >&2
  echo "  请先执行 deploy-manual-init/bootstrap/11-bootstrap-host.sh，或临时安装：sudo apt-get update && sudo apt-get install -y nodejs" >&2
  exit 1
fi
env VX_ENV_AUDIT_STRICT_RUNTIME=1 VX_WORKER_DIR="$COMPOSE_DIR" VX_RUNTIME_DIR="$RUNTIME_DIR" \
  node "$COMPOSE_DIR/guardrails/39-audit-env.mjs"

echo "  Tailscale 状态:"
tailscale status || echo "  !! Tailscale 未连接，外部业务 SSO / 内部调用链路可能不可用"

# ── 镜像仓库访问 ─────────────────────────────────────────────────────────────

echo ""
echo "==> [2/4] 镜像仓库访问（$IMAGE_REGISTRY/$IMAGE_NAMESPACE:$IMAGE_TAG）"
if [ "$IMAGE_REGISTRY" = "ghcr.io" ]; then
  echo "  使用 GHCR。如需优先拉 Aliyun ACR，请在执行前设置 VX_IMAGE_REGISTRY / VX_IMAGE_NAMESPACE / VX_IMAGE_TAG。"
else
  echo "  使用 Aliyun ACR：$IMAGE_REGISTRY/$IMAGE_NAMESPACE"
fi
echo "  如 registry 需要认证，请先在服务器上完成人工认证；本脚本不读取或保存 registry credential。"

# ── 拉取最新镜像 ──────────────────────────────────────────────────────────────

# ── 拉取 + 替换（逐服务，2C2G 省内存）─────────────────────────────────────────
# worker-01 = 2C2G。整栈一次性 `pull`（并行解压）+ `up -d`（尤其容器改名会全量重建）
# 会把内存打爆、拖垮 tailnet（2026-07-15 事故）。改为**逐服务**：一次拉一个、起一个，
# 停旧起新内存 1:1，全程稳。变更少时也只有受影响的服务真正重建。
echo ""
echo "==> [3/4]+[4/4] 逐服务拉取并替换（memory-safe）"
cd "$COMPOSE_DIR"
# VX_IMAGE_* 与 VX_WORKER0x_TAILNET_IP 已由 load_compose_env 导出，此处不再重复。
SERVICES="$(docker compose -f compose.platform.yml config --services)"
for svc in $SERVICES; do
  echo "  -- $svc: pull"
  docker compose -f compose.platform.yml pull "$svc" 2>&1 | grep -iE "Pulled|already|error|warn" | tail -1 || true
  echo "  -- $svc: up -d"
  docker compose -f compose.platform.yml up -d --no-deps "$svc"
done
# 收尾：移除改名/退役后的孤儿容器（已在跑的服务不重建）。
docker compose -f compose.platform.yml up -d --remove-orphans

# ── 等待就绪 ──────────────────────────────────────────────────────────────────

# 部署只负责"拉起并等待就绪"。完整健康/契约验证交给 40-verify-platform-runtime.sh，
# 基线/证书/防火墙等常态漂移巡检交给 platform-alerts 定时 workflow（51），均不在此重复。
# 变量在 load_compose_env 中已 export，无需重复。

echo ""
echo "==> 等待容器就绪（最多 ${VX_READINESS_TIMEOUT:-90}s）"
deadline=$(( $(date +%s) + ${VX_READINESS_TIMEOUT:-90} ))
while :; do
  # state 非 running，或 health 仍为 starting/unhealthy 的容器视为未就绪；无 healthcheck 的 running 容器视为就绪。
  pending="$(docker compose -f compose.platform.yml ps --format '{{.Name}} {{.State}} {{.Health}}' \
    | awk '$2 != "running" || $3 == "starting" || $3 == "unhealthy" { print $1 "(" $2 "/" $3 ")" }')"
  if [ -z "$pending" ]; then
    echo "  所有容器就绪。"
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "  !! 超时仍未就绪：$pending" >&2
    docker compose -f compose.platform.yml ps
    exit 1
  fi
  sleep 3
done

echo ""
docker compose -f compose.platform.yml ps --format "table {{.Name}}\t{{.Status}}"
echo ""
echo "平台栈已启动。下一步：bash scripts/40-verify-platform-runtime.sh"
