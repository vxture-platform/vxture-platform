#!/usr/bin/env bash
# deploy/scripts/33-recreate-service.sh
# 安全重建一个或多个平台服务以重载其 env（不走全量部署）。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-07-14
#
# 用途：改 secrets/platform.env 或 .env.{svc} 后，只想让受影响的服务重载新值时用本脚本。
#   TD-037：裸跑 `docker compose up -d <svc>` 有两个坑，第二个会拆掉在跑的容器：
#     ① registry 默认值陷阱——compose 用 ${VX_IMAGE_REGISTRY:-ghcr.io}，但生产跑阿里云 ACR，
#        registry/namespace/tag 三变量在 /srv/vxture/runtime/.env（不在 compose 目录）。裸跑 →
#        解析成 ghcr.io/…:latest → 私有仓 denied。
#     ② tag 注入陷阱——VX_IMAGE_TAG 由晋升流水线注入具体 sha-xxxxxxx，runtime/.env 里是 latest，
#        本地无 :latest 镜像 → --force-recreate 拉取失败前可能已停容器 → 单服务重建反致其下线。
#   本脚本 = source runtime/.env 带全三变量 + 把每个目标的 tag 钉到其**当前在跑容器的实际 tag**
#   + --pull never --no-deps + 前置校验目标镜像本地存在（不存在则拒绝，绝不 --force-recreate 拆容器）。
#
# 运行：bash 33-recreate-service.sh <service> [<service> ...]
#   service = compose 服务名（不是容器名）：
#     auth-bff  admin-bff  console-bff  website-bff  gateway-bff
#     platform-api  website  console  admin  accounts  opera  opera-bff
#   （postgres/redis 有状态，本脚本拒绝重建——改配置请另行评估。）
#
# 注意：本脚本只重载 env / 重建容器，**不拉新镜像、不改代码版本**。要上新代码走晋升 → deploy。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# 统一变量入口：compose 里的 ${VX_*} 在调用方进程环境求值，tailnet 地址既不能
# 空默认（会绑定全网卡）也不能缺值即炸（排障脚本正是最需要能跑的时候）。
. "$COMPOSE_DIR/scripts/lib/compose-env.sh"
load_compose_env
COMPOSE_FILE="$COMPOSE_DIR/compose.platform.yml"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"

# compose 服务名 → 容器名（用于按实际在跑镜像取 tag）。有状态服务不在册。
declare -A CONTAINER_OF=(
  [auth-bff]=vx-platform-auth-bff
  [admin-bff]=vx-platform-admin-bff
  [console-bff]=vx-platform-console-bff
  [website-bff]=vx-platform-website-bff
  [gateway-bff]=vx-platform-gateway-bff
  [platform-api]=vx-platform-api
  [website]=vx-platform-website
  [console]=vx-platform-console
  [admin]=vx-platform-admin
  [accounts]=vx-platform-accounts
  [opera]=vx-platform-opera
  [opera-bff]=vx-platform-opera-bff
)

if [ "$#" -eq 0 ]; then
  echo "用法：bash 33-recreate-service.sh <service> [<service> ...]" >&2
  echo "可选服务：${!CONTAINER_OF[*]}" >&2
  exit 2
fi

# ── 参数校验（先全量校验再动手，任一非法即整体拒绝）─────────────────────────
for svc in "$@"; do
  if [ -z "${CONTAINER_OF[$svc]+x}" ]; then
    echo "错误：未知或不可重建的服务 '$svc'（有状态服务如 postgres/redis 不在册）。" >&2
    echo "可选：${!CONTAINER_OF[*]}" >&2
    exit 2
  fi
done

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "错误：缺少 $COMPOSE_FILE" >&2
  exit 1
fi
if [ ! -f "$RUNTIME_DIR/.env" ]; then
  echo "错误：缺少 $RUNTIME_DIR/.env（registry/namespace 变量来源）" >&2
  exit 1
fi

# ── 取 registry / namespace（tag 逐服务从在跑容器取，不用 .env 的 latest）──────
set -a
# shellcheck disable=SC1091
. "$RUNTIME_DIR/.env"
set +a
: "${VX_IMAGE_REGISTRY:?运行时 .env 未定义 VX_IMAGE_REGISTRY}"
: "${VX_IMAGE_NAMESPACE:?运行时 .env 未定义 VX_IMAGE_NAMESPACE}"

echo "==> [1/3] 逐服务解析在跑镜像 + 前置校验本地镜像存在"
declare -A TAG_OF
for svc in "$@"; do
  cname="${CONTAINER_OF[$svc]}"
  if ! docker inspect "$cname" >/dev/null 2>&1; then
    echo "  错误：容器 $cname（服务 $svc）当前未运行——本脚本只重建在跑服务，拒绝执行。" >&2
    exit 1
  fi
  # 该容器实际在跑的镜像引用，如 crpi-….aliyuncs.com/vxture/platform_bff-auth:sha-732a0dc
  running_image="$(docker inspect --format '{{.Config.Image}}' "$cname")"
  running_tag="${running_image##*:}"
  if [ -z "$running_tag" ] || [ "$running_tag" = "$running_image" ]; then
    echo "  错误：无法从在跑镜像解析 tag（$running_image）。" >&2
    exit 1
  fi
  # 前置校验：本地必须已有该镜像（否则 --pull never 会失败，但先在这里挡住，绝不进 up）
  if ! docker image inspect "$running_image" >/dev/null 2>&1; then
    echo "  错误：本地缺少镜像 $running_image——拒绝重建（避免拆掉在跑容器后拉取失败致其下线）。" >&2
    exit 1
  fi
  TAG_OF[$svc]="$running_tag"
  echo "  [OK] $svc → $cname，tag=$running_tag（本地镜像在册）"
done

# 多服务时所有 tag 必须一致（同一晋升车产的镜像同 tag；不一致说明状态可疑，拒绝以防混用）
uniq_tags="$(printf '%s\n' "${TAG_OF[@]}" | sort -u)"
tag_count="$(printf '%s\n' "$uniq_tags" | grep -c . || true)"
if [ "$tag_count" -ne 1 ]; then
  echo "错误：目标服务在跑镜像 tag 不一致（$(printf '%s ' $uniq_tags)）——拒绝混批重建，请分别执行或先对齐。" >&2
  exit 1
fi
PIN_TAG="$uniq_tags"

echo ""
echo "==> [2/3] 重建（--pull never --no-deps，钉 tag=$PIN_TAG，仅目标服务）"
cd "$COMPOSE_DIR"
VX_IMAGE_REGISTRY="$VX_IMAGE_REGISTRY" \
VX_IMAGE_NAMESPACE="$VX_IMAGE_NAMESPACE" \
VX_IMAGE_TAG="$PIN_TAG" \
  docker compose -f compose.platform.yml up -d --pull never --no-deps --force-recreate "$@"

echo ""
echo "==> [3/3] 等待目标容器就绪（最多 ${VX_READINESS_TIMEOUT:-90}s）"
deadline=$(( $(date +%s) + ${VX_READINESS_TIMEOUT:-90} ))
for svc in "$@"; do
  cname="${CONTAINER_OF[$svc]}"
  while :; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cname" 2>/dev/null || echo missing)"
    case "$status" in
      healthy|running) echo "  [OK] $cname → $status"; break ;;
    esac
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "  !! $cname 超时未就绪（当前=$status）——请查 docker logs $cname" >&2
      exit 1
    fi
    sleep 3
  done
done

echo ""
echo "完成：$* 已按在跑镜像 tag=$PIN_TAG 重建并就绪，env 已重载。"
